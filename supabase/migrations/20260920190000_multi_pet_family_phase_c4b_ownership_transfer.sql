begin;

do $$
begin
  if exists (
    select 1
    from public.families as family
    where (
      select count(*)
      from public.family_members as membership
      where membership.family_id = family.id
        and membership.role = 'owner'
    ) <> 1
  ) then
    raise exception 'Phase C4B requires exactly one Owner per existing Family';
  end if;
end;
$$;

-- The existing partial unique index remains the single at-most-one Owner
-- constraint. This deferred check supplies the at-least-one half for every
-- live Family, including a Family with no Pets.
create or replace function private.validate_family_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.families as family
    where family.id = old.family_id
  ) and (
    select count(*)
    from public.family_members as membership
    where membership.family_id = old.family_id
      and membership.role = 'owner'
  ) <> 1 then
    raise exception 'family must keep exactly one owner' using errcode = '23514';
  end if;

  return old;
end;
$$;

comment on function private.validate_family_keeps_owner() is
  'Deferred Family-root Owner invariant. Every live Family keeps exactly one canonical Owner, even with zero Pets.';

create or replace function private.validate_new_family_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.families as family
    where family.id = new.id
  ) and (
    select count(*)
    from public.family_members as membership
    where membership.family_id = new.id
      and membership.role = 'owner'
  ) <> 1 then
    raise exception 'family must keep exactly one owner' using errcode = '23514';
  end if;

  return new;
end;
$$;

create constraint trigger validate_new_family_has_owner
after insert on public.families
deferrable initially deferred
for each row execute function private.validate_new_family_has_owner();

revoke execute on function private.validate_new_family_has_owner()
  from public, anon, authenticated;

create or replace function public.transfer_family_ownership(
  target_family_id uuid,
  new_owner_user_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  locked_family_id uuid;
  target_role public.pet_member_role;
  revocation_time timestamptz := now();
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_family_id is null or new_owner_user_id is null
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

  -- C2/C3/C4B Family mutations share this namespace and acquire it first.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  select family.id into locked_family_id
  from public.families as family
  where family.id = target_family_id
  for update;

  if locked_family_id is null
    or not exists (
      select 1
      from public.family_members as membership
      where membership.family_id = target_family_id
        and membership.user_id = caller_id
        and membership.role = 'owner'
    )
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

  -- Canonical rows precede Pets and mirrors in the shared lock order.
  perform membership.user_id
  from public.family_members as membership
  where membership.family_id = target_family_id
  order by membership.user_id
  for update;

  if new_owner_user_id = caller_id then
    return 'already_owner';
  end if;

  select membership.role into target_role
  from public.family_members as membership
  where membership.family_id = target_family_id
    and membership.user_id = new_owner_user_id;

  if target_role is distinct from 'member' then
    raise exception 'new owner must be an active member' using errcode = '42501';
  end if;

  perform pet.id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.id
  for update;

  perform mirror.pet_id
  from public.pet_members as mirror
  join public.pets as pet on pet.id = mirror.pet_id
  where pet.family_id = target_family_id
    and mirror.user_id in (caller_id, new_owner_user_id)
  order by mirror.pet_id, mirror.user_id
  for update of mirror;

  update public.family_members
  set role = 'member'
  where family_id = target_family_id
    and user_id = caller_id
    and role = 'owner';

  update public.family_members
  set role = 'owner'
  where family_id = target_family_id
    and user_id = new_owner_user_id
    and role = 'member';

  update public.pet_members as mirror
  set role = 'member'
  from public.pets as pet
  where pet.id = mirror.pet_id
    and pet.family_id = target_family_id
    and mirror.user_id = caller_id
    and mirror.role = 'owner';

  update public.pet_members as mirror
  set role = 'owner'
  from public.pets as pet
  where pet.id = mirror.pet_id
    and pet.family_id = target_family_id
    and mirror.user_id = new_owner_user_id
    and mirror.role = 'member';

  if exists (
    select 1
    from public.pets as pet
    cross join public.family_members as canonical
    where pet.family_id = target_family_id
      and canonical.family_id = pet.family_id
      and not exists (
        select 1
        from public.pet_members as mirror
        where mirror.pet_id = pet.id
          and mirror.user_id = canonical.user_id
          and mirror.role = canonical.role
          and mirror.created_at = canonical.created_at
      )
  ) or exists (
    select 1
    from public.pet_members as mirror
    join public.pets as pet on pet.id = mirror.pet_id
    where pet.family_id = target_family_id
      and not exists (
        select 1
        from public.family_members as canonical
        where canonical.family_id = pet.family_id
          and canonical.user_id = mirror.user_id
          and canonical.role = mirror.role
          and canonical.created_at = mirror.created_at
      )
  ) then
    raise exception 'family membership mirror drift' using errcode = 'P0001';
  end if;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  update public.pet_invites as legacy
  set revoked_at = revocation_time
  from public.family_invites as canonical
  where canonical.id = legacy.id
    and canonical.family_id = target_family_id
    and canonical.revoked_at = revocation_time
    and legacy.revoked_at is null;

  return 'transferred';
end;
$$;

comment on function public.transfer_family_ownership(uuid, uuid) is
  'Transfers one Family from its canonical Owner to an active Member, mirrors every Pet role, and revokes the current invite atomically.';

revoke execute on function public.transfer_family_ownership(uuid, uuid)
  from public, anon;
grant execute on function public.transfer_family_ownership(uuid, uuid)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'family_members_one_owner_per_family'
      and indexdef like '%WHERE (role = ''owner''%'
  ) then
    raise exception 'Phase C4B requires the canonical one-Owner partial unique index';
  end if;

  if exists (
    select 1
    from public.families as family
    where (
      select count(*)
      from public.family_members as membership
      where membership.family_id = family.id
        and membership.role = 'owner'
    ) <> 1
  ) then
    raise exception 'Phase C4B found a Family Owner invariant violation';
  end if;
end;
$$;

commit;

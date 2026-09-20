begin;

create or replace function public.leave_family(target_family_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  locked_family_id uuid;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_family_id is null then
    raise exception 'family not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  select family.id into locked_family_id
  from public.families as family
  where family.id = target_family_id
  for update;

  if locked_family_id is null then
    raise exception 'family not found' using errcode = '42501';
  end if;

  perform membership.user_id
  from public.family_members as membership
  where membership.family_id = target_family_id
  order by membership.user_id
  for update;

  select membership.role into caller_role
  from public.family_members as membership
  where membership.family_id = target_family_id
    and membership.user_id = caller_id;

  if caller_role is null then
    raise exception 'family not found' using errcode = '42501';
  end if;

  if caller_role = 'owner' then
    raise exception 'owner cannot leave family' using errcode = '42501';
  end if;

  if caller_role not in ('member', 'viewer') then
    raise exception 'family not found' using errcode = '42501';
  end if;

  perform pet.id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.id
  for key share;

  perform mirror.pet_id
  from public.pet_members as mirror
  join public.pets as pet on pet.id = mirror.pet_id
  where pet.family_id = target_family_id
    and mirror.user_id = caller_id
  order by mirror.pet_id
  for update of mirror;

  delete from public.pet_members as mirror
  using public.pets as pet
  where pet.id = mirror.pet_id
    and pet.family_id = target_family_id
    and mirror.user_id = caller_id;

  delete from public.family_members
  where family_id = target_family_id
    and user_id = caller_id
    and role = caller_role;

  if exists (
    select 1
    from public.pet_members as mirror
    join public.pets as pet on pet.id = mirror.pet_id
    where pet.family_id = target_family_id
      and mirror.user_id = caller_id
  ) then
    raise exception 'family membership mirror drift' using errcode = 'P0001';
  end if;

  return 'left';
end;
$$;

comment on function public.leave_family(uuid) is
  'Lets an authenticated canonical Member or Viewer leave one Family without revoking its active invite.';

revoke execute on function public.leave_family(uuid)
  from public, anon;
grant execute on function public.leave_family(uuid)
  to authenticated;

create or replace function public.remove_family_member(
  target_family_id uuid,
  target_user_id uuid
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

  if target_family_id is null or target_user_id is null
    or target_user_id = caller_id
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

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

  perform membership.user_id
  from public.family_members as membership
  where membership.family_id = target_family_id
  order by membership.user_id
  for update;

  select membership.role into target_role
  from public.family_members as membership
  where membership.family_id = target_family_id
    and membership.user_id = target_user_id;

  if target_role is null then
    return 'not_found';
  end if;

  if target_role not in ('member', 'viewer') then
    raise exception 'member cannot be removed' using errcode = '42501';
  end if;

  perform pet.id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.id
  for key share;

  perform mirror.pet_id
  from public.pet_members as mirror
  join public.pets as pet on pet.id = mirror.pet_id
  where pet.family_id = target_family_id
    and mirror.user_id = target_user_id
  order by mirror.pet_id
  for update of mirror;

  delete from public.pet_members as mirror
  using public.pets as pet
  where pet.id = mirror.pet_id
    and pet.family_id = target_family_id
    and mirror.user_id = target_user_id;

  delete from public.family_members
  where family_id = target_family_id
    and user_id = target_user_id
    and role = target_role;

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

  if exists (
    select 1
    from public.pet_members as mirror
    join public.pets as pet on pet.id = mirror.pet_id
    where pet.family_id = target_family_id
      and mirror.user_id = target_user_id
  ) then
    raise exception 'family membership mirror drift' using errcode = 'P0001';
  end if;

  return 'removed';
end;
$$;

comment on function public.remove_family_member(uuid, uuid) is
  'Lets the canonical Family Owner remove a Member or Viewer from every Pet mirror and revokes the active invite.';

revoke execute on function public.remove_family_member(uuid, uuid)
  from public, anon;
grant execute on function public.remove_family_member(uuid, uuid)
  to authenticated;

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
    raise exception 'Phase C4C found a Family Owner invariant violation';
  end if;

  if exists (
    select 1
    from public.pets as pet
    cross join public.family_members as canonical
    where canonical.family_id = pet.family_id
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
    where not exists (
      select 1
      from public.family_members as canonical
      where canonical.family_id = pet.family_id
        and canonical.user_id = mirror.user_id
        and canonical.role = mirror.role
        and canonical.created_at = mirror.created_at
    )
  ) then
    raise exception 'Phase C4C found Family membership mirror drift';
  end if;
end;
$$;

commit;

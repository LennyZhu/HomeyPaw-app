begin;

comment on function public.create_pet(
  text,
  public.pet_species,
  text,
  public.pet_gender,
  date,
  date,
  numeric,
  text
) is
  'Legacy create-new-Family flow: creates one new Family and its first Pet.';

create or replace function public.create_family_pet(
  target_family_id uuid,
  pet_name text,
  pet_species public.pet_species,
  pet_breed text default null,
  pet_gender public.pet_gender default 'unknown',
  pet_birthday date default null,
  pet_adoption_date date default null,
  pet_weight numeric default null,
  pet_description text default null
)
returns public.pets
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  created_pet public.pets;
  locked_family_id uuid;
  anchor_pet_id uuid;
  safe_name text;
  safe_breed text;
  safe_description text;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_family_owner(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  -- Family lifecycle mutations use the same namespace and acquire this lock
  -- before any Pet, membership, invite, Chat, or Schedule row lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  select family.id into locked_family_id
  from public.families as family
  where family.id = target_family_id
  for update;

  if locked_family_id is null
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

  safe_name := btrim(coalesce(pet_name, ''));
  safe_breed := nullif(btrim(coalesce(pet_breed, '')), '');
  safe_description := nullif(btrim(coalesce(pet_description, '')), '');

  insert into public.pets (
    name,
    species,
    breed,
    gender,
    birthday,
    adoption_date,
    weight,
    description,
    family_id
  )
  values (
    safe_name,
    pet_species,
    safe_breed,
    coalesce(pet_gender, 'unknown'),
    pet_birthday,
    pet_adoption_date,
    pet_weight,
    safe_description,
    target_family_id
  )
  returning * into created_pet;

  insert into public.pet_members (pet_id, user_id, role, created_at)
  select
    created_pet.id,
    membership.user_id,
    membership.role,
    membership.created_at
  from public.family_members as membership
  where membership.family_id = target_family_id
  order by
    case when membership.role = 'owner' then 0 else 1 end,
    membership.created_at,
    membership.user_id;

  if not exists (
    select 1
    from public.pet_members as membership
    where membership.pet_id = created_pet.id
      and membership.role = 'owner'
  ) then
    raise exception 'family must keep one owner' using errcode = '23514';
  end if;

  -- A zero-Pet Family has no possible legacy invite anchor. Recreating its
  -- first Pet restores the single compatibility representation without
  -- changing canonical invite identity or state.
  select pet.id into anchor_pet_id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.created_at, pet.id
  limit 1;

  insert into public.pet_invites (
    id,
    pet_id,
    invited_by,
    code_hash,
    expires_at,
    max_uses,
    used_count,
    revoked_at,
    created_at
  )
  select
    invite.id,
    anchor_pet_id,
    invite.invited_by,
    invite.code_hash,
    invite.expires_at,
    invite.max_uses,
    invite.used_count,
    invite.revoked_at,
    invite.created_at
  from public.family_invites as invite
  where invite.family_id = target_family_id
    and not exists (
      select 1
      from public.pet_invites as legacy
      where legacy.id = invite.id
    )
  order by invite.created_at, invite.id;

  return created_pet;
end;
$$;

comment on function public.create_family_pet(
  uuid,
  text,
  public.pet_species,
  text,
  public.pet_gender,
  date,
  date,
  numeric,
  text
) is
  'Owner-only add-Pet-to-existing-Family flow. Mirrors every canonical Family member and never creates a Family.';

create or replace function private.reanchor_family_invites_before_pet_delete()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  next_anchor_pet_id uuid;
begin
  if old.family_id is null then
    return old;
  end if;

  -- Direct legacy DELETE remains compatible, but it must fail fast instead of
  -- taking locks in the reverse order while a Family mutation is in flight.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(old.family_id::text, 4815162342)
  ) then
    raise exception 'family_pet_lifecycle_busy' using errcode = 'P0001';
  end if;

  select pet.id into next_anchor_pet_id
  from public.pets as pet
  where pet.family_id = old.family_id
    and pet.id <> old.id
  order by pet.created_at, pet.id
  limit 1
  for update;

  if next_anchor_pet_id is not null then
    update public.pet_invites
    set pet_id = next_anchor_pet_id
    where pet_id = old.id;
  end if;

  -- When this is the last Pet, the legacy rows cascade with it. Canonical
  -- family_invites remain valid and can be rehydrated by create_family_pet.
  return old;
end;
$$;

create trigger reanchor_family_invites_before_pet_delete
before delete on public.pets
for each row execute function private.reanchor_family_invites_before_pet_delete();

create or replace function public.delete_family_pet(target_pet_id uuid)
returns table (
  deleted_family_id uuid,
  next_pet_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
  locked_pet_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  select pet.id into locked_pet_id
  from public.pets as pet
  where pet.id = target_pet_id
    and pet.family_id = target_family_id
  for update;

  if locked_pet_id is null
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  delete from public.pets
  where id = target_pet_id;

  return query
  select
    target_family_id,
    (
      select pet.id
      from public.pets as pet
      where pet.family_id = target_family_id
      order by pet.created_at, pet.id
      limit 1
    );
end;
$$;

comment on function public.delete_family_pet(uuid) is
  'Owner-only single-Pet deletion. Keeps the Family, canonical members, and canonical invites; returns the stable next Pet or null.';

revoke execute on function public.create_family_pet(
  uuid,
  text,
  public.pet_species,
  text,
  public.pet_gender,
  date,
  date,
  numeric,
  text
) from public, anon;
revoke execute on function public.delete_family_pet(uuid)
  from public, anon;
revoke execute on function private.reanchor_family_invites_before_pet_delete()
  from public, anon, authenticated;

grant execute on function public.create_family_pet(
  uuid,
  text,
  public.pet_species,
  text,
  public.pet_gender,
  date,
  date,
  numeric,
  text
) to authenticated;
grant execute on function public.delete_family_pet(uuid) to authenticated;

do $$
begin
  if exists (
    select 1
    from public.pets as pet
    cross join public.family_members as family_member
    where family_member.family_id = pet.family_id
      and not exists (
        select 1
        from public.pet_members as pet_member
        where pet_member.pet_id = pet.id
          and pet_member.user_id = family_member.user_id
          and pet_member.role = family_member.role
          and pet_member.created_at = family_member.created_at
      )
  ) or exists (
    select 1
    from public.pet_members as pet_member
    join public.pets as pet on pet.id = pet_member.pet_id
    where not exists (
      select 1
      from public.family_members as family_member
      where family_member.family_id = pet.family_id
        and family_member.user_id = pet_member.user_id
        and family_member.role = pet_member.role
        and family_member.created_at = pet_member.created_at
    )
  ) then
    raise exception 'Phase C3 found membership mirror drift';
  end if;

  if exists (
    select 1
    from public.family_invites as family_invite
    where (
      select count(*)
      from public.pet_invites as pet_invite
      join public.pets as pet on pet.id = pet_invite.pet_id
      where pet_invite.id = family_invite.id
        and pet.family_id = family_invite.family_id
        and pet_invite.invited_by = family_invite.invited_by
        and pet_invite.code_hash = family_invite.code_hash
        and pet_invite.expires_at = family_invite.expires_at
        and pet_invite.max_uses = family_invite.max_uses
        and pet_invite.used_count = family_invite.used_count
        and pet_invite.revoked_at is not distinct from family_invite.revoked_at
        and pet_invite.created_at = family_invite.created_at
        and pet_invite.pet_id = (
          select anchor.id
          from public.pets as anchor
          where anchor.family_id = family_invite.family_id
          order by anchor.created_at, anchor.id
          limit 1
        )
    ) <> case
      when exists (
        select 1
        from public.pets as pet
        where pet.family_id = family_invite.family_id
      ) then 1
      else 0
    end
  ) or exists (
    select 1
    from public.pet_invites as pet_invite
    where not exists (
      select 1
      from public.family_invites as family_invite
      where family_invite.id = pet_invite.id
    )
  ) then
    raise exception 'Phase C3 found invite anchor drift';
  end if;
end;
$$;

commit;

begin;

-- Leaving/removal physically deletes canonical memberships. Fail closed on
-- pre-existing multi-Family accounts; no automatic reassignment or data loss.
do $$
begin
  if exists (
    select 1 from public.family_members
    group by user_id having count(*) > 1
  ) then
    raise exception 'C4I_DUPLICATE_FAMILY_MEMBERSHIP_REQUIRES_MANUAL_CLEANUP'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Complements the existing one-Owner-per-Family partial unique index.
create unique index family_members_one_family_per_user
  on public.family_members (user_id);

-- Extend C4G's existing guard: the same locked Auth row serializes create,
-- invite accept, and account deletion preparation. The unique index remains
-- the final database-level invariant for every write path.
create or replace function private.guard_account_membership_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_user_id uuid;
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.role = old.role then
    return new;
  end if;

  select users.id into locked_user_id
  from auth.users as users
  where users.id = new.user_id
  for update;

  if locked_user_id is null or exists (
    select 1 from private.account_deletion_preparations as preparation
    where preparation.user_id = new.user_id
  ) then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS' using errcode = 'P0001';
  end if;

  if tg_table_name = 'family_members' then
    if tg_op = 'INSERT' then
      if exists (select 1 from public.family_members where user_id = new.user_id) then
        raise exception 'ALREADY_IN_FAMILY' using errcode = 'P0001';
      end if;
    elsif new.user_id is distinct from old.user_id then
      if exists (
        select 1 from public.family_members as membership
        where membership.user_id = new.user_id
          and membership.family_id <> old.family_id
      ) then
        raise exception 'ALREADY_IN_FAMILY' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.create_pet(
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
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  created_pet public.pets;
  created_family_id uuid;
  owner_created_at timestamptz;
  safe_name text;
  safe_breed text;
  safe_description text;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Reuse the C4G account lifecycle row lock before creating any Family rows.
  perform 1 from auth.users where id = caller_id for update;
  if exists (
    select 1 from public.family_members where user_id = caller_id
  ) then
    raise exception 'ALREADY_IN_FAMILY' using errcode = 'P0001';
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
    description
  )
  values (
    safe_name,
    pet_species,
    safe_breed,
    coalesce(pet_gender, 'unknown'),
    pet_birthday,
    pet_adoption_date,
    pet_weight,
    safe_description
  )
  returning * into created_pet;

  insert into public.families (created_at)
  values (created_pet.created_at)
  returning id into created_family_id;

  update public.pets
  set family_id = created_family_id
  where id = created_pet.id
  returning * into created_pet;

  insert into public.pet_members (pet_id, user_id, role)
  values (created_pet.id, caller_id, 'owner')
  returning created_at into owner_created_at;

  insert into public.family_members (
    family_id,
    user_id,
    role,
    created_at
  )
  values (
    created_family_id,
    caller_id,
    'owner',
    owner_created_at
  );

  return created_pet;
end;
$$;

create or replace function public.join_family_with_invite(invite_code text)
returns table (
  join_status text,
  joined_family_id uuid,
  display_pet_id uuid,
  display_pet_name text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  normalized_code text;
  invite_hash text;
  matched_family_id uuid;
  matched_invite public.family_invites;
  anchor_pet_id uuid;
  anchor_pet_name text;
  membership_created_at timestamptz;
  updated_invite public.family_invites;
  mirrored_count integer;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  normalized_code := private.normalize_pet_invite_code(invite_code);
  if normalized_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  invite_hash := private.pet_invite_code_hash(normalized_code);

  select invite.family_id into matched_family_id
  from public.family_invites as invite
  where invite.code_hash = invite_hash;

  if matched_family_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(matched_family_id::text, 4815162342)
  );

  select invite.* into matched_invite
  from public.family_invites as invite
  where invite.code_hash = invite_hash
    and invite.family_id = matched_family_id
  for update;

  if matched_invite.id is null
    or matched_invite.revoked_at is not null
    or matched_invite.expires_at <= now()
  then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  perform pet.id
  from public.pets as pet
  where pet.family_id = matched_family_id
  order by pet.id
  for share;

  select pet.id, pet.name
  into anchor_pet_id, anchor_pet_name
  from public.pets as pet
  where pet.family_id = matched_family_id
  order by pet.created_at, pet.id
  limit 1;

  if anchor_pet_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  -- Preserve the Family-first lock order, then serialize all joins for this
  -- account with the same Auth row lock used by C4G deletion preparation.
  perform 1 from auth.users where id = caller_id for update;
  if exists (
    select 1 from public.family_members where user_id = caller_id
  ) then
    raise exception 'ALREADY_IN_FAMILY' using errcode = 'P0001';
  end if;

  if matched_invite.used_count >= matched_invite.max_uses then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  membership_created_at := now();
  insert into public.family_members (family_id, user_id, role, created_at)
  values (matched_family_id, caller_id, 'member', membership_created_at);

  insert into public.pet_members (pet_id, user_id, role, created_at)
  select pet.id, caller_id, 'member', membership_created_at
  from public.pets as pet
  where pet.family_id = matched_family_id
  order by pet.id;

  update public.family_invites
  set used_count = used_count + 1
  where id = matched_invite.id
  returning * into updated_invite;

  update public.pet_invites
  set
    invited_by = updated_invite.invited_by,
    code_hash = updated_invite.code_hash,
    expires_at = updated_invite.expires_at,
    max_uses = updated_invite.max_uses,
    used_count = updated_invite.used_count,
    revoked_at = updated_invite.revoked_at,
    created_at = updated_invite.created_at
  where id = updated_invite.id;

  get diagnostics mirrored_count = row_count;
  if mirrored_count <> 1 then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  return query
  select 'joined'::text, matched_family_id, anchor_pet_id, anchor_pet_name;
end;
$$;

comment on index public.family_members_one_family_per_user is
  'C4I: one active canonical Family membership per account.';

commit;

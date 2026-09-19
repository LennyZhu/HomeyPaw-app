-- Repair Pets created after Phase A but before the B1 compatibility RPCs.
-- The mapping table is private and removed before this migration completes.
-- Hold legacy and mirror writes while the repair snapshot and replacement RPCs
-- are installed so a concurrent mutation cannot escape the compatibility pass.
begin;

lock table
  public.pets,
  public.pet_members,
  public.pet_invites,
  public.family_members,
  public.family_invites
in share row exclusive mode;

create table private.phase_b1_null_family_repair (
  pet_id uuid primary key references public.pets (id) on delete cascade,
  family_id uuid not null unique
);

revoke all on table private.phase_b1_null_family_repair
  from public, anon, authenticated;

insert into private.phase_b1_null_family_repair (pet_id, family_id)
select pet.id, gen_random_uuid()
from public.pets as pet
where pet.family_id is null;

insert into public.families (id, created_at)
select repair.family_id, pet.created_at
from private.phase_b1_null_family_repair as repair
join public.pets as pet on pet.id = repair.pet_id;

update public.pets as pet
set family_id = repair.family_id
from private.phase_b1_null_family_repair as repair
where pet.id = repair.pet_id;

-- Phase A intentionally had no compatibility writes. Remove any stale mirror
-- rows produced during that interval, then copy the complete live legacy state.
delete from public.family_invites as family_invite
where not exists (
  select 1
  from public.pets as pet
  join public.pet_invites as pet_invite
    on pet_invite.pet_id = pet.id
   and pet_invite.id = family_invite.id
  where pet.family_id = family_invite.family_id
);

delete from public.family_members as family_member
where not exists (
  select 1
  from public.pets as pet
  join public.pet_members as pet_member
    on pet_member.pet_id = pet.id
   and pet_member.user_id = family_member.user_id
  where pet.family_id = family_member.family_id
);

update public.family_members as family_member
set
  role = pet_member.role,
  created_at = pet_member.created_at
from public.pets as pet
join public.pet_members as pet_member on pet_member.pet_id = pet.id
where family_member.family_id = pet.family_id
  and family_member.user_id = pet_member.user_id;

insert into public.family_members (
  family_id,
  user_id,
  role,
  created_at
)
select
  pet.family_id,
  membership.user_id,
  membership.role,
  membership.created_at
from public.pets as pet
join public.pet_members as membership on membership.pet_id = pet.id
where not exists (
  select 1
  from public.family_members as family_member
  where family_member.family_id = pet.family_id
    and family_member.user_id = membership.user_id
);

insert into public.family_invites (
  id,
  family_id,
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
  pet.family_id,
  invite.invited_by,
  invite.code_hash,
  invite.expires_at,
  invite.max_uses,
  invite.used_count,
  invite.revoked_at,
  invite.created_at
from public.pets as pet
join public.pet_invites as invite on invite.pet_id = pet.id
on conflict (id) do update
set
  family_id = excluded.family_id,
  invited_by = excluded.invited_by,
  code_hash = excluded.code_hash,
  expires_at = excluded.expires_at,
  max_uses = excluded.max_uses,
  used_count = excluded.used_count,
  revoked_at = excluded.revoked_at,
  created_at = excluded.created_at;

drop table private.phase_b1_null_family_repair;

do $$
begin
  if exists (select 1 from public.pets where family_id is null) then
    raise exception 'Phase B1 repair left a Pet without a Family';
  end if;

  if exists (
    select pet.family_id, member.user_id, member.role, member.created_at
    from public.pets as pet
    join public.pet_members as member on member.pet_id = pet.id
    except
    select family_id, user_id, role, created_at
    from public.family_members
  ) or exists (
    select family_id, user_id, role, created_at
    from public.family_members
    except
    select pet.family_id, member.user_id, member.role, member.created_at
    from public.pets as pet
    join public.pet_members as member on member.pet_id = pet.id
  ) then
    raise exception 'Phase B1 membership repair left mirror drift';
  end if;

  if exists (
    select
      invite.id,
      pet.family_id,
      invite.invited_by,
      invite.code_hash,
      invite.expires_at,
      invite.max_uses,
      invite.used_count,
      invite.revoked_at,
      invite.created_at
    from public.pets as pet
    join public.pet_invites as invite on invite.pet_id = pet.id
    except
    select
      id,
      family_id,
      invited_by,
      code_hash,
      expires_at,
      max_uses,
      used_count,
      revoked_at,
      created_at
    from public.family_invites
  ) or exists (
    select
      id,
      family_id,
      invited_by,
      code_hash,
      expires_at,
      max_uses,
      used_count,
      revoked_at,
      created_at
    from public.family_invites
    except
    select
      invite.id,
      pet.family_id,
      invite.invited_by,
      invite.code_hash,
      invite.expires_at,
      invite.max_uses,
      invite.used_count,
      invite.revoked_at,
      invite.created_at
    from public.pets as pet
    join public.pet_invites as invite on invite.pet_id = pet.id
  ) then
    raise exception 'Phase B1 invitation repair left mirror drift';
  end if;
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

revoke execute on function public.create_pet(
  text,
  public.pet_species,
  text,
  public.pet_gender,
  date,
  date,
  numeric,
  text
) from public, anon;
grant execute on function public.create_pet(
  text,
  public.pet_species,
  text,
  public.pet_gender,
  date,
  date,
  numeric,
  text
) to authenticated;

create or replace function public.create_pet_invite(target_pet_id uuid)
returns table (
  invite_id uuid,
  invite_code text,
  invite_expires_at timestamptz,
  invite_max_uses integer,
  invite_used_count integer,
  invite_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  target_family_id uuid;
  generated_code text;
  generated_hash text;
  created_invite public.pet_invites;
  revocation_time timestamptz := now();
  attempt integer := 0;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id
  for update;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.pet_invites as invite
    where invite.pet_id = target_pet_id
      and invite.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'invite creation rate limited' using errcode = 'P0001';
  end if;

  update public.pet_invites
  set revoked_at = revocation_time
  where pet_id = target_pet_id
    and revoked_at is null;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  loop
    attempt := attempt + 1;
    generated_code := private.generate_pet_invite_code();
    generated_hash := private.pet_invite_code_hash(generated_code);

    begin
      insert into public.pet_invites (
        pet_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses
      )
      values (
        target_pet_id,
        caller_id,
        generated_hash,
        now() + interval '7 days',
        5
      )
      returning * into created_invite;

      insert into public.family_invites (
        id,
        family_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses,
        used_count,
        revoked_at,
        created_at
      )
      values (
        created_invite.id,
        target_family_id,
        created_invite.invited_by,
        created_invite.code_hash,
        created_invite.expires_at,
        created_invite.max_uses,
        created_invite.used_count,
        created_invite.revoked_at,
        created_invite.created_at
      );

      exit;
    exception
      when unique_violation then
        if attempt >= 5 then
          raise exception 'invite generation failed' using errcode = 'P0001';
        end if;
    end;
  end loop;

  return query
  select
    created_invite.id,
    generated_code,
    created_invite.expires_at,
    created_invite.max_uses,
    created_invite.used_count,
    created_invite.created_at;
end;
$$;

revoke execute on function public.create_pet_invite(uuid)
  from public, anon;
grant execute on function public.create_pet_invite(uuid)
  to authenticated;

create or replace function public.revoke_pet_invite(target_pet_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
  revocation_time timestamptz := now();
  revoked_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  update public.pet_invites
  set revoked_at = revocation_time
  where pet_id = target_pet_id
    and revoked_at is null;

  get diagnostics revoked_count = row_count;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  return revoked_count > 0;
end;
$$;

revoke execute on function public.revoke_pet_invite(uuid)
  from public, anon;
grant execute on function public.revoke_pet_invite(uuid)
  to authenticated;

create or replace function public.join_pet_with_invite(invite_code text)
returns table (
  join_status text,
  joined_pet_id uuid,
  joined_pet_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  normalized_code text;
  matched_invite public.pet_invites;
  matched_pet_id uuid;
  target_family_id uuid;
  target_pet_name text;
  existing_member_role public.pet_member_role;
  existing_member_created_at timestamptz;
  joined_member_created_at timestamptz;
  updated_invite public.pet_invites;
  active_member_count integer;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  normalized_code := private.normalize_pet_invite_code(invite_code);

  if normalized_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  select invite.pet_id into matched_pet_id
  from public.pet_invites as invite
  where invite.code_hash = private.pet_invite_code_hash(normalized_code);

  if matched_pet_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  -- Preserve the existing lock order: membership advisory lock, invite row,
  -- membership mutation. Family mirror writes follow their legacy mutation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(matched_pet_id::text, 4815162342)
  );

  select invite.* into matched_invite
  from public.pet_invites as invite
  where invite.code_hash = private.pet_invite_code_hash(normalized_code)
    and invite.pet_id = matched_pet_id
  for update;

  if matched_invite.id is null
    or matched_invite.revoked_at is not null
    or matched_invite.expires_at <= now()
  then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  select pet.name, pet.family_id
  into target_pet_name, target_family_id
  from public.pets as pet
  where pet.id = matched_invite.pet_id;

  if target_family_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  insert into public.family_invites (
    id,
    family_id,
    invited_by,
    code_hash,
    expires_at,
    max_uses,
    used_count,
    revoked_at,
    created_at
  )
  values (
    matched_invite.id,
    target_family_id,
    matched_invite.invited_by,
    matched_invite.code_hash,
    matched_invite.expires_at,
    matched_invite.max_uses,
    matched_invite.used_count,
    matched_invite.revoked_at,
    matched_invite.created_at
  )
  on conflict (id) do update
  set
    family_id = excluded.family_id,
    invited_by = excluded.invited_by,
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    max_uses = excluded.max_uses,
    used_count = excluded.used_count,
    revoked_at = excluded.revoked_at,
    created_at = excluded.created_at;

  select membership.role, membership.created_at
  into existing_member_role, existing_member_created_at
  from public.pet_members as membership
  where membership.pet_id = matched_invite.pet_id
    and membership.user_id = caller_id;

  if existing_member_role is not null then
    update public.family_members
    set
      role = existing_member_role,
      created_at = existing_member_created_at
    where family_id = target_family_id
      and user_id = caller_id;

    if not found then
      insert into public.family_members (
        family_id,
        user_id,
        role,
        created_at
      )
      values (
        target_family_id,
        caller_id,
        existing_member_role,
        existing_member_created_at
      );
    end if;

    return query
    select 'already_member'::text, matched_invite.pet_id, target_pet_name;
    return;
  end if;

  if matched_invite.used_count >= matched_invite.max_uses then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*) into active_member_count
  from public.pet_members as membership
  where membership.pet_id = matched_invite.pet_id
    and membership.role in ('owner', 'member');

  if active_member_count >= 10 then
    raise exception 'family_member_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.pet_members (pet_id, user_id, role)
  values (matched_invite.pet_id, caller_id, 'member')
  returning created_at into joined_member_created_at;

  insert into public.family_members (
    family_id,
    user_id,
    role,
    created_at
  )
  values (
    target_family_id,
    caller_id,
    'member',
    joined_member_created_at
  );

  update public.pet_invites
  set used_count = used_count + 1
  where id = matched_invite.id
  returning * into updated_invite;

  update public.family_invites
  set
    family_id = target_family_id,
    invited_by = updated_invite.invited_by,
    code_hash = updated_invite.code_hash,
    expires_at = updated_invite.expires_at,
    max_uses = updated_invite.max_uses,
    used_count = updated_invite.used_count,
    revoked_at = updated_invite.revoked_at,
    created_at = updated_invite.created_at
  where id = updated_invite.id;

  return query
  select 'joined'::text, matched_invite.pet_id, target_pet_name;
end;
$$;

revoke execute on function public.join_pet_with_invite(text)
  from public, anon;
grant execute on function public.join_pet_with_invite(text)
  to authenticated;

create or replace function public.remove_pet_member(
  target_pet_id uuid,
  target_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  target_family_id uuid;
  target_role public.pet_member_role;
  revocation_time timestamptz := now();
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = caller_id then
    raise exception 'member cannot be removed' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select membership.role into target_role
  from public.pet_members as membership
  where membership.pet_id = target_pet_id
    and membership.user_id = target_user_id
  for update;

  if target_role is null then
    return 'not_found';
  end if;

  if target_role <> 'member' then
    raise exception 'member cannot be removed' using errcode = '42501';
  end if;

  -- The legacy delete remains first so existing Chat and Schedule triggers
  -- keep their current lock ordering and externally observable behavior.
  delete from public.pet_members
  where pet_id = target_pet_id
    and user_id = target_user_id
    and role = 'member';

  delete from public.family_members
  where family_id = target_family_id
    and user_id = target_user_id
    and role = 'member';

  update public.pet_invites
  set revoked_at = revocation_time
  where pet_id = target_pet_id
    and revoked_at is null;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  return 'removed';
end;
$$;

revoke execute on function public.remove_pet_member(uuid, uuid)
  from public, anon;
grant execute on function public.remove_pet_member(uuid, uuid)
  to authenticated;

commit;

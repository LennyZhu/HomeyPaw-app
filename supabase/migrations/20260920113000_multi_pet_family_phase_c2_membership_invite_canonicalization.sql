begin;

lock table public.families,
  public.pets,
  public.family_members,
  public.pet_members,
  public.family_invites,
  public.pet_invites
in share row exclusive mode;

-- Family rows are canonical. Repair every legacy Pet membership as a complete,
-- exact per-Pet mirror before switching the write paths.
delete from public.pet_members as pet_member
where exists (
  select 1
  from public.pets as pet
  where pet.id = pet_member.pet_id
    and not exists (
      select 1
      from public.family_members as family_member
      where family_member.family_id = pet.family_id
        and family_member.user_id = pet_member.user_id
    )
);

insert into public.pet_members (pet_id, user_id, role, created_at)
select pet.id, member.user_id, member.role, member.created_at
from public.pets as pet
join public.family_members as member on member.family_id = pet.family_id
order by pet.id, member.user_id
on conflict (pet_id, user_id) do update
set role = excluded.role, created_at = excluded.created_at;

-- A canonical Family invite has exactly one legacy representation. Existing
-- Phase B1 rows must have the same identity; move that representation to the
-- stable display/anchor Pet (oldest created_at, then UUID) and copy canonical
-- state into it.
do $$
begin
  if exists (
    select 1
    from public.family_invites as family_invite
    where not exists (
      select 1
      from public.pet_invites as pet_invite
      join public.pets as pet on pet.id = pet_invite.pet_id
      where pet_invite.id = family_invite.id
        and pet.family_id = family_invite.family_id
    )
  ) then
    raise exception 'Phase C2 found a Family invite without its legacy representation';
  end if;

  if exists (
    select 1
    from public.pet_invites as pet_invite
    join public.pets as pet on pet.id = pet_invite.pet_id
    where not exists (
      select 1
      from public.family_invites as family_invite
      where family_invite.id = pet_invite.id
        and family_invite.family_id = pet.family_id
    )
  ) then
    raise exception 'Phase C2 found a legacy invite without canonical Family state';
  end if;
end;
$$;

update public.pet_invites as pet_invite
set
  pet_id = anchor.id,
  invited_by = family_invite.invited_by,
  code_hash = family_invite.code_hash,
  expires_at = family_invite.expires_at,
  max_uses = family_invite.max_uses,
  used_count = family_invite.used_count,
  revoked_at = family_invite.revoked_at,
  created_at = family_invite.created_at
from public.family_invites as family_invite
cross join lateral (
  select pet.id
  from public.pets as pet
  where pet.family_id = family_invite.family_id
  order by pet.created_at, pet.id
  limit 1
) as anchor
where pet_invite.id = family_invite.id;

comment on table public.family_members is
  'Canonical Family membership. pet_members is a complete compatibility mirror for every Pet in the Family.';
comment on table public.family_invites is
  'Canonical Family invitation state. Each row has exactly one legacy pet_invites representation on the stable anchor Pet.';
comment on table public.pet_members is
  'Legacy compatibility mirror of canonical family_members, repeated exactly for every Pet in a Family.';
comment on table public.pet_invites is
  'Legacy compatibility representation of canonical family_invites. One row per Family invite, anchored to the oldest Pet by created_at then UUID.';
comment on column public.family_invites.code_hash is
  'SHA-256 hash generated once for the canonical Family invite. It is copied exactly to the single legacy representation.';

create or replace function public.get_family_members(target_family_id uuid)
returns table (
  member_user_id uuid,
  member_role public.pet_member_role,
  member_display_name text,
  member_avatar_path text,
  member_joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_family_member(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  return query
  select
    membership.user_id,
    membership.role,
    profile.display_name,
    profile.avatar_url,
    membership.created_at
  from public.family_members as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.family_id = target_family_id
  order by
    case when membership.role = 'owner' then 0 else 1 end,
    membership.created_at,
    membership.user_id;
end;
$$;

create or replace function public.create_family_invite(target_family_id uuid)
returns table (
  invite_id uuid,
  invite_code text,
  invite_expires_at timestamptz,
  invite_max_uses integer,
  invite_used_count integer,
  invite_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  locked_family_id uuid;
  anchor_pet_id uuid;
  generated_code text;
  generated_hash text;
  created_invite public.family_invites;
  revocation_time timestamptz := now();
  attempt integer := 0;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_family_owner(target_family_id) then
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
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

  select pet.id into anchor_pet_id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.created_at, pet.id
  limit 1
  for update;

  if anchor_pet_id is null then
    raise exception 'family has no display pet' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.family_invites as invite
    where invite.family_id = target_family_id
      and invite.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'invite creation rate limited' using errcode = 'P0001';
  end if;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  update public.pet_invites as invite
  set revoked_at = revocation_time
  where invite.revoked_at is null
    and exists (
      select 1
      from public.pets as pet
      where pet.id = invite.pet_id
        and pet.family_id = target_family_id
    );

  loop
    attempt := attempt + 1;
    generated_code := private.generate_pet_invite_code();
    generated_hash := private.pet_invite_code_hash(generated_code);

    begin
      insert into public.family_invites (
        family_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses
      )
      values (
        target_family_id,
        caller_id,
        generated_hash,
        now() + interval '7 days',
        5
      )
      returning * into created_invite;

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
      values (
        created_invite.id,
        anchor_pet_id,
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

create or replace function public.revoke_family_invite(target_family_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  revocation_time timestamptz := now();
  revoked_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_family_owner(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  if not private.is_family_owner(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  get diagnostics revoked_count = row_count;

  update public.pet_invites as invite
  set revoked_at = revocation_time
  where invite.revoked_at is null
    and exists (
      select 1
      from public.pets as pet
      where pet.id = invite.pet_id
        and pet.family_id = target_family_id
    );

  return revoked_count > 0;
end;
$$;

create or replace function public.preview_family_invite(invite_code text)
returns table (
  display_pet_id uuid,
  display_pet_name text,
  display_pet_species public.pet_species,
  display_pet_breed text,
  inviter_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_code text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  normalized_code := private.normalize_pet_invite_code(invite_code);
  if normalized_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  return query
  select
    anchor.id,
    anchor.name,
    anchor.species,
    anchor.breed,
    inviter.display_name
  from public.family_invites as invite
  join public.profiles as inviter on inviter.id = invite.invited_by
  cross join lateral (
    select pet.id, pet.name, pet.species, pet.breed
    from public.pets as pet
    where pet.family_id = invite.family_id
    order by pet.created_at, pet.id
    limit 1
  ) as anchor
  where invite.code_hash = private.pet_invite_code_hash(normalized_code)
    and invite.revoked_at is null
    and invite.expires_at > now()
    and (
      invite.used_count < invite.max_uses
      or exists (
        select 1
        from public.family_members as membership
        where membership.family_id = invite.family_id
          and membership.user_id = (select auth.uid())
      )
    )
  limit 1;

  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
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
  existing_role public.pet_member_role;
  membership_created_at timestamptz;
  updated_invite public.family_invites;
  mirrored_count integer;
  current_pet_id uuid;
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

  select membership.role, membership.created_at
  into existing_role, membership_created_at
  from public.family_members as membership
  where membership.family_id = matched_family_id
    and membership.user_id = caller_id
  for update;

  if existing_role is not null then
    -- Avoid INSERT ... ON CONFLICT here: PostgreSQL runs BEFORE INSERT
    -- triggers before conflict detection, which would reject an idempotent
    -- repair when the Family is already at the ten-person limit.
    for current_pet_id in
      select pet.id
      from public.pets as pet
      where pet.family_id = matched_family_id
      order by pet.id
    loop
      update public.pet_members
      set role = existing_role, created_at = membership_created_at
      where pet_id = current_pet_id
        and user_id = caller_id;

      if not found then
        insert into public.pet_members (pet_id, user_id, role, created_at)
        values (
          current_pet_id,
          caller_id,
          existing_role,
          membership_created_at
        );
      end if;
    end loop;

    return query
    select
      'already_member'::text,
      matched_family_id,
      anchor_pet_id,
      anchor_pet_name;
    return;
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
  target_role public.pet_member_role;
  current_pet_id uuid;
  revocation_time timestamptz := now();
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_family_owner(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = caller_id then
    raise exception 'member cannot be removed' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  if not private.is_family_owner(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  select membership.role into target_role
  from public.family_members as membership
  where membership.family_id = target_family_id
    and membership.user_id = target_user_id
  for update;

  if target_role is not null and target_role <> 'member' then
    raise exception 'member cannot be removed' using errcode = '42501';
  end if;

  -- Chat sends and Schedule claims take SHARE locks on one legacy membership.
  -- Lock every target mirror first, in Pet UUID order, before any trigger can
  -- acquire Chat state or Schedule row locks.
  perform membership.pet_id
  from public.pet_members as membership
  join public.pets as pet on pet.id = membership.pet_id
  where pet.family_id = target_family_id
    and membership.user_id = target_user_id
  order by membership.pet_id
  for update of membership;

  for current_pet_id in
    select pet.id
    from public.pets as pet
    where pet.family_id = target_family_id
    order by pet.id
  loop
    delete from public.pet_members
    where pet_id = current_pet_id
      and user_id = target_user_id
      and role = 'member';
  end loop;

  if target_role is null then
    return 'not_found';
  end if;

  delete from public.family_members
  where family_id = target_family_id
    and user_id = target_user_id
    and role = 'member';

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  update public.pet_invites as invite
  set revoked_at = revocation_time
  where invite.revoked_at is null
    and exists (
      select 1
      from public.pets as pet
      where pet.id = invite.pet_id
        and pet.family_id = target_family_id
    );

  return 'removed';
end;
$$;

-- Legacy Pet RPCs keep their exact public signatures. Each resolves Pet to
-- Family and delegates to the canonical Family operation.
create or replace function public.get_pet_members(target_pet_id uuid)
returns table (
  member_user_id uuid,
  member_role public.pet_member_role,
  member_display_name text,
  member_avatar_path text,
  member_joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null or not private.is_pet_member(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return query
  select * from public.get_family_members(target_family_id);
end;
$$;

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
volatile
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null or not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return query
  select * from public.create_family_invite(target_family_id);
end;
$$;

create or replace function public.revoke_pet_invite(target_pet_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null or not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return public.revoke_family_invite(target_family_id);
end;
$$;

create or replace function public.preview_pet_invite(invite_code text)
returns table (
  pet_name text,
  pet_species public.pet_species,
  pet_breed text,
  inviter_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    preview.display_pet_name,
    preview.display_pet_species,
    preview.display_pet_breed,
    preview.inviter_display_name
  from public.preview_family_invite(invite_code) as preview;
end;
$$;

create or replace function public.join_pet_with_invite(invite_code text)
returns table (
  join_status text,
  joined_pet_id uuid,
  joined_pet_name text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  select
    joined.join_status,
    joined.display_pet_id,
    joined.display_pet_name
  from public.join_family_with_invite(invite_code) as joined;
end;
$$;

create or replace function public.remove_pet_member(
  target_pet_id uuid,
  target_user_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null or not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.pets as pet
  where pet.id = target_pet_id;

  if target_family_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return public.remove_family_member(target_family_id, target_user_id);
end;
$$;

revoke execute on function public.get_family_members(uuid)
  from public, anon;
revoke execute on function public.create_family_invite(uuid)
  from public, anon;
revoke execute on function public.revoke_family_invite(uuid)
  from public, anon;
revoke execute on function public.preview_family_invite(text)
  from public, anon;
revoke execute on function public.join_family_with_invite(text)
  from public, anon;
revoke execute on function public.remove_family_member(uuid, uuid)
  from public, anon;

grant execute on function public.get_family_members(uuid) to authenticated;
grant execute on function public.create_family_invite(uuid) to authenticated;
grant execute on function public.revoke_family_invite(uuid) to authenticated;
grant execute on function public.preview_family_invite(text) to authenticated;
grant execute on function public.join_family_with_invite(text) to authenticated;
grant execute on function public.remove_family_member(uuid, uuid) to authenticated;

revoke execute on function public.get_pet_members(uuid)
  from public, anon;
revoke execute on function public.create_pet_invite(uuid)
  from public, anon;
revoke execute on function public.revoke_pet_invite(uuid)
  from public, anon;
revoke execute on function public.preview_pet_invite(text)
  from public, anon;
revoke execute on function public.join_pet_with_invite(text)
  from public, anon;
revoke execute on function public.remove_pet_member(uuid, uuid)
  from public, anon;

grant execute on function public.get_pet_members(uuid) to authenticated;
grant execute on function public.create_pet_invite(uuid) to authenticated;
grant execute on function public.revoke_pet_invite(uuid) to authenticated;
grant execute on function public.preview_pet_invite(text) to authenticated;
grant execute on function public.join_pet_with_invite(text) to authenticated;
grant execute on function public.remove_pet_member(uuid, uuid) to authenticated;

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
    raise exception 'Phase C2 membership canonicalization left mirror drift';
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
    ) <> 1
  ) or exists (
    select 1
    from public.pet_invites as pet_invite
    where not exists (
      select 1
      from public.family_invites as family_invite
      where family_invite.id = pet_invite.id
    )
  ) then
    raise exception 'Phase C2 invitation canonicalization left legacy drift';
  end if;
end;
$$;

commit;

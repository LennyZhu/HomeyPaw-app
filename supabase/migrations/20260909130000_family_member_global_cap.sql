create or replace function private.enforce_pet_family_member_limit()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  active_member_count integer;
begin
  if new.role not in ('owner', 'member') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.pet_id::text, 4815162342)
  );

  if tg_op = 'UPDATE' then
    select pg_catalog.count(*) into active_member_count
    from public.pet_members as membership
    where membership.pet_id = new.pet_id
      and membership.role in ('owner', 'member')
      and not (
        membership.pet_id = old.pet_id
        and membership.user_id = old.user_id
      );
  else
    select pg_catalog.count(*) into active_member_count
    from public.pet_members as membership
    where membership.pet_id = new.pet_id
      and membership.role in ('owner', 'member');
  end if;

  if active_member_count >= 10 then
    raise exception 'family_member_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger enforce_pet_family_member_limit_before_membership
before insert or update of pet_id, role on public.pet_members
for each row execute function private.enforce_pet_family_member_limit();

revoke execute on function private.enforce_pet_family_member_limit()
  from public, anon, authenticated;

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
  target_pet_name text;
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

  -- Every membership creation for this Family Space shares this transaction
  -- lock, including joins through different invite rows. It is acquired before
  -- invite and Chat state locks to keep the lock order deterministic.
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

  select pet.name into target_pet_name
  from public.pets as pet
  where pet.id = matched_invite.pet_id;

  if exists (
    select 1
    from public.pet_members as membership
    where membership.pet_id = matched_invite.pet_id
      and membership.user_id = caller_id
  ) then
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
  values (matched_invite.pet_id, caller_id, 'member');

  update public.pet_invites
  set used_count = used_count + 1
  where id = matched_invite.id;

  return query
  select 'joined'::text, matched_invite.pet_id, target_pet_name;
end;
$$;

revoke execute on function public.join_pet_with_invite(text)
  from public, anon;
grant execute on function public.join_pet_with_invite(text)
  to authenticated;

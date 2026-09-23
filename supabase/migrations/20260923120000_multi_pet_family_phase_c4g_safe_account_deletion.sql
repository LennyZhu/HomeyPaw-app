begin;

-- An invite belongs to its Family, not to the account that generated it.
alter table public.family_invites alter column invited_by drop not null;
alter table public.family_invites drop constraint family_invites_invited_by_fkey;
alter table public.family_invites add constraint family_invites_invited_by_fkey
  foreign key (invited_by) references auth.users (id) on delete set null;
alter table public.pet_invites alter column invited_by drop not null;
alter table public.pet_invites drop constraint pet_invites_invited_by_fkey;
alter table public.pet_invites add constraint pet_invites_invited_by_fkey
  foreign key (invited_by) references auth.users (id) on delete set null;

create table private.account_deletion_preparations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  prepared_at timestamptz not null default now()
);
revoke all on private.account_deletion_preparations from public, anon, authenticated;

-- Lock the target Auth row before any membership is created or promoted.
-- The same row is locked by prepare_account_deletion, so a request that
-- started before preparation either commits first and is seen by its Owner
-- check, or observes the durable preparation marker and fails closed.
create function private.guard_account_membership_write()
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

  return new;
end;
$$;

create trigger guard_family_member_account_lifecycle
before insert or update of user_id, role on public.family_members
for each row execute function private.guard_account_membership_write();

-- create_pet writes its legacy Owner mirror before family_members; this
-- guard closes that otherwise unprotected new-Family creation window.
create trigger guard_pet_member_account_lifecycle
before insert or update of user_id, role on public.pet_members
for each row execute function private.guard_account_membership_write();

revoke execute on function private.guard_account_membership_write()
  from public, anon, authenticated;

create function public.prepare_account_deletion()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  locked_user_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select users.id into locked_user_id
  from auth.users as users
  where users.id = caller_id
  for update;

  if locked_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.family_members as membership
    where membership.user_id = caller_id and membership.role = 'owner'
  ) then
    raise exception 'ACCOUNT_OWNS_FAMILY' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from private.account_deletion_preparations as preparation
    where preparation.user_id = caller_id
  ) then
    return 'prepared';
  end if;

  insert into private.account_deletion_preparations (user_id)
  values (caller_id);

  -- Shared rows keep their Pet/Family parent. Removing mirrors first invokes
  -- the existing Chat rotation and Schedule unassignment lifecycle hooks.
  delete from public.pet_members where user_id = caller_id;
  delete from public.family_members where user_id = caller_id;
  delete from public.chat_read_states where user_id = caller_id;
  delete from private.push_devices where user_id = caller_id;
  delete from public.profiles where id = caller_id;

  -- Profile deletion enqueues only the User-owned avatar through C4E.
  -- Auth Admin deletion follows this committed transaction in the Edge
  -- function. A failed Admin request can safely repeat this RPC.
  return 'prepared';
end;
$$;

comment on function public.prepare_account_deletion() is
  'Authenticated, self-only account preparation. Rejects every live canonical Family Owner, blocks new memberships, removes personal app state atomically, and leaves Auth deletion to the Edge orchestrator.';
revoke execute on function public.prepare_account_deletion() from public, anon;
grant execute on function public.prepare_account_deletion() to authenticated;

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
  select anchor.id, anchor.name, anchor.species, anchor.breed,
    coalesce(inviter.display_name, 'Deleted user')
  from public.family_invites as invite
  left join public.profiles as inviter on inviter.id = invite.invited_by
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
        select 1 from public.family_members as membership
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

commit;

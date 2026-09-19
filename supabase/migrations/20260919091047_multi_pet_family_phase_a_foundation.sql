create table public.families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table public.families is
  'First-class household roots. Phase A creates one transitional Family per existing Pet.';

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.pet_member_role not null,
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

comment on table public.family_members is
  'Additive Family membership mirror. Phase A does not replace pet_members.';

create unique index family_members_one_owner_per_family
  on public.family_members (family_id)
  where role = 'owner';

create index family_members_user_family_idx
  on public.family_members (user_id, family_id);

create table public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  max_uses integer not null default 5,
  used_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint family_invites_code_hash_format
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint family_invites_max_uses_range
    check (max_uses between 1 and 5),
  constraint family_invites_used_count_range
    check (used_count between 0 and max_uses),
  constraint family_invites_expiration_after_creation
    check (expires_at > created_at)
);

comment on table public.family_invites is
  'Additive Family invitation mirror. Phase A does not replace pet_invites.';
comment on column public.family_invites.code_hash is
  'SHA-256 hash copied exactly from the corresponding legacy Pet invite.';

create unique index family_invites_one_unrevoked_per_family
  on public.family_invites (family_id)
  where revoked_at is null;

create index family_invites_family_created_idx
  on public.family_invites (family_id, created_at desc);

alter table public.pets
  add column family_id uuid
  references public.families (id) on delete restrict;

comment on column public.pets.family_id is
  'Owning Family. Nullable during the additive compatibility phases so legacy create_pet remains unchanged.';

create index pets_family_id_idx on public.pets (family_id);

-- A legacy Pet UUID is reused as its transitional Family UUID. The tables are
-- independent roots; sharing the identifier provides a deterministic, durable
-- legacy Pet -> Family mapping without adding a temporary public mapping table.
insert into public.families (id, created_at)
select pet.id, pet.created_at
from public.pets as pet
on conflict (id) do update
set created_at = excluded.created_at;

update public.pets as pet
set family_id = pet.id
where pet.family_id is null;

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
from public.pet_members as membership
join public.pets as pet on pet.id = membership.pet_id
on conflict (family_id, user_id) do update
set
  role = excluded.role,
  created_at = excluded.created_at;

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
from public.pet_invites as invite
join public.pets as pet on pet.id = invite.pet_id
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

do $$
begin
  if exists (
    select 1
    from public.pets as pet
    where pet.family_id is null
  ) then
    raise exception 'Phase A backfill left a legacy Pet without a Family';
  end if;

  if exists (
    select family.id
    from public.families as family
    left join public.pets as pet on pet.family_id = family.id
    group by family.id
    having count(pet.id) <> 1
  ) then
    raise exception 'Phase A transitional Family mapping is not one-to-one';
  end if;

  if exists (
    select family.id
    from public.families as family
    left join public.family_members as membership
      on membership.family_id = family.id
     and membership.role = 'owner'
    group by family.id
    having count(membership.user_id) <> 1
  ) then
    raise exception 'Phase A transitional Family does not have exactly one Owner';
  end if;

  if exists (
    select
      pet.family_id,
      membership.user_id,
      membership.role,
      membership.created_at
    from public.pet_members as membership
    join public.pets as pet on pet.id = membership.pet_id
    except
    select
      membership.family_id,
      membership.user_id,
      membership.role,
      membership.created_at
    from public.family_members as membership
  ) or exists (
    select
      membership.family_id,
      membership.user_id,
      membership.role,
      membership.created_at
    from public.family_members as membership
    except
    select
      pet.family_id,
      membership.user_id,
      membership.role,
      membership.created_at
    from public.pet_members as membership
    join public.pets as pet on pet.id = membership.pet_id
  ) then
    raise exception 'Phase A Family membership mirror does not match pet_members';
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
    from public.pet_invites as invite
    join public.pets as pet on pet.id = invite.pet_id
    except
    select
      invite.id,
      invite.family_id,
      invite.invited_by,
      invite.code_hash,
      invite.expires_at,
      invite.max_uses,
      invite.used_count,
      invite.revoked_at,
      invite.created_at
    from public.family_invites as invite
  ) or exists (
    select
      invite.id,
      invite.family_id,
      invite.invited_by,
      invite.code_hash,
      invite.expires_at,
      invite.max_uses,
      invite.used_count,
      invite.revoked_at,
      invite.created_at
    from public.family_invites as invite
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
    from public.pet_invites as invite
    join public.pets as pet on pet.id = invite.pet_id
  ) then
    raise exception 'Phase A Family invitation mirror does not match pet_invites';
  end if;
end;
$$;

create or replace function private.enforce_family_member_limit()
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
    pg_catalog.hashtextextended(new.family_id::text, 4815162342)
  );

  if tg_op = 'UPDATE' then
    select pg_catalog.count(*) into active_member_count
    from public.family_members as membership
    where membership.family_id = new.family_id
      and membership.role in ('owner', 'member')
      and not (
        membership.family_id = old.family_id
        and membership.user_id = old.user_id
      );
  else
    select pg_catalog.count(*) into active_member_count
    from public.family_members as membership
    where membership.family_id = new.family_id
      and membership.role in ('owner', 'member');
  end if;

  if active_member_count >= 10 then
    raise exception 'family_member_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger enforce_family_member_limit_before_membership
before insert or update of family_id, role on public.family_members
for each row execute function private.enforce_family_member_limit();

create or replace function private.validate_family_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.pets as pet
    where pet.family_id = old.family_id
  ) and not exists (
    select 1
    from public.family_members as membership
    where membership.family_id = old.family_id
      and membership.role = 'owner'
  ) then
    raise exception 'family must keep one owner' using errcode = '23514';
  end if;

  return old;
end;
$$;

create constraint trigger validate_family_keeps_owner
after delete or update of family_id, role on public.family_members
deferrable initially deferred
for each row execute function private.validate_family_keeps_owner();

revoke execute on function private.enforce_family_member_limit()
  from public, anon, authenticated;
revoke execute on function private.validate_family_keeps_owner()
  from public, anon, authenticated;

create or replace function private.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets as pet
    join public.pet_members as membership on membership.pet_id = pet.id
    where pet.family_id = target_family_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_family_owner(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets as pet
    join public.pet_members as membership on membership.pet_id = pet.id
    where pet.family_id = target_family_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  );
$$;

revoke execute on function private.is_family_member(uuid) from public, anon;
revoke execute on function private.is_family_owner(uuid) from public, anon;
grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function private.is_family_owner(uuid) to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invites enable row level security;

revoke all on table public.families from anon, authenticated;
revoke all on table public.family_members from anon, authenticated;
revoke all on table public.family_invites from anon, authenticated;

grant select on table public.families to authenticated;
grant select on table public.family_members to authenticated;
grant select (
  id,
  family_id,
  invited_by,
  expires_at,
  max_uses,
  used_count,
  revoked_at,
  created_at
) on table public.family_invites to authenticated;

create policy "Family members can read families"
  on public.families
  for select
  to authenticated
  using ((select private.is_family_member(id)));

create policy "Family members can read memberships"
  on public.family_members
  for select
  to authenticated
  using ((select private.is_family_member(family_id)));

create policy "Family owners can read invite metadata"
  on public.family_invites
  for select
  to authenticated
  using ((select private.is_family_owner(family_id)));

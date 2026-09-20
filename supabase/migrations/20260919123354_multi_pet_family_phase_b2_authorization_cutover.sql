begin;

-- Authorization may cut over only after B1 has completed its repair and the
-- compatibility mirrors are healthy. Hold membership writes until every
-- replacement helper is installed in the same transaction.
lock table
  public.pets,
  public.pet_members,
  public.family_members
in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.pets as pet
    where pet.family_id is null
  ) then
    raise exception 'Phase B2 requires every Pet to have a Family';
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
    raise exception 'Phase B2 requires clean B1 membership mirror parity';
  end if;
end;
$$;

-- Public policies and RPCs keep passing Pet IDs. These helpers now resolve the
-- Pet to its Family and consult only the authoritative Family membership.
create or replace function private.is_pet_member(target_pet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets as pet
    join public.family_members as membership
      on membership.family_id = pet.family_id
    where pet.id = target_pet_id
      and pet.family_id is not null
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_pet_owner(target_pet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets as pet
    join public.family_members as membership
      on membership.family_id = pet.family_id
    where pet.id = target_pet_id
      and pet.family_id is not null
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  );
$$;

create or replace function private.can_contribute_to_pet(target_pet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pets as pet
    join public.family_members as membership
      on membership.family_id = pet.family_id
    where pet.id = target_pet_id
      and pet.family_id is not null
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'member')
  );
$$;

-- Family-table RLS calls security-definer helpers to avoid recursive policy
-- evaluation while making family_members the sole read authority.
create or replace function private.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members as membership
    where membership.family_id = target_family_id
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
    from public.family_members as membership
    where membership.family_id = target_family_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  );
$$;

-- Profile avatars are shared by Family identity. This also supports two users
-- whose visible Pets differ while both belong to the same Family.
create or replace function private.can_read_profile_avatar(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      private.profile_avatar_owner_id(object_name) = (select auth.uid())
      or exists (
        select 1
        from public.family_members as viewer_membership
        join public.family_members as avatar_membership
          on avatar_membership.family_id = viewer_membership.family_id
         and avatar_membership.user_id =
           private.profile_avatar_owner_id(object_name)
        where viewer_membership.user_id = (select auth.uid())
      )
    );
$$;

revoke execute on function private.is_pet_member(uuid) from public, anon;
revoke execute on function private.is_pet_owner(uuid) from public, anon;
revoke execute on function private.can_contribute_to_pet(uuid)
  from public, anon;
revoke execute on function private.is_family_member(uuid) from public, anon;
revoke execute on function private.is_family_owner(uuid) from public, anon;
revoke execute on function private.can_read_profile_avatar(text)
  from public, anon;

grant execute on function private.is_pet_member(uuid) to authenticated;
grant execute on function private.is_pet_owner(uuid) to authenticated;
grant execute on function private.can_contribute_to_pet(uuid)
  to authenticated;
grant execute on function private.is_family_member(uuid) to authenticated;
grant execute on function private.is_family_owner(uuid) to authenticated;
grant execute on function private.can_read_profile_avatar(text)
  to authenticated;

comment on table public.pets is
  'Private pet profiles. Authorization resolves family_id to family_members.';
comment on table public.pet_members is
  'Legacy Pet membership compatibility mirror maintained by B1 write paths.';
comment on table public.family_members is
  'Authoritative Family membership and role relation used by authorization.';

commit;

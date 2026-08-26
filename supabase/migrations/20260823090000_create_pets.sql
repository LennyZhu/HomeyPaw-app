create type public.pet_species as enum ('dog', 'cat', 'other');
create type public.pet_gender as enum ('male', 'female', 'unknown');
create type public.pet_member_role as enum ('owner', 'member', 'viewer');

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  species public.pet_species not null,
  breed text,
  gender public.pet_gender not null default 'unknown',
  birthday date,
  adoption_date date,
  weight numeric(6, 2),
  description text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pets_name_length
    check (
      char_length(name) between 1 and 80
      and name = btrim(name)
      and name ~ '[^[:space:]]'
    ),
  constraint pets_breed_length
    check (
      breed is null
      or (
        char_length(breed) between 1 and 80
        and breed = btrim(breed)
        and breed ~ '[^[:space:]]'
      )
    ),
  constraint pets_weight_range
    check (weight is null or (weight > 0 and weight <= 1000)),
  constraint pets_description_length
    check (description is null or char_length(description) <= 2000),
  constraint pets_avatar_path_length
    check (avatar_path is null or char_length(avatar_path) <= 1024)
);

comment on table public.pets is
  'Private pet profiles. Authorization is derived from pet_members.';
comment on column public.pets.weight is 'Pet weight in kilograms.';
comment on column public.pets.avatar_path is
  'Object path in the private pet-avatars Storage bucket.';

create table public.pet_members (
  pet_id uuid not null references public.pets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.pet_member_role not null,
  created_at timestamptz not null default now(),
  primary key (pet_id, user_id)
);

comment on table public.pet_members is
  'Membership and role relation between private pets and Auth users.';

create unique index pet_members_one_owner_per_pet
  on public.pet_members (pet_id)
  where role = 'owner';

create index pet_members_user_pet_idx
  on public.pet_members (user_id, pet_id);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_pet_member(target_pet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pet_members as membership
    where membership.pet_id = target_pet_id
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
    from public.pet_members as membership
    where membership.pet_id = target_pet_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  );
$$;

create or replace function private.avatar_pet_id(object_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  path_parts text[];
begin
  path_parts := pg_catalog.regexp_split_to_array(object_name, '/');

  if pg_catalog.array_length(path_parts, 1) <> 3 then
    return null;
  end if;

  begin
    return path_parts[2]::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke execute on function private.is_pet_member(uuid) from public, anon;
revoke execute on function private.is_pet_owner(uuid) from public, anon;
revoke execute on function private.avatar_pet_id(text) from public, anon;
grant execute on function private.is_pet_member(uuid) to authenticated;
grant execute on function private.is_pet_owner(uuid) to authenticated;
grant execute on function private.avatar_pet_id(text) to authenticated;

alter table public.pets enable row level security;
alter table public.pet_members enable row level security;

revoke all on table public.pets from anon, authenticated;
revoke all on table public.pet_members from anon, authenticated;

grant select on table public.pets to authenticated;
grant update (
  name,
  species,
  breed,
  gender,
  birthday,
  adoption_date,
  weight,
  description,
  avatar_path
) on table public.pets to authenticated;
grant delete on table public.pets to authenticated;
grant select on table public.pet_members to authenticated;

create policy "Pet members can read pets"
  on public.pets
  for select
  to authenticated
  using ((select private.is_pet_member(id)));

create policy "Pet owners can update pets"
  on public.pets
  for update
  to authenticated
  using ((select private.is_pet_owner(id)))
  with check ((select private.is_pet_owner(id)));

create policy "Pet owners can delete pets"
  on public.pets
  for delete
  to authenticated
  using ((select private.is_pet_owner(id)));

create policy "Pet members can read memberships"
  on public.pet_members
  for select
  to authenticated
  using ((select private.is_pet_member(pet_id)));

create or replace function public.set_pet_updated_at_and_validate_dates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.birthday is not null and new.birthday > current_date then
    raise exception 'birthday cannot be in the future'
      using errcode = '23514';
  end if;

  if new.adoption_date is not null and new.adoption_date > current_date then
    raise exception 'adoption_date cannot be in the future'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger set_pets_updated_at_and_validate_dates
before insert or update on public.pets
for each row execute function public.set_pet_updated_at_and_validate_dates();

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

  insert into public.pet_members (pet_id, user_id, role)
  values (created_pet.id, caller_id, 'owner');

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

revoke execute on function public.set_pet_updated_at_and_validate_dates()
  from public, anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pet-avatars',
  'pet-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Pet members can read pet avatars"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'pet-avatars'
    and (select private.is_pet_member(private.avatar_pet_id(name)))
  );

create policy "Pet owners can upload pet avatars"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pet-avatars'
    and (pg_catalog.regexp_split_to_array(name, '/'))[1] = (select auth.uid())::text
    and (select private.is_pet_owner(private.avatar_pet_id(name)))
  );

create policy "Pet owners can replace pet avatars"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'pet-avatars'
    and (select private.is_pet_owner(private.avatar_pet_id(name)))
  )
  with check (
    bucket_id = 'pet-avatars'
    and (pg_catalog.regexp_split_to_array(name, '/'))[1] = (select auth.uid())::text
    and (select private.is_pet_owner(private.avatar_pet_id(name)))
  );

create policy "Pet owners can delete pet avatars"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'pet-avatars'
    and (select private.is_pet_owner(private.avatar_pet_id(name)))
  );

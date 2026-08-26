create extension if not exists pgcrypto with schema extensions;

create table public.pet_invites (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  max_uses integer not null default 5,
  used_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pet_invites_code_hash_format
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint pet_invites_max_uses_range
    check (max_uses between 1 and 5),
  constraint pet_invites_used_count_range
    check (used_count between 0 and max_uses),
  constraint pet_invites_expiration_after_creation
    check (expires_at > created_at)
);

comment on table public.pet_invites is
  'Hashed, expiring invitations for joining one private pet family.';
comment on column public.pet_invites.code_hash is
  'SHA-256 hash of the normalized invite code. Plaintext codes are never stored.';

create unique index pet_invites_one_unrevoked_per_pet
  on public.pet_invites (pet_id)
  where revoked_at is null;
create index pet_invites_pet_created_idx
  on public.pet_invites (pet_id, created_at desc);

create or replace function public.validate_pet_keeps_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_pet_id uuid;
begin
  target_pet_id := old.pet_id;

  if exists (
    select 1 from public.pets as pet where pet.id = target_pet_id
  ) and not exists (
    select 1
    from public.pet_members as membership
    where membership.pet_id = target_pet_id
      and membership.role = 'owner'
  ) then
    raise exception 'pet must keep one owner' using errcode = '23514';
  end if;

  return old;
end;
$$;

create constraint trigger validate_pet_keeps_owner
after delete or update of role on public.pet_members
deferrable initially deferred
for each row execute function public.validate_pet_keeps_owner();

revoke execute on function public.validate_pet_keeps_owner()
  from public, anon, authenticated;

create or replace function private.normalize_pet_invite_code(invite_code text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.upper(pg_catalog.btrim(coalesce(invite_code, '')));
$$;

create or replace function private.pet_invite_code_hash(invite_code text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      private.normalize_pet_invite_code(invite_code),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.generate_pet_invite_code()
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  random_bytes bytea;
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  generated_code text := '';
  index integer;
begin
  random_bytes := extensions.gen_random_bytes(8);

  for index in 0..7 loop
    generated_code := generated_code || pg_catalog.substr(
      alphabet,
      (pg_catalog.get_byte(random_bytes, index) % 32) + 1,
      1
    );
  end loop;

  return generated_code;
end;
$$;

revoke execute on function private.normalize_pet_invite_code(text)
  from public, anon, authenticated;
revoke execute on function private.pet_invite_code_hash(text)
  from public, anon, authenticated;
revoke execute on function private.generate_pet_invite_code()
  from public, anon, authenticated;

alter table public.pet_invites enable row level security;
revoke all on table public.pet_invites from anon, authenticated;
grant select (
  id,
  pet_id,
  invited_by,
  expires_at,
  max_uses,
  used_count,
  revoked_at,
  created_at
) on table public.pet_invites to authenticated;

create policy "Pet owners can read invite metadata"
  on public.pet_invites
  for select
  to authenticated
  using ((select private.is_pet_owner(pet_id)));

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
  generated_code text;
  generated_hash text;
  created_invite public.pet_invites;
  attempt integer := 0;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  perform 1
  from public.pets as pet
  where pet.id = target_pet_id
  for update;

  if exists (
    select 1
    from public.pet_invites as invite
    where invite.pet_id = target_pet_id
      and invite.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'invite creation rate limited' using errcode = 'P0001';
  end if;

  update public.pet_invites
  set revoked_at = now()
  where pet_id = target_pet_id
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

create or replace function public.revoke_pet_invite(target_pet_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_pet_owner(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  update public.pet_invites
  set revoked_at = now()
  where pet_id = target_pet_id
    and revoked_at is null;

  get diagnostics revoked_count = row_count;
  return revoked_count > 0;
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
    pet.name,
    pet.species,
    pet.breed,
    inviter.display_name
  from public.pet_invites as invite
  join public.pets as pet on pet.id = invite.pet_id
  join public.profiles as inviter on inviter.id = invite.invited_by
  where invite.code_hash = private.pet_invite_code_hash(normalized_code)
    and invite.revoked_at is null
    and invite.expires_at > now()
    and (
      invite.used_count < invite.max_uses
      or exists (
        select 1
        from public.pet_members as membership
        where membership.pet_id = invite.pet_id
          and membership.user_id = (select auth.uid())
      )
    )
  limit 1;

  if not found then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
end;
$$;

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
  target_pet_name text;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  normalized_code := private.normalize_pet_invite_code(invite_code);

  if normalized_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  select invite.* into matched_invite
  from public.pet_invites as invite
  where invite.code_hash = private.pet_invite_code_hash(normalized_code)
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

  insert into public.pet_members (pet_id, user_id, role)
  values (matched_invite.pet_id, caller_id, 'member');

  update public.pet_invites
  set used_count = used_count + 1
  where id = matched_invite.id;

  return query
  select 'joined'::text, matched_invite.pet_id, target_pet_name;
end;
$$;

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
  target_role public.pet_member_role;
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

  delete from public.pet_members
  where pet_id = target_pet_id
    and user_id = target_user_id
    and role = 'member';

  update public.pet_invites
  set revoked_at = now()
  where pet_id = target_pet_id
    and revoked_at is null;

  return 'removed';
end;
$$;

create or replace function public.get_pet_members(target_pet_id uuid)
returns table (
  member_user_id uuid,
  member_role public.pet_member_role,
  member_display_name text,
  member_joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_pet_member(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return query
  select
    membership.user_id,
    membership.role,
    profile.display_name,
    membership.created_at
  from public.pet_members as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.pet_id = target_pet_id
  order by
    case when membership.role = 'owner' then 0 else 1 end,
    membership.created_at,
    membership.user_id;
end;
$$;

create or replace function public.get_pet_post_authors(target_pet_id uuid)
returns table (
  author_user_id uuid,
  author_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_pet_member(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return query
  select distinct post.author_id, profile.display_name
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id
  where post.pet_id = target_pet_id
  order by profile.display_name, post.author_id;
end;
$$;

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
revoke execute on function public.get_pet_members(uuid)
  from public, anon;
revoke execute on function public.get_pet_post_authors(uuid)
  from public, anon;

grant execute on function public.create_pet_invite(uuid) to authenticated;
grant execute on function public.revoke_pet_invite(uuid) to authenticated;
grant execute on function public.preview_pet_invite(text) to authenticated;
grant execute on function public.join_pet_with_invite(text) to authenticated;
grant execute on function public.remove_pet_member(uuid, uuid) to authenticated;
grant execute on function public.get_pet_members(uuid) to authenticated;
grant execute on function public.get_pet_post_authors(uuid) to authenticated;

create or replace function private.can_contribute_to_pet(target_pet_id uuid)
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
      and membership.role in ('owner', 'member')
  );
$$;

revoke execute on function private.can_contribute_to_pet(uuid)
  from public, anon;
grant execute on function private.can_contribute_to_pet(uuid)
  to authenticated;

create or replace function public.create_post(
  post_id uuid,
  post_pet_id uuid,
  post_content text,
  post_tag public.post_tag,
  post_event_date date,
  post_location_name text,
  media_items jsonb default '[]'::jsonb
)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  created_post public.posts;
  item jsonb;
  safe_content text;
  safe_location_name text;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if post_id is null or post_pet_id is null then
    raise exception 'post and pet ids are required' using errcode = '22023';
  end if;

  if not private.can_contribute_to_pet(post_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  safe_content := nullif(btrim(coalesce(post_content, '')), '');
  safe_location_name := nullif(btrim(coalesce(post_location_name, '')), '');

  perform private.validate_post_media_input(
    caller_id,
    post_pet_id,
    post_id,
    media_items
  );

  if safe_content is null and pg_catalog.jsonb_array_length(media_items) = 0 then
    raise exception 'post must contain text or at least one image'
      using errcode = '23514';
  end if;

  insert into public.posts (
    id,
    pet_id,
    author_id,
    content,
    tag,
    event_date,
    location_name
  )
  values (
    post_id,
    post_pet_id,
    caller_id,
    safe_content,
    post_tag,
    coalesce(post_event_date, current_date),
    safe_location_name
  )
  returning * into created_post;

  for item in
    select value from pg_catalog.jsonb_array_elements(media_items)
  loop
    insert into public.post_media (
      id,
      post_id,
      storage_path,
      position,
      width,
      height,
      mime_type
    )
    values (
      (item->>'id')::uuid,
      post_id,
      item->>'storage_path',
      (item->>'position')::smallint,
      (item->>'width')::integer,
      (item->>'height')::integer,
      item->>'mime_type'
    );
  end loop;

  return created_post;
end;
$$;

create or replace function public.update_post(
  target_post_id uuid,
  post_content text,
  post_tag public.post_tag,
  post_event_date date,
  post_location_name text,
  media_items jsonb default '[]'::jsonb
)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_post public.posts;
  updated_post public.posts;
  item jsonb;
  safe_content text;
  safe_location_name text;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into existing_post
  from public.posts as post
  where post.id = target_post_id;

  if existing_post.id is null
    or existing_post.author_id <> caller_id
    or not private.can_contribute_to_pet(existing_post.pet_id)
  then
    raise exception 'post not found' using errcode = '42501';
  end if;

  safe_content := nullif(btrim(coalesce(post_content, '')), '');
  safe_location_name := nullif(btrim(coalesce(post_location_name, '')), '');

  perform private.validate_post_media_input(
    caller_id,
    existing_post.pet_id,
    existing_post.id,
    media_items
  );

  if safe_content is null and pg_catalog.jsonb_array_length(media_items) = 0 then
    raise exception 'post must contain text or at least one image'
      using errcode = '23514';
  end if;

  update public.posts
  set
    content = safe_content,
    tag = post_tag,
    event_date = coalesce(post_event_date, current_date),
    location_name = safe_location_name
  where id = target_post_id
  returning * into updated_post;

  delete from public.post_media where post_id = target_post_id;

  for item in
    select value from pg_catalog.jsonb_array_elements(media_items)
  loop
    insert into public.post_media (
      id,
      post_id,
      storage_path,
      position,
      width,
      height,
      mime_type
    )
    values (
      (item->>'id')::uuid,
      target_post_id,
      item->>'storage_path',
      (item->>'position')::smallint,
      (item->>'width')::integer,
      (item->>'height')::integer,
      item->>'mime_type'
    );
  end loop;

  return updated_post;
end;
$$;

create or replace function private.post_media_post_id(object_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  post_id_text text;
begin
  post_id_text := private.post_media_path_part(object_name, 3);

  begin
    return post_id_text::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

create or replace function private.can_upload_post_media(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.post_media_path_part(object_name, 1) = (select auth.uid())::text
    and pg_catalog.right(object_name, 4) = '.jpg'
    and private.can_contribute_to_pet(private.post_media_pet_id(object_name))
    and private.post_media_post_id(object_name) is not null
    and (
      not exists (
        select 1
        from public.posts as post
        where post.id = private.post_media_post_id(object_name)
      )
      or exists (
        select 1
        from public.posts as post
        where post.id = private.post_media_post_id(object_name)
          and post.pet_id = private.post_media_pet_id(object_name)
          and post.author_id = (select auth.uid())
      )
    );
$$;

create or replace function private.can_delete_post_media(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.can_contribute_to_pet(private.post_media_pet_id(object_name))
    and (
      private.post_media_path_part(object_name, 1) = (select auth.uid())::text
      or private.is_pet_owner(private.post_media_pet_id(object_name))
    );
$$;

revoke execute on function private.can_upload_post_media(text)
  from public, anon;
revoke execute on function private.can_delete_post_media(text)
  from public, anon;
revoke execute on function private.post_media_post_id(text)
  from public, anon, authenticated;
grant execute on function private.can_upload_post_media(text) to authenticated;
grant execute on function private.can_delete_post_media(text) to authenticated;

drop policy "Pet owners can upload post media objects" on storage.objects;
drop policy "Pet owners can delete post media objects" on storage.objects;

create policy "Pet authors can upload post media objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-media'
    and (select private.can_upload_post_media(name))
  );

create policy "Pet authors and owners can delete post media objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-media'
    and (select private.can_delete_post_media(name))
  );

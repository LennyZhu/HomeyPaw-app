create type public.post_tag as enum (
  'walk',
  'meal',
  'sleep',
  'play',
  'grooming',
  'vet',
  'birthday',
  'travel',
  'other'
);

create table public.posts (
  id uuid primary key,
  pet_id uuid not null references public.pets (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  content text,
  tag public.post_tag,
  event_date date not null default current_date,
  location_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_content_length
    check (
      content is null
      or (
        char_length(content) between 1 and 4000
        and content = btrim(content)
        and content ~ '[^[:space:]]'
      )
    ),
  constraint posts_location_name_length
    check (
      location_name is null
      or (
        char_length(location_name) between 1 and 160
        and location_name = btrim(location_name)
        and location_name ~ '[^[:space:]]'
      )
    ),
  constraint posts_event_date_not_future check (event_date <= current_date)
);

comment on table public.posts is
  'Private pet journal entries. event_date is the lived date and is distinct from created_at.';
comment on column public.posts.author_id is
  'Always assigned from auth.uid() by the mutation RPCs.';

create table public.post_media (
  id uuid primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null unique,
  position smallint not null,
  width integer not null,
  height integer not null,
  mime_type text not null default 'image/jpeg',
  created_at timestamptz not null default now(),
  constraint post_media_position_range check (position between 0 and 8),
  constraint post_media_dimensions check (width > 0 and height > 0),
  constraint post_media_storage_path_length
    check (char_length(storage_path) between 1 and 1024),
  constraint post_media_image_mime_type
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint post_media_post_position_unique unique (post_id, position)
);

comment on table public.post_media is
  'Ordered image metadata for private journal entries. Binary data lives in the private post-media bucket.';

create index posts_pet_timeline_idx
  on public.posts (pet_id, event_date desc, created_at desc, id desc);
create index posts_author_id_idx on public.posts (author_id);
create index post_media_post_position_idx
  on public.post_media (post_id, position);

create or replace function private.post_media_path_part(
  object_name text,
  part_number integer
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.array_length(
      pg_catalog.regexp_split_to_array(object_name, '/'),
      1
    ) = 4
      then (pg_catalog.regexp_split_to_array(object_name, '/'))[part_number]
    else null
  end;
$$;

create or replace function private.post_media_pet_id(object_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  pet_id_text text;
begin
  pet_id_text := private.post_media_path_part(object_name, 2);

  begin
    return pet_id_text::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke execute on function private.post_media_path_part(text, integer)
  from public, anon;
revoke execute on function private.post_media_pet_id(text) from public, anon;
grant execute on function private.post_media_path_part(text, integer)
  to authenticated;
grant execute on function private.post_media_pet_id(text) to authenticated;

alter table public.posts enable row level security;
alter table public.post_media enable row level security;

revoke all on table public.posts from anon, authenticated;
revoke all on table public.post_media from anon, authenticated;
grant select on table public.posts to authenticated;
grant select on table public.post_media to authenticated;

create policy "Pet members can read posts"
  on public.posts
  for select
  to authenticated
  using ((select private.is_pet_member(pet_id)));

create policy "Pet members can read post media"
  on public.post_media
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.posts as post
      where post.id = post_media.post_id
        and (select private.is_pet_member(post.pet_id))
    )
  );

create or replace function public.set_post_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_posts_updated_at
before update on public.posts
for each row execute function public.set_post_updated_at();

create or replace function public.validate_post_has_content_or_media()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_post_id uuid;
begin
  if tg_table_name = 'posts' then
    target_post_id := coalesce(new.id, old.id);
  else
    target_post_id := coalesce(new.post_id, old.post_id);
  end if;

  if exists (
    select 1
    from public.posts as post
    where post.id = target_post_id
      and post.content is null
      and not exists (
        select 1
        from public.post_media as media
        where media.post_id = post.id
      )
  ) then
    raise exception 'post must contain text or at least one image'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create constraint trigger validate_post_content_or_media_from_posts
after insert or update of content on public.posts
deferrable initially deferred
for each row execute function public.validate_post_has_content_or_media();

create constraint trigger validate_post_content_or_media_from_media
after insert or update or delete on public.post_media
deferrable initially deferred
for each row execute function public.validate_post_has_content_or_media();

create or replace function private.validate_post_media_input(
  caller_id uuid,
  target_pet_id uuid,
  target_post_id uuid,
  media_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  item_id uuid;
  item_path text;
  item_position integer;
  expected_path text;
  media_count integer;
begin
  if media_items is null or pg_catalog.jsonb_typeof(media_items) <> 'array' then
    raise exception 'media must be an array' using errcode = '22023';
  end if;

  media_count := pg_catalog.jsonb_array_length(media_items);

  if media_count > 9 then
    raise exception 'a post can contain at most 9 images'
      using errcode = '23514';
  end if;

  for item, item_position in
    select value, (ordinality - 1)::integer
    from pg_catalog.jsonb_array_elements(media_items) with ordinality
  loop
    begin
      item_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid media id' using errcode = '22023';
    end;

    item_path := item->>'storage_path';
    expected_path := caller_id::text || '/' || target_pet_id::text || '/' ||
      target_post_id::text || '/' || item_id::text || '.jpg';

    if item_path is distinct from expected_path
      or (item->>'position')::integer is distinct from item_position
      or (item->>'width')::integer <= 0
      or (item->>'height')::integer <= 0
      or coalesce(item->>'mime_type', '') <> 'image/jpeg'
    then
      raise exception 'invalid media metadata' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'post-media'
        and object.name = item_path
    ) then
      raise exception 'uploaded media object is missing' using errcode = '22023';
    end if;
  end loop;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid media metadata' using errcode = '22023';
end;
$$;

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

  if not private.is_pet_owner(post_pet_id) then
    raise exception 'pet owner access required' using errcode = '42501';
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
    or not private.is_pet_owner(existing_post.pet_id)
  then
    raise exception 'post not found' using errcode = '42501';
  end if;

  safe_content := nullif(btrim(coalesce(post_content, '')), '');
  safe_location_name := nullif(btrim(coalesce(post_location_name, '')), '');

  perform private.validate_post_media_input(
    existing_post.author_id,
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

revoke execute on function public.create_post(
  uuid, uuid, text, public.post_tag, date, text, jsonb
) from public, anon;
revoke execute on function public.update_post(
  uuid, text, public.post_tag, date, text, jsonb
) from public, anon;
grant execute on function public.create_post(
  uuid, uuid, text, public.post_tag, date, text, jsonb
) to authenticated;
grant execute on function public.update_post(
  uuid, text, public.post_tag, date, text, jsonb
) to authenticated;

revoke execute on function public.set_post_updated_at()
  from public, anon, authenticated;
revoke execute on function public.validate_post_has_content_or_media()
  from public, anon, authenticated;
revoke execute on function private.validate_post_media_input(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'post-media',
  'post-media',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Pet members can read post media objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-media'
    and (select private.is_pet_member(private.post_media_pet_id(name)))
  );

create policy "Pet owners can upload post media objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-media'
    and (select private.post_media_path_part(name, 1)) = (select auth.uid())::text
    and pg_catalog.right(name, 4) = '.jpg'
    and (select private.is_pet_owner(private.post_media_pet_id(name)))
  );

create policy "Pet owners can delete post media objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-media'
    and (select private.is_pet_owner(private.post_media_pet_id(name)))
  );

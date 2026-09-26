create table public.post_videos (
  id uuid primary key,
  post_id uuid not null unique
    references public.posts (id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text not null unique,
  duration_ms integer not null,
  file_size_bytes bigint not null,
  width integer not null,
  height integer not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  constraint post_videos_storage_path_length
    check (
      char_length(storage_path) between 1 and 1024
      and storage_path = btrim(storage_path)
    ),
  constraint post_videos_thumbnail_path_length
    check (
      char_length(thumbnail_path) between 1 and 1024
      and thumbnail_path = btrim(thumbnail_path)
    ),
  constraint post_videos_distinct_paths
    check (storage_path <> thumbnail_path),
  constraint post_videos_duration
    check (duration_ms between 1 and 15000),
  constraint post_videos_file_size
    check (file_size_bytes between 1 and 26214400),
  constraint post_videos_dimensions
    check (width > 0 and height > 0),
  constraint post_videos_mp4_mime_type
    check (mime_type = 'video/mp4')
);

-- Extend the committed bootstrap lock in the same migration transaction.
create trigger pre_cutover_release_lock
  before insert or update or delete on public.post_videos
  for each row execute function private.assert_release_write_allowed();

comment on table public.post_videos is
  'One private MP4 and JPEG timeline thumbnail per Journal post. Binary objects live in dedicated private Storage buckets.';
comment on column public.post_videos.file_size_bytes is
  'Canonical size copied by the mutation RPC from storage.objects metadata, never trusted from client JSON.';
comment on column public.post_videos.duration_ms is
  'Client-pipeline metadata constrained for defense in depth; PostgreSQL does not parse MP4 content.';

alter table public.post_videos enable row level security;

revoke all on table public.post_videos from anon, authenticated, service_role;
grant select on table public.post_videos to authenticated;
grant select on table public.post_videos to service_role;

create policy "Pet members can read post videos"
  on public.post_videos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.posts as post
      where post.id = post_videos.post_id
        and (select private.is_pet_member(post.pet_id))
    )
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'post-videos',
    'post-videos',
    false,
    26214400,
    array['video/mp4']
  ),
  (
    'post-video-thumbnails',
    'post-video-thumbnails',
    false,
    2097152,
    array['image/jpeg']
  )
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.journal_video_path_part(
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
    when part_number between 1 and 4
      and pg_catalog.array_length(
        pg_catalog.regexp_split_to_array(object_name, '/'),
        1
      ) = 4
      and not exists (
        select 1
        from pg_catalog.unnest(
          pg_catalog.regexp_split_to_array(object_name, '/')
        ) as part(value)
        where value = ''
      )
      then (pg_catalog.regexp_split_to_array(object_name, '/'))[part_number]
    else null
  end;
$$;

create or replace function private.is_strict_journal_video_path(
  object_name text,
  expected_extension text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    expected_extension in ('.mp4', '.jpg')
    and private.journal_video_path_part(object_name, 1)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.journal_video_path_part(object_name, 2)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.journal_video_path_part(object_name, 3)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and private.journal_video_path_part(object_name, 4)
      ~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
        || replace(expected_extension, '.', '[.]') || '$'
      );
$$;

create or replace function private.journal_video_path_uuid(
  object_name text,
  part_number integer
)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  value text;
begin
  value := private.journal_video_path_part(object_name, part_number);
  begin
    return value::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

create or replace function private.journal_video_object_id(
  object_name text,
  expected_extension text
)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  filename text;
begin
  if not private.is_strict_journal_video_path(
    object_name,
    expected_extension
  ) then
    return null;
  end if;

  filename := private.journal_video_path_part(object_name, 4);
  return pg_catalog.left(
    filename,
    char_length(filename) - char_length(expected_extension)
  )::uuid;
end;
$$;

create or replace function private.can_read_journal_video_object(
  target_bucket_id text,
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case target_bucket_id
    when 'post-videos' then
      private.is_strict_journal_video_path(object_name, '.mp4')
    when 'post-video-thumbnails' then
      private.is_strict_journal_video_path(object_name, '.jpg')
    else false
  end
  and private.is_pet_member(
    private.journal_video_path_uuid(object_name, 2)
  );
$$;

create or replace function private.can_upload_journal_video_object(
  target_bucket_id text,
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case target_bucket_id
      when 'post-videos' then
        private.is_strict_journal_video_path(object_name, '.mp4')
      when 'post-video-thumbnails' then
        private.is_strict_journal_video_path(object_name, '.jpg')
      else false
    end
    and private.journal_video_path_uuid(object_name, 1) = (select auth.uid())
    and private.can_contribute_to_pet(
      private.journal_video_path_uuid(object_name, 2)
    )
    and (
      not exists (
        select 1
        from public.posts as post
        where post.id = private.journal_video_path_uuid(object_name, 3)
      )
      or exists (
        select 1
        from public.posts as post
        where post.id = private.journal_video_path_uuid(object_name, 3)
          and post.pet_id = private.journal_video_path_uuid(object_name, 2)
          and post.author_id = (select auth.uid())
      )
    );
$$;

create or replace function private.can_delete_journal_video_object(
  target_bucket_id text,
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case target_bucket_id
      when 'post-videos' then
        private.is_strict_journal_video_path(object_name, '.mp4')
      when 'post-video-thumbnails' then
        private.is_strict_journal_video_path(object_name, '.jpg')
      else false
    end
    and private.can_contribute_to_pet(
      private.journal_video_path_uuid(object_name, 2)
    )
    and (
      private.journal_video_path_uuid(object_name, 1) = (select auth.uid())
      or private.is_pet_owner(
        private.journal_video_path_uuid(object_name, 2)
      )
    );
$$;

revoke execute on function private.journal_video_path_part(text, integer)
  from public, anon, authenticated;
revoke execute on function private.is_strict_journal_video_path(text, text)
  from public, anon, authenticated;
revoke execute on function private.journal_video_path_uuid(text, integer)
  from public, anon, authenticated;
revoke execute on function private.journal_video_object_id(text, text)
  from public, anon, authenticated;
revoke execute on function private.can_read_journal_video_object(text, text)
  from public, anon;
revoke execute on function private.can_upload_journal_video_object(text, text)
  from public, anon;
revoke execute on function private.can_delete_journal_video_object(text, text)
  from public, anon;
grant execute on function private.can_read_journal_video_object(text, text)
  to authenticated;
grant execute on function private.can_upload_journal_video_object(text, text)
  to authenticated;
grant execute on function private.can_delete_journal_video_object(text, text)
  to authenticated;

create policy "Pet members can read journal video objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('post-videos', 'post-video-thumbnails')
    and (
      select private.can_read_journal_video_object(bucket_id, name)
    )
  );

create policy "Pet authors can upload journal video objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id in ('post-videos', 'post-video-thumbnails')
    and (
      select private.can_upload_journal_video_object(bucket_id, name)
    )
  );

create policy "Pet authors and owners can delete journal video objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id in ('post-videos', 'post-video-thumbnails')
    and (
      select private.can_delete_journal_video_object(bucket_id, name)
    )
  );

create table public.media_cleanup_jobs (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  storage_path text not null,
  reason text not null,
  source_post_id uuid,
  created_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  completed_at timestamptz,
  constraint media_cleanup_jobs_bucket
    check (bucket_id in ('post-videos', 'post-video-thumbnails')),
  constraint media_cleanup_jobs_storage_path
    check (
      char_length(storage_path) between 1 and 1024
      and storage_path = btrim(storage_path)
    ),
  constraint media_cleanup_jobs_reason
    check (
      char_length(reason) between 1 and 160
      and reason = btrim(reason)
    ),
  constraint media_cleanup_jobs_attempt_count
    check (attempt_count >= 0),
  constraint media_cleanup_jobs_last_error
    check (last_error is null or char_length(last_error) <= 2000)
);

-- Extend the committed bootstrap lock in the same migration transaction.
create trigger pre_cutover_release_lock
  before insert or update or delete on public.media_cleanup_jobs
  for each row execute function private.assert_release_write_allowed();

comment on table public.media_cleanup_jobs is
  'Persistent retry queue for MP4/JPEG objects that were referenced by committed database rows and later removed.';
comment on column public.media_cleanup_jobs.next_attempt_at is
  'Also acts as a retry lease after a worker claims a row with FOR UPDATE SKIP LOCKED.';

create unique index media_cleanup_jobs_active_object_idx
  on public.media_cleanup_jobs (bucket_id, storage_path)
  where completed_at is null;
create index media_cleanup_jobs_due_idx
  on public.media_cleanup_jobs (next_attempt_at, id)
  where completed_at is null;

alter table public.media_cleanup_jobs enable row level security;
revoke all on table public.media_cleanup_jobs
  from anon, authenticated, service_role;
grant select, insert, update on table public.media_cleanup_jobs to service_role;
revoke all on sequence public.media_cleanup_jobs_id_seq from service_role;
grant usage, select on sequence public.media_cleanup_jobs_id_seq
  to service_role;

create or replace function private.enqueue_media_cleanup(
  target_bucket_id text,
  target_storage_path text,
  cleanup_reason text,
  target_post_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued_id bigint;
begin
  if target_bucket_id not in ('post-videos', 'post-video-thumbnails')
    or target_storage_path is null
    or char_length(target_storage_path) not between 1 and 1024
    or cleanup_reason is null
    or char_length(cleanup_reason) not between 1 and 160
  then
    raise exception 'invalid media cleanup job' using errcode = '22023';
  end if;

  insert into public.media_cleanup_jobs (
    bucket_id,
    storage_path,
    reason,
    source_post_id
  )
  values (
    target_bucket_id,
    target_storage_path,
    cleanup_reason,
    target_post_id
  )
  on conflict (bucket_id, storage_path) where completed_at is null
  do update set
    reason = excluded.reason,
    source_post_id = coalesce(
      excluded.source_post_id,
      media_cleanup_jobs.source_post_id
    ),
    next_attempt_at = least(
      media_cleanup_jobs.next_attempt_at,
      now()
    )
  returning id into queued_id;

  return queued_id;
end;
$$;

create or replace function private.enqueue_deleted_post_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_media_cleanup(
    'post-videos',
    old.storage_path,
    'post_video_removed',
    old.post_id
  );
  perform private.enqueue_media_cleanup(
    'post-video-thumbnails',
    old.thumbnail_path,
    'post_video_thumbnail_removed',
    old.post_id
  );
  return old;
end;
$$;

create trigger enqueue_deleted_post_video_cleanup
after delete on public.post_videos
for each row execute function private.enqueue_deleted_post_video();

revoke execute on function private.enqueue_media_cleanup(
  text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function private.enqueue_deleted_post_video()
  from public, anon, authenticated;

create or replace function public.claim_media_cleanup_jobs(
  job_limit integer default 25
)
returns setof public.media_cleanup_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if job_limit not between 1 and 100 then
    raise exception 'job limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  return query
  with due_jobs as (
    select job.id
    from public.media_cleanup_jobs as job
    where job.completed_at is null
      and job.next_attempt_at <= now()
    order by job.next_attempt_at, job.id
    for update skip locked
    limit job_limit
  )
  update public.media_cleanup_jobs as job
  set
    attempt_count = job.attempt_count + 1,
    next_attempt_at = now() + pg_catalog.make_interval(
      secs => least(
        3600,
        30 * (1 << least(job.attempt_count, 7))
      )
    )
  from due_jobs
  where job.id = due_jobs.id
  returning job.*;
end;
$$;

create or replace function public.complete_media_cleanup_job(target_job_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.media_cleanup_jobs
  set completed_at = now(), last_error = null
  where id = target_job_id
    and completed_at is null;
end;
$$;

create or replace function public.fail_media_cleanup_job(
  target_job_id bigint,
  failure_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.media_cleanup_jobs
  set last_error = pg_catalog.left(
    coalesce(nullif(btrim(failure_message), ''), 'Unknown Storage error'),
    2000
  )
  where id = target_job_id
    and completed_at is null;
end;
$$;

revoke execute on function public.claim_media_cleanup_jobs(integer)
  from public, anon, authenticated;
revoke execute on function public.complete_media_cleanup_job(bigint)
  from public, anon, authenticated;
revoke execute on function public.fail_media_cleanup_job(bigint, text)
  from public, anon, authenticated;
grant execute on function public.claim_media_cleanup_jobs(integer)
  to service_role;
grant execute on function public.complete_media_cleanup_job(bigint)
  to service_role;
grant execute on function public.fail_media_cleanup_job(bigint, text)
  to service_role;

create or replace function public.validate_post_has_content_or_media()
returns trigger
language plpgsql
security definer
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
      and not exists (
        select 1
        from public.post_videos as video
        where video.post_id = post.id
      )
  ) then
    raise exception 'post must contain text, at least one image, or one video'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.posts as post
    where post.id = target_post_id
      and exists (
        select 1
        from public.post_media as media
        where media.post_id = post.id
      )
      and exists (
        select 1
        from public.post_videos as video
        where video.post_id = post.id
      )
  ) then
    raise exception 'post cannot contain both images and video'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.validate_post_has_content_or_media() is
  'Deferred Journal invariant: a post has text, photos, or video, and photos/video are mutually exclusive.';

create constraint trigger validate_post_content_or_media_from_videos
after insert or update or delete on public.post_videos
deferrable initially deferred
for each row execute function public.validate_post_has_content_or_media();

revoke execute on function public.validate_post_has_content_or_media()
  from public, anon, authenticated;

create or replace function private.validate_post_video_input(
  caller_id uuid,
  target_pet_id uuid,
  target_post_id uuid,
  video_item jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_id uuid;
  item_path text;
  item_thumbnail_path text;
  item_duration_ms integer;
  item_width integer;
  item_height integer;
  expected_path text;
  expected_thumbnail_path text;
  video_size bigint;
  video_mime_type text;
  thumbnail_size bigint;
  thumbnail_mime_type text;
begin
  if video_item is null
    or video_item = 'null'::jsonb
    or pg_catalog.jsonb_typeof(video_item) <> 'object'
  then
    raise exception 'video must be an object' using errcode = '22023';
  end if;

  begin
    item_id := (video_item->>'id')::uuid;
    item_duration_ms := (video_item->>'duration_ms')::integer;
    item_width := (video_item->>'width')::integer;
    item_height := (video_item->>'height')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid video metadata' using errcode = '22023';
  end;

  item_path := video_item->>'storage_path';
  item_thumbnail_path := video_item->>'thumbnail_path';
  expected_path := caller_id::text || '/' || target_pet_id::text || '/' ||
    target_post_id::text || '/' || item_id::text || '.mp4';
  expected_thumbnail_path := caller_id::text || '/' || target_pet_id::text ||
    '/' || target_post_id::text || '/' || item_id::text || '.jpg';

  if item_id is null then
    raise exception 'invalid video id' using errcode = '22023';
  end if;

  if item_path is distinct from expected_path then
    raise exception 'invalid video storage path'
      using errcode = '22023',
      detail = 'expected ' || expected_path || ', received ' ||
        coalesce(item_path, '<null>');
  end if;

  if item_thumbnail_path is distinct from expected_thumbnail_path then
    raise exception 'invalid video thumbnail path'
      using errcode = '22023',
      detail = 'expected ' || expected_thumbnail_path || ', received ' ||
        coalesce(item_thumbnail_path, '<null>');
  end if;

  if item_duration_ms not between 1 and 15000
    or item_width <= 0
    or item_height <= 0
  then
    raise exception 'invalid video duration or dimensions'
      using errcode = '22023';
  end if;

  if coalesce(video_item->>'mime_type', '') <> 'video/mp4' then
    raise exception 'invalid video MIME type' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.media_cleanup_jobs as job
    where job.completed_at is null
      and (
        (job.bucket_id = 'post-videos' and job.storage_path = item_path)
        or (
          job.bucket_id = 'post-video-thumbnails'
          and job.storage_path = item_thumbnail_path
        )
      )
  ) then
    raise exception 'video object is pending cleanup' using errcode = '23505';
  end if;

  begin
    select
      (object.metadata->>'size')::bigint,
      pg_catalog.lower(object.metadata->>'mimetype')
    into video_size, video_mime_type
    from storage.objects as object
    where object.bucket_id = 'post-videos'
      and object.name = item_path
      and object.owner_id = caller_id::text;

    select
      (object.metadata->>'size')::bigint,
      pg_catalog.lower(object.metadata->>'mimetype')
    into thumbnail_size, thumbnail_mime_type
    from storage.objects as object
    where object.bucket_id = 'post-video-thumbnails'
      and object.name = item_thumbnail_path
      and object.owner_id = caller_id::text;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid Storage object metadata' using errcode = '22023';
  end;

  if video_size is null
    or video_size not between 1 and 26214400
    or video_mime_type is distinct from 'video/mp4'
  then
    raise exception 'uploaded video object is missing or invalid'
      using errcode = '22023';
  end if;

  if thumbnail_size is null
    or thumbnail_size not between 1 and 2097152
    or thumbnail_mime_type is distinct from 'image/jpeg'
  then
    raise exception 'uploaded video thumbnail is missing or invalid'
      using errcode = '22023';
  end if;

  return video_size;
end;
$$;

revoke execute on function private.validate_post_video_input(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

create or replace function public.create_post_v2(
  post_id uuid,
  post_pet_id uuid,
  post_content text,
  post_tag public.post_tag,
  post_event_date date,
  post_location_name text,
  media_items jsonb default '[]'::jsonb,
  video_item jsonb default null
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
  has_video boolean;
  video_size bigint;
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
  has_video := video_item is not null and video_item <> 'null'::jsonb;

  perform private.validate_post_media_input(
    caller_id,
    post_pet_id,
    post_id,
    media_items
  );

  if has_video then
    video_size := private.validate_post_video_input(
      caller_id,
      post_pet_id,
      post_id,
      video_item
    );
  end if;

  if pg_catalog.jsonb_array_length(media_items) > 0 and has_video then
    raise exception 'post cannot contain both images and video'
      using errcode = '23514';
  end if;

  if safe_content is null
    and pg_catalog.jsonb_array_length(media_items) = 0
    and not has_video
  then
    raise exception 'post must contain text, at least one image, or one video'
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

  if has_video then
    insert into public.post_videos (
      id,
      post_id,
      storage_path,
      thumbnail_path,
      duration_ms,
      file_size_bytes,
      width,
      height,
      mime_type
    )
    values (
      (video_item->>'id')::uuid,
      post_id,
      video_item->>'storage_path',
      video_item->>'thumbnail_path',
      (video_item->>'duration_ms')::integer,
      video_size,
      (video_item->>'width')::integer,
      (video_item->>'height')::integer,
      video_item->>'mime_type'
    );
  end if;

  return created_post;
end;
$$;

create or replace function public.update_post_v2(
  target_post_id uuid,
  post_content text,
  post_tag public.post_tag,
  post_event_date date,
  post_location_name text,
  media_items jsonb default '[]'::jsonb,
  video_item jsonb default null
)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_post public.posts;
  existing_video public.post_videos%rowtype;
  updated_post public.posts;
  item jsonb;
  safe_content text;
  safe_location_name text;
  has_video boolean;
  video_id uuid;
  video_size bigint;
  video_path text;
  thumbnail_path text;
  duration_ms integer;
  video_width integer;
  video_height integer;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into existing_post
  from public.posts as post
  where post.id = target_post_id
  for update;

  if existing_post.id is null
    or existing_post.author_id <> caller_id
    or not private.can_contribute_to_pet(existing_post.pet_id)
  then
    raise exception 'post not found' using errcode = '42501';
  end if;

  safe_content := nullif(btrim(coalesce(post_content, '')), '');
  safe_location_name := nullif(btrim(coalesce(post_location_name, '')), '');
  has_video := video_item is not null and video_item <> 'null'::jsonb;

  perform private.validate_post_media_input(
    caller_id,
    existing_post.pet_id,
    existing_post.id,
    media_items
  );

  if has_video then
    video_size := private.validate_post_video_input(
      caller_id,
      existing_post.pet_id,
      existing_post.id,
      video_item
    );
    video_id := (video_item->>'id')::uuid;
    video_path := video_item->>'storage_path';
    thumbnail_path := video_item->>'thumbnail_path';
    duration_ms := (video_item->>'duration_ms')::integer;
    video_width := (video_item->>'width')::integer;
    video_height := (video_item->>'height')::integer;
  end if;

  if pg_catalog.jsonb_array_length(media_items) > 0 and has_video then
    raise exception 'post cannot contain both images and video'
      using errcode = '23514';
  end if;

  if safe_content is null
    and pg_catalog.jsonb_array_length(media_items) = 0
    and not has_video
  then
    raise exception 'post must contain text, at least one image, or one video'
      using errcode = '23514';
  end if;

  select * into existing_video
  from public.post_videos as video
  where video.post_id = target_post_id
  for update;

  if has_video and existing_video.id is not null then
    if existing_video.id = video_id
      and existing_video.storage_path = video_path
      and existing_video.thumbnail_path = thumbnail_path
      and existing_video.duration_ms = duration_ms
      and existing_video.file_size_bytes = video_size
      and existing_video.width = video_width
      and existing_video.height = video_height
      and existing_video.mime_type = 'video/mp4'
    then
      null;
    elsif existing_video.id = video_id
      or existing_video.storage_path = video_path
      or existing_video.thumbnail_path = thumbnail_path
    then
      raise exception 'existing video identity cannot be reused'
        using errcode = '23505';
    end if;
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

  if not has_video then
    delete from public.post_videos where post_id = target_post_id;
  elsif existing_video.id is null then
    insert into public.post_videos (
      id,
      post_id,
      storage_path,
      thumbnail_path,
      duration_ms,
      file_size_bytes,
      width,
      height,
      mime_type
    )
    values (
      video_id,
      target_post_id,
      video_path,
      thumbnail_path,
      duration_ms,
      video_size,
      video_width,
      video_height,
      'video/mp4'
    );
  elsif existing_video.id <> video_id
    or existing_video.storage_path <> video_path
    or existing_video.thumbnail_path <> thumbnail_path
  then
    delete from public.post_videos where post_id = target_post_id;
    insert into public.post_videos (
      id,
      post_id,
      storage_path,
      thumbnail_path,
      duration_ms,
      file_size_bytes,
      width,
      height,
      mime_type
    )
    values (
      video_id,
      target_post_id,
      video_path,
      thumbnail_path,
      duration_ms,
      video_size,
      video_width,
      video_height,
      'video/mp4'
    );
  end if;

  return updated_post;
end;
$$;

revoke execute on function public.create_post_v2(
  uuid, uuid, text, public.post_tag, date, text, jsonb, jsonb
) from public, anon;
revoke execute on function public.update_post_v2(
  uuid, text, public.post_tag, date, text, jsonb, jsonb
) from public, anon;
grant execute on function public.create_post_v2(
  uuid, uuid, text, public.post_tag, date, text, jsonb, jsonb
) to authenticated;
grant execute on function public.update_post_v2(
  uuid, text, public.post_tag, date, text, jsonb, jsonb
) to authenticated;

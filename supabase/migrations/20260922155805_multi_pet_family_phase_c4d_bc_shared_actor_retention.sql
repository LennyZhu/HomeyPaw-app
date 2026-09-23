-- Preserve shared Family/Pet history when an Auth user is deleted. Actor
-- columns become nullable only for historical anonymization; all new writes
-- remain bound to auth.uid() by the existing SECURITY DEFINER mutation RPCs.
--
-- Supabase applies each migration in a transaction, so the FK changes and the
-- NULL-safe authorization replacements become visible atomically.

alter table public.posts
  drop constraint posts_author_id_fkey,
  alter column author_id drop not null;

alter table public.posts
  add constraint posts_author_id_fkey
  foreign key (author_id)
  references auth.users (id)
  on delete set null;

alter table public.care_logs
  drop constraint care_logs_performed_by_fkey,
  alter column performed_by drop not null;

alter table public.care_logs
  add constraint care_logs_performed_by_fkey
  foreign key (performed_by)
  references auth.users (id)
  on delete set null;

alter table public.care_task_completions
  drop constraint care_task_completions_completed_by_fkey,
  alter column completed_by drop not null;

alter table public.care_task_completions
  add constraint care_task_completions_completed_by_fkey
  foreign key (completed_by)
  references auth.users (id)
  on delete set null;

alter table public.chat_messages
  drop constraint chat_messages_sender_id_fkey,
  alter column sender_id drop not null;

alter table public.chat_messages
  add constraint chat_messages_sender_id_fkey
  foreign key (sender_id)
  references auth.users (id)
  on delete set null;

comment on column public.posts.author_id is
  'Bound to auth.uid() on create; null only after the actor account is deleted.';
comment on column public.care_logs.performed_by is
  'Bound to auth.uid() on create; null only after the actor account is deleted.';
comment on column public.care_task_completions.completed_by is
  'Bound to auth.uid() on completion; null only after the actor account is deleted.';
comment on column public.chat_messages.sender_id is
  'Bound to auth.uid() on send; null only after the sender account is deleted.';

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
    or existing_post.author_id is distinct from caller_id
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
    or existing_post.author_id is distinct from caller_id
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

create or replace function public.update_care_log(
  target_care_log_id uuid,
  care_occurred_at timestamptz,
  care_time_zone text,
  care_note text default null,
  care_duration_minutes integer default null
)
returns public.care_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_log public.care_logs;
  updated_log public.care_logs;
  safe_note text;
  safe_time_zone text;
  derived_local_date date;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into existing_log
  from public.care_logs as care_log
  where care_log.id = target_care_log_id;

  if existing_log.id is null
    or existing_log.performed_by is distinct from caller_id
    or not private.can_contribute_to_pet(existing_log.pet_id)
  then
    raise exception 'care log not found' using errcode = '42501';
  end if;

  if care_occurred_at is null then
    raise exception 'care time is required' using errcode = '22023';
  end if;

  if care_occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'care time cannot be in the future' using errcode = '22023';
  end if;

  safe_time_zone := nullif(btrim(coalesce(care_time_zone, '')), '');
  if safe_time_zone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = safe_time_zone
    )
  then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  safe_note := nullif(btrim(coalesce(care_note, '')), '');

  if existing_log.care_type = 'other' and safe_note is null then
    raise exception 'other care requires a note' using errcode = '23514';
  end if;

  if char_length(coalesce(safe_note, '')) > 500 then
    raise exception 'care note is too long' using errcode = '22001';
  end if;

  if care_duration_minutes is not null and (
    existing_log.care_type <> 'walk'
    or care_duration_minutes < 1
    or care_duration_minutes > 1440
  ) then
    raise exception 'invalid care duration' using errcode = '23514';
  end if;

  derived_local_date := (care_occurred_at at time zone safe_time_zone)::date;

  update public.care_logs
  set
    occurred_at = care_occurred_at,
    time_zone = safe_time_zone,
    local_date = derived_local_date,
    note = safe_note,
    duration_minutes = care_duration_minutes
  where id = target_care_log_id
  returning * into updated_log;

  return updated_log;
end;
$$;

create or replace function public.undo_care_task_completion(
  target_completion_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_completion public.care_task_completions;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select completion.* into existing_completion
  from public.care_task_completions as completion
  where completion.id = target_completion_id
  for update;

  if existing_completion.id is null then
    return 'not_found';
  end if;

  if not private.is_pet_member(existing_completion.pet_id)
    or (
      existing_completion.completed_by is distinct from caller_id
      and not private.is_pet_owner(existing_completion.pet_id)
    )
  then
    raise exception 'completion not found' using errcode = '42501';
  end if;

  delete from public.care_logs
  where id = existing_completion.care_log_id;

  return 'undone';
end;
$$;

create or replace function public.update_chat_message(
  target_message_id uuid,
  message_body text
)
returns public.chat_messages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  message_pet_id uuid;
  message_sender_id uuid;
  safe_body text;
  updated_message public.chat_messages;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_message_id is null then
    raise exception 'message id is required' using errcode = '22023';
  end if;

  safe_body := btrim(coalesce(message_body, ''));

  if safe_body = '' or safe_body !~ '[^[:space:]]' then
    raise exception 'message cannot be empty' using errcode = '23514';
  end if;

  if char_length(safe_body) > 2000 then
    raise exception 'message is too long' using errcode = '23514';
  end if;

  -- Read only routing/ownership columns before taking locks. Every mutating
  -- Chat RPC then locks membership -> channel state -> message in that order.
  select message.pet_id, message.sender_id
  into message_pet_id, message_sender_id
  from public.chat_messages as message
  where message.id = target_message_id;

  if message_pet_id is null or message_sender_id is distinct from caller_id then
    raise exception 'message not found' using errcode = '42501';
  end if;

  caller_role := private.lock_pet_chat_membership(message_pet_id);
  if caller_role is null then
    raise exception 'message not found' using errcode = '42501';
  end if;

  update public.chat_messages as message
  set
    body = safe_body,
    updated_at = now()
  where message.id = target_message_id
    and message.pet_id = message_pet_id
    and message.sender_id = caller_id
  returning message.* into updated_message;

  if updated_message.id is null then
    raise exception 'message not found' using errcode = '42501';
  end if;

  return updated_message;
end;
$$;

create or replace function public.delete_chat_message(
  target_message_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  deleted_pet_id uuid;
  message_pet_id uuid;
  message_sender_id uuid;
  caller_role public.pet_member_role;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select message.pet_id, message.sender_id
  into message_pet_id, message_sender_id
  from public.chat_messages as message
  where message.id = target_message_id;

  if message_pet_id is null then
    return false;
  end if;

  caller_role := private.lock_pet_chat_membership(message_pet_id);
  if caller_role is null
    or (message_sender_id is distinct from caller_id and caller_role <> 'owner')
  then
    return false;
  end if;

  delete from public.chat_messages as message
  where message.id = target_message_id
  returning message.pet_id into deleted_pet_id;

  if deleted_pet_id is null then
    return false;
  end if;

  perform private.broadcast_pet_chat_change(
    deleted_pet_id,
    'message_deleted',
    target_message_id
  );

  return true;
end;
$$;

create or replace function public.get_chat_unread_count(
  target_pet_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  unread_count bigint;
  read_cursor_at timestamptz;
  read_cursor_id uuid;
begin
  caller_id := auth.uid();

  if caller_id is null
    or not private.can_contribute_to_pet(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select
    read_state.last_read_at,
    read_state.last_read_message_id
  into read_cursor_at, read_cursor_id
  from public.chat_read_states as read_state
  where read_state.pet_id = target_pet_id
    and read_state.user_id = caller_id;

  select count(*) into unread_count
  from public.chat_messages as message
  where message.pet_id = target_pet_id
    and message.sender_id is distinct from caller_id
    and (message.created_at, message.id) > (
      coalesce(read_cursor_at, to_timestamp(0)),
      coalesce(
        read_cursor_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    );

  return unread_count;
end;
$$;

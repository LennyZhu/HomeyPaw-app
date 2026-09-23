-- Phase C4E makes database references the authority for durable media
-- lifecycle cleanup. Database mutations enqueue cleanup in the same
-- transaction; Storage deletion happens later in the local worker.

alter table public.media_cleanup_jobs
  drop constraint media_cleanup_jobs_bucket;

alter table public.media_cleanup_jobs
  add constraint media_cleanup_jobs_bucket
  check (
    bucket_id in (
      'profile-avatars',
      'pet-avatars',
      'post-media',
      'post-videos',
      'post-video-thumbnails'
    )
  );

comment on table public.media_cleanup_jobs is
  'Durable, retryable cleanup queue for user-owned profile avatars, Pet-owned avatars, and Post/Pet-owned Journal media after their canonical database reference is removed.';
comment on column public.media_cleanup_jobs.source_post_id is
  'Optional former Post identifier for Journal media diagnostics; it is deliberately not a foreign key so cleanup survives Post deletion.';

create or replace function private.is_valid_media_cleanup_path(
  target_bucket_id text,
  target_storage_path text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    target_storage_path is not null
    and char_length(target_storage_path) between 1 and 1024
    and target_storage_path = btrim(target_storage_path)
    and target_storage_path not like '/%'
    and target_storage_path not like '%/%/'
    and target_storage_path not like '%//%'
    and position('..' in target_storage_path) = 0
    and case target_bucket_id
      when 'profile-avatars' then
        target_storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$'
      when 'pet-avatars' then
        target_storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$'
      when 'post-media' then
        target_storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$'
      when 'post-videos' then
        target_storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]*\.mp4$'
      when 'post-video-thumbnails' then
        target_storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$'
      else false
    end;
$$;

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
  if not private.is_valid_media_cleanup_path(
    target_bucket_id,
    target_storage_path
  )
    or cleanup_reason is null
    or char_length(cleanup_reason) not between 1 and 160
    or cleanup_reason <> btrim(cleanup_reason)
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
    next_attempt_at = least(media_cleanup_jobs.next_attempt_at, now())
  returning id into queued_id;

  return queued_id;
end;
$$;

create or replace function private.enqueue_removed_profile_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.avatar_url is not null
    and (tg_op = 'DELETE' or old.avatar_url is distinct from new.avatar_url)
  then
    perform private.enqueue_media_cleanup(
      'profile-avatars',
      old.avatar_url,
      case
        when tg_op = 'DELETE' then 'profile_avatar_deleted'
        else 'profile_avatar_replaced'
      end
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger enqueue_removed_profile_avatar_cleanup
after update of avatar_url or delete on public.profiles
for each row execute function private.enqueue_removed_profile_avatar();

create or replace function private.enqueue_removed_pet_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.avatar_path is not null
    and (tg_op = 'DELETE' or old.avatar_path is distinct from new.avatar_path)
  then
    perform private.enqueue_media_cleanup(
      'pet-avatars',
      old.avatar_path,
      case
        when tg_op = 'DELETE' then 'pet_avatar_deleted'
        else 'pet_avatar_replaced'
      end
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger enqueue_removed_pet_avatar_cleanup
after update of avatar_path or delete on public.pets
for each row execute function private.enqueue_removed_pet_avatar();

create or replace function private.enqueue_deleted_post_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- update_post and update_post_v2 replace the metadata set by deleting and
  -- reinserting it. A retained committed path must not be queued.
  if not exists (
    select 1
    from public.post_media as media
    where media.storage_path = old.storage_path
  ) then
    perform private.enqueue_media_cleanup(
      'post-media', old.storage_path, 'post_media_removed', old.post_id
    );
  end if;

  return old;
end;
$$;

create constraint trigger enqueue_deleted_post_media_cleanup
after delete on public.post_media
deferrable initially deferred
for each row execute function private.enqueue_deleted_post_media();

revoke execute on function private.is_valid_media_cleanup_path(text, text)
  from public, anon, authenticated;
revoke execute on function private.enqueue_media_cleanup(text, text, text, uuid)
  from public, anon, authenticated;
revoke execute on function private.enqueue_removed_profile_avatar()
  from public, anon, authenticated;
revoke execute on function private.enqueue_removed_pet_avatar()
  from public, anon, authenticated;
revoke execute on function private.enqueue_deleted_post_media()
  from public, anon, authenticated;

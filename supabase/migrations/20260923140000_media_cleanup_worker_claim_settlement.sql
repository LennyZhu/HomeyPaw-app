-- R2: An expired worker must not settle a later claim of the same job.
-- Existing queue, retry interval, enqueue triggers, and lifecycle semantics remain unchanged.
create or replace function public.complete_media_cleanup_job_if_claimed(
  target_job_id bigint,
  claimed_attempt_count integer
)
returns boolean
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
    and attempt_count = claimed_attempt_count
    and next_attempt_at > now()
    and completed_at is null;
  return found;
end;
$$;

create or replace function public.fail_media_cleanup_job_if_claimed(
  target_job_id bigint,
  claimed_attempt_count integer,
  failure_message text
)
returns boolean
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
    coalesce(nullif(btrim(failure_message), ''), 'Unknown Storage error'), 2000
  )
  where id = target_job_id
    and attempt_count = claimed_attempt_count
    and next_attempt_at > now()
    and completed_at is null;
  return found;
end;
$$;

revoke execute on function public.complete_media_cleanup_job_if_claimed(bigint, integer)
  from public, anon, authenticated;
revoke execute on function public.fail_media_cleanup_job_if_claimed(bigint, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_media_cleanup_job_if_claimed(bigint, integer)
  to service_role;
grant execute on function public.fail_media_cleanup_job_if_claimed(bigint, integer, text)
  to service_role;

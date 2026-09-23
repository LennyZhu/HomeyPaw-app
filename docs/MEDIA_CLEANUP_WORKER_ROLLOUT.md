# R2 media cleanup worker rollout (operator runbook)

The C4E `media_cleanup_jobs` table is the only cleanup queue. Canonical DB mutations commit with their cleanup jobs; a stopped worker delays Storage deletion without changing Family, Pet, Post, or Account state. The worker consumes at most five jobs per invocation by default (configurable 1–25), validates the queued bucket and canonical path again, and settles each job independently. The five buckets are `profile-avatars`, `pet-avatars`, `post-media`, `post-videos`, and `post-video-thumbnails`.

## Deployment order (not performed by R2)

1. Verify C4E and the R2 claim-settlement migration are installed. Confirm the rest of the approved Family migration sequence and Production data preflight separately.
2. Deploy `process-media-cleanup` Edge Function with `verify_jwt = false`. This exposes an HTTP endpoint, but its own high-entropy `MEDIA_CLEANUP_INVOKE_SECRET` check runs before any queue claim. Do **not** set the scheduler yet.
3. Set `MEDIA_CLEANUP_INVOKE_SECRET` (at least 32 random characters) as a Production Edge secret. The Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Set optional `MEDIA_CLEANUP_BATCH_SIZE` to 1–25; default 5. Never put these credentials in the app, repo, logs, or a public endpoint. Missing credentials fail closed.
4. Store the same invoke secret, project URL, and publishable API key in Supabase Vault for the scheduler. Use a controlled internal invocation against a known disposable queued object; verify batch response, Storage deletion, completed row, and logs. Do not put bucket or path in the request; the body is ignored.
5. Configure the `pg_cron` + `pg_net` schedule below, initially at a low cadence (e.g. every five minutes). A one-minute cadence is possible after measuring batch latency and backlog. No user App session or local computer is involved.
6. Monitor the queue and Edge structured logs for a full observation window, then restore destructive endpoints only after the broader Release Gate is GO. C4E / worker readiness alone does not make the whole release GO.

The schedule SQL below is a **template only**. Replace the three Vault secret names after provisioning them in the Production project. Review privileges and run manually only during an approved Production rollout. R2 did not run this SQL remotely.

```sql
-- Provision Vault secrets separately: media_cleanup_project_url,
-- media_cleanup_publishable_key, media_cleanup_invoke_secret.
select cron.schedule(
  'process-media-cleanup',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'media_cleanup_project_url') || '/functions/v1/process-media-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'media_cleanup_publishable_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'media_cleanup_invoke_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

The queue's `FOR UPDATE SKIP LOCKED` claim gives each invocation different due jobs. `attempt_count` acts as the claim generation: R2's completion/failure RPCs reject an older generation or an expired lease. Storage `remove` is idempotent for already-missing objects, including a replay after successful removal but failed settlement. A job can be retried after its C4E lease/backoff; errors are kept in `last_error`. There is no dead-letter state, so recurring poison jobs stay visible and retry no faster than the existing capped backoff. Keep total batch runtime below the shortest 30-second first lease under normal operations; use batch size 1 if Storage latency approaches it. Late workers cannot settle a later claim; duplicate Storage remove remains safe only while canonical object paths are not reused. Keep upload paths unique as the existing app does.

## Read-only monitoring SQL

The schema has no explicit processing state. `next_attempt_at > now()` is **leased or backing off**, not an exact count of currently running workers.

```sql
select
  count(*) filter (where completed_at is null) as unfinished,
  count(*) filter (where completed_at is null and attempt_count = 0) as pending_unclaimed,
  count(*) filter (where completed_at is null and next_attempt_at <= now()) as due_now,
  count(*) filter (where completed_at is null and next_attempt_at > now()) as leased_or_backing_off,
  count(*) filter (where completed_at is null and last_error is not null) as failed_retrying,
  max(now() - created_at) filter (where completed_at is null) as oldest_unfinished_age,
  count(*) filter (where completed_at >= now() - interval '1 hour') as processed_last_hour
from public.media_cleanup_jobs;

select id, bucket_id, attempt_count, next_attempt_at, created_at, left(last_error, 240) as last_error
from public.media_cleanup_jobs
where completed_at is null and last_error is not null
order by next_attempt_at desc
limit 25;
```

Alert operators if oldest unfinished age or failed/retrying count rises, or if `processed_last_hour` is zero while `due_now` is nonzero. Edge logs emit `media_cleanup_batch`, `media_cleanup_retry`, `media_cleanup_stale_claim`, and `media_cleanup_settlement_error` with job IDs and buckets, without secrets or full paths.

## Emergency stop

Disable/unschedule `process-media-cleanup` and stop invoking the function. Do not roll back DB lifecycle migrations or delete queued rows. Jobs remain durable while the worker is stopped for hours or days. Fix the worker, make a controlled test call, then resume the scheduler and watch the backlog drain. The local `process:media-cleanup` script remains restricted to local Supabase for development verification; Production uses the scheduled Edge Function.

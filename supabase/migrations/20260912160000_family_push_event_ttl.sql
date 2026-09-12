-- Family activity Push is useful only while it is recent. Keep expired outbox
-- and delivery rows for audit, but never send an event ten minutes after its
-- original database creation time.

alter table private.family_notification_outbox
  drop constraint family_notification_outbox_status;

alter table private.family_notification_outbox
  add constraint family_notification_outbox_status
  check (status in ('pending', 'processing', 'retry', 'processed', 'failed', 'expired'));

create index family_notification_outbox_expiry_idx
  on private.family_notification_outbox (created_at, id)
  where status in ('pending', 'processing', 'retry');

create or replace function private.expire_family_notification_event(
  target_event_id uuid,
  include_active_processing boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_event_id uuid;
begin
  update private.family_notification_outbox as event
  set
    status = 'expired',
    processed_at = now(),
    lease_until = null,
    last_error = 'event expired after 10 minutes'
  where event.id = target_event_id
    and event.created_at <= now() - interval '10 minutes'
    and (
      event.status in ('pending', 'retry')
      or (
        event.status = 'processing'
        and (include_active_processing or event.lease_until < now())
      )
    )
  returning event.id into expired_event_id;

  if expired_event_id is null then
    return false;
  end if;

  update private.family_notification_deliveries as delivery
  set
    status = 'skipped',
    processed_at = now(),
    updated_at = now(),
    last_error = 'event expired after 10 minutes'
  where delivery.event_id = expired_event_id
    and delivery.status in ('pending', 'retry', 'sending');

  return true;
end;
$$;

revoke execute on function private.expire_family_notification_event(uuid, boolean)
  from public, anon, authenticated;

-- Safely terminalize any backlog that predates this remediation. Successful,
-- accepted, delivered, and otherwise terminal delivery history is untouched.
do $migration$
declare
  stale_event record;
begin
  for stale_event in
    select event.id
    from private.family_notification_outbox as event
    where event.created_at <= now() - interval '10 minutes'
      and (
        event.status in ('pending', 'retry')
        or (event.status = 'processing' and event.lease_until < now())
      )
    order by event.created_at, event.id
  loop
    perform private.expire_family_notification_event(stale_event.id, false);
  end loop;
end;
$migration$;

create or replace function public.claim_family_notification_event()
returns table (
  event_id uuid,
  event_type text,
  activity_kind text,
  pet_id uuid,
  actor_user_id uuid,
  source_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed private.family_notification_outbox;
  stale_event_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  -- Bound cleanup work per claim. Fresh events can still be selected when a
  -- larger stale backlog remains because the claim query independently gates
  -- on the same server-time TTL.
  for stale_event_id in
    select event.id
    from private.family_notification_outbox as event
    where event.created_at <= now() - interval '10 minutes'
      and (
        event.status in ('pending', 'retry')
        or (event.status = 'processing' and event.lease_until < now())
      )
    order by event.created_at, event.id
    for update skip locked
    limit 100
  loop
    perform private.expire_family_notification_event(stale_event_id, false);
  end loop;

  select event.* into claimed
  from private.family_notification_outbox as event
  where event.created_at > now() - interval '10 minutes'
    and event.attempt_count < 5
    and event.available_at <= now()
    and (
      event.status in ('pending', 'retry')
      or (event.status = 'processing' and event.lease_until < now())
    )
  order by event.created_at, event.id
  for update skip locked
  limit 1;

  if claimed.id is null then
    return;
  end if;

  if claimed.status = 'processing' then
    update private.family_notification_deliveries as delivery
    set
      status = 'failed',
      processed_at = now(),
      updated_at = now(),
      last_error = 'expired send lease; not retried to prevent duplicate push'
    where delivery.event_id = claimed.id
      and delivery.status = 'sending';
  end if;

  update private.family_notification_outbox as event
  set
    status = 'processing',
    attempt_count = event.attempt_count + 1,
    lease_until = now() + interval '2 minutes',
    last_error = null
  where event.id = claimed.id;

  insert into private.family_notification_deliveries (
    event_id,
    push_device_id,
    recipient_user_id
  )
  select
    claimed.id,
    device.id,
    membership.user_id
  from public.pet_members as membership
  join private.push_devices as device
    on device.user_id = membership.user_id
   and device.enabled
  where membership.pet_id = claimed.pet_id
    and membership.role in ('owner', 'member')
    and membership.user_id <> claimed.actor_user_id
  on conflict on constraint family_notification_delivery_unique do nothing;

  if not exists (
    select 1
    from private.family_notification_deliveries as delivery
    where delivery.event_id = claimed.id
  ) then
    update private.family_notification_outbox as event
    set status = 'processed', processed_at = now(), lease_until = null
    where event.id = claimed.id;
  end if;

  return query select
    claimed.id,
    claimed.event_type::text,
    claimed.activity_kind,
    claimed.pet_id,
    claimed.actor_user_id,
    claimed.source_id;
end;
$$;

create or replace function public.claim_family_notification_targets(
  target_event_id uuid,
  requested_limit integer default 100
)
returns table (
  delivery_id uuid,
  push_device_id uuid,
  expo_push_token text,
  recipient_locale text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if private.expire_family_notification_event(target_event_id, true) then
    return;
  end if;

  update private.family_notification_deliveries as delivery
  set status = 'skipped', processed_at = now(), updated_at = now(),
      last_error = 'recipient no longer eligible'
  from private.family_notification_outbox as event
  where delivery.event_id = target_event_id
    and event.id = delivery.event_id
    and delivery.status in ('pending', 'retry', 'sending')
    and not exists (
      select 1
      from public.pet_members as membership
      join private.push_devices as device
        on device.id = delivery.push_device_id
      where membership.pet_id = event.pet_id
        and membership.user_id = delivery.recipient_user_id
        and membership.role in ('owner', 'member')
        and membership.user_id <> event.actor_user_id
        and device.user_id = delivery.recipient_user_id
        and device.enabled
    );

  return query
  with candidates as (
    select delivery.id
    from private.family_notification_deliveries as delivery
    join private.family_notification_outbox as event
      on event.id = delivery.event_id
    where delivery.event_id = target_event_id
      and event.created_at > now() - interval '10 minutes'
      and event.status = 'processing'
      and delivery.status in ('pending', 'retry')
      and delivery.available_at <= now()
      and delivery.attempt_count < 3
    order by delivery.created_at, delivery.id
    for update of delivery skip locked
    limit greatest(1, least(coalesce(requested_limit, 100), 100))
  ), claimed as (
    update private.family_notification_deliveries as delivery
    set
      status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      updated_at = now(),
      last_error = null
    where delivery.id in (select candidate.id from candidates as candidate)
    returning delivery.*
  )
  select
    claimed.id,
    device.id,
    device.expo_push_token,
    coalesce(profile.locale, 'zh-HK')::text
  from claimed
  join private.push_devices as device on device.id = claimed.push_device_id
  left join public.profiles as profile on profile.id = claimed.recipient_user_id;
end;
$$;

create or replace function public.finish_family_notification_event(
  target_event_id uuid,
  processing_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_available_at timestamptz;
  current_attempt_count integer;
  current_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if private.expire_family_notification_event(target_event_id, true) then
    return 'expired';
  end if;

  select event.attempt_count, event.status
    into current_attempt_count, current_status
  from private.family_notification_outbox as event
  where event.id = target_event_id
  for update;

  if current_attempt_count is null then
    return 'not_found';
  end if;
  if current_status = 'expired' then
    return 'expired';
  end if;

  select min(delivery.available_at) into next_available_at
  from private.family_notification_deliveries as delivery
  where delivery.event_id = target_event_id
    and delivery.status in ('pending', 'retry', 'sending');

  if next_available_at is not null and current_attempt_count < 5 then
    update private.family_notification_outbox as event
    set
      status = 'retry',
      available_at = greatest(now() + interval '15 seconds', next_available_at),
      lease_until = null,
      last_error = left(nullif(coalesce(processing_error, ''), ''), 500)
    where event.id = target_event_id;
    return 'retry';
  end if;

  update private.family_notification_outbox as event
  set
    status = case when next_available_at is null then 'processed' else 'failed' end,
    processed_at = now(),
    lease_until = null,
    last_error = left(nullif(coalesce(processing_error, ''), ''), 500)
  where event.id = target_event_id;
  return case when next_available_at is null then 'processed' else 'failed' end;
end;
$$;

revoke execute on function public.claim_family_notification_event()
  from public, anon, authenticated;
revoke execute on function public.claim_family_notification_targets(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.finish_family_notification_event(uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_family_notification_event()
  to service_role;
grant execute on function public.claim_family_notification_targets(uuid, integer)
  to service_role;
grant execute on function public.finish_family_notification_event(uuid, text)
  to service_role;

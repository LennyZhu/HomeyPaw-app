create type private.family_notification_event_type as enum (
  'journal_created',
  'care_log_created',
  'reminder_created'
);

create table private.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id text not null unique,
  expo_push_token text not null unique,
  platform text not null,
  app_version text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_devices_installation_length
    check (char_length(installation_id) between 16 and 128),
  constraint push_devices_token_format
    check (
      expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$'
    ),
  constraint push_devices_platform
    check (platform in ('ios', 'android')),
  constraint push_devices_app_version_length
    check (char_length(app_version) between 1 and 40)
);

comment on table private.push_devices is
  'Private per-installation Expo push registrations. Never family-readable.';
comment on column private.push_devices.user_id is
  'Always bound to auth.uid() by register_push_device.';

create index push_devices_user_enabled_idx
  on private.push_devices (user_id, enabled, updated_at desc);

create table private.family_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type private.family_notification_event_type not null,
  activity_kind text not null,
  pet_id uuid not null references public.pets (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint family_notification_outbox_source_unique
    unique (event_type, source_id),
  constraint family_notification_outbox_activity_kind
    check (activity_kind in ('journal', 'care', 'health', 'reminder')),
  constraint family_notification_outbox_status
    check (status in ('pending', 'processing', 'retry', 'processed', 'failed')),
  constraint family_notification_outbox_attempt_count
    check (attempt_count between 0 and 5)
);

comment on table private.family_notification_outbox is
  'Transactional family activity events. Push failure never rolls back business data.';

create index family_notification_outbox_claim_idx
  on private.family_notification_outbox (status, available_at, created_at, id)
  where status in ('pending', 'processing', 'retry');

create table private.family_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references private.family_notification_outbox (id) on delete cascade,
  push_device_id uuid not null
    references private.push_devices (id) on delete cascade,
  recipient_user_id uuid not null
    references auth.users (id) on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  receipt_check_count integer not null default 0,
  ticket_id text,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  processed_at timestamptz,
  constraint family_notification_delivery_unique
    unique (event_id, push_device_id),
  constraint family_notification_delivery_status
    check (
      status in (
        'pending', 'sending', 'retry', 'ticketed', 'delivered', 'failed',
        'device_not_registered', 'skipped'
      )
    ),
  constraint family_notification_delivery_attempt_count
    check (attempt_count between 0 and 3),
  constraint family_notification_receipt_count
    check (receipt_check_count between 0 and 5)
);

comment on table private.family_notification_deliveries is
  'One idempotent delivery per outbox event and active push installation.';

create index family_notification_delivery_claim_idx
  on private.family_notification_deliveries
    (event_id, status, available_at, created_at, id)
  where status in ('pending', 'retry');
create index family_notification_receipt_claim_idx
  on private.family_notification_deliveries
    (status, available_at, updated_at, id)
  where status = 'ticketed';

alter table private.push_devices enable row level security;
alter table private.family_notification_outbox enable row level security;
alter table private.family_notification_deliveries enable row level security;

revoke all on table private.push_devices from public, anon, authenticated;
revoke all on table private.family_notification_outbox
  from public, anon, authenticated;
revoke all on table private.family_notification_deliveries
  from public, anon, authenticated;

create or replace function public.register_push_device(
  device_installation_id text,
  device_expo_push_token text,
  device_platform text,
  device_app_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  registered_device_id uuid;
  safe_installation_id text := btrim(coalesce(device_installation_id, ''));
  safe_push_token text := btrim(coalesce(device_expo_push_token, ''));
  safe_platform text := btrim(coalesce(device_platform, ''));
  safe_app_version text := btrim(coalesce(device_app_version, ''));
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(safe_installation_id) not between 16 and 128
    or safe_push_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$'
    or safe_platform not in ('ios', 'android')
    or char_length(safe_app_version) not between 1 and 40
  then
    raise exception 'invalid push device registration' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(safe_installation_id, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(safe_push_token, 1)
  );

  delete from private.push_devices as device
  where device.expo_push_token = safe_push_token
    and device.installation_id <> safe_installation_id;

  insert into private.push_devices (
    user_id,
    installation_id,
    expo_push_token,
    platform,
    app_version,
    enabled,
    last_seen_at
  ) values (
    caller_id,
    safe_installation_id,
    safe_push_token,
    safe_platform,
    safe_app_version,
    true,
    now()
  )
  on conflict (installation_id) do update
  set
    user_id = excluded.user_id,
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    app_version = excluded.app_version,
    enabled = true,
    updated_at = now(),
    last_seen_at = now()
  returning id into registered_device_id;

  return registered_device_id;
end;
$$;

create or replace function public.unregister_push_device(
  device_installation_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  changed_count integer;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update private.push_devices as device
  set enabled = false, updated_at = now(), last_seen_at = now()
  where device.user_id = caller_id
    and device.installation_id = btrim(coalesce(device_installation_id, ''))
    and device.enabled;
  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;

create or replace function public.has_shared_family_for_push()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    else exists (
      select 1
      from public.pet_members as own_membership
      where own_membership.user_id = auth.uid()
        and own_membership.role in ('owner', 'member')
        and (
          select count(*)
          from public.pet_members as family_membership
          where family_membership.pet_id = own_membership.pet_id
            and family_membership.role in ('owner', 'member')
        ) >= 2
    )
  end;
$$;

revoke execute on function public.register_push_device(text, text, text, text)
  from public, anon;
revoke execute on function public.unregister_push_device(text)
  from public, anon;
revoke execute on function public.has_shared_family_for_push()
  from public, anon;
grant execute on function public.register_push_device(text, text, text, text)
  to authenticated;
grant execute on function public.unregister_push_device(text)
  to authenticated;
grant execute on function public.has_shared_family_for_push()
  to authenticated;

create or replace function private.enqueue_family_activity_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued_event_type private.family_notification_event_type;
  queued_activity_kind text;
  queued_pet_id uuid;
  queued_actor_id uuid;
  queued_source_id uuid;
begin
  if tg_table_schema <> 'public' then
    raise exception 'unsupported notification source';
  end if;

  if tg_table_name = 'posts' then
    queued_event_type := 'journal_created';
    queued_activity_kind := 'journal';
    queued_pet_id := new.pet_id;
    queued_actor_id := new.author_id;
    queued_source_id := new.id;
  elsif tg_table_name = 'care_logs' then
    queued_event_type := 'care_log_created';
    queued_activity_kind := case
      when new.care_type = 'health' then 'health'
      else 'care'
    end;
    queued_pet_id := new.pet_id;
    queued_actor_id := new.performed_by;
    queued_source_id := new.id;
  elsif tg_table_name = 'care_tasks' then
    queued_event_type := 'reminder_created';
    queued_activity_kind := 'reminder';
    queued_pet_id := new.pet_id;
    queued_actor_id := new.created_by;
    queued_source_id := new.id;
  else
    raise exception 'unsupported notification source';
  end if;

  if queued_actor_id is not null then
    insert into private.family_notification_outbox (
      event_type,
      activity_kind,
      pet_id,
      actor_user_id,
      source_id
    ) values (
      queued_event_type,
      queued_activity_kind,
      queued_pet_id,
      queued_actor_id,
      queued_source_id
    )
    on conflict (event_type, source_id) do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function private.enqueue_family_activity_notification()
  from public, anon, authenticated;

create trigger enqueue_journal_created_notification
after insert on public.posts
for each row execute function private.enqueue_family_activity_notification();

create trigger enqueue_care_log_created_notification
after insert on public.care_logs
for each row execute function private.enqueue_family_activity_notification();

create trigger enqueue_reminder_created_notification
after insert on public.care_tasks
for each row execute function private.enqueue_family_activity_notification();

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
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select event.* into claimed
  from private.family_notification_outbox as event
  where event.attempt_count < 5
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
    where delivery.event_id = target_event_id
      and delivery.status in ('pending', 'retry')
      and delivery.available_at <= now()
      and delivery.attempt_count < 3
    order by delivery.created_at, delivery.id
    for update skip locked
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

create or replace function public.record_family_push_delivery(
  target_delivery_id uuid,
  delivery_outcome text,
  expo_ticket_id text default null,
  delivery_error text default null,
  retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery private.family_notification_deliveries;
  next_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select delivery.* into target_delivery
  from private.family_notification_deliveries as delivery
  where delivery.id = target_delivery_id
  for update;

  if target_delivery.id is null or target_delivery.status <> 'sending' then
    return false;
  end if;

  if delivery_outcome = 'ticket' and expo_ticket_id is not null then
    next_status := 'ticketed';
  elsif delivery_outcome = 'retry' and target_delivery.attempt_count < 3 then
    next_status := 'retry';
  elsif delivery_outcome = 'device_not_registered' then
    next_status := 'device_not_registered';
  elsif delivery_outcome = 'failed' then
    next_status := 'failed';
  else
    next_status := 'failed';
  end if;

  update private.family_notification_deliveries as delivery
  set
    status = next_status,
    ticket_id = case when next_status = 'ticketed' then expo_ticket_id else delivery.ticket_id end,
    available_at = case
      when next_status = 'ticketed' then now() + interval '15 minutes'
      when next_status = 'retry' then now() + pg_catalog.make_interval(secs => greatest(15, least(coalesce(retry_after_seconds, 60), 3600)))
      else delivery.available_at
    end,
    last_error = left(nullif(coalesce(delivery_error, ''), ''), 500),
    sent_at = case when next_status = 'ticketed' then now() else delivery.sent_at end,
    processed_at = case
      when next_status in ('device_not_registered', 'failed') then now()
      else delivery.processed_at
    end,
    updated_at = now()
  where delivery.id = target_delivery.id;

  if next_status = 'device_not_registered' then
    update private.push_devices as device
    set enabled = false, updated_at = now()
    where device.id = target_delivery.push_device_id;
  end if;

  return true;
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
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select event.attempt_count into current_attempt_count
  from private.family_notification_outbox as event
  where event.id = target_event_id
  for update;

  if current_attempt_count is null then
    return 'not_found';
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

create or replace function public.claim_family_push_receipts(
  requested_limit integer default 100
)
returns table (
  delivery_id uuid,
  expo_ticket_id text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select delivery.id
    from private.family_notification_deliveries as delivery
    where delivery.status = 'ticketed'
      and delivery.ticket_id is not null
      and delivery.available_at <= now()
      and delivery.receipt_check_count < 5
    order by delivery.updated_at, delivery.id
    for update skip locked
    limit greatest(1, least(coalesce(requested_limit, 100), 100))
  ), claimed as (
    update private.family_notification_deliveries as delivery
    set
      receipt_check_count = delivery.receipt_check_count + 1,
      available_at = now() + interval '15 minutes',
      updated_at = now()
    where delivery.id in (select candidate.id from candidates as candidate)
    returning delivery.id, delivery.ticket_id
  )
  select claimed.id, claimed.ticket_id from claimed;
end;
$$;

create or replace function public.record_family_push_receipt(
  target_delivery_id uuid,
  receipt_outcome text,
  receipt_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery private.family_notification_deliveries;
  next_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select delivery.* into target_delivery
  from private.family_notification_deliveries as delivery
  where delivery.id = target_delivery_id
  for update;

  if target_delivery.id is null or target_delivery.status <> 'ticketed' then
    return false;
  end if;

  if receipt_outcome = 'delivered' then
    next_status := 'delivered';
  elsif receipt_outcome = 'device_not_registered' then
    next_status := 'device_not_registered';
  elsif receipt_outcome = 'pending' and target_delivery.receipt_check_count < 5 then
    next_status := 'ticketed';
  else
    next_status := 'failed';
  end if;

  update private.family_notification_deliveries as delivery
  set
    status = next_status,
    last_error = left(nullif(coalesce(receipt_error, ''), ''), 500),
    processed_at = case when next_status <> 'ticketed' then now() else delivery.processed_at end,
    updated_at = now()
  where delivery.id = target_delivery.id;

  if next_status = 'device_not_registered' then
    update private.push_devices as device
    set enabled = false, updated_at = now()
    where device.id = target_delivery.push_device_id;
  end if;

  return true;
end;
$$;

revoke execute on function public.claim_family_notification_event()
  from public, anon, authenticated;
revoke execute on function public.claim_family_notification_targets(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.record_family_push_delivery(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.finish_family_notification_event(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.claim_family_push_receipts(integer)
  from public, anon, authenticated;
revoke execute on function public.record_family_push_receipt(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_family_notification_event()
  to service_role;
grant execute on function public.claim_family_notification_targets(uuid, integer)
  to service_role;
grant execute on function public.record_family_push_delivery(uuid, text, text, text, integer)
  to service_role;
grant execute on function public.finish_family_notification_event(uuid, text)
  to service_role;
grant execute on function public.claim_family_push_receipts(integer)
  to service_role;
grant execute on function public.record_family_push_receipt(uuid, text, text)
  to service_role;

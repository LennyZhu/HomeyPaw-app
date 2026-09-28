begin;

-- One shared Push infrastructure. Existing installations are incapable by default.
-- Lock parents before the queue, matching Family deletion/cascade ordering.
lock table public.families, public.pets, public.family_members, public.chat_messages,
  private.push_devices, private.family_notification_outbox,
  private.family_notification_deliveries in share row exclusive mode;
alter table private.push_devices add column chat_push_v1 boolean not null default false;
comment on column private.push_devices.chat_push_v1 is
  'Explicit client support for Family Chat notification navigation; legacy registration clears it.';

-- Keep the old enum available for the existing Pet enqueue function. A checked
-- text event type permits an atomic forward migration without ADD VALUE's
-- new-enum-value transaction restriction.
alter table private.family_notification_outbox
  alter column event_type type text using event_type::text,
  add column family_id uuid references public.families(id) on delete cascade;
alter table private.family_notification_outbox
  drop constraint family_notification_outbox_activity_kind,
  add constraint family_notification_outbox_event_type
    check (event_type in ('journal_created', 'care_log_created', 'reminder_created', 'chat_message')),
  add constraint family_notification_outbox_activity_kind
    check (activity_kind in ('journal', 'care', 'health', 'reminder', 'chat'));

-- Backfill queue ownership only, never enqueue historical Chat rows. Preserve
-- the existing release write guards and use the established transaction-local
-- migration bypass while updating existing private rows.
do $$
declare previous_bypass text;
begin
  if exists (select 1 from private.family_notification_outbox e
    left join public.pets p on p.id = e.pet_id where p.family_id is null) then
    raise exception 'PUSH_FAMILY_BACKFILL_UNMAPPABLE';
  end if;
  previous_bypass := current_setting('homeypaw.pre_cutover_migration_bypass', true);
  perform set_config('homeypaw.pre_cutover_migration_bypass', 'on', true);
  update private.family_notification_outbox e set family_id = p.family_id
    from public.pets p where p.id = e.pet_id;
  perform set_config('homeypaw.pre_cutover_migration_bypass', coalesce(previous_bypass, ''), true);
end;
$$;
alter table private.family_notification_outbox
  alter column family_id set not null,
  alter column pet_id drop not null,
  add constraint family_notification_outbox_scope
    check ((event_type = 'chat_message' and activity_kind = 'chat' and pet_id is null)
      or (event_type <> 'chat_message' and activity_kind <> 'chat' and pet_id is not null));

create function private.set_family_notification_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare resolved_family uuid;
begin
  if new.event_type <> 'chat_message' then
    select family_id into resolved_family from public.pets where id = new.pet_id;
    if resolved_family is null or (new.family_id is not null and new.family_id <> resolved_family) then
      raise exception 'push family mismatch' using errcode = '23514';
    end if;
    new.family_id := resolved_family;
  end if;
  return new;
end;
$$;
create trigger set_family_notification_scope before insert or update of family_id, pet_id
  on private.family_notification_outbox for each row execute function private.set_family_notification_scope();
revoke execute on function private.set_family_notification_scope() from public, anon, authenticated, service_role;

create or replace function public.register_push_device(
  device_installation_id text,
  device_expo_push_token text,
  device_platform text,
  device_app_version text,
  device_chat_push_v1 boolean
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
    chat_push_v1,
    last_seen_at
  ) values (
    caller_id,
    safe_installation_id,
    safe_push_token,
    safe_platform,
    safe_app_version,
    true,
    coalesce(device_chat_push_v1, false),
    now()
  )
  on conflict (installation_id) do update
  set
    user_id = excluded.user_id,
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    app_version = excluded.app_version,
    enabled = true,
    chat_push_v1 = excluded.chat_push_v1,
    updated_at = now(),
    last_seen_at = now()
  returning id into registered_device_id;

  return registered_device_id;
end;
$$;

-- Preserve the exact four-argument 1.2.0 API. Rebinding/downgrading to a
-- legacy client must clear capability, not inherit a previous client's claim.
create or replace function public.register_push_device(
  device_installation_id text, device_expo_push_token text,
  device_platform text, device_app_version text
)
returns uuid language sql security definer set search_path = '' as $$
  select public.register_push_device(device_installation_id, device_expo_push_token,
    device_platform, device_app_version, false);
$$;
revoke execute on function public.register_push_device(text, text, text, text, boolean) from public, anon;
grant execute on function public.register_push_device(text, text, text, text, boolean) to authenticated;

create or replace function public.has_shared_family_for_push()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_members own_membership
    where own_membership.user_id = (select auth.uid())
      and own_membership.role in ('owner', 'member')
      and (select count(*) from public.family_members other_membership
        where other_membership.family_id = own_membership.family_id
          and other_membership.role in ('owner', 'member')) >= 2
  );
$$;

create function private.enqueue_chat_message_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sender_id is not null then
    insert into private.family_notification_outbox
      (event_type, activity_kind, family_id, pet_id, actor_user_id, source_id)
    values ('chat_message', 'chat', new.family_id, null, new.sender_id, new.id)
    on conflict (event_type, source_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger enqueue_chat_message_notification after insert on public.chat_messages
  for each row execute function private.enqueue_chat_message_notification();
revoke execute on function private.enqueue_chat_message_notification() from public, anon, authenticated, service_role;

-- The single eligibility predicate is reused at enqueue-delivery, target claim
-- and the worker's final pre-send check. Pet mirrors are never consulted.
create function private.is_family_notification_recipient(
  target_event_id uuid, target_device_id uuid, target_recipient_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.family_notification_outbox e
    join public.family_members fm on fm.family_id = e.family_id
    join private.push_devices d on d.id = target_device_id and d.user_id = fm.user_id
    where e.id = target_event_id and fm.user_id = target_recipient_id
      and fm.role in ('owner', 'member') and fm.user_id <> e.actor_user_id and d.enabled
      and (e.event_type <> 'chat_message' or (d.chat_push_v1 and exists (
        select 1 from public.chat_messages m where m.id = e.source_id
          and m.family_id = e.family_id and m.sender_id = e.actor_user_id
      )))
  );
$$;
revoke execute on function private.is_family_notification_recipient(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- OUT columns are extended, so replace the service-only signature atomically.
drop function public.claim_family_notification_event();
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
  set enabled = false, chat_push_v1 = false, updated_at = now(), last_seen_at = now()
  where device.user_id = caller_id
    and device.installation_id = btrim(coalesce(device_installation_id, ''))
    and device.enabled;
  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;

create or replace function public.claim_family_notification_event()
returns table (
  event_id uuid,
  event_type text,
  activity_kind text,
  pet_id uuid,
  actor_user_id uuid,
  source_id uuid,
  family_id uuid,
  sender_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed private.family_notification_outbox;
  stale_event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
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
  select claimed.id, device.id, membership.user_id
  from public.family_members as membership
  join private.push_devices as device on device.user_id = membership.user_id
  where membership.family_id = claimed.family_id
    and private.is_family_notification_recipient(claimed.id, device.id, membership.user_id)
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
    claimed.source_id,
    claimed.family_id,
    (select profile.display_name from public.profiles as profile where profile.id = claimed.actor_user_id);
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
  if auth.role() is distinct from 'service_role' then
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
    and not private.is_family_notification_recipient(
      event.id, delivery.push_device_id, delivery.recipient_user_id);

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
      and private.is_family_notification_recipient(
        event.id, delivery.push_device_id, delivery.recipient_user_id)
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

create function public.validate_family_notification_delivery(target_delivery_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare delivery private.family_notification_deliveries;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into delivery from private.family_notification_deliveries
    where id = target_delivery_id for update;
  if delivery.id is null or delivery.status <> 'sending' then return false; end if;
  if private.expire_family_notification_event(delivery.event_id, true) then return false; end if;
  if exists (select 1 from private.family_notification_outbox e
    where e.id = delivery.event_id and e.status = 'processing')
    and private.is_family_notification_recipient(delivery.event_id,
      delivery.push_device_id, delivery.recipient_user_id) then return true; end if;
  update private.family_notification_deliveries set status = 'skipped',
    processed_at = now(), updated_at = now(), last_error = 'source or recipient no longer eligible'
    where id = delivery.id;
  return false;
end;
$$;
revoke execute on function public.claim_family_notification_event() from public, anon, authenticated;
grant execute on function public.claim_family_notification_event() to service_role;
revoke execute on function public.validate_family_notification_delivery(uuid) from public, anon, authenticated;
grant execute on function public.validate_family_notification_delivery(uuid) to service_role;

commit;

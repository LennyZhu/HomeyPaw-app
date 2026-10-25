-- Release environment support, still disabled by default. No seed/grant or
-- activation is performed. Charging requires separately verified media quotas.
begin;
alter table private.family_billing_config
  add column release_ready boolean not null default false,
  drop constraint family_billing_config_environment_check,
  add constraint family_billing_config_environment_check check(environment in ('SANDBOX','PRODUCTION'));
alter table private.family_store_subscriptions
  drop constraint family_store_subscriptions_environment_check,
  add constraint family_store_subscriptions_environment_check check(environment in ('SANDBOX','PRODUCTION'));
alter table private.family_media_entitlements
  drop constraint family_media_entitlements_billing_environment_check,
  add constraint family_media_entitlements_billing_environment_check check(billing_environment is null or billing_environment in ('SANDBOX','PRODUCTION'));

create function private.family_billing_can_charge()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select c.enabled and c.rc_project_id is not null and c.rc_app_id is not null
    and c.rc_entitlement_id is not null and c.monthly_product_id is not null and c.yearly_product_id is not null
    and c.monthly_product_id<>c.yearly_product_id and
    (c.environment='SANDBOX' or (c.release_ready and exists(
      select 1 from private.family_media_quota_policy q where q.singleton and q.storage_enforcement_enabled
        and q.video_calendar_time_zone is not null and q.video_counting_scope is not null
        and q.metering_started_at<=statement_timestamp()
        and exists(select 1 from pg_catalog.pg_timezone_names where name=q.video_calendar_time_zone))))
    from private.family_billing_config c where c.singleton),false);
$$;
revoke all on function private.family_billing_can_charge() from public,anon,authenticated,service_role;

create or replace function private.assert_family_billing_sandbox_ready()
returns private.family_billing_config language plpgsql stable security definer set search_path='' as $$
declare cfg private.family_billing_config;
begin
  select * into cfg from private.family_billing_config where singleton;
  if not coalesce(cfg.enabled,false) or cfg.rc_project_id is null or cfg.rc_app_id is null or cfg.rc_entitlement_id is null
    or cfg.monthly_product_id is null or cfg.yearly_product_id is null or cfg.monthly_product_id=cfg.yearly_product_id then
    raise exception 'BILLING_SANDBOX_NOT_CONFIGURED' using errcode='P0001'; end if;
  return cfg;
end; $$;

-- Closing checkout must not block verified renewals, refunds or revocations.
-- Only new purchase intents require media/release readiness.
create or replace function public.begin_family_billing_purchase(target_family_id uuid,request_id uuid,period text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; customer uuid; intent private.family_billing_intents; product text;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  if not private.family_billing_can_charge() then
    raise exception 'BILLING_RELEASE_NOT_READY' using errcode='P0001'; end if;
  if request_id is null or period not in('monthly','yearly') or period is null then raise exception 'invalid purchase intent' using errcode='22023'; end if;
  perform 1 from public.family_members where family_id=target_family_id and user_id=auth.uid() and role='owner' for share;
  if not found then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  -- Preserve payer-before-Family lock order used by snapshot reconciliation.
  customer:=public.get_family_billing_customer();
  -- Initialize from authoritative Storage metadata, never client byte counts.
  -- This explicit purchase mutation is separate from the read-only Summary RPC.
  perform private.sync_family_media_objects(target_family_id);
  if cfg.environment='PRODUCTION' and
    (public.get_family_plus_summary(target_family_id)->'usage'->>'status') is distinct from 'ready' then
    raise exception 'BILLING_METERING_NOT_READY' using errcode='P0001'; end if;
  -- Reuse Phase 2 Family lock so purchase and entitlement changes serialize.
  perform private.lock_family_media_usage(target_family_id);
  product:=case period when 'monthly' then cfg.monthly_product_id else cfg.yearly_product_id end;
  select * into intent from private.family_billing_intents where id=request_id;
  if intent.id is not null then
    if intent.family_id<>target_family_id or intent.customer_id<>customer or intent.product_id<>product then
      raise exception 'BILLING_INTENT_CONFLICT' using errcode='22023'; end if;
  else
    if not exists(select 1 from private.family_billing_purchase_checks where family_id=target_family_id and owner_id=auth.uid()
      and verified_at>=clock_timestamp()-interval '30 seconds') then
      raise exception 'BILLING_RECONCILIATION_REQUIRED' using errcode='P0001'; end if;
    if exists(select 1 from private.family_store_subscriptions where customer_id=customer and family_id<>target_family_id
      and ((gives_access and access_until>clock_timestamp()) or status not in('expired','refunded','revoked'))) then
      raise exception 'BILLING_PAYER_ALREADY_BOUND' using errcode='P0001'; end if;
    if (select tier='plus' from private.family_media_limits(target_family_id,clock_timestamp()))
      or exists(select 1 from private.family_store_subscriptions where family_id=target_family_id
        and ((gives_access and access_until>clock_timestamp()) or status not in('expired','refunded','revoked'))) then
      raise exception 'FAMILY_ALREADY_SUBSCRIBED' using errcode='P0001'; end if;
    if exists(select 1 from private.family_billing_intents where (family_id=target_family_id or customer_id=customer)
      and (status='store_pending' or (status='prepared' and expires_at>clock_timestamp()))) then
      raise exception 'BILLING_PURCHASE_PENDING' using errcode='P0001'; end if;
    insert into private.family_billing_intents(id,family_id,customer_id,product_id) values(request_id,target_family_id,customer,product) returning * into intent;
    delete from private.family_billing_purchase_checks where family_id=target_family_id;
  end if;
  return jsonb_build_object('intent_id',intent.id,'customer_id',customer,'product_id',product,'status',intent.status,'expires_at',intent.expires_at);
end; $$;

create or replace function public.get_family_billing_state(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg private.family_billing_config; result jsonb;
begin
  if not exists(select 1 from public.family_members where family_id=target_family_id and user_id=auth.uid()) then
    raise exception 'family not found' using errcode='42501'; end if;
  select * into cfg from private.family_billing_config where singleton;
  select to_jsonb(l) into result from private.family_media_limits(target_family_id,statement_timestamp()) l;
  return result||jsonb_build_object('sandbox_enabled',private.family_billing_can_charge(),'environment',cfg.environment,
    'billing_enabled',coalesce(cfg.enabled,false),
    'has_subscription',exists(select 1 from private.family_store_subscriptions where family_id=target_family_id),
    'purchase_blocked',exists(select 1 from private.family_store_subscriptions where family_id=target_family_id
      and ((gives_access and access_until>statement_timestamp()) or status not in('expired','refunded','revoked'))),
    'pending_intent',exists(select 1 from private.family_billing_intents where family_id=target_family_id
      and (status='store_pending' or (status='prepared' and expires_at>statement_timestamp()))));
end; $$;

create or replace function public.receive_family_billing_webhook(event jsonb,payload_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; existing private.family_billing_webhook_inbox; cust uuid;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  if event->>'environment' is distinct from cfg.environment or event->>'app_id' is distinct from cfg.rc_app_id then raise exception 'BILLING_ENVIRONMENT_DENIED' using errcode='42501'; end if;
  if coalesce(event->>'id','')='' or payload_hash!~'^[0-9a-f]{64}$' or payload_hash is null then raise exception 'invalid webhook' using errcode='22023'; end if;
  select id into cust from private.family_billing_customers where id::text=event->>'app_user_id';
  insert into private.family_billing_webhook_inbox(event_id,payload_hash,customer_id,original_transaction_id,event_type,product_id,event_at)
    values(event->>'id',payload_hash,cust,event->>'original_transaction_id',event->>'type',event->>'product_id',
      to_timestamp((event->>'event_timestamp_ms')::numeric/1000)) on conflict(event_id) do nothing;
  select * into existing from private.family_billing_webhook_inbox where event_id=event->>'id' for update;
  if existing.payload_hash<>payload_hash then raise exception 'BILLING_EVENT_ID_CONFLICT' using errcode='22023'; end if;
  if cust is null and existing.status='pending' then
    update private.family_billing_webhook_inbox set status='ignored',last_error='UNKNOWN_BILLING_CUSTOMER',processed_at=clock_timestamp() where event_id=existing.event_id;
    return 'ignored';
  end if;
  return existing.status;
end; $$;

create or replace function public.apply_family_billing_snapshot(target_customer_id uuid,generation bigint,snapshot jsonb,source_event_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; customer private.family_billing_customers; sub private.family_store_subscriptions;
  intent private.family_billing_intents; source private.family_billing_webhook_inbox; fam uuid;
  original_id text; product text; started timestamptz; until_time timestamptz; access boolean;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  select * into customer from private.family_billing_customers where id=target_customer_id for update;
  if customer.id is null or generation is distinct from customer.refresh_generation then raise exception 'BILLING_STALE_REFRESH' using errcode='P0001'; end if;
  if snapshot->>'environment' is distinct from cfg.environment or snapshot->>'store' is distinct from 'APP_STORE'
    or snapshot->>'customer_id' is distinct from target_customer_id::text or snapshot->>'original_customer_id' is distinct from target_customer_id::text
    or snapshot->>'app_id' is distinct from cfg.rc_app_id or snapshot->>'entitlement_id' is distinct from cfg.rc_entitlement_id
    or coalesce(snapshot->>'ownership','')<>'purchased' then raise exception 'BILLING_SNAPSHOT_DENIED' using errcode='42501'; end if;
  original_id:=snapshot->>'original_transaction_id';product:=snapshot->>'product_id';
  started:=(snapshot->>'started_at')::timestamptz;until_time:=(snapshot->>'access_until')::timestamptz;
  if coalesce(original_id,'')='' or coalesce(snapshot->>'rc_subscription_id','')='' or product not in(cfg.monthly_product_id,cfg.yearly_product_id)
    or product is null or started is null or until_time is null or not isfinite(started) or not isfinite(until_time) or until_time<=started
    or snapshot->>'status' is null or snapshot->>'auto_renewal_status' is null or snapshot->>'gives_access' is null then
    raise exception 'invalid subscription snapshot' using errcode='22023'; end if;
  access:=(snapshot->>'gives_access')::boolean and until_time>clock_timestamp();
  -- A stable chain and RC subscription can never be relabelled to a Family.
  perform pg_advisory_xact_lock(hashtextextended('family-billing:'||original_id,0));
  select * into sub from private.family_store_subscriptions where original_transaction_id=original_id and environment=cfg.environment and store='APP_STORE' for update;
  if sub.id is not null then
    if sub.customer_id<>target_customer_id or sub.rc_subscription_id<>snapshot->>'rc_subscription_id' then
      raise exception 'BILLING_CHAIN_ALREADY_BOUND' using errcode='42501'; end if;
    fam:=sub.family_id;
  else
    select * into source from private.family_billing_webhook_inbox where event_id=source_event_id;
    if source.customer_id is distinct from target_customer_id or source.original_transaction_id is distinct from original_id
      or source.product_id is distinct from product then raise exception 'BILLING_CHAIN_ANCHOR_REQUIRED' using errcode='P0001'; end if;
    select * into intent from private.family_billing_intents where customer_id=target_customer_id and product_id=product
      and status in('prepared','store_pending') and started>=created_at-interval '30 seconds'
      and (status='store_pending' or started<=expires_at) order by created_at desc limit 1;
    if intent.id is null then raise exception 'BILLING_BINDING_REVIEW_REQUIRED' using errcode='P0001'; end if;
    perform 1 from public.family_members where family_id=intent.family_id and user_id=customer.user_id and role='owner' for share;
    if not found then raise exception 'BILLING_BINDING_REVIEW_REQUIRED' using errcode='P0001'; end if;
    fam:=intent.family_id;
  end if;
  perform private.lock_family_media_usage(fam);
  if sub.id is null then
    if exists(select 1 from private.family_store_subscriptions where family_id=fam and
      ((gives_access and access_until>clock_timestamp()) or status not in('expired','refunded','revoked'))) then
      raise exception 'FAMILY_ALREADY_SUBSCRIBED' using errcode='P0001'; end if;
    insert into private.family_store_subscriptions(environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,
      product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
    values(cfg.environment,'APP_STORE',original_id,snapshot->>'rc_subscription_id',target_customer_id,fam,intent.id,
      product,snapshot->>'status',access,snapshot->>'auto_renewal_status',started,until_time,generation,clock_timestamp()) returning * into sub;
    update private.family_billing_intents set status='fulfilled' where id=intent.id;
  else
    update private.family_store_subscriptions set product_id=product,status=snapshot->>'status',gives_access=access,
      auto_renewal_status=snapshot->>'auto_renewal_status',access_until=until_time,last_generation=generation,checked_at=clock_timestamp() where id=sub.id;
  end if;
  insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference,revoked_at,billing_subscription_id,billing_environment)
    values(fam,'plus',started,until_time,false,'rc:'||lower(cfg.environment)||':'||original_id,case when access then null else clock_timestamp() end,sub.id,cfg.environment)
    on conflict(billing_subscription_id) where billing_subscription_id is not null do update set
      ends_at=excluded.ends_at,revoked_at=excluded.revoked_at;
  update private.family_billing_customers set reconciled_at=clock_timestamp() where id=target_customer_id;
  if source_event_id is not null then update private.family_billing_webhook_inbox set status='processed',processed_at=clock_timestamp(),last_error=null where event_id=source_event_id; end if;
  return jsonb_build_object('family_id',fam,'gives_access',access,'environment',cfg.environment);
end; $$;

create or replace function private.family_media_limits(target_family uuid, at_time timestamptz)
returns table(tier text,limit_bytes bigint,video_limit integer)
language sql stable security definer set search_path='' as $$
  select chosen.tier,case chosen.tier when 'plus' then 5368709120::bigint
    when 'transition' then 1073741824::bigint else 314572800::bigint end,
    case when chosen.tier='free' then 3 else null::integer end
  from (select coalesce((select e.tier from private.family_media_entitlements e
    where e.family_id=target_family and e.revoked_at is null and e.starts_at<=at_time
      and (e.billing_environment is null or e.billing_environment=(select environment from private.family_billing_config where singleton))
      and (at_time<e.ends_at or (e.ends_inclusive and at_time=e.ends_at))
    order by case e.tier when 'plus' then 0 else 1 end,e.ends_at desc limit 1),'free') tier) chosen;
$$;

create or replace function public.get_family_plus_summary(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  billing_env text := (select environment from private.family_billing_config where singleton);
  viewer uuid := auth.uid(); viewer_role text; at_time timestamptz := statement_timestamp();
  cfg private.family_media_quota_policy; usage private.family_media_usage;
  grant_row private.family_media_entitlements; sub private.family_store_subscriptions;
  lim record; period record; state text := 'unavailable'; access boolean := false;
  valid_until timestamptz; checked_at timestamptz; usage_state text := 'uninitialized';
  unsettled bigint := 0; cleanup_bytes bigint := 0; unpublished_bytes bigint := 0;
  spent bigint; video_state text := 'not_configured';
begin
  select null::timestamptz period_start,null::timestamptz period_end into period;
  if viewer is null or not exists(select 1 from auth.users where id=viewer) then
    raise exception 'authentication required' using errcode='42501'; end if;
  select m.role::text into viewer_role from public.family_members m
    where m.family_id=target_family_id and m.user_id=viewer;
  if viewer_role is null then raise exception 'family not found' using errcode='42501'; end if;
  select * into cfg from private.family_media_quota_policy where singleton;
  select * into lim from private.family_media_limits(target_family_id,at_time);
  select * into grant_row from private.family_media_entitlements e
    where e.family_id=target_family_id and (e.billing_environment is null or e.billing_environment=billing_env) and e.revoked_at is null and e.starts_at<=at_time
      and (at_time<e.ends_at or (e.ends_inclusive and at_time=e.ends_at))
    order by case e.tier when 'plus' then 0 else 1 end,e.ends_at desc,e.id limit 1;
  if grant_row.id is not null then
    valid_until:=grant_row.ends_at; checked_at:=grant_row.starts_at;
    if grant_row.tier='transition' then state:='transition';
    elsif grant_row.billing_subscription_id is null then
      -- A bounded administrator grant (synthetic fixtures in this phase).
      state:='active'; access:=true;
    else
      select * into sub from private.family_store_subscriptions s
        where s.id=grant_row.billing_subscription_id and s.family_id=target_family_id
          and s.environment=grant_row.billing_environment and s.environment=billing_env and s.store='APP_STORE';
      checked_at:=sub.checked_at;
      if sub.gives_access and sub.started_at<=at_time and sub.access_until>at_time then
        valid_until:=least(grant_row.ends_at,sub.access_until);
        state:=case when sub.status='in_grace_period' then 'grace'
          when sub.status='cancelled' or (sub.status='active' and sub.auto_renewal_status='will_not_renew') then 'cancelled'
          when sub.status='active' then 'active' else 'unavailable' end;
        access:=state<>'unavailable';
      end if;
    end if;
  else
    select * into grant_row from private.family_media_entitlements e where e.family_id=target_family_id
      and (e.billing_environment is null or e.billing_environment=billing_env) and e.starts_at<=at_time order by e.ends_at desc,e.id limit 1;
    if grant_row.id is null then state:='free';
    else
      select * into sub from private.family_store_subscriptions s where s.id=grant_row.billing_subscription_id
        and s.family_id=target_family_id and s.environment=grant_row.billing_environment;
      checked_at:=sub.checked_at;
      if sub.status in('refunded','revoked') then state:='revoked';
      elsif sub.status='expired' then state:='expired';
      elsif sub.gives_access and sub.access_until>at_time then state:='unavailable';
      elsif sub.id is not null then
        state:=case when sub.status in('active','cancelled','in_billing_retry') and sub.access_until<=at_time
          then 'expired' else 'unavailable' end;
      elsif grant_row.revoked_at is not null then state:='revoked';
      else state:='expired'; end if;
    end if;
  end if;

  select * into usage from private.family_media_usage where family_id=target_family_id;
  -- Detect observation gaps without scanning/refreshing into writable ledgers.
  select count(*) into unsettled from storage.objects o
    left join private.family_media_objects r on r.storage_object_id=o.id and r.deleted_at is null
    left join public.pets p on p.id=case when o.bucket_id='post-media'
      then private.post_media_pet_id(o.name) else private.journal_video_path_uuid(o.name,2) end
    where o.bucket_id in('post-media','post-videos','post-video-thumbnails')
      and coalesce(r.family_id,p.family_id)=target_family_id
      and (r.storage_object_id is null or r.storage_version is distinct from o.version
        or case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then r.bytes<>(o.metadata->>'size')::bigint else true end);
  select coalesce(sum(r.bytes) filter(where r.pending_cleanup or exists(select 1 from public.media_cleanup_jobs j
      where j.bucket_id=r.bucket_id and j.storage_path=r.storage_path and j.completed_at is null)),0),
    coalesce(sum(r.bytes) filter(where not r.pending_cleanup
      and not exists(select 1 from public.media_cleanup_jobs j where j.bucket_id=r.bucket_id and j.storage_path=r.storage_path and j.completed_at is null)
      and not exists(select 1 from public.post_media m where r.bucket_id='post-media' and m.storage_path=r.storage_path)
      and not exists(select 1 from public.post_videos v where (r.bucket_id='post-videos' and v.storage_path=r.storage_path)
        or (r.bucket_id='post-video-thumbnails' and v.thumbnail_path=r.storage_path))),0)
    into cleanup_bytes,unpublished_bytes from private.family_media_objects r
    where r.family_id=target_family_id and r.deleted_at is null;
  if usage.reconciled_at is not null then
    usage_state:=case when usage.measurement_errors<>0 or unsettled<>0
      or exists(select 1 from private.family_media_measurement_errors where family_id is null or family_id=target_family_id)
      or usage.used_bytes<>(select coalesce(sum(bytes),0) from private.family_media_objects where family_id=target_family_id and deleted_at is null)
      or usage.reserved_bytes<>(select coalesce(sum(reserved_bytes),0) from private.family_media_upload_sessions where family_id=target_family_id)
      or exists(select 1 from private.family_media_objects r where r.family_id=target_family_id and r.deleted_at is null
        and not r.pending_cleanup and not exists(select 1 from storage.objects o where o.id=r.storage_object_id))
      then 'pending' else 'ready' end;
  end if;
  if cfg.video_calendar_time_zone is not null and cfg.video_counting_scope is not null and cfg.metering_started_at is not null then
    if exists(select 1 from pg_catalog.pg_timezone_names where name=cfg.video_calendar_time_zone) then
      select * into period from private.family_media_video_period(at_time);
      video_state:=case when period.metering_start>period.period_start then 'partial' else 'ready' end;
      if video_state='ready' then
        select count(*) into spent from private.family_video_publications v where v.family_id=target_family_id
          and v.published_at>=period.period_start and v.published_at<period.period_end
          and (period.counting_scope='all_successful' or v.tier_at_publication='free');
        if exists(select 1 from public.post_videos v join public.posts p on p.id=v.post_id
          join public.pets pet on pet.id=p.pet_id where pet.family_id=target_family_id
          and v.created_at>=period.period_start and v.created_at<period.period_end
          and not exists(select 1 from private.family_video_publications ledger where ledger.post_id=v.post_id)) then
          video_state:='pending'; spent:=null;
        end if;
      end if;
    else video_state:='invalid'; end if;
  end if;
  return jsonb_build_object('schema_version',1,'family_id',target_family_id,'viewer_user_id',viewer,'role',viewer_role,
    'server_time',at_time,'status',state,'gives_plus_access',access,'access_until',case when access then valid_until end,
    'entitlement_checked_at',checked_at,'billing_environment',billing_env,
    'limit_bytes',case when state<>'unavailable' then lim.limit_bytes end,
    'storage_enforcement_enabled',coalesce(cfg.storage_enforcement_enabled,false),
    'usage',jsonb_build_object('status',usage_state,'used_bytes',case when usage_state='ready' then usage.used_bytes end,
      'reserved_bytes',case when usage.reconciled_at is not null then usage.reserved_bytes end,
      'unpublished_bytes',case when usage.reconciled_at is not null then unpublished_bytes end,
      'cleanup_pending_bytes',case when usage.reconciled_at is not null then cleanup_bytes end,
      'unsettled_object_count',unsettled,'reconciled_at',usage.reconciled_at),
    'videos',jsonb_build_object('status',video_state,'published',spent,'limit',lim.video_limit,
      'calendar_time_zone',cfg.video_calendar_time_zone,'counting_scope',cfg.video_counting_scope,
      'period_start',case when video_state in('ready','partial') then period.period_start end,
      'policy_is_candidate',true));
end; $$;
commit;

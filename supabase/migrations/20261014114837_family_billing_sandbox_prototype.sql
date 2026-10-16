-- Phase 3 SANDBOX ONLY. Depends on the unapplied Phase 2 forward migration.
-- Disabled by default; no real products, payer data, transition or grants seeded.
create table private.family_billing_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  environment text not null default 'SANDBOX' check(environment='SANDBOX'),
  rc_project_id text,
  rc_app_id text,
  rc_entitlement_id text,
  monthly_product_id text,
  yearly_product_id text
);
insert into private.family_billing_config(singleton) values(true);
create table private.family_billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  refresh_generation bigint not null default 0,
  reconciled_at timestamptz
);
create table private.family_billing_intents (
  id uuid primary key,
  family_id uuid not null,
  customer_id uuid not null references private.family_billing_customers(id),
  product_id text not null,
  status text not null default 'prepared' check(status in('prepared','store_pending','cancelled','failed','fulfilled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
create index family_billing_intents_pending on private.family_billing_intents(family_id) where status in('prepared','store_pending');
create table private.family_billing_webhook_inbox (
  event_id text primary key,
  payload_hash text not null,
  customer_id uuid references private.family_billing_customers(id),
  original_transaction_id text,
  event_type text not null,
  product_id text,
  event_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check(status in('pending','processed','ignored','deferred')),
  last_error text,
  processed_at timestamptz
);
create table private.family_store_subscriptions (
  id uuid primary key default gen_random_uuid(),
  environment text not null check(environment='SANDBOX'),
  store text not null check(store='APP_STORE'),
  original_transaction_id text not null,
  rc_subscription_id text not null unique,
  customer_id uuid not null references private.family_billing_customers(id),
  family_id uuid not null,
  intent_id uuid not null references private.family_billing_intents(id),
  product_id text not null,
  status text not null,
  gives_access boolean not null,
  auto_renewal_status text not null,
  started_at timestamptz not null,
  access_until timestamptz not null,
  last_generation bigint not null,
  checked_at timestamptz not null,
  unique(environment,store,original_transaction_id)
);
create index family_store_subscriptions_family on private.family_store_subscriptions(family_id);
create table private.family_billing_purchase_checks (
  family_id uuid primary key,
  owner_id uuid not null,
  verified_at timestamptz not null
);
alter table private.family_media_entitlements
  add column billing_subscription_id uuid references private.family_store_subscriptions(id),
  add column billing_environment text check(billing_environment is null or billing_environment='SANDBOX');
create unique index family_media_entitlements_billing on private.family_media_entitlements(billing_subscription_id) where billing_subscription_id is not null;

create function private.assert_family_billing_sandbox_ready()
returns private.family_billing_config language plpgsql stable security definer set search_path='' as $$
declare cfg private.family_billing_config;
begin
  select * into cfg from private.family_billing_config where singleton;
  if not coalesce(cfg.enabled,false) or cfg.rc_project_id is null or cfg.rc_app_id is null or cfg.rc_entitlement_id is null
    or cfg.monthly_product_id is null or cfg.yearly_product_id is null or cfg.monthly_product_id=cfg.yearly_product_id then
    raise exception 'BILLING_SANDBOX_NOT_CONFIGURED' using errcode='P0001'; end if;
  return cfg;
end; $$;
create function public.get_family_billing_customer()
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform private.assert_family_billing_sandbox_ready();
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception 'authentication required' using errcode='42501'; end if;
  insert into private.family_billing_customers(user_id) values(auth.uid()) on conflict(user_id) do update set user_id=excluded.user_id returning id into result;
  return result;
end; $$;
create function public.get_family_billing_state(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg private.family_billing_config; result jsonb;
begin
  if not exists(select 1 from public.family_members where family_id=target_family_id and user_id=auth.uid()) then
    raise exception 'family not found' using errcode='42501'; end if;
  select * into cfg from private.family_billing_config where singleton;
  select to_jsonb(l) into result from private.family_media_limits(target_family_id,statement_timestamp()) l;
  return result||jsonb_build_object('sandbox_enabled',coalesce(cfg.enabled,false),'environment','SANDBOX',
    'has_subscription',exists(select 1 from private.family_store_subscriptions where family_id=target_family_id),
    'purchase_blocked',exists(select 1 from private.family_store_subscriptions where family_id=target_family_id
      and ((gives_access and access_until>statement_timestamp()) or status not in('expired','refunded','revoked'))),
    'pending_intent',exists(select 1 from private.family_billing_intents where family_id=target_family_id
      and (status='store_pending' or (status='prepared' and expires_at>statement_timestamp()))));
end; $$;
create function public.begin_family_billing_purchase(target_family_id uuid,request_id uuid,period text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; customer uuid; intent private.family_billing_intents; product text;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  if request_id is null or period not in('monthly','yearly') or period is null then raise exception 'invalid purchase intent' using errcode='22023'; end if;
  perform 1 from public.family_members where family_id=target_family_id and user_id=auth.uid() and role='owner' for share;
  if not found then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  customer:=public.get_family_billing_customer();
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
create function public.update_family_billing_intent(target_intent_id uuid,next_status text)
returns void language plpgsql security definer set search_path='' as $$
declare intent private.family_billing_intents;
begin
  select i.* into intent from private.family_billing_intents i join private.family_billing_customers c on c.id=i.customer_id
    where i.id=target_intent_id and c.user_id=auth.uid();
  if intent.id is null then raise exception 'intent not found' using errcode='42501'; end if;
  if next_status not in('store_pending','cancelled','failed') or next_status is null then raise exception 'invalid intent status' using errcode='22023'; end if;
  perform private.lock_family_media_usage(intent.family_id);
  select * into intent from private.family_billing_intents where id=target_intent_id for update;
  if intent.status='fulfilled' then return; end if;
  if next_status='store_pending' then
    perform 1 from public.family_members where family_id=intent.family_id and user_id=auth.uid() and role='owner' for share;
    if not found then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
    if intent.status<>'prepared' or clock_timestamp()>=intent.expires_at then raise exception 'BILLING_INTENT_NOT_ACTIVE' using errcode='P0001'; end if;
  end if;
  update private.family_billing_intents set status=next_status where id=target_intent_id;
end; $$;

-- Called only after authentication of an actual RevenueCat delivery. No raw
-- receipt, payment details or arbitrary client entitlement is retained.
create function public.receive_family_billing_webhook(event jsonb,payload_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; existing private.family_billing_webhook_inbox; cust uuid;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  if event->>'environment' is distinct from 'SANDBOX' or event->>'app_id' is distinct from cfg.rc_app_id then raise exception 'BILLING_ENVIRONMENT_DENIED' using errcode='42501'; end if;
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
create function public.start_family_billing_refresh(target_customer_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare generation bigint;
begin
  perform private.assert_family_billing_sandbox_ready();
  update private.family_billing_customers set refresh_generation=refresh_generation+1 where id=target_customer_id returning refresh_generation into generation;
  if generation is null then raise exception 'billing customer not found' using errcode='22023'; end if;
  return generation;
end; $$;
create function public.get_family_billing_server_context(target_customer_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return jsonb_build_object('config',(select to_jsonb(c) from private.family_billing_config c where singleton),
    'pending_intent',exists(select 1 from private.family_billing_intents where customer_id=target_customer_id
      and (status='store_pending' or (status='prepared' and expires_at>statement_timestamp()))),
    'chains',(select coalesce(jsonb_agg(jsonb_build_object('original_transaction_id',original_transaction_id)),'[]')
      from private.family_store_subscriptions where customer_id=target_customer_id));
end; $$;
create function public.finish_family_billing_webhook(target_event_id text,next_status text,error_code text default null)
returns void language plpgsql security definer set search_path='' as $$ begin
  if next_status not in('ignored','deferred') then raise exception 'invalid webhook result' using errcode='22023'; end if;
  update private.family_billing_webhook_inbox set status=next_status,last_error=error_code,
    processed_at=case when next_status='ignored' then clock_timestamp() else null end
    where event_id=target_event_id and status<>'processed';
end; $$;
create function public.get_family_billing_reconciliation_work(job_limit integer default 25)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(id),'{}') from (select c.id from private.family_billing_customers c
    where exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id)
      or exists(select 1 from private.family_billing_intents i where i.customer_id=c.id and i.status in('prepared','store_pending'))
    order by c.reconciled_at nulls first,c.created_at limit least(greatest(job_limit,1),25)) work;
$$;
create function public.get_family_billing_purchase_preflight_context(target_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fam uuid;
begin
  perform private.assert_family_billing_sandbox_ready();
  select family_id into fam from public.family_members where user_id=target_user_id and role='owner';
  if fam is null then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('family_id',fam,'customers',(select coalesce(jsonb_agg(id),'[]') from private.family_billing_customers c
    where c.user_id=target_user_id or exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id and s.family_id=fam)));
end; $$;
create function public.finish_family_billing_purchase_preflight(target_user_id uuid,target_family_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform private.assert_family_billing_sandbox_ready();
  perform 1 from public.family_members where user_id=target_user_id and family_id=target_family_id and role='owner' for share;
  if not found then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  perform private.lock_family_media_usage(target_family_id);
  -- Every known payer, including a former/deleted Owner, must have a successful
  -- fresh authoritative query. A new Owner's empty personal account is not proof.
  if exists(select 1 from private.family_store_subscriptions s join private.family_billing_customers c on c.id=s.customer_id
    where s.family_id=target_family_id and (c.reconciled_at is null or c.reconciled_at<clock_timestamp()-interval '30 seconds')) then
    raise exception 'BILLING_RECONCILIATION_REQUIRED' using errcode='P0001'; end if;
  insert into private.family_billing_purchase_checks values(target_family_id,target_user_id,clock_timestamp())
    on conflict(family_id) do update set owner_id=excluded.owner_id,verified_at=excluded.verified_at;
end; $$;
create function public.apply_family_billing_snapshot(target_customer_id uuid,generation bigint,snapshot jsonb,source_event_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; customer private.family_billing_customers; sub private.family_store_subscriptions;
  intent private.family_billing_intents; source private.family_billing_webhook_inbox; fam uuid;
  original_id text; product text; started timestamptz; until_time timestamptz; access boolean;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  select * into customer from private.family_billing_customers where id=target_customer_id for update;
  if customer.id is null or generation is distinct from customer.refresh_generation then raise exception 'BILLING_STALE_REFRESH' using errcode='P0001'; end if;
  if snapshot->>'environment' is distinct from 'SANDBOX' or snapshot->>'store' is distinct from 'APP_STORE'
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
  select * into sub from private.family_store_subscriptions where original_transaction_id=original_id and environment='SANDBOX' and store='APP_STORE' for update;
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
    values('SANDBOX','APP_STORE',original_id,snapshot->>'rc_subscription_id',target_customer_id,fam,intent.id,
      product,snapshot->>'status',access,snapshot->>'auto_renewal_status',started,until_time,generation,clock_timestamp()) returning * into sub;
    update private.family_billing_intents set status='fulfilled' where id=intent.id;
  else
    update private.family_store_subscriptions set product_id=product,status=snapshot->>'status',gives_access=access,
      auto_renewal_status=snapshot->>'auto_renewal_status',access_until=until_time,last_generation=generation,checked_at=clock_timestamp() where id=sub.id;
  end if;
  insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference,revoked_at,billing_subscription_id,billing_environment)
    values(fam,'plus',started,until_time,false,'rc:sandbox:'||original_id,case when access then null else clock_timestamp() end,sub.id,'SANDBOX')
    on conflict(billing_subscription_id) where billing_subscription_id is not null do update set
      ends_at=excluded.ends_at,revoked_at=excluded.revoked_at;
  update private.family_billing_customers set reconciled_at=clock_timestamp() where id=target_customer_id;
  if source_event_id is not null then update private.family_billing_webhook_inbox set status='processed',processed_at=clock_timestamp(),last_error=null where event_id=source_event_id; end if;
  return jsonb_build_object('family_id',fam,'gives_access',access,'environment','SANDBOX');
end; $$;

do $$ declare t text; begin
  foreach t in array array['family_billing_config','family_billing_customers','family_billing_intents','family_billing_webhook_inbox','family_store_subscriptions','family_billing_purchase_checks'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
    execute format('grant all on private.%I to service_role',t);
    execute format('create trigger pre_cutover_release_lock before insert or update or delete on private.%I for each row execute function private.assert_release_write_allowed()',t);
    execute format('create trigger require_supported_client before insert or update or delete on private.%I for each row execute function private.require_supported_client_mutation()',t);
  end loop;
end; $$;
revoke all on function private.assert_family_billing_sandbox_ready() from public,anon,authenticated,service_role;
revoke all on function public.get_family_billing_customer(),public.get_family_billing_state(uuid),public.begin_family_billing_purchase(uuid,uuid,text),public.update_family_billing_intent(uuid,text),
  public.receive_family_billing_webhook(jsonb,text),public.start_family_billing_refresh(uuid),public.apply_family_billing_snapshot(uuid,bigint,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.get_family_billing_server_context(uuid),public.finish_family_billing_webhook(text,text,text),public.get_family_billing_reconciliation_work(integer) from public,anon,authenticated,service_role;
revoke all on function public.get_family_billing_purchase_preflight_context(uuid),public.finish_family_billing_purchase_preflight(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_family_billing_customer(),public.get_family_billing_state(uuid),public.begin_family_billing_purchase(uuid,uuid,text),public.update_family_billing_intent(uuid,text) to authenticated;
grant execute on function public.receive_family_billing_webhook(jsonb,text),public.start_family_billing_refresh(uuid),public.apply_family_billing_snapshot(uuid,bigint,jsonb,text) to service_role;
grant execute on function public.get_family_billing_server_context(uuid),public.finish_family_billing_webhook(text,text,text),public.get_family_billing_reconciliation_work(integer) to service_role;
grant execute on function public.get_family_billing_purchase_preflight_context(uuid),public.finish_family_billing_purchase_preflight(uuid,uuid) to service_role;

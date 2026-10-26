-- SANDBOX ONLY: local request abandonment does not describe an Apple outcome.
-- Never place this file in the Production migration manifest. Deployment must
-- independently verify project yhxxsawcaffxonpconaq (environment is not identity).
begin;
set local lock_timeout='800ms';
set local statement_timeout='10s';
do $$ begin
  perform private.assert_family_billing_app_review_maintenance();
end; $$;

alter table private.family_billing_intents
  drop constraint family_billing_intents_status_check,
  add constraint family_billing_intents_status_check
    check(status in('prepared','store_pending','cancelled','failed','fulfilled','abandoned'));

create table private.family_billing_intent_abandonments (
  intent_id uuid primary key references private.family_billing_intents(id),
  operation_id uuid not null unique,
  owner_id uuid not null,
  family_id uuid not null,
  customer_id uuid not null,
  product_id text not null,
  abandoned_at timestamptz not null default clock_timestamp(),
  actor text not null default session_user,
  reason text not null check(length(reason) between 1 and 500),
  transaction_outcome text not null default 'unknown' check(transaction_outcome='unknown'),
  intent_before jsonb not null,
  provider_evidence jsonb not null,
  database_evidence jsonb not null
);
alter table private.family_billing_intent_abandonments enable row level security;
revoke all on private.family_billing_intent_abandonments from public,anon,authenticated,service_role;

create function private.guard_family_billing_abandonment_audit()
returns trigger language plpgsql set search_path='' as $$ begin
  perform private.assert_family_billing_app_review_maintenance();
  if tg_op<>'INSERT' then
    raise exception 'BILLING_ABANDONMENT_AUDIT_IMMUTABLE' using errcode='42501'; end if;
  return new;
end; $$;
revoke all on function private.guard_family_billing_abandonment_audit() from public,anon,authenticated,service_role;
create trigger immutable_abandonment_audit before insert or update or delete
  on private.family_billing_intent_abandonments for each row
  execute function private.guard_family_billing_abandonment_audit();

-- Existing service_role table grants must not allow forging/reopening abandoned
-- requests. The audit is immutable even after a real late chain is attached.
create function private.guard_family_billing_abandoned_intent()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if tg_op<>'INSERT' and exists(select 1 from private.family_billing_intent_ambiguities a
      where a.candidate_intent_ids @> array[old.id]) then
    if tg_op='DELETE' then raise exception 'BILLING_INTENT_AMBIGUITY_IMMUTABLE' using errcode='42501'; end if;
    if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
      raise exception 'BILLING_INTENT_AMBIGUITY_IMMUTABLE' using errcode='42501'; end if;
  end if;
  if tg_op<>'INSERT' and old.status='abandoned' then
    if tg_op='DELETE' then
      raise exception 'BILLING_ABANDONED_INTENT_IMMUTABLE' using errcode='42501'; end if;
    if new is distinct from old then
      raise exception 'BILLING_ABANDONED_INTENT_IMMUTABLE' using errcode='42501'; end if;
  end if;
  if tg_op<>'DELETE' and new.status='abandoned' and (tg_op='INSERT' or old.status<>'abandoned') then
    perform private.assert_family_billing_app_review_maintenance();
    if tg_op='INSERT' or old.status<>'store_pending'
      or (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') or not exists(
      select 1 from private.family_billing_intent_abandonments a
      where a.intent_id=new.id and a.intent_before=to_jsonb(old)
        and a.customer_id=new.customer_id and a.family_id=new.family_id
        and a.product_id=new.product_id) then
      raise exception 'BILLING_ABANDONMENT_AUDIT_REQUIRED' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function private.guard_family_billing_abandoned_intent() from public,anon,authenticated,service_role;
create trigger guard_abandoned_intent before insert or update or delete on private.family_billing_intents
  for each row execute function private.guard_family_billing_abandoned_intent();

-- Evidence is supplied by a trusted DIRECT maintenance operator after paginated,
-- read-only RevenueCat GETs. SQL cannot authenticate external HTTP evidence.
-- This operation deliberately records the remaining Apple outcome as UNKNOWN.
create function private.abandon_family_billing_intent(
  target_intent_id uuid, expected_owner_id uuid, expected_family_id uuid,
  operation_id uuid, reason text, provider_evidence jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare i private.family_billing_intents; a private.family_billing_intent_abandonments;
  cfg private.family_billing_config; observed timestamptz; previous_bypass text; db_proof jsonb;
begin
  perform private.assert_family_billing_app_review_maintenance();
  if target_intent_id is null or expected_owner_id is null or expected_family_id is null
    or operation_id is null or reason is null or length(reason) not between 1 and 500 then
    raise exception 'BILLING_ABANDONMENT_INVALID' using errcode='22023'; end if;
  perform set_config('lock_timeout','800ms',true);
  -- Freeze the closed baseline against concurrent window/switch activation.
  -- Follow the same Release Lock -> Billing order as review approval/close.
  perform 1 from private.pre_cutover_release_lock where singleton for share;
  select * into cfg from private.family_billing_config where singleton for share;
  perform 1 from private.family_media_quota_policy where singleton for share;
  -- Same payer -> Family -> intent order as begin/snapshot. No global switch
  -- is touched. A concurrent snapshot serializes on this payer row.
  perform 1 from private.family_billing_customers
    where id=expected_owner_id and user_id=expected_owner_id for update;
  if not found then raise exception 'BILLING_ABANDONMENT_BINDING_DENIED' using errcode='42501'; end if;
  perform 1 from public.family_members m join auth.users u on u.id=m.user_id
    where m.user_id=expected_owner_id and m.family_id=expected_family_id and m.role='owner'
      and u.deleted_at is null and coalesce(u.banned_until<=clock_timestamp(),true) for share of m,u;
  if not found then raise exception 'BILLING_ABANDONMENT_BINDING_DENIED' using errcode='42501'; end if;
  previous_bypass:=current_setting('homeypaw.pre_cutover_migration_bypass',true);
  perform set_config('homeypaw.pre_cutover_migration_bypass','on',true);
  perform private.lock_family_media_usage(expected_family_id);
  perform set_config('homeypaw.pre_cutover_migration_bypass',coalesce(previous_bypass,''),true);
  select * into i from private.family_billing_intents where id=target_intent_id for update;
  if i.id is null or i.customer_id<>expected_owner_id or i.family_id<>expected_family_id then
    raise exception 'BILLING_ABANDONMENT_BINDING_DENIED' using errcode='42501'; end if;
  select * into a from private.family_billing_intent_abandonments where intent_id=i.id;
  if a.intent_id is not null then
    if a.operation_id<>operation_id or a.owner_id<>expected_owner_id or a.family_id<>expected_family_id
      or a.reason<>reason or a.provider_evidence is distinct from provider_evidence or i.status<>'abandoned' then
      raise exception 'BILLING_ABANDONMENT_CONFLICT' using errcode='22023'; end if;
    return to_jsonb(a); -- Original evidence may now be old; replay never mutates.
  end if;
  if cfg.enabled is distinct from false
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from true
    or (select storage_enforcement_enabled from private.family_media_quota_policy where singleton) is distinct from false
    or exists(select 1 from private.family_billing_test_accounts where enabled and expires_at>clock_timestamp()) then
    raise exception 'BILLING_ABANDONMENT_CLOSED_STATE_REQUIRED' using errcode='42501'; end if;
  if i.status<>'store_pending' or not isfinite(i.expires_at) or i.expires_at>clock_timestamp()
    or i.product_id is distinct from cfg.monthly_product_id
    or cfg.rc_project_id is null or cfg.rc_app_id is null or cfg.rc_entitlement_id is null then
    raise exception 'BILLING_ABANDONMENT_EXPECTED_PENDING_MONTHLY' using errcode='22023'; end if;
  observed:=(provider_evidence->>'observed_at')::timestamptz;
  if provider_evidence is null or jsonb_typeof(provider_evidence)<>'object'
    or observed is null or not isfinite(observed) or observed>clock_timestamp()
    or observed<clock_timestamp()-interval '2 minutes' or observed<i.expires_at
    or provider_evidence->>'project_ref' is distinct from 'yhxxsawcaffxonpconaq'
    or provider_evidence->>'rc_project_id' is distinct from cfg.rc_project_id
    or provider_evidence->>'app_id' is distinct from cfg.rc_app_id
    or provider_evidence->>'entitlement_id' is distinct from cfg.rc_entitlement_id
    or provider_evidence->>'customer_id' is distinct from i.customer_id::text
    or provider_evidence->>'original_customer_id' is distinct from i.customer_id::text
    or provider_evidence->>'intent_id' is distinct from i.id::text
    or provider_evidence->>'product_id' is distinct from i.product_id
    or provider_evidence->>'environment' is distinct from 'SANDBOX'
    or provider_evidence->>'store' is distinct from 'APP_STORE'
    or provider_evidence->>'transaction_outcome' is distinct from 'unknown'
    or provider_evidence->'pagination_complete' is distinct from 'true'::jsonb
    or provider_evidence->'transactions_since_intent' is distinct from '0'::jsonb
    or provider_evidence->'events_since_intent' is distinct from '0'::jsonb
    or provider_evidence->'active_entitlements' is distinct from '0'::jsonb
    or provider_evidence->'pending_payments' is distinct from '0'::jsonb
    or coalesce(provider_evidence->>'evidence_sha256','')!~'^[0-9a-f]{64}$' then
    raise exception 'BILLING_ABANDONMENT_EVIDENCE_DENIED' using errcode='42501'; end if;
  if exists(select 1 from private.family_store_subscriptions s where
      s.intent_id=i.id or ((s.customer_id=i.customer_id or s.family_id=i.family_id)
        and (s.started_at>=i.created_at-interval '30 seconds'
          or (s.gives_access and s.access_until>clock_timestamp()) or s.status not in('expired','refunded','revoked'))))
    or exists(select 1 from private.family_billing_webhook_inbox e where e.customer_id=i.customer_id
      and (e.event_at>=i.created_at-interval '30 seconds' or e.status in('pending','deferred')))
    or exists(select 1 from private.family_media_entitlements e where e.family_id=i.family_id
      and e.revoked_at is null and e.starts_at<=clock_timestamp()
      and (e.ends_at is null or e.ends_at>=clock_timestamp()))
    or exists(select 1 from private.family_billing_intents x where x.id<>i.id
      and (x.customer_id=i.customer_id or x.family_id=i.family_id)
      and (x.status='store_pending' or (x.status='prepared' and x.expires_at>clock_timestamp()))) then
    raise exception 'BILLING_ABANDONMENT_TRANSACTION_REVIEW_REQUIRED' using errcode='P0001'; end if;
  select jsonb_build_object('checked_at',clock_timestamp(),
    'subscriptions',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from private.family_store_subscriptions s
      where s.customer_id=i.customer_id or s.family_id=i.family_id),
    'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from private.family_billing_webhook_inbox e where e.customer_id=i.customer_id),
    'entitlements',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from private.family_media_entitlements e where e.family_id=i.family_id),
    'related_intents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from private.family_billing_intents x
      where x.customer_id=i.customer_id or x.family_id=i.family_id),
    'billing',cfg.enabled,'release_lock',true,'quota',false,'valid_admissions',0) into db_proof;
  insert into private.family_billing_intent_abandonments(intent_id,operation_id,owner_id,family_id,customer_id,
    product_id,reason,intent_before,provider_evidence,database_evidence)
    values(i.id,operation_id,expected_owner_id,expected_family_id,i.customer_id,i.product_id,reason,
      to_jsonb(i),provider_evidence,db_proof) returning * into a;
  previous_bypass:=current_setting('homeypaw.pre_cutover_migration_bypass',true);
  perform set_config('homeypaw.pre_cutover_migration_bypass','on',true);
  update private.family_billing_intents set status='abandoned' where id=i.id;
  perform set_config('homeypaw.pre_cutover_migration_bypass',coalesce(previous_bypass,''),true);
  return to_jsonb(a);
end; $$;
revoke all on function private.abandon_family_billing_intent(uuid,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;

-- A real chain may prove its Family without proving one purchase-attempt UUID.
-- Old non-null links remain untouched. New null links require an immutable audit.
alter table private.family_store_subscriptions alter column intent_id drop not null;
create table private.family_billing_intent_ambiguities (
  subscription_id uuid primary key references private.family_store_subscriptions(id),
  customer_id uuid not null,
  family_id uuid not null,
  original_transaction_id text not null,
  rc_subscription_id text not null,
  source_event_id text not null references private.family_billing_webhook_inbox(event_id),
  candidate_intent_ids uuid[] not null check(cardinality(candidate_intent_ids)>1),
  candidate_intents jsonb not null,
  verified_snapshot jsonb not null,
  resolved_at timestamptz not null default clock_timestamp(),
  resolution text not null default 'family_verified_intent_unknown' check(resolution='family_verified_intent_unknown')
);
alter table private.family_billing_intent_ambiguities enable row level security;
revoke all on private.family_billing_intent_ambiguities from public,anon,authenticated,service_role;
create index family_billing_intent_ambiguity_candidates on private.family_billing_intent_ambiguities using gin(candidate_intent_ids);
create function private.guard_family_billing_intent_ambiguity()
returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op<>'INSERT' then raise exception 'BILLING_INTENT_AMBIGUITY_IMMUTABLE' using errcode='42501'; end if;
  if (select count(distinct i.id) from private.family_billing_intents i where i.id=any(new.candidate_intent_ids)
       and i.customer_id=new.customer_id and i.family_id=new.family_id
       and i.product_id=new.verified_snapshot->>'product_id')<>cardinality(new.candidate_intent_ids)
    or not exists(select 1 from private.family_billing_intent_abandonments a where a.intent_id=any(new.candidate_intent_ids))
    or not exists(select 1 from private.family_billing_webhook_inbox e where e.event_id=new.source_event_id
       and e.customer_id=new.customer_id and e.original_transaction_id=new.original_transaction_id
       and e.product_id=new.verified_snapshot->>'product_id') then
    raise exception 'BILLING_BINDING_REVIEW_REQUIRED' using errcode='P0001'; end if;
  return new;
end; $$;
revoke all on function private.guard_family_billing_intent_ambiguity() from public,anon,authenticated,service_role;
create trigger immutable_intent_ambiguity before insert or update or delete on private.family_billing_intent_ambiguities
  for each row execute function private.guard_family_billing_intent_ambiguity();

create function private.check_family_billing_ambiguous_subscription()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.intent_id is null and not exists(select 1 from private.family_billing_intent_ambiguities a
      where a.subscription_id=new.id and a.customer_id=new.customer_id and a.family_id=new.family_id
        and a.original_transaction_id=new.original_transaction_id and a.rc_subscription_id=new.rc_subscription_id)
    then raise exception 'BILLING_INTENT_AMBIGUITY_AUDIT_REQUIRED' using errcode='42501'; end if;
  return null;
end; $$;
revoke all on function private.check_family_billing_ambiguous_subscription() from public,anon,authenticated,service_role;
create constraint trigger require_intent_ambiguity_audit after insert or update on private.family_store_subscriptions
  deferrable initially deferred for each row execute function private.check_family_billing_ambiguous_subscription();

-- This ends local checkout blocking for the audited candidate set without
-- falsely calling any particular request paid, failed, cancelled or refunded.
create function private.family_billing_intent_blocks_checkout(i private.family_billing_intents, at_time timestamptz)
returns boolean language sql stable set search_path='' as $$
  select (i.status='store_pending' or (i.status='prepared' and i.expires_at>at_time))
    and not exists(select 1 from private.family_billing_intent_ambiguities a
      where a.customer_id=i.customer_id and a.family_id=i.family_id and a.candidate_intent_ids @> array[i.id]);
$$;
revoke all on function private.family_billing_intent_blocks_checkout(private.family_billing_intents,timestamptz)
  from public,anon,authenticated,service_role;

-- Change only the private business delegates; public wrappers retain admission
-- checks, signatures, response shape, OIDs and ACLs used by Build 12.
do $$ declare definition text; patched text; signature text; needle text; replacement text; begin
  foreach signature in array array[
    'private.test_window_original_begin_family_billing_purchase(uuid,uuid,text)',
    'private.app_review_original_get_family_billing_state(uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if signature like '%begin_family%' then
      needle:='(status=''store_pending'' or (status=''prepared'' and expires_at>clock_timestamp()))';
      replacement:='private.family_billing_intent_blocks_checkout(family_billing_intents,clock_timestamp())';
    else
      needle:='(status=''store_pending'' or (status=''prepared'' and expires_at>statement_timestamp()))';
      replacement:='private.family_billing_intent_blocks_checkout(family_billing_intents,statement_timestamp())';
    end if;
    patched:=replace(definition,needle,replacement);
    if patched=definition or (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
      raise exception 'BILLING_ABANDONMENT_DELEGATE_DRIFT'; end if;
    execute patched;
  end loop;
end; $$;

-- Preserve public RPC signature, ownership, grants and all trusted snapshot checks.
create or replace function public.apply_family_billing_snapshot(target_customer_id uuid,generation bigint,snapshot jsonb,source_event_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.family_billing_config; customer private.family_billing_customers; sub private.family_store_subscriptions;
  intent private.family_billing_intents; source private.family_billing_webhook_inbox; fam uuid;
  candidate_count bigint; family_count bigint; candidate_id uuid; candidate_ids uuid[]; candidate_rows jsonb; has_abandoned boolean; original_id text; product text; started timestamptz; until_time timestamptz; access boolean;
begin
  cfg:=private.assert_family_billing_sandbox_ready();
  if cfg.environment<>'SANDBOX' then raise exception 'BILLING_ABANDONMENT_SANDBOX_REQUIRED' using errcode='42501'; end if;
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
    -- Family consensus is independent of exact Intent attribution. The trusted
    -- provider customer and chain checks above remain mandatory.
    select count(*),count(distinct i.family_id),(array_agg(i.family_id))[1]
      into candidate_count,family_count,fam
      from private.family_billing_intents i where i.customer_id=target_customer_id and i.product_id=product
      and i.status in('prepared','store_pending','abandoned') and started>=i.created_at-interval '30 seconds'
      and (i.status in('store_pending','abandoned') or started<=i.expires_at)
      and not exists(select 1 from private.family_store_subscriptions bound where bound.intent_id=i.id);
    if candidate_count=0 or family_count<>1 then
      raise exception 'BILLING_BINDING_REVIEW_REQUIRED' using errcode='P0001'; end if;
    perform 1 from public.family_members where family_id=fam and user_id=customer.user_id and role='owner'
      and exists(select 1 from auth.users u where u.id=customer.user_id and u.deleted_at is null
        and coalesce(u.banned_until<=clock_timestamp(),true)) for share;
    if not found then raise exception 'BILLING_BINDING_REVIEW_REQUIRED' using errcode='P0001'; end if;
  end if;
  perform private.lock_family_media_usage(fam);
  if sub.id is null then
    -- Family lock serializes cancellation; payer lock serializes new requests.
    perform i.id from private.family_billing_intents i where i.customer_id=target_customer_id
      and i.product_id=product and i.status in('prepared','store_pending','abandoned')
      and started>=i.created_at-interval '30 seconds' and (i.status in('store_pending','abandoned') or started<=i.expires_at)
      and not exists(select 1 from private.family_store_subscriptions bound where bound.intent_id=i.id)
      order by i.id for update;
    select count(*),count(distinct i.family_id),array_agg(i.id order by i.id),
      jsonb_agg(to_jsonb(i) order by i.id),bool_or(i.status='abandoned'),(array_agg(i.family_id))[1]
      into candidate_count,family_count,candidate_ids,candidate_rows,has_abandoned,candidate_id
      from private.family_billing_intents i where i.customer_id=target_customer_id and i.product_id=product
      and i.status in('prepared','store_pending','abandoned') and started>=i.created_at-interval '30 seconds'
      and (i.status in('store_pending','abandoned') or started<=i.expires_at)
      and not exists(select 1 from private.family_store_subscriptions bound where bound.intent_id=i.id);
    if candidate_count=0 or family_count<>1 or candidate_id<>fam
      or (candidate_count>1 and not has_abandoned) then
      raise exception 'BILLING_BINDING_REVIEW_REQUIRED' using errcode='P0001'; end if;
    -- An exact association is recorded only for a single candidate.
    candidate_id:=case when candidate_count=1 then candidate_ids[1] else null end;
    if exists(select 1 from private.family_store_subscriptions where family_id=fam and
      ((gives_access and access_until>clock_timestamp()) or status not in('expired','refunded','revoked'))) then
      raise exception 'FAMILY_ALREADY_SUBSCRIBED' using errcode='P0001'; end if;
    insert into private.family_store_subscriptions(environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,
      product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
    values(cfg.environment,'APP_STORE',original_id,snapshot->>'rc_subscription_id',target_customer_id,fam,candidate_id,
      product,snapshot->>'status',access,snapshot->>'auto_renewal_status',started,until_time,generation,clock_timestamp()) returning * into sub;
    if candidate_count>1 then
      insert into private.family_billing_intent_ambiguities(subscription_id,customer_id,family_id,
        original_transaction_id,rc_subscription_id,source_event_id,candidate_intent_ids,candidate_intents,verified_snapshot)
        values(sub.id,target_customer_id,fam,original_id,sub.rc_subscription_id,source_event_id,
          candidate_ids,candidate_rows,snapshot);
    else
      update private.family_billing_intents set status='fulfilled' where id=candidate_id and status<>'abandoned';
    end if;
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


create or replace function public.get_family_billing_server_context(target_customer_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return jsonb_build_object('config',(select to_jsonb(c) from private.family_billing_config c where singleton),
    'pending_intent',exists(select 1 from private.family_billing_intents where customer_id=target_customer_id
      and not exists(select 1 from private.family_store_subscriptions bound where bound.intent_id=family_billing_intents.id)
      and (status in('store_pending','abandoned') or (status='prepared' and expires_at>statement_timestamp()))),
    'chains',(select coalesce(jsonb_agg(jsonb_build_object('original_transaction_id',original_transaction_id)),'[]')
      from private.family_store_subscriptions where customer_id=target_customer_id));
end; $$;

create or replace function public.get_family_billing_reconciliation_work(job_limit integer default 25)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(id),'{}') from (
    select c.id from private.family_billing_customers c
    where not c.review_required and (c.next_retry_at is null or c.next_retry_at<=statement_timestamp())
      -- One invalid shared provider credential pauses automatic work globally,
      -- instead of quarantining another innocent payer on every Cron tick.
      and not exists(select 1 from private.family_billing_customers blocked
        where blocked.review_required and blocked.recovery_error in('BILLING_PROVIDER_HTTP_401','BILLING_PROVIDER_HTTP_403'))
      and (exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id)
        or exists(select 1 from private.family_billing_intents i where i.customer_id=c.id
          and not exists(select 1 from private.family_store_subscriptions bound where bound.intent_id=i.id) and
          (i.status in('store_pending','abandoned') or (i.status='prepared' and i.expires_at>statement_timestamp())))
        or exists(select 1 from private.family_billing_webhook_inbox e where e.customer_id=c.id and e.status in('pending','deferred')))
    order by c.last_attempt_at nulls first,c.created_at,c.id limit least(greatest(job_limit,1),25)
  ) work;
$$;

create or replace function public.get_family_billing_recovery_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with backlog as (
    select count(*) filter(where c.review_required) as review_required,
      count(*) filter(where c.recovery_error in('BILLING_PROVIDER_HTTP_401','BILLING_PROVIDER_HTTP_403')) as authentication_failures,
      count(*) filter(where c.recovery_failures>=3) as repeatedly_failing,
      count(*) filter(where not c.review_required and (c.next_retry_at is null or c.next_retry_at<=statement_timestamp())) as due,
      coalesce(max(extract(epoch from statement_timestamp()-coalesce(c.reconciled_at,c.created_at))),0)::bigint as oldest_unverified_seconds
    from private.family_billing_customers c where
      exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id)
      or exists(select 1 from private.family_billing_intents i where i.customer_id=c.id
          and not exists(select 1 from private.family_store_subscriptions bound where bound.intent_id=i.id) and
        (i.status in('store_pending','abandoned') or (i.status='prepared' and i.expires_at>statement_timestamp())))
      or exists(select 1 from private.family_billing_webhook_inbox e where e.customer_id=c.id and e.status in('pending','deferred'))
  ), inbox as (
    select count(*) as deferred,
      coalesce(max(extract(epoch from statement_timestamp()-received_at)),0)::bigint as oldest_deferred_seconds
    from private.family_billing_webhook_inbox where status in('pending','deferred')
  ) select to_jsonb(b)||to_jsonb(i)||jsonb_build_object(
    'billing_enabled',coalesce((select enabled from private.family_billing_config where singleton),false),
    'release_lock',coalesce((select enabled from private.pre_cutover_release_lock where singleton),true),
    'attention_required',b.review_required>0 or b.authentication_failures>0 or b.repeatedly_failing>0
      or b.oldest_unverified_seconds>900 or i.oldest_deferred_seconds>300)
    from backlog b cross join inbox i;
$$;

-- No account, switch, scheduler, Intent or entitlement is seeded.
commit;

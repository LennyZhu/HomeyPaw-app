-- SANDBOX ONLY: deploy exclusively to yhxxsawcaffxonpconaq through the
-- verified Sandbox wrapper, never a Production/default migration manifest.
-- Requires all three Sandbox forwards through 20261026074212.
-- Adds one private Yearly-only maintenance entry point. Existing Monthly,
-- checkout, matching, 90-minute/14-day approval and Cron routines are untouched.
-- No account, Intent, entitlement, configuration, Secret or job is changed here.
-- SQL checks the protected SANDBOX environment; the external deployment wrapper
-- must independently verify the actual project identity before executing SQL.
begin;
set local lock_timeout='800ms';
set local statement_timeout='10s';
do $$ begin
  perform private.assert_family_billing_app_review_maintenance();
  if to_regprocedure('private.abandon_family_billing_intent(uuid,uuid,uuid,uuid,text,jsonb)') is null
    or to_regclass('private.family_billing_intent_abandonments') is null
    or to_regclass('private.family_billing_intent_ambiguities') is null then
    raise exception 'BILLING_YEARLY_ABANDONMENT_PREREQUISITES_REQUIRED' using errcode='42501';
  end if;
end; $$;

-- Fresh provider/Functions evidence is collected and attested by trusted direct
-- maintenance after read-only GETs. SQL cannot authenticate RevenueCat HTTP data
-- or observe Edge Secret propagation. Missing/old/ON Functions proof rejects.
-- A zero provider count is never proof that Apple payment failed: UNKNOWN only.
create function private.abandon_family_billing_yearly_intent(
  target_intent_id uuid, expected_owner_id uuid, expected_family_id uuid,
  expected_product_id text, operation_id uuid, reason text, provider_evidence jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare i private.family_billing_intents; a private.family_billing_intent_abandonments;
  cfg private.family_billing_config; observed timestamptz; functions_observed timestamptz;
  previous_bypass text; db_proof jsonb;
begin
  perform private.assert_family_billing_app_review_maintenance();
  if target_intent_id is null or expected_owner_id is null or expected_family_id is null
    or nullif(expected_product_id,'') is null or operation_id is null
    or reason is null or length(reason) not between 1 and 500 then
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
  if i.id is null or i.customer_id<>expected_owner_id or i.family_id<>expected_family_id
    or i.product_id is distinct from expected_product_id
    or expected_product_id is distinct from cfg.yearly_product_id then
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
    or i.product_id is distinct from cfg.yearly_product_id
    or cfg.yearly_product_id is not distinct from cfg.monthly_product_id
    or cfg.rc_project_id is null or cfg.rc_app_id is null or cfg.rc_entitlement_id is null then
    raise exception 'BILLING_ABANDONMENT_EXPECTED_PENDING_YEARLY' using errcode='22023'; end if;
  observed:=(provider_evidence->>'observed_at')::timestamptz;
  functions_observed:=(provider_evidence->'functions_billing'->>'observed_at')::timestamptz;
  if provider_evidence is null or jsonb_typeof(provider_evidence)<>'object'
    or observed is null or not isfinite(observed) or observed>clock_timestamp()
    or observed<clock_timestamp()-interval '2 minutes' or observed<i.expires_at
    or observed<(select updated_at from private.pre_cutover_release_lock where singleton)
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
    or provider_evidence->'identity_conflicts' is distinct from '0'::jsonb
    or provider_evidence->'unresolved_ambiguities' is distinct from '0'::jsonb
    or functions_observed is null or not isfinite(functions_observed)
    or functions_observed>clock_timestamp() or functions_observed<clock_timestamp()-interval '2 minutes'
    or functions_observed<(select updated_at from private.pre_cutover_release_lock where singleton)
    or provider_evidence->'functions_billing'->>'project_ref' is distinct from 'yhxxsawcaffxonpconaq'
    or provider_evidence->'functions_billing'->>'environment' is distinct from 'SANDBOX'
    or provider_evidence->'functions_billing'->'enabled' is distinct from 'false'::jsonb
    or provider_evidence->'transactions_since_intent' is distinct from '0'::jsonb
    or provider_evidence->'events_since_intent' is distinct from '0'::jsonb
    or provider_evidence->'active_entitlements' is distinct from '0'::jsonb
    or provider_evidence->'pending_payments' is distinct from '0'::jsonb
    or coalesce(provider_evidence->>'evidence_sha256','')!~'^[0-9a-f]{64}$' then
    raise exception 'BILLING_ABANDONMENT_EVIDENCE_DENIED' using errcode='42501'; end if;
  if exists(select 1 from private.family_billing_customers c where c.id=i.customer_id
      and (c.review_required or c.recovery_error is not null))
    or exists(select 1 from private.family_billing_intent_ambiguities x
      -- resolved_at proves Family consensus, not exact Intent attribution.
      -- Existing ambiguity audits still require administrator investigation.
      where (x.customer_id=i.customer_id or x.family_id=i.family_id
        or x.candidate_intent_ids @> array[i.id]))
    or exists(select 1 from private.family_store_subscriptions s where
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
    'customer',(select to_jsonb(c) from private.family_billing_customers c where c.id=i.customer_id),
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
revoke all on function private.abandon_family_billing_yearly_intent(uuid,uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated,service_role;

commit;

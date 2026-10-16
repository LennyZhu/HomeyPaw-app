begin;
select public.rv2_assert(not has_function_privilege('authenticated','public.get_family_billing_recovery_anchors(uuid)','execute'),'client cannot read trusted anchors');
select public.rv2_assert(not has_function_privilege('anon','public.finish_family_billing_recovery(uuid,bigint,text,text)','execute'),'anon cannot acknowledge provider recovery');
select public.rv2_assert(has_function_privilege('service_role','public.finish_family_billing_recovery(uuid,bigint,text,text)','execute'),'service recovery only');
select public.get_family_billing_customer() where false;
insert into private.family_billing_customers(id,user_id) values(public.rv2_id('recovery-customer'),public.rv2_id('owner'));
select public.receive_family_billing_webhook(jsonb_build_object('id','recover-pending','type','INITIAL_PURCHASE','app_id','app_fixture',
  'app_user_id',public.rv2_id('recovery-customer'),'environment','SANDBOX','store','APP_STORE',
  'original_transaction_id','trusted-original','product_id','sandbox.monthly','event_timestamp_ms',1),repeat('a',64));
select public.rv2_assert(jsonb_array_length(public.get_family_billing_recovery_anchors(public.rv2_id('recovery-customer')))=1,'trusted pending inbox anchor recoverable without API event history');
select public.rv2_assert(public.rv2_id('recovery-customer')=any(public.get_family_billing_reconciliation_work()),'pending inbox included even without subscription');
select public.start_family_billing_refresh(public.rv2_id('recovery-customer'));
select public.start_family_billing_refresh(public.rv2_id('recovery-customer'));
select public.finish_family_billing_recovery(public.rv2_id('recovery-customer'),2,'reconciled');
select public.finish_family_billing_recovery(public.rv2_id('recovery-customer'),1,'manual_review','BILLING_CHAIN_ALREADY_BOUND');
select public.rv2_assert(not(select review_required from private.family_billing_customers where id=public.rv2_id('recovery-customer')),'stale recovery cannot overwrite latest result');
select public.finish_family_billing_recovery(public.rv2_id('recovery-customer'),2,'manual_review','BILLING_CHAIN_ALREADY_BOUND');
select public.rv2_assert(not public.rv2_id('recovery-customer')=any(public.get_family_billing_reconciliation_work()),'manual review not blindly retried');
-- A provider outage cannot erase a still-valid bounded grant, and absence of
-- another successful refresh cannot extend that grant beyond its trusted end.
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',false,'synthetic-bounded-recovery');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','unknown provider preserves still-valid grant');
update private.family_media_entitlements set ends_at=clock_timestamp()-interval '1 second'
where source_reference='synthetic-bounded-recovery';
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='free','trusted expiry wins without another webhook or provider refresh');
rollback;

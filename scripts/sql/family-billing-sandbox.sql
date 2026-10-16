-- Synthetic billing fixtures only. Roll back all customer/subscription grants.
create function public.fb_customer(label text) returns uuid language sql security definer set search_path='' as $$
 select id from private.family_billing_customers where user_id=public.rv2_id(label); $$;
create function public.fb_event(label text,customer text,original_id text,product text default 'sandbox.monthly')
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',label,'app_id','app_fixture','app_user_id',public.fb_customer(customer),'environment','SANDBOX',
 'type','INITIAL_PURCHASE','store','APP_STORE','original_transaction_id',original_id,'product_id',product,
 'event_timestamp_ms',floor(extract(epoch from clock_timestamp())*1000)); $$;
create function public.fb_snapshot(original_id text,customer text,intent_label text,product text default 'sandbox.monthly')
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('environment','SANDBOX','store','APP_STORE','original_transaction_id',original_id,'rc_subscription_id','sub-'||original_id,
 'customer_id',public.fb_customer(customer),'original_customer_id',public.fb_customer(customer),'app_id','app_fixture','entitlement_id','ent_fixture',
 'ownership','purchased','product_id',product,'status','active','auto_renewal_status','will_renew','gives_access',true,
 'started_at',(select created_at from private.family_billing_intents where id=public.rv2_id(intent_label)),
 'access_until',clock_timestamp()+interval '1 day'); $$;
create function public.fb_apply(snapshot jsonb,event_id text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare customer uuid:=(snapshot->>'customer_id')::uuid; generation bigint;
begin
 generation:=public.start_family_billing_refresh(customer);
 return public.apply_family_billing_snapshot(customer,generation,snapshot,event_id);
end; $$;
create function public.fb_begin(family_id uuid,request_id uuid,period text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.finish_family_billing_purchase_preflight(auth.uid(),family_id);
 return public.begin_family_billing_purchase(family_id,request_id,period);
end; $$;

begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_error('select public.get_family_billing_customer()','P0001','BILLING_SANDBOX_NOT_CONFIGURED');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'sandbox_enabled')='false','default Sandbox disabled');
rollback;
-- Explicit disposable-server setup. Never seed this in the migration.
update private.family_billing_config set enabled=true,rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',
 monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';

begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.get_family_billing_customer();select public.get_family_billing_customer();
select public.rv2_error($q$select public.begin_family_billing_purchase(public.rv2_id('family'),public.rv2_id('no-preflight'),'monthly')$q$,'P0001','BILLING_RECONCILIATION_REQUIRED');
select public.fb_begin(public.rv2_id('family'),public.rv2_id('cancel'),'monthly');
select public.fb_begin(public.rv2_id('family'),public.rv2_id('cancel'),'monthly');
select public.update_family_billing_intent(public.rv2_id('cancel'),'store_pending');
select public.rv2_error($q$select public.fb_begin(public.rv2_id('family'),public.rv2_id('duplicate'),'yearly')$q$,'P0001','BILLING_PURCHASE_PENDING');
select public.update_family_billing_intent(public.rv2_id('cancel'),'cancelled');
select public.fb_begin(public.rv2_id('family'),public.rv2_id('failed'),'yearly');
select public.update_family_billing_intent(public.rv2_id('failed'),'failed');
select public.fb_begin(public.rv2_id('family'),public.rv2_id('pending'),'monthly');
select public.update_family_billing_intent(public.rv2_id('pending'),'store_pending');
reset role;
update private.family_billing_intents set expires_at=clock_timestamp()-interval '1 hour' where id=public.rv2_id('pending');
set local role authenticated;
select public.rv2_error($q$select public.fb_begin(public.rv2_id('family'),public.rv2_id('pending-duplicate'),'monthly')$q$,'P0001','BILLING_PURCHASE_PENDING');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='free','cancel/fail/pending never grant Plus');
select public.rv2_error($q$update private.family_media_entitlements set tier='plus'$q$,'42501');
select public.rv2_error($q$select public.apply_family_billing_snapshot(public.fb_customer('owner'),1,'{}',null)$q$,'42501');
select public.rv2_error($q$select public.finish_family_billing_purchase_preflight(public.rv2_id('owner'),public.rv2_id('family'))$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.get_family_billing_state(public.rv2_id('family'));
select public.rv2_error($q$select public.fb_begin(public.rv2_id('family'),public.rv2_id('member-buy'),'monthly')$q$,'42501','BILLING_OWNER_REQUIRED');
select set_config('request.jwt.claim.sub',public.rv2_id('viewer')::text,true);
select public.get_family_billing_state(public.rv2_id('family'));
select public.rv2_error($q$select public.fb_begin(public.rv2_id('family'),public.rv2_id('viewer-buy'),'monthly')$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('removed')::text,true);
select public.rv2_error($q$select public.get_family_billing_state(public.rv2_id('family'))$q$,'42501');
select public.rv2_error($q$select public.fb_begin(public.rv2_id('family'),public.rv2_id('removed-buy'),'monthly')$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('former')::text,true);
select public.rv2_error($q$select public.get_family_billing_state(public.rv2_id('family'))$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('stranger')::text,true);
select public.rv2_error($q$select public.get_family_billing_state(public.rv2_id('family'))$q$,'42501');
rollback;

do $$ declare period text; product text; snap jsonb; source jsonb; first_id uuid; cust uuid; g1 bigint; g2 bigint; begin
 foreach period in array array['monthly','yearly'] loop
  begin
   product:='sandbox.'||period;
   perform set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
   cust:=public.get_family_billing_customer();
   perform public.fb_begin(public.rv2_id('family'),public.rv2_id('first-'||period),period);
   update private.family_billing_intents set created_at=statement_timestamp()-interval '1 second' where id=public.rv2_id('first-'||period);
   perform public.update_family_billing_intent(public.rv2_id('first-'||period),'store_pending');
   source:=public.fb_event('initial-'||period,'owner','original-'||period,product);
   perform public.receive_family_billing_webhook(source,repeat('a',64));
   snap:=public.fb_snapshot('original-'||period,'owner','first-'||period,product);
   perform public.fb_apply(snap,'initial-'||period);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus',period||' grants Family Plus');
   perform public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'limit_bytes')::bigint=5368709120,'reuses Phase 2 5 GiB entitlement');
   perform set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','nonpaying Member shares Plus');
   perform set_config('request.jwt.claim.sub',public.rv2_id('viewer')::text,true);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','nonpaying Viewer shares Plus');
   perform set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
   perform public.rv2_assert((select count(*)=1 from private.family_media_entitlements),'one shared entitlement');
   select id into first_id from private.family_media_entitlements;
   perform public.receive_family_billing_webhook(source,repeat('a',64));
   perform public.rv2_error(format('select public.receive_family_billing_webhook(%L::jsonb,%L)',source::text,repeat('b',64)),'22023','BILLING_EVENT_ID_CONFLICT');
   snap:=snap||jsonb_build_object('access_until',clock_timestamp()+interval '2 days');
   perform public.fb_apply(snap);perform public.fb_apply(snap,'initial-'||period);
   perform public.rv2_assert((select count(*)=1 from private.family_media_entitlements where id=first_id),'restore/renew/out-of-order retain one entitlement');
   snap:=snap||'{"auto_renewal_status":"will_not_renew"}';perform public.fb_apply(snap);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','cancel auto-renew retains unexpired access');
   snap:=snap||'{"status":"in_grace_period","gives_access":true}';perform public.fb_apply(snap);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','provider-confirmed bounded grace');
   snap:=snap||'{"status":"in_billing_retry","gives_access":false}';perform public.fb_apply(snap);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='free','retry without access revokes Plus');
   snap:=snap||'{"status":"active","gives_access":true}';perform public.fb_apply(snap);
   g1:=public.start_family_billing_refresh(cust);g2:=public.start_family_billing_refresh(cust);
   perform public.rv2_error(format('select public.apply_family_billing_snapshot(%L,%s,%L::jsonb,null)',cust,g1,snap),'P0001','BILLING_STALE_REFRESH');
   perform public.apply_family_billing_snapshot(cust,g2,snap||'{"status":"expired","gives_access":false}',null);
   perform public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='free','expiry drops only Plus');
   perform public.fb_apply(snap||'{"status":"refunded","gives_access":false}');perform public.fb_apply(snap||'{"status":"revoked","gives_access":false}');
   perform public.rv2_assert((select count(*)=1 from private.family_store_subscriptions),'refund/revoke retain binding');
   perform public.rv2_error(format('select public.fb_apply(%L::jsonb)',(snap||'{"environment":"PRODUCTION"}')::text),'42501','BILLING_SNAPSHOT_DENIED');
   raise exception 'fixture rollback' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null; end;
 end loop;
end; $$;

begin;
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.get_family_billing_customer();select public.fb_begin(public.rv2_id('family'),public.rv2_id('delayed-approved'),'monthly');
select public.update_family_billing_intent(public.rv2_id('delayed-approved'),'store_pending');
update private.family_billing_intents set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '5 minutes' where id=public.rv2_id('delayed-approved');
select public.receive_family_billing_webhook(public.fb_event('delayed-approved','owner','original-delayed'),repeat('a',64));
select public.fb_apply(public.fb_snapshot('original-delayed','owner','delayed-approved')||jsonb_build_object('started_at',clock_timestamp()),'delayed-approved');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','late store approval binds the original pending intent');
rollback;

begin;
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.get_family_billing_customer();select public.fb_begin(public.rv2_id('family'),public.rv2_id('lifecycle'),'monthly');
select public.receive_family_billing_webhook(public.fb_event('lifecycle','owner','original-life'),repeat('a',64));
select public.fb_apply(public.fb_snapshot('original-life','owner','lifecycle'),'lifecycle');
update public.family_members set role='member' where user_id=public.rv2_id('owner');
update public.family_members set role='owner' where user_id=public.rv2_id('member');
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','new Owner inherits rights, not payer');
select public.rv2_error($q$select public.fb_begin(public.rv2_id('family'),public.rv2_id('new-owner-buy'),'monthly')$q$,'P0001','FAMILY_ALREADY_SUBSCRIBED');
delete from public.family_members where user_id=public.rv2_id('owner');
select public.fb_apply(public.fb_snapshot('original-life','owner','lifecycle'));
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','payer exit keeps original Family');
update public.family_members set role='member' where user_id=public.rv2_id('stranger');
insert into public.family_members(family_id,user_id,role) values(public.rv2_id('other'),public.rv2_id('owner'),'owner');
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_error($q$select public.fb_begin(public.rv2_id('other'),public.rv2_id('payer-new-family-buy'),'yearly')$q$,'P0001','BILLING_PAYER_ALREADY_BOUND');
delete from public.family_members where user_id=public.rv2_id('owner');
update public.family_members set role='owner' where user_id=public.rv2_id('stranger');
select set_config('request.jwt.claim.sub',public.rv2_id('stranger')::text,true);
select public.get_family_billing_customer();select public.fb_begin(public.rv2_id('other'),public.rv2_id('steal'),'monthly');
select public.rv2_error($q$select public.fb_apply(public.fb_snapshot('original-life','stranger','steal'))$q$,'42501','BILLING_CHAIN_ALREADY_BOUND');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('other'))->>'tier')='free','second Family cannot claim chain');
create temporary table retained_billing_snapshot on commit drop as select public.fb_snapshot('original-life','owner','lifecycle') snapshot;
delete from auth.users where id=public.rv2_id('owner');
select public.rv2_assert((select user_id is null from private.family_billing_customers where id=(select (snapshot->>'customer_id')::uuid from retained_billing_snapshot)),'account deletion anonymizes user link');
select public.fb_apply(snapshot) from retained_billing_snapshot;
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='plus','renewal survives payer deletion');
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_error('select public.get_family_billing_customer()','42501');
rollback;

begin;
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.get_family_billing_customer();select public.fb_begin(public.rv2_id('family'),public.rv2_id('raced-owner'),'monthly');
select public.receive_family_billing_webhook(public.fb_event('raced-owner','owner','original-owner-race'),repeat('a',64));
update public.family_members set role='member' where user_id=public.rv2_id('owner');update public.family_members set role='owner' where user_id=public.rv2_id('member');
select public.rv2_error($q$select public.fb_apply(public.fb_snapshot('original-owner-race','owner','raced-owner'),'raced-owner')$q$,'P0001','BILLING_BINDING_REVIEW_REQUIRED');
select public.rv2_assert((select count(*)=0 from private.family_media_entitlements),'in-flight Owner transfer requires review');
rollback;

select public.rv2_assert((select count(*)=0 from private.family_store_subscriptions),'billing fixtures rolled back');
select public.rv2_assert((select count(*)=0 from private.family_media_entitlements),'no Sandbox entitlement leaked');
select public.rv2_assert((select storage_enforcement_enabled=false and video_calendar_time_zone is null and video_counting_scope is null from private.family_media_quota_policy),'quota OFF and calendar choices unset');
select 'FAMILY_BILLING_SQL_COMPLETE';

-- Executes only inside the existing disposable billing verifier.
begin;
update private.family_billing_config set enabled=true,environment='SANDBOX',
 rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',
 monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert(public.get_family_billing_customer()=public.rv2_id('owner'),'RC App User ID is authenticated UUID');
select public.rv2_assert(public.get_family_billing_customer()=public.rv2_id('owner'),'stable identity on repeated registration');
select public.rv2_assert(not has_function_privilege('authenticated','private.family_billing_can_charge()','execute'),'client cannot override release readiness');
update private.family_billing_config set environment='PRODUCTION',release_ready=true;
select public.rv2_assert(not private.family_billing_can_charge(),'Production cannot charge while quotas are OFF');
select public.rv2_assert((private.assert_family_billing_sandbox_ready()).environment='PRODUCTION','closing checkout preserves verified provider processing');
select public.rv2_error($q$select public.begin_family_billing_purchase(public.rv2_id('family'),public.rv2_id('not-ready'),'monthly')$q$,'P0001','BILLING_RELEASE_NOT_READY');
select public.rv2_assert((public.get_family_plus_summary(public.rv2_id('family'))->>'billing_environment')='PRODUCTION','summary identifies environment explicitly');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'sandbox_enabled')='false','client payment availability fails closed');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'billing_enabled')='true','renewal processing and subscription management remain available when checkout closes');
-- Wrong-environment provider facts cannot grant Family Plus.
select public.rv2_assert((select count(*)=0 from private.family_media_entitlements),'no grant on rejected release');
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference,billing_environment)
 values(public.rv2_id('family'),'plus',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',false,'synthetic-wrong-environment','SANDBOX');
select public.rv2_assert((public.get_family_plus_summary(public.rv2_id('family'))->>'gives_plus_access')='false','Sandbox grant cannot become Production membership');
select public.rv2_assert((public.get_family_billing_state(public.rv2_id('family'))->>'tier')='free','Sandbox grant cannot inflate Production quota');
delete from private.family_media_entitlements where source_reference='synthetic-wrong-environment';
update private.family_billing_config set environment='SANDBOX',release_ready=false;
select public.rv2_error($q$select public.receive_family_billing_webhook(jsonb_build_object('id','wrong-env','environment','PRODUCTION','app_id','app_fixture','event_timestamp_ms',1),repeat('a',64))$q$,'42501','BILLING_ENVIRONMENT_DENIED');
select public.rv2_assert(not exists(select 1 from private.family_billing_webhook_inbox where event_id='wrong-env'),'wrong environment never enters inbox');
-- Previously created random payer identities are retained, never silently moved.
delete from private.family_billing_customers where user_id=public.rv2_id('owner');
insert into private.family_billing_customers(id,user_id) values(public.rv2_id('legacy-payer'),public.rv2_id('owner'));
select public.rv2_error('select public.get_family_billing_customer()','P0001','BILLING_LEGACY_IDENTITY_REVIEW_REQUIRED');
select public.rv2_assert(exists(select 1 from private.family_billing_customers where id=public.rv2_id('legacy-payer') and user_id=public.rv2_id('owner')),'legacy identity preserved for review');
rollback;
select 'FAMILY_BILLING_RELEASE_COMPLETE';

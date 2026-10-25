-- Synthetic data, disposable blank Supabase only. No real subscription.
begin;
select public.rv2_assert((select provolatile='s' and prosecdef from pg_proc where oid='public.get_family_plus_summary(uuid)'::regprocedure),'stable private-table reader');
select public.rv2_assert(not has_function_privilege('anon','public.get_family_plus_summary(uuid)','execute'),'anonymous denied');
set local role authenticated;
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='free','server Free, no fake subscription');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{usage,used_bytes}' is null,'uninitialized is not zero');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{videos,published}' is null,'unconfigured monthly policy is unknown');
select public.rv2_error($q$select * from private.family_media_entitlements$q$,'42501');
select public.rv2_error($q$select public.get_family_plus_summary(public.rv2_id('other'))$q$,'42501');
reset role;
select private.sync_family_media_objects(public.rv2_id('other'));
delete from public.pets where id=public.rv2_id('other-pet');
select set_config('request.jwt.claim.sub',public.rv2_id('stranger')::text,true);
set local role authenticated;
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('other'))#>>'{usage,used_bytes}'='0','initialized empty Family really zero');
reset role;
insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
select public.rv2_id('photo-'||n),'post-media',public.rv2_id('owner')||'/'||public.rv2_id('pet')||'/'||public.rv2_id('post')||'/'||public.rv2_id('photo-'||n)||'.jpg',
public.rv2_id('owner')::text,'fixture',jsonb_build_object('size',8388608,'mimetype','image/jpeg') from generate_series(1,40) n;
select private.sync_family_media_objects(public.rv2_id('family'));
update private.family_media_objects set pending_cleanup=true where storage_object_id=public.rv2_id('photo-1');
insert into private.family_media_upload_sessions(id,family_id,actor_id,pet_id,post_id,manifest,reserved_bytes,video_slot_held,expires_at,tier_at_reservation)
values(public.rv2_id('reservation'),public.rv2_id('family'),public.rv2_id('owner'),public.rv2_id('pet'),public.rv2_id('unpublished-post'),'[]',128,false,now()+interval '1 hour','free');
select private.refresh_family_media_totals(public.rv2_id('family'));
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
set local role authenticated;
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{usage,used_bytes}'='335544320','trusted registry over Free limit, history retained');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{usage,reserved_bytes}'='128','reservation separate from occupied bytes');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{usage,cleanup_pending_bytes}'='8388608','cleanup does not refund early');
reset role;
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'plus',now()-interval '1 day',now()+interval '1 day',false,'isolated-bounded-grant');
do $$ declare who text; doc jsonb; begin
  foreach who in array array['owner','member','viewer'] loop
    perform set_config('request.jwt.claim.sub',public.rv2_id(who)::text,true);
    doc:=public.get_family_plus_summary(public.rv2_id('family'));
    perform public.rv2_assert(doc->>'role'=who,'canonical reader role');
    perform public.rv2_assert(doc->>'status'='active' and doc->>'gives_plus_access'='true','same Family grant for every role');
    perform public.rv2_assert(doc->>'limit_bytes'='5368709120','5 GiB bounded Plus');
    perform public.rv2_assert(not(doc ?| array['customer_id','billing_uuid','original_transaction_id','rc_subscription_id']),'no payment identity leak');
  end loop;
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',public.rv2_id('removed')::text,true);
select public.rv2_error($q$select public.get_family_plus_summary(public.rv2_id('family'))$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('former')::text,true);
select public.rv2_error($q$select public.get_family_plus_summary(public.rv2_id('family'))$q$,'42501');
reset role;
update private.family_media_entitlements set ends_at=now()-interval '1 hour' where source_reference='isolated-bounded-grant';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='expired','expiry uses server time');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'limit_bytes'='314572800','expired returns Free limit');
update private.family_media_entitlements set ends_at=now()+interval '1 day',revoked_at=now() where source_reference='isolated-bounded-grant';
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='revoked','revoked is not active');
select public.rv2_assert((select count(*)=40 from storage.objects where bucket_id='post-media'),'no deletion on downgrade');
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'transition',now()-interval '1 hour',now()+interval '1 day',false,'isolated-transition');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='transition','transition is not Plus');
-- End the independent administrator/transition cases before linked-store cases.
delete from private.family_media_entitlements where source_reference in('isolated-bounded-grant','isolated-transition');
insert into private.family_billing_customers(id,user_id) values(public.rv2_id('read-customer'),public.rv2_id('owner'));
insert into private.family_billing_intents(id,family_id,customer_id,product_id,status)
values(public.rv2_id('read-intent'),public.rv2_id('family'),public.rv2_id('read-customer'),'synthetic.monthly','fulfilled');
insert into private.family_store_subscriptions(id,environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
values(public.rv2_id('read-sub'),'SANDBOX','APP_STORE','synthetic-chain','synthetic-sub',public.rv2_id('read-customer'),public.rv2_id('family'),public.rv2_id('read-intent'),'synthetic.monthly','in_grace_period',true,'will_renew',now()-interval '1 day',now()+interval '2 hours',1,now());
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference,billing_subscription_id,billing_environment)
values(public.rv2_id('family'),'plus',now()-interval '1 day',now()+interval '2 hours',false,'synthetic-linked-grant',public.rv2_id('read-sub'),'SANDBOX');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='grace','grace mapped from the same stored subscription');
update private.family_store_subscriptions set status='active',auto_renewal_status='will_not_renew' where id=public.rv2_id('read-sub');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='cancelled','cancelled renewal retains verified access');
update private.family_store_subscriptions set gives_access=false where id=public.rv2_id('read-sub');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='unavailable','inconsistent grant does not claim Plus');
update private.family_store_subscriptions set status='refunded' where id=public.rv2_id('read-sub');
update private.family_media_entitlements set revoked_at=now() where source_reference in('synthetic-linked-grant','isolated-transition');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='revoked','verified refund removes display access');
update private.family_store_subscriptions set status='in_billing_retry',access_until=now()-interval '1 minute' where id=public.rv2_id('read-sub');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='expired','retry without grace access is not a revocation or active Plus');
update private.family_media_quota_policy set video_calendar_time_zone='Asia/Hong_Kong',video_counting_scope='all_successful',metering_started_at='2020-01-01';
insert into private.family_video_publications select public.rv2_id('video-'||n),public.rv2_id('family'),public.rv2_id('historical-post-'||n),now(),'free',false from generate_series(1,4) n;
select public.rv2_assert(case when (select video_limit from private.family_media_limits(public.rv2_id('family'),now())) is null
 then public.get_family_plus_summary(public.rv2_id('family'))#>>'{videos,published}' is null
 else public.get_family_plus_summary(public.rv2_id('family'))#>>'{videos,published}'='4' end,'capacity-only release hides monthly count; candidate policy retains publication ledger');
update private.family_media_quota_policy set metering_started_at=now();
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{videos,published}' is null,'partial coverage cannot claim full monthly count');
insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
values(public.rv2_id('late'),'post-media',public.rv2_id('owner')||'/'||public.rv2_id('pet')||'/'||public.rv2_id('post')||'/'||public.rv2_id('late')||'.jpg',public.rv2_id('owner')::text,'late','{"size":4}');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{usage,status}'='pending','late upload pending server settlement');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))#>>'{usage,used_bytes}' is null,'stale scan is not exact usage');
rollback;
-- Force PostgreSQL read-only mode: the endpoint must not lazily initialize rows.
begin read only;
set local role authenticated;
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.get_family_plus_summary(public.rv2_id('family'));
rollback;
select 'FAMILY_PLUS_READ_SQL_PASS';

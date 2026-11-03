-- All writes below run only in the disposable schema clone and roll back.
begin;
set local timezone='America/New_York';
update private.family_billing_config set environment='PRODUCTION';
select public.rv2_assert(not has_function_privilege('authenticated','private.grant_family_media_transition()','execute'), 'no client transition activation RPC');
select public.rv2_assert(not has_table_privilege('authenticated','private.family_media_quota_policy','update'), 'client cannot reset policy clock');

insert into public.families(id) values(public.rv2_id('edge-family'));
insert into public.pets(id,name,species,family_id)
values(public.rv2_id('edge-pet'),'Synthetic boundary pet','dog',public.rv2_id('edge-family'));
insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
select public.rv2_id(label),'post-media',public.rv2_id(actor)||'/'||public.rv2_id(pet)||'/'||public.rv2_id(label||'-post')||'/'||public.rv2_id(label)||'.jpg',
  public.rv2_id(actor)::text,'synthetic',jsonb_build_object('size',bytes)
from (values('over-object','owner','pet',314572801::bigint),
  ('plus-object','stranger','other-pet',419430400::bigint),
  ('edge-object','owner','edge-pet',314572800::bigint)) x(label,actor,pet,bytes);
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('other'),'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '90 days',false,'existing-trusted-plus');

-- Unmeasurable old media cannot silently lose qualification or become zero.
insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
values(public.rv2_id('unknown-size'),'post-media',public.rv2_id('owner')||'/'||public.rv2_id('pet')||'/'||public.rv2_id('unknown-post')||'/'||public.rv2_id('unknown-size')||'.jpg',public.rv2_id('owner')::text,'synthetic','{}');
select public.rv2_error('update private.family_media_quota_policy set storage_enforcement_enabled=true','P0001','TRANSITION_USAGE_NOT_READY');
select public.rv2_assert((select not storage_enforcement_enabled and legacy_transition_started_at is null from private.family_media_quota_policy),'failed snapshot rolls activation back');
set local storage.allow_delete_query='true';
delete from storage.objects where id=public.rv2_id('unknown-size');

update private.family_media_quota_policy set storage_enforcement_enabled=true;
select public.rv2_assert((select legacy_transition_started_at=capacity_epoch from private.family_media_quota_policy),'one common server policy epoch');
select public.rv2_assert((select count(*)=1 from private.family_media_entitlements where source_reference='capacity-policy-transition-v1'),'only existing over-cap Free Family qualifies');
select public.rv2_assert((select starts_at=legacy_transition_started_at and ends_at=starts_at+interval '360 hours'
  and extract(epoch from ends_at-starts_at)=1296000 and not ends_inclusive
  from private.family_media_entitlements cross join private.family_media_quota_policy where source_reference='capacity-policy-transition-v1'),'exact 15x24 hours, exclusive end');
select public.rv2_assert((select tier='transition' from private.family_media_limits(public.rv2_id('family'),clock_timestamp())),'over-cap old Free gets Transition');
select public.rv2_assert((select tier='free' from private.family_media_limits(public.rv2_id('edge-family'),clock_timestamp())),'exactly 300 MiB is not over-cap');
select public.rv2_assert((select tier='plus' and limit_bytes=5368709120 from private.family_media_limits(public.rv2_id('other'),clock_timestamp())),'existing Plus keeps 5 GiB');
select public.rv2_assert((select tier='transition' from private.family_media_limits(public.rv2_id('family'),
  (select ends_at-interval '1 microsecond' from private.family_media_entitlements where source_reference='capacity-policy-transition-v1'))),'last microsecond of day 15');
select public.rv2_assert((select tier='free' and limit_bytes=314572800 from private.family_media_limits(public.rv2_id('family'),
  (select ends_at from private.family_media_entitlements where source_reference='capacity-policy-transition-v1'))),'exact expiry returns Free');
select public.rv2_assert(extract(epoch from ('2026-03-01T12:00:00-05'::timestamptz+interval '360 hours')-'2026-03-01T12:00:00-05'::timestamptz)=1296000,'DST crossing cannot shorten fifteen days');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
create temp table owner_transition as select public.get_family_plus_summary(public.rv2_id('family')) result;
select public.reserve_family_media_upload(public.rv2_id('transition-session'),public.rv2_id('pet'),public.rv2_id('transition-post'),array[public.rv2_id('transition-photo')],null);
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.rv2_assert((select result->'transition' from owner_transition)=public.get_family_plus_summary(public.rv2_id('family'))->'transition','Owner and Member share dates');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='transition','Member reads transition without Pet mirror');
select public.rv2_assert((public.get_family_plus_summary(public.rv2_id('family'))->>'gives_plus_access')::boolean=false,'transition is not paid Plus');
reset role;

-- Upgrading during Transition wins and survives its historical end.
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'plus',clock_timestamp(),clock_timestamp()+interval '90 days',false,'upgrade-during-transition');
select public.rv2_assert((select tier='plus' and limit_bytes=5368709120 from private.family_media_limits(public.rv2_id('family'),
  (select ends_at from private.family_media_entitlements where source_reference='capacity-policy-transition-v1'))),'transition expiry cannot revoke valid Plus');

-- Re-enable, new Family and Pet changes cannot reset or extend the cohort.
create temp table original_window as select starts_at,ends_at from private.family_media_entitlements where source_reference='capacity-policy-transition-v1';
insert into public.families(id) values(public.rv2_id('new-family'));
insert into public.pets(id,name,species,family_id) values(public.rv2_id('second-pet'),'Synthetic second pet','cat',public.rv2_id('family'));
update private.family_media_quota_policy set storage_enforcement_enabled=false;
update private.family_media_quota_policy set storage_enforcement_enabled=true;
select public.rv2_assert((select count(*)=1 from private.family_media_entitlements where source_reference='capacity-policy-transition-v1'),'no repeated grant or new-Family qualification');
select public.rv2_assert((select row(e.starts_at,e.ends_at)=row(w.starts_at,w.ends_at) from private.family_media_entitlements e cross join original_window w where source_reference='capacity-policy-transition-v1'),'original window immutable on reactivation');
select public.rv2_error('update private.family_media_quota_policy set legacy_transition_started_at=clock_timestamp()','P0001','TRANSITION_START_IMMUTABLE');

-- End the independent synthetic upgrade scenario before testing Free expiry.
delete from private.family_media_entitlements where source_reference='upgrade-during-transition';
-- Advance only this synthetic window into the past to exercise real clock paths.
update private.family_media_entitlements set starts_at=clock_timestamp()-interval '361 hours',ends_at=clock_timestamp()-interval '1 hour' where source_reference='capacity-policy-transition-v1';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->>'status'='free','expired Transition is Free, not expired Plus');
select public.rv2_assert(public.get_family_plus_summary(public.rv2_id('family'))->'transition'='null'::jsonb,'expired transition has no live countdown');
select public.rv2_error(format('select public.reserve_family_media_upload(%L,%L,%L,array[%L::uuid],null)',public.rv2_id('expiry-session'),public.rv2_id('pet'),public.rv2_id('expiry-post'),public.rv2_id('expiry-photo')),'P0001','FAMILY_STORAGE_QUOTA_EXCEEDED');
select public.rv2_assert((select count(*)=1 from storage.objects where id=public.rv2_id('over-object')),'over-cap historical media remains readable');
reset role;
select public.rv2_assert((select count(*)=3 from storage.objects),'expiry does not delete any existing media');
select public.rv2_assert((select tier='plus' from private.family_media_limits(public.rv2_id('other'),clock_timestamp())),'unrelated existing Plus unaffected');
rollback;
select public.rv2_assert((select not enabled from private.family_billing_config),'Billing still OFF after rollback');
select public.rv2_assert((select not storage_enforcement_enabled and legacy_transition_started_at is null from private.family_media_quota_policy),'no persistent activation');
select 'FAMILY_MEDIA_TRANSITION_PASS';

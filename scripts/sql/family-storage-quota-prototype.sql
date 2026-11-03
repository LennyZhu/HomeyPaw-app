-- Synthetic helpers exist only in the disposable schema clone.
create function public.fq_id(text) returns uuid language sql immutable as $$
 select overlay(overlay(md5('family-quota:'||$1) placing '4' from 13) placing 'a' from 17)::uuid; $$;
create function public.fq_reserve(label text,video boolean default false) returns jsonb language sql as $$
 select public.reserve_family_media_upload(public.fq_id(label),public.rv2_id('pet'),public.fq_id('post-'||label),
 case when video then '{}'::uuid[] else array[public.fq_id('asset-'||label)] end,
 case when video then public.fq_id('asset-'||label) else null end); $$;
create function public.fq_fill_usage(total bigint) returns void language plpgsql security definer set search_path='' as $$
declare n integer:=0; remaining bigint:=total; amount bigint; object_path text;
begin
 while remaining>0 loop
  amount:=least(remaining,8388608);n:=n+1;
  object_path:=public.rv2_id('owner')::text||'/'||public.rv2_id('pet')::text||'/'||public.fq_id('seed-post')::text||'/'||public.fq_id('seed-'||n)::text||'.jpg';
  insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
  values(public.fq_id('seed-'||n),'post-media',object_path,public.rv2_id('owner')::text,'fixture',jsonb_build_object('size',amount,'mimetype','image/jpeg'));
  remaining:=remaining-amount;
 end loop;
 perform private.sync_family_media_objects(public.rv2_id('family'));
end; $$;
create function public.fq_upload(label text) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
 select public.fq_id('object-'||label||'-'||i.bucket_id),i.bucket_id,i.storage_path,s.actor_id::text,'fixture',
 jsonb_build_object('size',case when i.bucket_id='post-videos' then 24 else 4 end,'mimetype',case when i.bucket_id='post-videos' then 'video/mp4' else 'image/jpeg' end)
 from private.family_media_upload_items i join private.family_media_upload_sessions s on s.id=i.session_id where s.id=public.fq_id(label);
end; $$;
create function public.fq_publish(label text) returns void language plpgsql security definer set search_path='' as $$
declare video jsonb; photo jsonb; p record;
begin
 select * into p from private.family_media_upload_sessions where id=public.fq_id(label);
 -- Test helper reads private fixtures; its caller still exercises real RPC authorization.
 if (p.manifest->>'video_id') is not null then
  select jsonb_build_object('id',p.manifest->>'video_id','storage_path',v.storage_path,'thumbnail_path',t.storage_path,
    'duration_ms',1000,'width',10,'height',10,'mime_type','video/mp4') into video
    from private.family_media_upload_items v join private.family_media_upload_items t on t.session_id=v.session_id
    where v.session_id=p.id and v.bucket_id='post-videos' and t.bucket_id='post-video-thumbnails';
  perform public.create_post_v2(p.post_id,p.pet_id,null,'other',current_date,null,'[]',video);
 else
  select jsonb_agg(jsonb_build_object('id',public.fq_id('asset-'||label),'storage_path',i.storage_path,'position',0,'width',10,'height',10,'mime_type','image/jpeg'))
  into photo from private.family_media_upload_items i where i.session_id=p.id;
  perform public.create_post(p.post_id,p.pet_id,null,'other',current_date,null,photo);
 end if;
end; $$;
-- Fixture helpers are absent from the migration. auth.uid() is still preserved
-- when the helper calls the real public RPCs; no private client table grants.

begin;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'tier')='free','default Free, no entitlement fixture or transition snapshot');
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'video_policy_ready')='false','unresolved calendar/counting/start have no default');
do $$ begin
 if public.get_family_media_quota(public.rv2_id('family'))->>'video_limit' is null then
  perform public.fq_reserve('unconfigured-video',true);
 else perform public.rv2_error($q$select public.fq_reserve('unconfigured-video',true)$q$,'P0001','QUOTA_VIDEO_POLICY_NOT_CONFIGURED'); end if;
end; $$;
select public.rv2_error($q$update private.family_media_entitlements set tier='plus'$q$,'42501');
select public.rv2_error($q$select public.reconcile_family_media_usage(public.rv2_id('family'))$q$,'42501');
rollback;

-- Each quota boundary test rolls back, including synthetic Storage rows.
do $$ declare tier text; cap bigint; result jsonb; begin
 foreach tier in array array['free','transition','plus'] loop
  begin
   cap:=case tier when 'free' then 314572800 when 'transition' then 1073741824 else 5368709120 end;
   if tier<>'free' then insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
    values(public.rv2_id('family'),tier,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',false,'isolated fixture'); end if;
   perform public.fq_fill_usage(cap-8388608);
   perform set_config('request.jwt.claim.role','authenticated',true);
   perform set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
   result:=public.fq_reserve('boundary-'||tier);
   perform public.rv2_assert((result->>'reserved_bytes')::bigint=8388608,tier||' exact cap admits one conservative photo reservation');
   perform public.rv2_error(format('select public.fq_reserve(%L)', 'overflow-'||tier),'P0001','FAMILY_STORAGE_QUOTA_EXCEEDED');
   raise exception 'fixture rollback' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null; end;
 end loop;
end; $$;

-- Explicit test policy; NOT a product default or a Production activation.
update private.family_media_quota_policy set video_calendar_time_zone='Asia/Hong_Kong',video_counting_scope='all_successful',metering_started_at='2020-01-01';
begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.fq_reserve('video-1',true);
select public.fq_reserve('video-2',true);
select public.fq_reserve('video-3',true);
do $$ begin
 if public.get_family_media_quota(public.rv2_id('family'))->>'video_limit' is null then
  perform public.fq_reserve('video-4',true);
 else perform public.rv2_error($q$select public.fq_reserve('video-4',true)$q$,'P0001','FAMILY_VIDEO_QUOTA_EXCEEDED'); end if;
end; $$;
select public.fq_reserve('video-1',true);
reset role;
select public.rv2_assert((select count(*)=case when (select video_limit from private.family_media_limits(public.rv2_id('family'),now())) is null then 4 else 3 end from private.family_media_upload_sessions),'idempotent retry does not reserve twice');
set local role authenticated;
select public.cancel_family_media_upload(public.fq_id('video-3'));
do $$ begin
 if public.get_family_media_quota(public.rv2_id('family'))->>'video_limit' is null then
  perform public.fq_reserve('video-4',true);
 else perform public.rv2_error($q$select public.fq_reserve('video-4',true)$q$,'P0001','FAMILY_VIDEO_QUOTA_EXCEEDED'); end if;
end; $$;
reset role;
select public.release_closed_family_media_upload(public.fq_id('video-3'));
select public.release_closed_family_media_upload(public.fq_id('video-3'));
set local role authenticated;
select public.fq_reserve('video-4',true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'video_spent')::int=0,'failed/canceled/unpublished sessions never consume permanent publication count');
select public.fq_upload('video-1');
select public.settle_family_media_upload(public.fq_id('video-1'));
select public.settle_family_media_upload(public.fq_id('video-1'));
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'used_bytes')::bigint=28,'trusted actual size, not client size, settled once');
select public.fq_publish('video-1');
set constraints all immediate;
select public.settle_family_media_upload(public.fq_id('video-1'));
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'video_spent')::int=1,'successful commit records one publication');
reset role;
select public.rv2_assert((select count(*)=1 from private.family_video_publications),'duplicate finalize does not change first publication');
select public.rv2_error($q$select public.queue_closed_family_media_cleanup(public.fq_id('video-1'))$q$,'P0001','UPLOAD_TRANSPORT_STILL_ACTIVE');
select public.rv2_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.fq_id('post-video-1')),'no duplicate Journal Push');
-- The actual video edit RPC keeps an unchanged video identity in place.
create temporary table retained_publication on commit drop as select * from private.family_video_publications;
select public.update_post_v2(public.fq_id('post-video-1'),'Synthetic edit','other',current_date,null,'[]',to_jsonb(v))
 from public.post_videos v where post_id=public.fq_id('post-video-1');
select public.rv2_assert(not exists(select * from private.family_video_publications except select * from retained_publication),'retained edit does not rewrite first publication');
select public.rv2_assert((select count(*)=0 from public.media_cleanup_jobs where completed_at is null),'retained edit does not enqueue physical cleanup');
select public.rv2_assert((select used_bytes=28 from private.family_media_usage where family_id=public.rv2_id('family')),'retained edit does not duplicate physical usage');
delete from public.posts where id=public.fq_id('post-video-1');
select public.rv2_assert((select count(*)=2 from public.media_cleanup_jobs where completed_at is null),'delete enqueues video plus thumbnail');
select public.rv2_assert((select used_bytes=28 from private.family_media_usage where family_id=public.rv2_id('family')),'DB reference deletion alone does not release physical bytes');
select public.rv2_assert((select count(*)=1 from private.family_video_publications),'delete does not refund video count');
select public.rv2_error($q$select public.acknowledge_family_media_deletion(public.fq_id('object-video-1-post-videos'))$q$,'P0001','STORAGE_DELETE_NOT_CONFIRMED');
-- These rows contain no binary files and exist only in the disposable DB.
-- Real transport deletion is separately tested through the Storage API.
set local storage.allow_delete_query='true';
delete from storage.objects where id in(public.fq_id('object-video-1-post-videos'),public.fq_id('object-video-1-post-video-thumbnails'));
update public.media_cleanup_jobs set completed_at=clock_timestamp() where source_post_id=public.fq_id('post-video-1');
select public.acknowledge_family_media_deletion(public.fq_id('object-video-1-post-videos'));
select public.rv2_assert((select used_bytes=0 from private.family_media_usage where family_id=public.rv2_id('family')),'trusted cleanup acknowledgement refunds bytes exactly once');
rollback;

begin;
-- Unlimited Transition and Plus reservations remain within their storage caps.
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'transition',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',false,'isolated transition');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.fq_reserve('transition-1',true);select public.fq_reserve('transition-2',true);
select public.fq_reserve('transition-3',true);select public.fq_reserve('transition-4',true);
select public.fq_reserve('transition-5',true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'tier')='transition','Member without Pet mirror shares Family Transition');
reset role;
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',false,'isolated Plus');
set local role authenticated;
select public.fq_reserve('plus-6',true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'tier')='plus','Plus takes priority and has no monthly segment limit');
reset role;
delete from private.family_media_entitlements where tier='plus';
update public.family_members set role='member' where user_id=public.rv2_id('owner');
update public.family_members set role='owner' where user_id=public.rv2_id('member');
select public.rv2_assert((select tier='transition' from private.family_media_limits(public.rv2_id('family'),clock_timestamp())),'Owner transfer leaves entitlement bound to Family');
update private.family_media_entitlements set revoked_at=clock_timestamp();
select public.rv2_assert((select count(*)=6 from private.family_media_upload_sessions),'downgrade never erases existing reservations or data');
rollback;

begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('viewer')::text,true);
select public.get_family_media_quota(public.rv2_id('family'));
select public.rv2_error($q$select public.fq_reserve('viewer')$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('removed')::text,true);
select public.rv2_error($q$select public.fq_reserve('removed')$q$,'42501');
select public.rv2_error($q$select public.get_family_media_quota(public.rv2_id('family'))$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('former')::text,true);
select public.rv2_error($q$select public.fq_reserve('former')$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.rv2_error($q$select public.reserve_family_media_upload(public.fq_id('cross'),public.rv2_id('other-pet'),public.fq_id('cross-post'),array[public.fq_id('cross-photo')])$q$,'42501');
select set_config('request.jwt.claim.sub',public.rv2_id('stranger')::text,true);
select public.reserve_family_media_upload(public.fq_id('other'),public.rv2_id('other-pet'),public.fq_id('other-post'),array[public.fq_id('other-photo')]);
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'reserved_bytes')::bigint=0,'cross-Family usage isolated');
select public.rv2_error($q$select public.settle_family_media_upload(public.fq_id('other'))$q$,'42501');
rollback;

begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.fq_reserve('late',true);
reset role;
update private.family_media_upload_sessions set expires_at=clock_timestamp()-interval '1 second' where id=public.fq_id('late');
select public.fq_upload('late');
select public.reconcile_family_media_usage(public.rv2_id('family'));
set local role authenticated;
select public.rv2_error($q$select public.settle_family_media_upload(public.fq_id('late'))$q$,'P0001','UPLOAD_SESSION_NOT_ACTIVE');
select public.rv2_error($q$select public.release_closed_family_media_upload(public.fq_id('late'))$q$,'42501');
reset role;
select public.rv2_error($q$select public.release_closed_family_media_upload(public.fq_id('late'))$q$,'P0001','UPLOAD_CLEANUP_REQUIRED');
select public.rv2_assert((select count(*)=0 from private.family_video_publications),'late uncommitted upload has no spent video');
select public.rv2_assert((select used_bytes=28 from private.family_media_usage where family_id=public.rv2_id('family')),'late orphan bytes remain charged until cleanup');
select public.queue_closed_family_media_cleanup(public.fq_id('late'));
select public.queue_closed_family_media_cleanup(public.fq_id('late'));
select public.rv2_assert((select count(*)=2 from public.media_cleanup_jobs where source_post_id=public.fq_id('post-late') and completed_at is null),'closed abandoned session reuses existing cleanup queue idempotently');
set local storage.allow_delete_query='true';
delete from storage.objects where id in(public.fq_id('object-late-post-videos'),public.fq_id('object-late-post-video-thumbnails'));
update public.media_cleanup_jobs set completed_at=clock_timestamp() where source_post_id=public.fq_id('post-late');
select public.release_closed_family_media_upload(public.fq_id('late'));
select public.rv2_assert((select used_bytes=0 and reserved_bytes=0 from private.family_media_usage where family_id=public.rv2_id('family')),'closed orphan cleanup releases actual and reserved bytes');
select public.rv2_assert((select count(*)=0 from private.family_video_publications),'cleaned failed upload still has no spent video');
rollback;

begin;
insert into storage.objects(id,bucket_id,name,metadata) values
 (public.fq_id('unmapped'),'post-media','malformed-orphan.jpg','{"size":4}'),
 (public.fq_id('later-mapping'),'post-media',public.rv2_id('owner')::text||'/'||public.fq_id('later-pet')::text||'/'||public.fq_id('later-post')::text||'/'||public.fq_id('later-photo')::text||'.jpg','{}'),
 (public.fq_id('unknown-size'),'post-media',public.rv2_id('owner')::text||'/'||public.rv2_id('pet')::text||'/'||public.fq_id('unknown-post')::text||'/'||public.fq_id('unknown-photo')::text||'.jpg','{}');
select public.reconcile_family_media_usage(public.rv2_id('family'));
select public.rv2_assert(exists(select 1 from private.family_media_measurement_errors where storage_object_id=public.fq_id('unmapped') and reason='UNMAPPABLE_FAMILY'),'unmappable orphans are quarantined rather than assigned to a random Family');
select public.rv2_assert((select measurement_errors=1 from private.family_media_usage where family_id=public.rv2_id('family')),'missing actual bytes are not guessed');
insert into public.pets(id,name,species,family_id) values(public.fq_id('later-pet'),'Synthetic later mapping','dog',public.rv2_id('family'));
select public.reconcile_family_media_usage(public.rv2_id('family'));
select public.rv2_assert((select measurement_errors=2 from private.family_media_usage where family_id=public.rv2_id('family')),'newly mapped missing-size object fails closed for its Family');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_error($q$select public.fq_reserve('unknown-metering')$q$,'P0001','QUOTA_MEASUREMENT_UNAVAILABLE');
rollback;

begin;
-- Scope is only Journal: both kinds of avatar stay outside paid storage.
insert into storage.objects(id,bucket_id,name,owner_id,metadata) values
 (public.fq_id('profile-avatar'),'profile-avatars',public.rv2_id('owner')::text||'/avatar.jpg',public.rv2_id('owner')::text,'{"size":1048576}'),
 (public.fq_id('pet-avatar'),'pet-avatars',public.rv2_id('owner')::text||'/'||public.rv2_id('pet')::text||'/avatar.jpg',public.rv2_id('owner')::text,'{"size":1048576}');
select public.reconcile_family_media_usage(public.rv2_id('family'));
select public.rv2_assert((select used_bytes=0 from private.family_media_usage where family_id=public.rv2_id('family')),'avatars are excluded');
update auth.users set raw_user_meta_data=raw_user_meta_data||'{"isPlus":true}'::jsonb where id=public.rv2_id('owner');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'tier')='free','user metadata cannot grant Plus');
reset role;
delete from public.pets where id=public.rv2_id('other-pet');
set local role authenticated;
select set_config('request.jwt.claim.sub',public.rv2_id('stranger')::text,true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('other'))->>'used_bytes')::bigint=0,'zero-Pet Family can read quota');
rollback;

begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.fq_reserve('failed-post',true);
select public.rv2_error($q$select public.fq_publish('failed-post')$q$,'22023');
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'video_spent')::int=0,'failed Post commit spends no permanent slot');
reset role;
select public.rv2_assert(not exists(select 1 from public.posts where id=public.fq_id('post-failed-post')),'failed publication leaves no Post');
select public.rv2_assert((select video_slot_held from private.family_media_upload_sessions where id=public.fq_id('failed-post')),'retry retains existing temporary slot');
rollback;

begin;
-- Lowering a quota cannot block historical reads or text-only publication.
select public.fq_fill_usage(314572801);
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.create_post(public.fq_id('text-over-quota'),public.rv2_id('pet'),'Synthetic text','other',current_date,null,'[]');
select public.rv2_assert(exists(select 1 from public.posts where id=public.fq_id('text-over-quota')),'overquota text-only Journal remains free');
select public.rv2_error($q$select public.fq_reserve('overquota')$q$,'P0001','FAMILY_STORAGE_QUOTA_EXCEEDED');
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'used_bytes')::bigint=314572801,'overquota historical objects remain accounted and retained');
rollback;

-- Scope/boundary options are data, not silently fixed product rules.
begin;
insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
values(public.rv2_id('family'),'transition','2026-01-01','2026-01-31',false,'boundary fixture');
select public.rv2_assert((select tier='transition' from private.family_media_limits(public.rv2_id('family'),'2026-01-30T23:59:59.999999Z')),'exclusive end before boundary');
select public.rv2_assert((select tier='free' from private.family_media_limits(public.rv2_id('family'),'2026-01-31')),'exclusive end at boundary');
update private.family_media_entitlements set ends_inclusive=true;
select public.rv2_assert((select tier='transition' from private.family_media_limits(public.rv2_id('family'),'2026-01-31')),'inclusive end is explicitly configurable');
insert into private.family_video_publications values(public.fq_id('past-transition'),public.rv2_id('family'),public.fq_id('past-post'),clock_timestamp(),'transition',true);
select public.rv2_assert((select counting_scope='all_successful' from private.family_media_video_period(clock_timestamp())),'all-successful test policy');
update private.family_media_quota_policy set video_counting_scope='free_only';
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.rv2_assert((public.get_family_media_quota(public.rv2_id('family'))->>'video_spent')::int=0,'alternative Free-only downgrade accounting can be evaluated');
reset role;
select public.rv2_assert((select period_end='2026-02-28T16:00:00Z'::timestamptz from private.family_media_video_period('2026-02-28T15:59:59Z')),'explicit Hong Kong month ends at local midnight');
select public.rv2_assert((select period_start='2026-02-28T16:00:00Z'::timestamptz from private.family_media_video_period('2026-02-28T16:00:00Z')),'explicit Hong Kong month starts at local midnight');
rollback;

select public.rv2_assert((select storage_enforcement_enabled=false from private.family_media_quota_policy),'global Storage enforcement OFF');
select public.rv2_assert((select count(*)=0 from private.family_media_entitlements),'no test entitlement leaked outside rollback');
select public.rv2_assert(not has_function_privilege('authenticated','public.acknowledge_family_media_deletion(uuid)','EXECUTE'),'client cannot forge cleanup acknowledgement');
select public.rv2_assert(not has_function_privilege('authenticated','public.queue_closed_family_media_cleanup(uuid)','EXECUTE'),'client cannot enqueue abandonment cleanup');

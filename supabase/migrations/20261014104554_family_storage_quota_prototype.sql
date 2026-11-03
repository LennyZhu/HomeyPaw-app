-- Phase 2 prototype. No Storage policy/trigger or legacy RPC changes.
-- Global enforcement cannot be enabled by this migration. Product boundaries
-- remain NULL until a reviewed server configuration chooses them.
create table private.family_media_quota_policy (
  singleton boolean primary key default true check(singleton),
  storage_enforcement_enabled boolean not null default false check(not storage_enforcement_enabled),
  video_calendar_time_zone text,
  video_counting_scope text check(video_counting_scope in('all_successful','free_only')),
  metering_started_at timestamptz
);
insert into private.family_media_quota_policy(singleton) values(true);

create table private.family_media_entitlements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  tier text not null check(tier in('transition','plus')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(isfinite(ends_at) and ends_at>starts_at),
  ends_inclusive boolean not null,
  source_reference text not null,
  revoked_at timestamptz
);
create index family_media_entitlements_family on private.family_media_entitlements(family_id,ends_at) where revoked_at is null;

-- Deliberately retain Family UUIDs across a canonical Family/Pet deletion until
-- physical cleanup is acknowledged. No FK may block or erase legacy lifecycle.
create table private.family_media_usage (
  family_id uuid primary key,
  used_bytes bigint not null default 0 check(used_bytes>=0),
  reserved_bytes bigint not null default 0 check(reserved_bytes>=0),
  measurement_errors integer not null default 0,
  reconciled_at timestamptz
);
create table private.family_media_objects (
  storage_object_id uuid primary key,
  family_id uuid not null,
  bucket_id text not null check(bucket_id in('post-media','post-videos','post-video-thumbnails')),
  storage_path text not null,
  storage_version text,
  bytes bigint not null check(bytes>=0),
  referenced boolean not null default false,
  pending_cleanup boolean not null default false,
  first_seen_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create unique index family_media_objects_live_path on private.family_media_objects(bucket_id,storage_path) where deleted_at is null;
create index family_media_objects_usage on private.family_media_objects(family_id) where deleted_at is null;
create table private.family_media_measurement_errors (
  storage_object_id uuid primary key,
  family_id uuid,
  reason text not null
);

create table private.family_media_upload_sessions (
  id uuid primary key,
  family_id uuid not null,
  actor_id uuid not null,
  pet_id uuid not null,
  post_id uuid not null,
  manifest jsonb not null,
  status text not null default 'reserved' check(status in('reserved','uploaded','published','cancel_requested','expired','released')),
  reserved_bytes bigint not null check(reserved_bytes>=0),
  video_slot_held boolean not null,
  reserved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  tier_at_reservation text not null,
  published_at timestamptz,
  transport_closed_at timestamptz
);
create index family_media_sessions_held on private.family_media_upload_sessions(family_id,reserved_at) where video_slot_held;
create table private.family_media_upload_items (
  session_id uuid not null references private.family_media_upload_sessions(id) on delete cascade,
  bucket_id text not null,
  storage_path text not null,
  max_bytes bigint not null check(max_bytes>0),
  settled_object_id uuid,
  primary key(bucket_id,storage_path)
);
create index family_media_items_session on private.family_media_upload_items(session_id);

-- Durable successful-publication facts, not a count of remaining post_videos.
-- No Post/Auth/Family cascade can refund a spent video or erase its first time.
create table private.family_video_publications (
  storage_object_id uuid primary key,
  family_id uuid not null,
  post_id uuid not null,
  published_at timestamptz not null,
  tier_at_publication text not null,
  legacy_observation boolean not null
);
create index family_video_publications_month on private.family_video_publications(family_id,published_at);

create function private.family_media_limits(target_family uuid, at_time timestamptz)
returns table(tier text,limit_bytes bigint,video_limit integer)
language sql stable security definer set search_path='' as $$
  select chosen.tier,case chosen.tier when 'plus' then 5368709120::bigint
    when 'transition' then 1073741824::bigint else 314572800::bigint end,
    case when chosen.tier='free' then 3 else null::integer end
  from (select coalesce((select e.tier from private.family_media_entitlements e
    where e.family_id=target_family and e.revoked_at is null and e.starts_at<=at_time
      and (at_time<e.ends_at or (e.ends_inclusive and at_time=e.ends_at))
    order by case e.tier when 'plus' then 0 else 1 end,e.ends_at desc limit 1),'free') tier) chosen;
$$;

create function private.lock_family_media_usage(target_family uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  insert into private.family_media_usage(family_id) values(target_family) on conflict do nothing;
  perform 1 from private.family_media_usage where family_id=target_family for update;
end; $$;

create function private.refresh_family_media_totals(target_family uuid)
returns void language sql security definer set search_path='' as $$
  update private.family_media_usage set
    used_bytes=(select coalesce(sum(bytes),0) from private.family_media_objects where family_id=target_family and deleted_at is null),
    reserved_bytes=(select coalesce(sum(reserved_bytes),0) from private.family_media_upload_sessions where family_id=target_family),
    measurement_errors=(select count(*) from private.family_media_measurement_errors where family_id=target_family),
    reconciled_at=clock_timestamp()
  where family_id=target_family;
$$;

create function private.sync_family_media_objects(target_family uuid)
returns void language plpgsql security definer set search_path='' as $$
declare obj record; mapped_family uuid; obj_bytes bigint;
begin
  perform private.lock_family_media_usage(target_family);
  insert into private.family_media_measurement_errors(storage_object_id,family_id,reason)
    select o.id,null,'UNMAPPABLE_FAMILY' from storage.objects o
    left join private.family_media_objects r on r.storage_object_id=o.id
    left join public.pets p on p.id=case when o.bucket_id='post-media'
      then private.post_media_pet_id(o.name) else private.journal_video_path_uuid(o.name,2) end
    where o.bucket_id in('post-media','post-videos','post-video-thumbnails') and coalesce(r.family_id,p.family_id) is null
    on conflict do nothing;
  for obj in
    select o.*,coalesce(r.family_id,p.family_id) mapped_family
    from storage.objects o
    left join private.family_media_objects r on r.storage_object_id=o.id
    left join public.pets p on p.id=case when o.bucket_id='post-media'
      then private.post_media_pet_id(o.name) else private.journal_video_path_uuid(o.name,2) end
    where o.bucket_id in('post-media','post-videos','post-video-thumbnails')
      and coalesce(r.family_id,p.family_id)=target_family order by o.id
  loop
    mapped_family:=obj.mapped_family;
    if obj.metadata->>'size' is null or (obj.metadata->>'size')!~'^[0-9]{1,18}$' then
      insert into private.family_media_measurement_errors values(obj.id,mapped_family,'MISSING_OR_INVALID_SIZE')
        on conflict(storage_object_id) do update set family_id=excluded.family_id,reason=excluded.reason;
      continue;
    end if;
    obj_bytes:=(obj.metadata->>'size')::bigint;
    delete from private.family_media_measurement_errors where storage_object_id=obj.id;
    -- A missing old generation is not silently refunded by a metadata scan.
    if exists(select 1 from private.family_media_objects where bucket_id=obj.bucket_id and storage_path=obj.name
      and deleted_at is null and storage_object_id<>obj.id) then
      insert into private.family_media_measurement_errors values(obj.id,mapped_family,'UNACKNOWLEDGED_REPLACEMENT') on conflict do nothing;
      continue;
    end if;
    insert into private.family_media_objects(storage_object_id,family_id,bucket_id,storage_path,storage_version,bytes,referenced,pending_cleanup)
    values(obj.id,mapped_family,obj.bucket_id,obj.name,obj.version,obj_bytes,
      exists(select 1 from public.post_media m where obj.bucket_id='post-media' and m.storage_path=obj.name)
      or exists(select 1 from public.post_videos v where (obj.bucket_id='post-videos' and v.storage_path=obj.name)
        or (obj.bucket_id='post-video-thumbnails' and v.thumbnail_path=obj.name)),
      exists(select 1 from public.media_cleanup_jobs j where j.bucket_id=obj.bucket_id and j.storage_path=obj.name and j.completed_at is null))
    on conflict(storage_object_id) do update set bytes=excluded.bytes,referenced=excluded.referenced,
      pending_cleanup=excluded.pending_cleanup,storage_version=excluded.storage_version;
    update private.family_media_upload_items i set settled_object_id=obj.id
      from private.family_media_upload_sessions s where s.id=i.session_id and s.family_id=target_family
        and i.bucket_id=obj.bucket_id and i.storage_path=obj.name and obj_bytes<=i.max_bytes;
  end loop;
  update private.family_media_upload_sessions set status='expired' where family_id=target_family
    and status in('reserved','uploaded') and clock_timestamp()>=expires_at;
  update private.family_media_upload_sessions s set reserved_bytes=(select coalesce(sum(i.max_bytes),0)
    from private.family_media_upload_items i where i.session_id=s.id and i.settled_object_id is null),
    status=case when s.status='reserved' and not exists(select 1 from private.family_media_upload_items i where i.session_id=s.id and i.settled_object_id is null)
      then 'uploaded' else s.status end
    where s.family_id=target_family and s.status<>'released';
  perform private.refresh_family_media_totals(target_family);
end; $$;

create function private.family_media_video_period(at_time timestamptz)
returns table(period_start timestamptz,period_end timestamptz,counting_scope text,metering_start timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare cfg private.family_media_quota_policy;
begin
  select * into cfg from private.family_media_quota_policy where singleton;
  if cfg.video_calendar_time_zone is null or cfg.video_counting_scope is null or cfg.metering_started_at is null then
    raise exception 'QUOTA_VIDEO_POLICY_NOT_CONFIGURED' using errcode='P0001';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=cfg.video_calendar_time_zone) then
    raise exception 'QUOTA_VIDEO_TIME_ZONE_INVALID' using errcode='22023';
  end if;
  return query select date_trunc('month',at_time at time zone cfg.video_calendar_time_zone) at time zone cfg.video_calendar_time_zone,
    (date_trunc('month',at_time at time zone cfg.video_calendar_time_zone)+interval '1 month') at time zone cfg.video_calendar_time_zone,
    cfg.video_counting_scope,cfg.metering_started_at;
end; $$;

create function private.assert_family_video_slot(target_family uuid,excluding_session uuid,at_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare lim record; period record; spent bigint; held bigint;
begin
  select * into lim from private.family_media_limits(target_family,at_time);
  if lim.video_limit is null then return; end if;
  select * into period from private.family_media_video_period(at_time);
  select count(*) into spent from private.family_video_publications v where v.family_id=target_family
    and v.published_at>=greatest(period.period_start,period.metering_start) and v.published_at<period.period_end
    and (period.counting_scope='all_successful' or v.tier_at_publication='free');
  select count(*) into held from private.family_media_upload_sessions s where s.family_id=target_family
    and s.video_slot_held and s.id is distinct from excluding_session
    and s.reserved_at>=period.period_start and s.reserved_at<period.period_end;
  if spent+held>=lim.video_limit then raise exception 'FAMILY_VIDEO_QUOTA_EXCEEDED' using errcode='P0001'; end if;
end; $$;

create function public.get_family_media_quota(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim record; cfg private.family_media_quota_policy; usage private.family_media_usage; spent bigint; period record;
begin
  if not exists(select 1 from public.family_members where family_id=target_family_id and user_id=auth.uid()) then
    raise exception 'family not found' using errcode='42501';
  end if;
  select * into lim from private.family_media_limits(target_family_id,statement_timestamp());
  select * into cfg from private.family_media_quota_policy where singleton;
  select * into usage from private.family_media_usage where family_id=target_family_id;
  select null::timestamptz period_start,null::timestamptz period_end into period;
  if cfg.video_calendar_time_zone is not null and cfg.video_counting_scope is not null and cfg.metering_started_at is not null then
    select * into period from private.family_media_video_period(statement_timestamp());
    select count(*) into spent from private.family_video_publications where family_id=target_family_id
      and published_at>=greatest(period.period_start,period.metering_start) and published_at<period.period_end
      and (period.counting_scope='all_successful' or tier_at_publication='free');
  end if;
  return jsonb_build_object('family_id',target_family_id,'tier',lim.tier,'limit_bytes',lim.limit_bytes,
    'used_bytes',coalesce(usage.used_bytes,0),'reserved_bytes',coalesce(usage.reserved_bytes,0),
    'measurement_errors',coalesce(usage.measurement_errors,0),'reconciled_at',usage.reconciled_at,
    'video_limit',lim.video_limit,'video_spent',spent,'video_period_start',period.period_start,
    'storage_enforcement_enabled',cfg.storage_enforcement_enabled,
    'video_policy_ready',cfg.video_calendar_time_zone is not null and cfg.video_counting_scope is not null and cfg.metering_started_at is not null);
end; $$;

create function public.reserve_family_media_upload(request_id uuid,target_pet_id uuid,target_post_id uuid,
  photo_ids uuid[] default '{}',video_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fam uuid; existing private.family_media_upload_sessions; manifest jsonb; lim record;
  total bigint:=0; one_id uuid; at_time timestamptz; stem text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select p.family_id into fam from public.pets p join public.family_members m on m.family_id=p.family_id
    where p.id=target_pet_id and m.user_id=auth.uid() and m.role in('owner','member') for share of m;
  if fam is null then raise exception 'pet not found' using errcode='42501'; end if;
  if request_id is null or target_post_id is null or photo_ids is null or cardinality(photo_ids)>9
    or array_position(photo_ids,null) is not null or cardinality(photo_ids)<>(select count(distinct x) from unnest(photo_ids)x)
    or (video_id is not null and cardinality(photo_ids)>0) or (video_id is null and cardinality(photo_ids)=0) then
    raise exception 'invalid upload manifest' using errcode='22023';
  end if;
  if exists(select 1 from public.posts where id=target_post_id and (pet_id<>target_pet_id or author_id is distinct from auth.uid())) then
    raise exception 'post not found' using errcode='42501';
  end if;
  manifest:=jsonb_build_object('photo_ids',photo_ids,'video_id',video_id);
  perform private.lock_family_media_usage(fam);
  select * into existing from private.family_media_upload_sessions where id=request_id for update;
  if existing.id is not null then
    if existing.actor_id<>auth.uid() or existing.family_id<>fam or existing.pet_id<>target_pet_id or existing.post_id<>target_post_id
      or existing.manifest<>manifest then raise exception 'UPLOAD_IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return jsonb_build_object('session_id',existing.id,'status',existing.status,'reserved_bytes',existing.reserved_bytes,'expires_at',existing.expires_at);
  end if;
  perform private.sync_family_media_objects(fam);
  if (select measurement_errors from private.family_media_usage where family_id=fam)>0 then
    raise exception 'QUOTA_MEASUREMENT_UNAVAILABLE' using errcode='P0001';
  end if;
  at_time:=clock_timestamp();
  select * into lim from private.family_media_limits(fam,at_time);
  total:=case when video_id is not null then 26214400+2097152 else cardinality(photo_ids)::bigint*8388608 end;
  if (select used_bytes+reserved_bytes+total from private.family_media_usage where family_id=fam)>lim.limit_bytes then
    raise exception 'FAMILY_STORAGE_QUOTA_EXCEEDED' using errcode='P0001';
  end if;
  if video_id is not null then perform private.assert_family_video_slot(fam,null,at_time); end if;
  insert into private.family_media_upload_sessions(id,family_id,actor_id,pet_id,post_id,manifest,reserved_bytes,video_slot_held,expires_at,tier_at_reservation)
  values(request_id,fam,auth.uid(),target_pet_id,target_post_id,manifest,total,video_id is not null,at_time+interval '24 hours',lim.tier);
  stem:=auth.uid()::text||'/'||target_pet_id::text||'/'||target_post_id::text||'/';
  if video_id is not null then
    insert into private.family_media_upload_items values(request_id,'post-videos',stem||video_id::text||'.mp4',26214400,null),
      (request_id,'post-video-thumbnails',stem||video_id::text||'.jpg',2097152,null);
  else
    foreach one_id in array photo_ids loop
      insert into private.family_media_upload_items values(request_id,'post-media',stem||one_id::text||'.jpg',8388608,null);
    end loop;
  end if;
  perform private.refresh_family_media_totals(fam);
  return jsonb_build_object('session_id',request_id,'status','reserved','reserved_bytes',total,'expires_at',at_time+interval '24 hours');
end; $$;

create function public.settle_family_media_upload(target_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare session private.family_media_upload_sessions; fam uuid;
begin
  select family_id into fam from private.family_media_upload_sessions where id=target_session_id and actor_id=auth.uid();
  if fam is null then raise exception 'upload not found' using errcode='42501'; end if;
  perform 1 from public.family_members where family_id=fam and user_id=auth.uid() and role in('owner','member') for share;
  if not found then raise exception 'upload not found' using errcode='42501'; end if;
  perform private.lock_family_media_usage(fam);
  select * into session from private.family_media_upload_sessions where id=target_session_id for update;
  if session.status='published' then return jsonb_build_object('status','published'); end if;
  if session.status not in('reserved','uploaded') or clock_timestamp()>=session.expires_at then
    raise exception 'UPLOAD_SESSION_NOT_ACTIVE' using errcode='P0001'; end if;
  if exists(select 1 from private.family_media_upload_items i join storage.objects o on o.bucket_id=i.bucket_id and o.name=i.storage_path
    where i.session_id=target_session_id and (o.owner_id is distinct from auth.uid()::text or (o.metadata->>'size')::bigint>i.max_bytes)) then
    raise exception 'UPLOAD_OBJECT_INVALID' using errcode='22023'; end if;
  perform private.sync_family_media_objects(fam);
  select * into session from private.family_media_upload_sessions where id=target_session_id;
  return jsonb_build_object('status',session.status,'reserved_bytes',session.reserved_bytes,
    'actual_bytes',(select coalesce(sum(o.bytes),0) from private.family_media_upload_items i join private.family_media_objects o on o.storage_object_id=i.settled_object_id where i.session_id=target_session_id));
end; $$;

create function public.cancel_family_media_upload(target_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare fam uuid; s private.family_media_upload_sessions;
begin
  select family_id into fam from private.family_media_upload_sessions where id=target_session_id and actor_id=auth.uid();
  if fam is null or not exists(select 1 from public.family_members where family_id=fam and user_id=auth.uid() and role in('owner','member')) then
    raise exception 'upload not found' using errcode='42501'; end if;
  perform private.lock_family_media_usage(fam);
  select * into s from private.family_media_upload_sessions where id=target_session_id for update;
  if s.status='published' then raise exception 'UPLOAD_ALREADY_PUBLISHED' using errcode='P0001'; end if;
  if s.status='released' then return; end if;
  -- Cancellation is not evidence that a TUS capability has been terminated.
  update private.family_media_upload_sessions set status='cancel_requested' where id=target_session_id;
end; $$;

-- Read-only helper for isolated transport experiments. This migration DOES NOT
-- attach it to Storage RLS; old 1.3.0 uploads stay unchanged.
create function private.can_use_family_media_reservation(target_bucket text,target_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.family_media_upload_items i join private.family_media_upload_sessions s on s.id=i.session_id
    join public.family_members m on m.family_id=s.family_id and m.user_id=auth.uid()
    where i.bucket_id=target_bucket and i.storage_path=target_path and i.settled_object_id is null
      and s.actor_id=auth.uid() and m.role in('owner','member') and s.status='reserved' and clock_timestamp()<s.expires_at);
$$;

create function private.record_family_media_publication(target_family uuid,target_post uuid,target_path text,is_video boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s private.family_media_upload_sessions; obj private.family_media_objects; lim record; at_time timestamptz;
begin
  perform private.sync_family_media_objects(target_family);
  select session.* into s from private.family_media_upload_items i join private.family_media_upload_sessions session on session.id=i.session_id
    where i.storage_path=target_path and i.bucket_id=case when is_video then 'post-videos' else 'post-media' end for update of session;
  at_time:=clock_timestamp();
  if s.id is not null and s.status<>'published' then
    if s.post_id<>target_post or s.family_id<>target_family or s.status not in('reserved','uploaded') or at_time>=s.expires_at then
      raise exception 'UPLOAD_SESSION_NOT_ACTIVE' using errcode='P0001'; end if;
    if exists(select 1 from private.family_media_upload_items i where i.session_id=s.id and
      (i.settled_object_id is null or not exists(select 1 from storage.objects o where o.id=i.settled_object_id and o.owner_id=s.actor_id::text)
      or not (exists(select 1 from public.post_media m where m.post_id=target_post and i.bucket_id='post-media' and m.storage_path=i.storage_path)
        or exists(select 1 from public.post_videos v where v.post_id=target_post and ((i.bucket_id='post-videos' and v.storage_path=i.storage_path)
          or (i.bucket_id='post-video-thumbnails' and v.thumbnail_path=i.storage_path)))))) then
      raise exception 'UPLOAD_MANIFEST_INCOMPLETE' using errcode='22023'; end if;
    if is_video then perform private.assert_family_video_slot(target_family,s.id,at_time); end if;
    update private.family_media_upload_sessions set status='published',video_slot_held=false,published_at=at_time where id=s.id;
  end if;
  if is_video then
    select * into obj from private.family_media_objects where family_id=target_family and bucket_id='post-videos' and storage_path=target_path and deleted_at is null;
    if obj.storage_object_id is not null then
      select * into lim from private.family_media_limits(target_family,at_time);
      insert into private.family_video_publications values(obj.storage_object_id,target_family,target_post,at_time,lim.tier,s.id is null) on conflict do nothing;
    end if;
  end if;
  perform private.refresh_family_media_totals(target_family);
end; $$;

create function private.observe_family_media_reference()
returns trigger language plpgsql security definer set search_path='' as $$
declare path text; fam uuid; parent_post uuid; video boolean; remains boolean;
begin
  video:=tg_table_name='post_videos';
  if tg_op='DELETE' then path:=old.storage_path;parent_post:=old.post_id;
  else path:=new.storage_path;parent_post:=new.post_id; end if;
  select p.family_id into fam from public.posts j join public.pets p on p.id=j.pet_id where j.id=parent_post;
  if fam is null then select family_id into fam from private.family_media_objects where storage_path=path limit 1; end if;
  if fam is null then return null; end if;
  remains:=case when video then exists(select 1 from public.post_videos where storage_path=path and post_id=parent_post)
    else exists(select 1 from public.post_media where storage_path=path and post_id=parent_post) end;
  if remains then perform private.record_family_media_publication(fam,parent_post,path,video);
  else
    perform private.lock_family_media_usage(fam);
    update private.family_media_objects set referenced=false,pending_cleanup=true where family_id=fam and storage_path=path and deleted_at is null;
    if video and tg_op='DELETE' then
      update private.family_media_objects set referenced=false,pending_cleanup=true where family_id=fam and storage_path=old.thumbnail_path and deleted_at is null;
    end if;
  end if;
  return null;
end; $$;
create constraint trigger observe_family_media_photo after insert or update or delete on public.post_media
  deferrable initially deferred for each row execute function private.observe_family_media_reference();
create constraint trigger observe_family_media_video after insert or update or delete on public.post_videos
  deferrable initially deferred for each row execute function private.observe_family_media_reference();

create function public.reconcile_family_media_usage(target_family_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  perform private.sync_family_media_objects(target_family_id);
  return (select to_jsonb(u) from private.family_media_usage u where family_id=target_family_id);
end; $$;
create function public.acknowledge_family_media_deletion(target_object_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare fam uuid;
begin
  select family_id into fam from private.family_media_objects where storage_object_id=target_object_id;
  if fam is null then return; end if;
  perform private.lock_family_media_usage(fam);
  if exists(select 1 from storage.objects o join private.family_media_objects r on r.bucket_id=o.bucket_id and r.storage_path=o.name
    where r.storage_object_id=target_object_id) then raise exception 'STORAGE_DELETE_NOT_CONFIRMED' using errcode='P0001'; end if;
  -- Trusted service calls this only after successful/idempotent Storage API deletion.
  update private.family_media_objects set deleted_at=coalesce(deleted_at,clock_timestamp()),pending_cleanup=false where storage_object_id=target_object_id;
  delete from private.family_media_measurement_errors where storage_object_id=target_object_id;
  perform private.refresh_family_media_totals(fam);
end; $$;
create function public.release_closed_family_media_upload(target_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare fam uuid; s private.family_media_upload_sessions;
begin
  select family_id into fam from private.family_media_upload_sessions where id=target_session_id;
  if fam is null then raise exception 'upload not found' using errcode='22023'; end if;
  perform private.lock_family_media_usage(fam);
  select * into s from private.family_media_upload_sessions where id=target_session_id for update;
  if s.status='released' then return; end if;
  if s.status='published' or (s.status not in('cancel_requested','expired') and clock_timestamp()<s.expires_at) then
    raise exception 'UPLOAD_TRANSPORT_STILL_ACTIVE' using errcode='P0001'; end if;
  if exists(select 1 from private.family_media_upload_items i join storage.objects o on o.bucket_id=i.bucket_id and o.name=i.storage_path where i.session_id=s.id) then
    raise exception 'UPLOAD_CLEANUP_REQUIRED' using errcode='P0001'; end if;
  if exists(select 1 from private.family_media_upload_items i join private.family_media_objects o on o.storage_object_id=i.settled_object_id
    where i.session_id=s.id and o.deleted_at is null) then raise exception 'STORAGE_DELETE_NOT_CONFIRMED' using errcode='P0001'; end if;
  -- Service-only: transport termination/expiry and capability revocation must
  -- be confirmed externally, not inferred from the app's Cancel button.
  update private.family_media_upload_sessions set status='released',reserved_bytes=0,video_slot_held=false,transport_closed_at=clock_timestamp() where id=s.id;
  perform private.refresh_family_media_totals(fam);
end; $$;

-- Trusted transport controller confirms termination/revocation before calling.
-- Reuse the existing cleanup queue, never a second queue or client assertion.
create function public.queue_closed_family_media_cleanup(target_session_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare fam uuid; s private.family_media_upload_sessions; item record; queued integer:=0;
begin
  select family_id into fam from private.family_media_upload_sessions where id=target_session_id;
  if fam is null then raise exception 'upload not found' using errcode='22023'; end if;
  perform private.lock_family_media_usage(fam);
  select * into s from private.family_media_upload_sessions where id=target_session_id for update;
  if s.status='released' then return 0; end if;
  if s.status='published' or (s.status not in('cancel_requested','expired') and clock_timestamp()<s.expires_at) then
    raise exception 'UPLOAD_TRANSPORT_STILL_ACTIVE' using errcode='P0001'; end if;
  if exists(select 1 from private.family_media_upload_items i where i.session_id=s.id and
    (exists(select 1 from public.post_media m where i.bucket_id='post-media' and m.storage_path=i.storage_path)
      or exists(select 1 from public.post_videos v where (i.bucket_id='post-videos' and v.storage_path=i.storage_path)
        or (i.bucket_id='post-video-thumbnails' and v.thumbnail_path=i.storage_path)))) then
    raise exception 'UPLOAD_OBJECT_STILL_REFERENCED' using errcode='P0001'; end if;
  perform private.sync_family_media_objects(fam);
  update private.family_media_upload_sessions set status='cancel_requested',
    transport_closed_at=coalesce(transport_closed_at,clock_timestamp()) where id=s.id;
  for item in select * from private.family_media_upload_items where session_id=s.id loop
    -- Do not update an already queued row: the cleanup worker may hold it while
    -- acknowledging bytes under the Family lock. Retries only add missing jobs.
    if not exists(select 1 from public.media_cleanup_jobs where bucket_id=item.bucket_id and storage_path=item.storage_path and completed_at is null) then
      perform private.enqueue_media_cleanup(item.bucket_id,item.storage_path,'quota_upload_abandoned',s.post_id);
    end if;
    update private.family_media_objects set pending_cleanup=true where bucket_id=item.bucket_id and storage_path=item.storage_path and deleted_at is null;
    queued:=queued+1;
  end loop;
  return queued;
end; $$;

create function private.observe_family_media_cleanup_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare obj record;
begin
  if new.completed_at is not null and old.completed_at is null
    and not exists(select 1 from storage.objects where bucket_id=new.bucket_id and name=new.storage_path) then
    for obj in select storage_object_id from private.family_media_objects
      where bucket_id=new.bucket_id and storage_path=new.storage_path and deleted_at is null loop
      perform public.acknowledge_family_media_deletion(obj.storage_object_id);
    end loop;
  end if;
  return new;
end; $$;
create trigger observe_family_media_cleanup after update of completed_at on public.media_cleanup_jobs
  for each row execute function private.observe_family_media_cleanup_completion();

-- Private records have no client table grants or client upgrade/configuration API.
do $$ declare t text; f record; begin
  foreach t in array array['family_media_quota_policy','family_media_entitlements','family_media_usage','family_media_objects',
    'family_media_measurement_errors','family_media_upload_sessions','family_media_upload_items','family_video_publications'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
    execute format('grant all on private.%I to service_role',t);
    execute format('create trigger pre_cutover_release_lock before insert or update or delete on private.%I for each row execute function private.assert_release_write_allowed()',t);
    execute format('create trigger require_supported_client before insert or update or delete on private.%I for each row execute function private.require_supported_client_mutation()',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in('family_media_limits','lock_family_media_usage','refresh_family_media_totals','sync_family_media_objects',
      'family_media_video_period','assert_family_video_slot','can_use_family_media_reservation','record_family_media_publication','observe_family_media_reference','observe_family_media_cleanup_completion') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end; $$;
grant execute on function private.can_use_family_media_reservation(text,text) to authenticated;
revoke all on function public.get_family_media_quota(uuid),public.reserve_family_media_upload(uuid,uuid,uuid,uuid[],uuid),
  public.settle_family_media_upload(uuid),public.cancel_family_media_upload(uuid),public.reconcile_family_media_usage(uuid),
  public.acknowledge_family_media_deletion(uuid),public.release_closed_family_media_upload(uuid),public.queue_closed_family_media_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_family_media_quota(uuid),public.reserve_family_media_upload(uuid,uuid,uuid,uuid[],uuid),
  public.settle_family_media_upload(uuid),public.cancel_family_media_upload(uuid) to authenticated;
grant execute on function public.reconcile_family_media_usage(uuid),public.acknowledge_family_media_deletion(uuid),public.release_closed_family_media_upload(uuid),public.queue_closed_family_media_cleanup(uuid) to service_role;

-- Initial physical-usage observation only; no entitlement/cohort activation.
do $$ declare f record; begin
  for f in select id from public.families order by id loop perform private.sync_family_media_objects(f.id); end loop;
end; $$;

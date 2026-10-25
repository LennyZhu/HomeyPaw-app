-- 1.4 capacity only. No activation, entitlement seed, data rewrite or policy change.
-- Storage API owns all storage.objects mutations; this trigger only writes the
-- existing private registry and rejects transactions exceeding a Family cap.
-- Requires the reviewed Storage finalization contract; see capacity verification.
begin;
alter table private.family_media_quota_policy drop constraint family_media_quota_policy_storage_enforcement_enabled_check;
-- Coverage epoch is independent of the deferred monthly-video product policy.
alter table private.family_media_quota_policy add column capacity_epoch timestamptz not null default clock_timestamp();
-- Not an activation switch: the old TUS protocol has no trusted aggregate
-- admission reserve. Leave false until an actual transport bound is verified.
alter table private.family_media_quota_policy add column legacy_tus_admission_verified boolean not null default false;
alter table private.family_media_usage add column capacity_epoch timestamptz;
create function private.advance_family_capacity_epoch()
returns trigger language plpgsql set search_path='' as $$ begin
  if new.storage_enforcement_enabled and not old.storage_enforcement_enabled then
    new.capacity_epoch:=clock_timestamp();
  elsif new.storage_enforcement_enabled and new.capacity_epoch is distinct from old.capacity_epoch then
    raise exception 'QUOTA_COVERAGE_EPOCH_IMMUTABLE' using errcode='P0001';
  end if;
  return new;
end; $$;
revoke all on function private.advance_family_capacity_epoch() from public,anon,authenticated,service_role;
create trigger advance_family_capacity_epoch before update on private.family_media_quota_policy
  for each row execute function private.advance_family_capacity_epoch();
create or replace function private.family_media_limits(target_family uuid, at_time timestamptz)
returns table(tier text,limit_bytes bigint,video_limit integer)
language sql stable security definer set search_path='' as $$
  select chosen.tier,case chosen.tier when 'plus' then 5368709120::bigint
    when 'transition' then 1073741824::bigint else 314572800::bigint end,
    null::integer
  from (select coalesce((select e.tier from private.family_media_entitlements e
    where e.family_id=target_family and e.revoked_at is null and e.starts_at<=at_time
      and (e.billing_environment is null or e.billing_environment=(select environment from private.family_billing_config where singleton))
      and (at_time<e.ends_at or (e.ends_inclusive and at_time=e.ends_at))
    order by case e.tier when 'plus' then 0 else 1 end,e.ends_at desc limit 1),'free') tier) chosen;
$$;

create or replace function private.sync_family_media_objects(target_family uuid)
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
  update private.family_media_upload_sessions s set reserved_bytes=case when (select storage_enforcement_enabled from private.family_media_quota_policy where singleton) and s.status not in('reserved','uploaded') then 0 else (select coalesce(sum(i.max_bytes),0)
    from private.family_media_upload_items i where i.session_id=s.id and i.settled_object_id is null) end,
    status=case when s.status='reserved' and not exists(select 1 from private.family_media_upload_items i where i.session_id=s.id and i.settled_object_id is null)
      then 'uploaded' else s.status end
    where s.family_id=target_family and s.status<>'released';
  perform private.refresh_family_media_totals(target_family);
  -- Only a complete trusted scan establishes coverage; ordinary refreshes and
  -- deletion acknowledgements cannot accidentally certify an old OFF snapshot.
  update private.family_media_usage set capacity_epoch=(select capacity_epoch from private.family_media_quota_policy where singleton)
    where family_id=target_family;
end; $$;
create or replace function public.cancel_family_media_upload(target_session_id uuid)
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
  -- The final Storage commit gate now revokes late writes independently of TUS TTL.
  if (select storage_enforcement_enabled from private.family_media_quota_policy where singleton) then
    perform private.sync_family_media_objects(fam);
  end if;
end; $$;

create or replace function private.family_billing_can_charge()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select c.enabled and c.rc_project_id is not null and c.rc_app_id is not null
    and c.rc_entitlement_id is not null and c.monthly_product_id is not null and c.yearly_product_id is not null
    and c.monthly_product_id<>c.yearly_product_id and
    (c.environment='SANDBOX' or (c.release_ready and exists(
      select 1 from private.family_media_quota_policy q where q.singleton and q.storage_enforcement_enabled
        and q.legacy_tus_admission_verified
        and q.capacity_epoch<=statement_timestamp())
      and exists(select 1 from pg_catalog.pg_trigger where tgrelid='storage.objects'::regclass
        and tgname='family_media_capacity_commit' and tgenabled='O')))
    from private.family_billing_config c where c.singleton),false);
$$;
create or replace function public.get_family_plus_summary(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  billing_env text := (select environment from private.family_billing_config where singleton);
  viewer uuid := auth.uid(); viewer_role text; at_time timestamptz := statement_timestamp();
  cfg private.family_media_quota_policy; usage private.family_media_usage;
  grant_row private.family_media_entitlements; sub private.family_store_subscriptions;
  lim record; period record; state text := 'unavailable'; access boolean := false;
  valid_until timestamptz; checked_at timestamptz; usage_state text := 'uninitialized';
  unsettled bigint := 0; cleanup_bytes bigint := 0; unpublished_bytes bigint := 0;
  spent bigint; video_state text := 'not_configured';
begin
  select null::timestamptz period_start,null::timestamptz period_end into period;
  if viewer is null or not exists(select 1 from auth.users where id=viewer) then
    raise exception 'authentication required' using errcode='42501'; end if;
  select m.role::text into viewer_role from public.family_members m
    where m.family_id=target_family_id and m.user_id=viewer;
  if viewer_role is null then raise exception 'family not found' using errcode='42501'; end if;
  select * into cfg from private.family_media_quota_policy where singleton;
  select * into lim from private.family_media_limits(target_family_id,at_time);
  select * into grant_row from private.family_media_entitlements e
    where e.family_id=target_family_id and (e.billing_environment is null or e.billing_environment=billing_env) and e.revoked_at is null and e.starts_at<=at_time
      and (at_time<e.ends_at or (e.ends_inclusive and at_time=e.ends_at))
    order by case e.tier when 'plus' then 0 else 1 end,e.ends_at desc,e.id limit 1;
  if grant_row.id is not null then
    valid_until:=grant_row.ends_at; checked_at:=grant_row.starts_at;
    if grant_row.tier='transition' then state:='transition';
    elsif grant_row.billing_subscription_id is null then
      -- A bounded administrator grant (synthetic fixtures in this phase).
      state:='active'; access:=true;
    else
      select * into sub from private.family_store_subscriptions s
        where s.id=grant_row.billing_subscription_id and s.family_id=target_family_id
          and s.environment=grant_row.billing_environment and s.environment=billing_env and s.store='APP_STORE';
      checked_at:=sub.checked_at;
      if sub.gives_access and sub.started_at<=at_time and sub.access_until>at_time then
        valid_until:=least(grant_row.ends_at,sub.access_until);
        state:=case when sub.status='in_grace_period' then 'grace'
          when sub.status='cancelled' or (sub.status='active' and sub.auto_renewal_status='will_not_renew') then 'cancelled'
          when sub.status='active' then 'active' else 'unavailable' end;
        access:=state<>'unavailable';
      end if;
    end if;
  else
    select * into grant_row from private.family_media_entitlements e where e.family_id=target_family_id
      and (e.billing_environment is null or e.billing_environment=billing_env) and e.starts_at<=at_time order by e.ends_at desc,e.id limit 1;
    if grant_row.id is null then state:='free';
    else
      select * into sub from private.family_store_subscriptions s where s.id=grant_row.billing_subscription_id
        and s.family_id=target_family_id and s.environment=grant_row.billing_environment;
      checked_at:=sub.checked_at;
      if sub.status in('refunded','revoked') then state:='revoked';
      elsif sub.status='expired' then state:='expired';
      elsif sub.gives_access and sub.access_until>at_time then state:='unavailable';
      elsif sub.id is not null then
        state:=case when sub.status in('active','cancelled','in_billing_retry') and sub.access_until<=at_time
          then 'expired' else 'unavailable' end;
      elsif grant_row.revoked_at is not null then state:='revoked';
      else state:='expired'; end if;
    end if;
  end if;

  select * into usage from private.family_media_usage where family_id=target_family_id;
  -- Detect observation gaps without scanning/refreshing into writable ledgers.
  select count(*) into unsettled from storage.objects o
    left join private.family_media_objects r on r.storage_object_id=o.id and r.deleted_at is null
    left join public.pets p on p.id=case when o.bucket_id='post-media'
      then private.post_media_pet_id(o.name) else private.journal_video_path_uuid(o.name,2) end
    where o.bucket_id in('post-media','post-videos','post-video-thumbnails')
      and coalesce(r.family_id,p.family_id)=target_family_id
      and (r.storage_object_id is null or r.storage_version is distinct from o.version
        or case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then r.bytes<>(o.metadata->>'size')::bigint else true end);
  select coalesce(sum(r.bytes) filter(where r.pending_cleanup or exists(select 1 from public.media_cleanup_jobs j
      where j.bucket_id=r.bucket_id and j.storage_path=r.storage_path and j.completed_at is null)),0),
    coalesce(sum(r.bytes) filter(where not r.pending_cleanup
      and not exists(select 1 from public.media_cleanup_jobs j where j.bucket_id=r.bucket_id and j.storage_path=r.storage_path and j.completed_at is null)
      and not exists(select 1 from public.post_media m where r.bucket_id='post-media' and m.storage_path=r.storage_path)
      and not exists(select 1 from public.post_videos v where (r.bucket_id='post-videos' and v.storage_path=r.storage_path)
        or (r.bucket_id='post-video-thumbnails' and v.thumbnail_path=r.storage_path))),0)
    into cleanup_bytes,unpublished_bytes from private.family_media_objects r
    where r.family_id=target_family_id and r.deleted_at is null;
  if usage.reconciled_at is not null then
    usage_state:=case when usage.measurement_errors<>0 or unsettled<>0
      or (cfg.storage_enforcement_enabled and usage.capacity_epoch is distinct from cfg.capacity_epoch)
      or exists(select 1 from private.family_media_measurement_errors where family_id is null or family_id=target_family_id)
      or usage.used_bytes<>(select coalesce(sum(bytes),0) from private.family_media_objects where family_id=target_family_id and deleted_at is null)
      or usage.reserved_bytes<>(select coalesce(sum(reserved_bytes),0) from private.family_media_upload_sessions where family_id=target_family_id)
      or exists(select 1 from private.family_media_objects r where r.family_id=target_family_id and r.deleted_at is null
        and not r.pending_cleanup and not exists(select 1 from storage.objects o where o.id=r.storage_object_id))
      then 'pending' else 'ready' end;
  end if;
  -- 1.4 launch has capacity differentiation only; no monthly video limit.
  return jsonb_build_object('schema_version',1,'family_id',target_family_id,'viewer_user_id',viewer,'role',viewer_role,
    'server_time',at_time,'status',state,'gives_plus_access',access,'access_until',case when access then valid_until end,
    'entitlement_checked_at',checked_at,'billing_environment',billing_env,
    'limit_bytes',case when state<>'unavailable' then lim.limit_bytes end,
    'storage_enforcement_enabled',coalesce(cfg.storage_enforcement_enabled,false),
    'usage',jsonb_build_object('status',usage_state,'used_bytes',case when usage_state='ready' then usage.used_bytes end,
      'reserved_bytes',case when usage.reconciled_at is not null then usage.reserved_bytes end,
      'unpublished_bytes',case when usage.reconciled_at is not null then unpublished_bytes end,
      'cleanup_pending_bytes',case when usage.reconciled_at is not null then cleanup_bytes end,
      'unsettled_object_count',unsettled,'reconciled_at',usage.reconciled_at),
    'videos',jsonb_build_object('status',video_state,'published',spent,'limit',lim.video_limit,
      'calendar_time_zone',null,'counting_scope',null,
      'period_start',case when video_state in('ready','partial') then period.period_start end,
      'policy_is_candidate',true));
end; $$;

create function private.enforce_family_media_capacity()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare
  fam uuid; prior_family uuid; actor uuid; pet uuid; size_bytes bigint; lim record;
  object_row storage.objects; previous private.family_media_objects;
  slot private.family_media_upload_sessions; item private.family_media_upload_items;
  probe boolean; active boolean; coverage timestamptz;
begin
  -- Shared until object commit, even while OFF: activation cannot overlook an
  -- upload that saw the old flag and committed during its baseline scan.
  select storage_enforcement_enabled,capacity_epoch into active,coverage
    from private.family_media_quota_policy where singleton for share;
  -- OFF makes no ledger mutations, including with Release Lock ON.
  if not coalesce(active,false) then return null; end if;
  if tg_op='DELETE' then object_row:=old; else object_row:=new; end if;
  if object_row.bucket_id not in('post-media','post-videos','post-video-thumbnails') then
    if tg_op<>'UPDATE' or old.bucket_id not in('post-media','post-videos','post-video-thumbnails') then return null; end if;
    raise exception 'QUOTA_MEDIA_MOVE_REQUIRES_COPY_DELETE' using errcode='P0001';
  end if;
  if tg_op='UPDATE' and row(old.bucket_id,old.name,old.version,old.owner_id,old.metadata->>'size')
    is not distinct from row(new.bucket_id,new.name,new.version,new.owner_id,new.metadata->>'size') then return null; end if;
  -- Only the actual Storage connection may distinguish its rollback-only RLS
  -- probe (version=1) from final backend metadata. End users cannot spoof login.
  -- postgres/supabase_admin are trusted migration/recovery actors, not app roles.
  if session_user not in('supabase_storage_admin','postgres','supabase_admin') then
    raise exception 'QUOTA_STORAGE_WRITER_REQUIRED' using errcode='42501'; end if;
  probe:=session_user='supabase_storage_admin' and current_setting('role')='authenticated' and tg_op<>'DELETE' and object_row.version='1';
  if probe then return null; end if;
  if session_user='supabase_storage_admin' and tg_op<>'DELETE' and current_setting('role')<>'service_role' then
    raise exception 'QUOTA_STORAGE_FINALIZATION_UNVERIFIED' using errcode='42501'; end if;
  select * into previous from private.family_media_objects where storage_object_id=object_row.id;
  if tg_op='DELETE' then
    fam:=previous.family_id;
    if fam is null then return null; end if;
    perform private.lock_family_media_usage(fam);
    -- Storage API commits this only together with backend deletion. Post removal
    -- alone never refunds capacity; queued cleanup remains charged until here.
    update private.family_media_objects set deleted_at=coalesce(deleted_at,clock_timestamp()),pending_cleanup=false where storage_object_id=object_row.id;
    delete from private.family_media_measurement_errors where storage_object_id=object_row.id;
    perform private.refresh_family_media_totals(fam);
    return null;
  end if;
  if not private.is_valid_media_cleanup_path(object_row.bucket_id,object_row.name)
    or object_row.metadata->>'size' is null or (object_row.metadata->>'size')!~'^[0-9]{1,18}$' then
    raise exception 'QUOTA_MEASUREMENT_UNAVAILABLE' using errcode='P0001'; end if;
  size_bytes:=(object_row.metadata->>'size')::bigint;
  pet:=case when object_row.bucket_id='post-media' then private.post_media_pet_id(object_row.name) else private.journal_video_path_uuid(object_row.name,2) end;
  select family_id into fam from public.pets where id=pet;
  actor:=private.journal_video_path_uuid(object_row.name,1);
  if fam is null or object_row.owner_id is distinct from actor::text or not exists(
    select 1 from public.family_members where family_id=fam and user_id=actor and role in('owner','member')) then
    raise exception 'QUOTA_FAMILY_UPLOAD_DENIED' using errcode='42501'; end if;
  if previous.family_id is not null and previous.family_id<>fam then
    raise exception 'QUOTA_MEDIA_FAMILY_MOVE_DENIED' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.name is distinct from new.name then
    select family_id into prior_family from public.pets where id=case when old.bucket_id='post-media'
      then private.post_media_pet_id(old.name) else private.journal_video_path_uuid(old.name,2) end;
    if prior_family is distinct from fam then raise exception 'QUOTA_MEDIA_FAMILY_MOVE_DENIED' using errcode='42501'; end if;
  end if;
  -- Same lock as reservations/entitlements. VOLATILE SPI reads after waiting
  -- observe the latest committed Family budget, not the INSERT's stale snapshot.
  -- Hold canonical membership stable through final commit; a previously issued
  -- TUS URL or signed-upload permission is not permanent authorization.
  perform 1 from public.family_members where family_id=fam and user_id=actor and role in('owner','member') for share;
  if not found then raise exception 'QUOTA_FAMILY_UPLOAD_DENIED' using errcode='42501'; end if;
  perform private.lock_family_media_usage(fam);
  if tg_op='UPDATE' then
    update private.family_media_objects set storage_path=object_row.name,bucket_id=object_row.bucket_id
      where storage_object_id=object_row.id;
  end if;
  select i.* into item from private.family_media_upload_items i where i.bucket_id=object_row.bucket_id and i.storage_path=object_row.name;
  if item.session_id is not null then
    select * into slot from private.family_media_upload_sessions where id=item.session_id;
    if slot.family_id<>fam or slot.actor_id<>actor or slot.status not in('reserved','uploaded') or clock_timestamp()>=slot.expires_at
      or slot.transport_closed_at is not null or size_bytes>item.max_bytes then
      raise exception 'UPLOAD_SESSION_NOT_ACTIVE' using errcode='P0001'; end if;
  end if;
  -- Account for every final object, including unpublished/legacy/orphan files;
  -- do not accept a client size or count only public.post_media references.
  if (select capacity_epoch from private.family_media_usage where family_id=fam) is distinct from coverage then
    perform private.sync_family_media_objects(fam);
  else
    -- The finalization trigger has covered every object mutation in this epoch.
    -- Settle just this backend-measured object rather than re-writing every file
    -- in a large Plus Family on each upload.
    insert into private.family_media_objects(storage_object_id,family_id,bucket_id,storage_path,storage_version,bytes,referenced,pending_cleanup)
    values(object_row.id,fam,object_row.bucket_id,object_row.name,object_row.version,size_bytes,
      exists(select 1 from public.post_media m where object_row.bucket_id='post-media' and m.storage_path=object_row.name)
      or exists(select 1 from public.post_videos v where (object_row.bucket_id='post-videos' and v.storage_path=object_row.name)
        or (object_row.bucket_id='post-video-thumbnails' and v.thumbnail_path=object_row.name)),
      exists(select 1 from public.media_cleanup_jobs j where j.bucket_id=object_row.bucket_id and j.storage_path=object_row.name and j.completed_at is null))
    on conflict(storage_object_id) do update set storage_version=excluded.storage_version,bytes=excluded.bytes,
      storage_path=excluded.storage_path,bucket_id=excluded.bucket_id,referenced=excluded.referenced,pending_cleanup=excluded.pending_cleanup;
    delete from private.family_media_measurement_errors where storage_object_id=object_row.id;
    if item.session_id is not null then
      update private.family_media_upload_items set settled_object_id=object_row.id where bucket_id=object_row.bucket_id and storage_path=object_row.name;
    end if;
    update private.family_media_upload_sessions set status='expired' where family_id=fam and status in('reserved','uploaded') and clock_timestamp()>=expires_at;
    update private.family_media_upload_sessions s set reserved_bytes=case when s.status in('reserved','uploaded')
      then (select coalesce(sum(i.max_bytes),0) from private.family_media_upload_items i where i.session_id=s.id and i.settled_object_id is null) else 0 end,
      status=case when s.status='reserved' and not exists(select 1 from private.family_media_upload_items i where i.session_id=s.id and i.settled_object_id is null)
        then 'uploaded' else s.status end
      where s.family_id=fam and s.status<>'released';
    perform private.refresh_family_media_totals(fam);
  end if;
  if exists(select 1 from private.family_media_measurement_errors where family_id=fam or family_id is null) then
    raise exception 'QUOTA_MEASUREMENT_UNAVAILABLE' using errcode='P0001'; end if;
  select * into lim from private.family_media_limits(fam,clock_timestamp());
  if (select used_bytes+reserved_bytes from private.family_media_usage where family_id=fam)>lim.limit_bytes
    and (tg_op='INSERT' or size_bytes>(old.metadata->>'size')::bigint) then
    raise exception 'FAMILY_STORAGE_QUOTA_EXCEEDED' using errcode='P0001'; end if;
  return null;
end; $$;
revoke all on function private.enforce_family_media_capacity() from public,anon,authenticated,service_role;
create trigger family_media_capacity_commit after insert or update or delete on storage.objects
  for each row execute function private.enforce_family_media_capacity();
commit;

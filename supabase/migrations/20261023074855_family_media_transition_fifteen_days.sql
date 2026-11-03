-- One Family-scoped window at the first Production capacity-policy activation.
-- Installing this forward does not activate quotas, Billing or any entitlement.
begin;
alter table private.family_media_quota_policy
  add column legacy_transition_started_at timestamptz;

create unique index family_media_transition_once
  on private.family_media_entitlements(family_id)
  where source_reference='capacity-policy-transition-v1';

create function private.set_family_media_transition_start()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.legacy_transition_started_at is distinct from old.legacy_transition_started_at then
    raise exception 'TRANSITION_START_IMMUTABLE' using errcode='P0001';
  end if;
  if old.legacy_transition_started_at is null
    and new.storage_enforcement_enabled and not old.storage_enforcement_enabled
    and (select environment from private.family_billing_config where singleton)='PRODUCTION' then
    if session_user not in('postgres','supabase_admin') then
      raise exception 'TRANSITION_TRUSTED_ACTIVATION_REQUIRED' using errcode='42501';
    end if;
    -- advance_family_capacity_epoch runs first (PostgreSQL trigger name order).
    -- Its server clock is also the common cutoff for all eligible Families.
    new.legacy_transition_started_at:=new.capacity_epoch;
  end if;
  return new;
end; $$;
revoke all on function private.set_family_media_transition_start()
  from public,anon,authenticated,service_role;
create trigger set_family_media_transition_start
  before update on private.family_media_quota_policy
  for each row execute function private.set_family_media_transition_start();

create function private.grant_family_media_transition()
returns trigger language plpgsql security definer set search_path='' as $$
declare fam record; usage private.family_media_usage;
begin
  -- The policy UPDATE serializes Storage commits via the existing shared lock.
  -- Refresh authoritative metadata, never client sizes or an old usage cache.
  for fam in select id from public.families
    where created_at<=new.legacy_transition_started_at order by id
  loop
    perform private.sync_family_media_objects(fam.id);
    select * into usage from private.family_media_usage where family_id=fam.id;
    if usage.reconciled_at is null or usage.measurement_errors<>0
      or exists(select 1 from private.family_media_measurement_errors where family_id is null or family_id=fam.id)
      or exists(select 1 from private.family_media_objects r where r.family_id=fam.id and r.deleted_at is null
        and not exists(select 1 from storage.objects o where o.id=r.storage_object_id)) then
      -- Abort the activation atomically rather than guessing qualification.
      raise exception 'TRANSITION_USAGE_NOT_READY' using errcode='P0001';
    end if;
    if usage.used_bytes>314572800 and
      (select tier='free' from private.family_media_limits(fam.id,new.legacy_transition_started_at)) then
      insert into private.family_media_entitlements(
        family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
      values(fam.id,'transition',new.legacy_transition_started_at,
        new.legacy_transition_started_at+interval '360 hours',false,'capacity-policy-transition-v1')
      on conflict do nothing;
    end if;
  end loop;
  return null;
end; $$;
revoke all on function private.grant_family_media_transition()
  from public,anon,authenticated,service_role;
create trigger grant_family_media_transition
  after update on private.family_media_quota_policy for each row
  when (old.legacy_transition_started_at is null and new.legacy_transition_started_at is not null)
  execute function private.grant_family_media_transition();

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
    if grant_row.id is null or grant_row.tier='transition' then state:='free';
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
    'transition',case when state='transition' then jsonb_build_object(
      'starts_at',grant_row.starts_at,'ends_at',grant_row.ends_at) end,
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
commit;

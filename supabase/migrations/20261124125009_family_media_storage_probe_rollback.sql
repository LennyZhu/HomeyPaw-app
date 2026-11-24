-- P1: Storage 1.96.4 permission probes use random versions, not literal '1'.
-- No activation, policy/role change, data rewrite or quota/entitlement change.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$ begin
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.enforce_family_media_capacity()')
    and encode(sha256(convert_to(btrim(p.prosrc),'UTF8')),'hex')=
      'd19d3259f6f4c5cbb4e0c715f59d10557e3f8a4d3877aabebfc315b391655428')
    or not exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass
      and tgname='family_media_capacity_commit' and tgenabled='O')
    or to_regprocedure('private.require_family_media_storage_probe_rollback()') is not null
    or to_regclass('private.family_media_storage_probe_guards') is not null
  then raise exception 'QUOTA_STORAGE_PROBE_BASELINE_MISMATCH'; end if;
end $$;

-- This app-owned private table avoids changing managed storage.objects ownership
-- or privileges. It is always EMPTY after a successful transaction: each guard
-- is either rolled back with a permission probe or rejects COMMIT. No user data.
create table private.family_media_storage_probe_guards (
  id uuid primary key default gen_random_uuid()
);
alter table private.family_media_storage_probe_guards enable row level security;
revoke all on private.family_media_storage_probe_guards
  from public,anon,authenticated,service_role;

-- Queue this only at the trusted Storage/caller-role branch below, while the
-- role is known. Do NOT re-decide trust from JWT, metadata or role at COMMIT.
-- testPermission rollback/savepoint rollback discards the row and queued event.
create function private.require_family_media_storage_probe_rollback()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'QUOTA_STORAGE_FINALIZATION_UNVERIFIED' using errcode='42501';
end $$;
revoke all on function private.require_family_media_storage_probe_rollback()
  from public,anon,authenticated,service_role;

create constraint trigger family_media_storage_probe_rollback
after insert on private.family_media_storage_probe_guards
deferrable initially deferred
for each row
execute function private.require_family_media_storage_probe_rollback();

create or replace function private.enforce_family_media_capacity()
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
  -- Caller-role checks and signed-upload checks lacking backend size are
  -- rollback-only candidates on the trusted Storage connection, never finals.
  -- 1.96.4 uses random versions; 1.77.5 used '1'. Version is not authority.
  -- The deferred constraint below forbids COMMIT of any such capacity write;
  -- testPermission must roll it back (including nested savepoint probes).
  -- Final backend writes still require service_role and pass every check below.
  if session_user not in('supabase_storage_admin','postgres','supabase_admin') then
    raise exception 'QUOTA_STORAGE_WRITER_REQUIRED' using errcode='42501'; end if;
  probe:=session_user='supabase_storage_admin' and tg_op<>'DELETE'
    and (current_setting('role')='authenticated'
      or (current_setting('role')='service_role' and object_row.metadata->>'size' is null));
  if probe then
    insert into private.family_media_storage_probe_guards default values;
    return null;
  end if;
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
revoke all on function private.enforce_family_media_capacity()
  from public,anon,authenticated,service_role;
comment on trigger family_media_storage_probe_rollback on private.family_media_storage_probe_guards is
  'Caller-role Storage capacity probes must roll back; final service-role writes retain trusted measurement, membership and Family quota checks.';
commit;


-- First cutover step. Only a trusted direct database session may release this lock.
create table private.pre_cutover_release_lock (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into private.pre_cutover_release_lock (singleton, enabled) values (true, true);
revoke all on private.pre_cutover_release_lock from public, anon, authenticated, service_role;

create or replace function private.assert_release_write_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Migrations and reviewed SQL Editor operations connect directly as postgres.
  -- A SECURITY DEFINER RPC keeps its original session_user (authenticator),
  -- so it cannot escape this guard by running as a privileged function owner.
  if session_user <> 'postgres' and
     (select enabled from private.pre_cutover_release_lock where singleton) is distinct from false
  then
    raise exception 'PRE_CUTOVER_RELEASE_LOCK' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function private.assert_release_write_allowed()
  from public, anon, authenticated, service_role;

-- Edge service-role callers can read the lock without exposing its table.
create or replace function public.is_pre_cutover_release_locked()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select enabled from private.pre_cutover_release_lock where singleton), true
  );
$$;
revoke execute on function public.is_pre_cutover_release_locked()
  from public, anon, authenticated;
grant execute on function public.is_pre_cutover_release_locked()
  to service_role, authenticated;

-- Install against every pre-Phase-A application table. Keep the list explicit
-- so unrelated tables in public are not changed by a Production schema drift.
-- Triggers also guard SECURITY DEFINER RPCs and service-role PostgREST writes.
do $$
declare target record;
begin
  for target in
    select schemaname, tablename from pg_tables
    where schemaname = 'public'
      and tablename in (
        'profiles', 'pets', 'pet_members', 'pet_invites', 'posts',
        'post_media', 'post_videos', 'media_cleanup_jobs',
        'care_logs', 'care_tasks', 'care_task_completions',
        'chat_messages', 'chat_read_states', 'care_shifts', 'care_shift_tasks'
      )
    union all
    select schemaname, tablename from pg_tables
    where schemaname = 'private'
      and tablename in ('push_devices', 'family_notification_outbox',
                        'family_notification_deliveries', 'pet_chat_states')
  loop
    execute format(
      'create trigger pre_cutover_release_lock before insert or update or delete on %I.%I for each row execute function private.assert_release_write_allowed()',
      target.schemaname, target.tablename
    );
  end loop;
end;
$$;

-- The old app calls Storage directly. A row trigger covers its upload,
-- replacement, and delete operations, including service-key API requests.
create trigger pre_cutover_release_lock
  before insert or update or delete on storage.objects
  for each row execute function private.assert_release_write_allowed();

-- Authenticated Storage API requests are rejected by RLS before object
-- mutation. Existing permissive bucket policies remain in place after unlock.
create policy pre_cutover_storage_insert on storage.objects
  as restrictive for insert to authenticated
  with check (not public.is_pre_cutover_release_locked());
create policy pre_cutover_storage_update on storage.objects
  as restrictive for update to authenticated
  using (not public.is_pre_cutover_release_locked())
  with check (not public.is_pre_cutover_release_locked());
create policy pre_cutover_storage_delete on storage.objects
  as restrictive for delete to authenticated
  using (not public.is_pre_cutover_release_locked());

-- Admin Auth deletion in an old Edge function must not escape the lock.
-- Account deletion is intentionally closed; sign-up may also fail closed if
-- its profile trigger attempts an application-table write during cutover.
create trigger pre_cutover_release_lock
  before delete on auth.users
  for each row execute function private.assert_release_write_allowed();

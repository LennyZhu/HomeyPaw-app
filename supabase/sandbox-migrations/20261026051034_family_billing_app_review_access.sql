-- SANDBOX-ONLY forward. Deliberately outside supabase/migrations: never copy
-- this file into a Production deployment manifest. Deployment must independently
-- verify project yhxxsawcaffxonpconaq; SQL environment is an additional guard,
-- not proof of a project's identity. Requires 20261025143824 test-window guards.
-- No admission, switch, schedule, transaction or entitlement is seeded.
begin;
set local lock_timeout='800ms';
set local statement_timeout='10s';

do $$ begin
  if (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX'
    or to_regprocedure('private.require_family_billing_test_writer(uuid,uuid)') is null then
    raise exception 'BILLING_REVIEW_SANDBOX_REQUIRED' using errcode='42501';
  end if;
end; $$;

alter table private.family_billing_test_accounts
  add column admission_kind text not null default 'development'
    check(admission_kind in('development','app_review')),
  add column approval_generation uuid,
  add constraint family_billing_app_review_duration check(admission_kind<>'app_review' or
    (approval_generation is not null and isfinite(approved_at) and isfinite(expires_at)
      and expires_at>approved_at and expires_at<=approved_at+interval '336 hours'));

create function private.assert_family_billing_app_review_maintenance()
returns void language plpgsql set search_path='' as $$ begin
  if session_user not in('postgres','cli_login_postgres')
    or not pg_catalog.pg_has_role(session_user,'postgres','MEMBER')
    or auth.uid() is not null
    or nullif(current_setting('request.jwt.claim.role',true),'') is not null
    or nullif(current_setting('request.jwt.claim.sub',true),'') is not null
    or nullif(current_setting('request.jwt.claims',true),'') is not null
    or nullif(current_setting('request.headers',true),'') is not null
    or nullif(current_setting('request.method',true),'') is not null
    or nullif(current_setting('request.path',true),'') is not null
    or nullif(current_setting('request.cookies',true),'') is not null
    or (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    raise exception 'BILLING_REVIEW_MAINTENANCE_REQUIRED' using errcode='42501';
  end if;
end; $$;
revoke all on function private.assert_family_billing_app_review_maintenance() from public,anon,authenticated,service_role;

create function private.guard_family_billing_app_review_approval()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.admission_kind='app_review' or (tg_op='UPDATE' and old.admission_kind='app_review') then
    perform private.assert_family_billing_app_review_maintenance();
    if tg_op='UPDATE' and new.admission_kind='app_review' and
      (new.user_id is distinct from old.user_id or new.family_id is distinct from old.family_id
        or new.approved_at is distinct from old.approved_at or new.expires_at is distinct from old.expires_at
        or new.admission_kind is distinct from old.admission_kind or (new.enabled and not old.enabled))
      and (new.approval_generation is not distinct from old.approval_generation or new.approved_at<=old.approved_at) then
      raise exception 'BILLING_REVIEW_NEW_GENERATION_REQUIRED' using errcode='42501';
    end if;
  end if;
  -- No concurrent development/review approvals. Their global Billing/Lock
  -- switches are shared; the existing 90-minute closer remains unchanged.
  if new.enabled and exists(select 1 from private.family_billing_test_accounts a
    where a.user_id<>new.user_id and a.enabled
      and (a.admission_kind='app_review' or new.admission_kind='app_review')) then
    raise exception 'BILLING_TEST_CONCURRENT_WINDOW' using errcode='P0001';
  end if;
  return new;
end; $$;
revoke all on function private.guard_family_billing_app_review_approval() from public,anon,authenticated,service_role;
create trigger billing_app_review_approval before insert or update on private.family_billing_test_accounts
  for each row execute function private.guard_family_billing_app_review_approval();

-- The same helper is already used before/after all direct user mutations and
-- by the service-only, Auth.getUser-scoped Edge operation dispatcher.
create or replace function private.require_family_billing_test_writer(actor_user_id uuid, target_family_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare binding record; at_time timestamptz;
begin
  if (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    return target_family_id; -- Preserve normal Production authorization.
  end if;
  if actor_user_id is null then raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  select a.*,m.role into binding from private.family_billing_test_accounts a
    join auth.users u on u.id=a.user_id
    join public.family_members m on m.user_id=a.user_id and m.family_id=a.family_id
    where a.user_id=actor_user_id and m.role='owner' and u.deleted_at is null
      and coalesce(u.banned_until<=clock_timestamp(),true)
      and (target_family_id is null or a.family_id=target_family_id)
    for share of a,m;
  at_time:=clock_timestamp();
  if not found or not binding.enabled or binding.approved_at>at_time
    or binding.expires_at<=at_time or not isfinite(binding.approved_at) or not isfinite(binding.expires_at)
    or binding.expires_at>binding.approved_at+(case binding.admission_kind
      when 'app_review' then interval '336 hours' else interval '90 minutes' end)
    or (binding.admission_kind='app_review' and binding.approval_generation is null) then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  return binding.family_id;
end; $$;

create or replace function public.get_family_billing_test_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare binding record; at_time timestamptz:=clock_timestamp();
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid()
      and deleted_at is null and coalesce(banned_until<=at_time,true))
    or (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  select a.*,m.role::text as role into binding from private.family_billing_test_accounts a
    join public.family_members m on m.user_id=a.user_id and m.family_id=a.family_id
    where a.user_id=auth.uid() and a.enabled and a.approved_at<=at_time and a.expires_at>at_time
      and isfinite(a.approved_at) and isfinite(a.expires_at)
      and a.expires_at<=a.approved_at+(case a.admission_kind
        when 'app_review' then interval '336 hours' else interval '90 minutes' end)
      and ((a.admission_kind='development' and m.role in('owner','member','viewer'))
        or (a.admission_kind='app_review' and m.role='owner' and a.approval_generation is not null));
  if not found then raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  return jsonb_build_object('user_id',auth.uid(),'family_id',binding.family_id,'role',binding.role,
    'server_time',at_time,'expires_at',binding.expires_at,'environment','SANDBOX','project_ref','yhxxsawcaffxonpconaq');
end; $$;

-- Also protect direct reads, not just Build 12's authorize() call. Ordinary
-- Sandbox members retain their existing RLS reads; a revoked review identity
-- cannot bypass expiry by invoking the underlying Summary/State RPC directly.
create function private.require_family_billing_app_review_read(target_family_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare admission jsonb;
begin
  if exists(select 1 from private.family_billing_test_accounts a
    where a.user_id=auth.uid() and a.admission_kind='app_review') then
    admission:=public.get_family_billing_test_access();
    if (admission->>'family_id')::uuid is distinct from target_family_id then
      raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  end if;
end; $$;
revoke all on function private.require_family_billing_app_review_read(uuid) from public,anon,authenticated,service_role;

do $$ declare signature text; worker text; definition text; begin
  foreach signature in array array['get_family_plus_summary(uuid)','get_family_billing_state(uuid)'] loop
    worker:=split_part(signature,'(',1);
    definition:=pg_get_functiondef(('public.'||signature)::regprocedure);
    execute replace(definition,'FUNCTION public.'||worker||'(',
      'FUNCTION private.app_review_original_'||worker||'(');
    execute 'revoke all on function private.app_review_original_'||signature||' from public,anon,authenticated,service_role';
  end loop;
end; $$;
create or replace function public.get_family_plus_summary(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_family_billing_app_review_read(target_family_id);
  result:=private.app_review_original_get_family_plus_summary(target_family_id);
  perform private.require_family_billing_app_review_read(target_family_id);
  return result;
end; $$;
create or replace function public.get_family_billing_state(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_family_billing_app_review_read(target_family_id);
  result:=private.app_review_original_get_family_billing_state(target_family_id);
  perform private.require_family_billing_app_review_read(target_family_id);
  return result;
end; $$;

-- Generation-checked closer, callable only by trusted direct maintenance/Cron.
-- Each call is one DB transaction; errors roll back the internal unlock too.
create function private.close_family_billing_app_review_window(target_user_id uuid, expected_generation uuid, close_now boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare admission private.family_billing_test_accounts;
begin
  perform private.assert_family_billing_app_review_maintenance();
  if target_user_id is null or expected_generation is null or close_now is null then
    raise exception 'BILLING_REVIEW_WINDOW_INVALID' using errcode='22023'; end if;
  perform set_config('lock_timeout','800ms',true);
  perform 1 from private.pre_cutover_release_lock where singleton for update;
  perform 1 from private.family_billing_config where singleton for update;
  select * into admission from private.family_billing_test_accounts where user_id=target_user_id for update;
  if not found then
    if exists(select 1 from private.family_billing_test_accounts where enabled) then return true; end if;
    -- Deleted admission/account with no replacement: fail closed below.
  elsif admission.admission_kind<>'app_review' or admission.approval_generation<>expected_generation then
    return true; -- Stale generation: disable only that Cron, never the new window.
  end if;
  if coalesce(not admission.enabled,true) and not (select enabled from private.family_billing_config where singleton)
    and (select enabled from private.pre_cutover_release_lock where singleton) then return true; end if;
  if not close_now and clock_timestamp()<admission.expires_at then return false; end if;
  if exists(select 1 from private.family_billing_test_accounts where user_id<>target_user_id and enabled) then
    raise exception 'BILLING_TEST_CONCURRENT_WINDOW' using errcode='P0001'; end if;
  update private.pre_cutover_release_lock set enabled=false,updated_at=clock_timestamp() where singleton;
  update private.family_billing_config set enabled=false where singleton;
  update private.family_billing_test_accounts set enabled=false where user_id=target_user_id;
  update private.pre_cutover_release_lock set enabled=true,updated_at=clock_timestamp() where singleton;
  if (select enabled from private.family_billing_config where singleton)
    or exists(select 1 from private.family_billing_test_accounts where user_id=target_user_id and enabled)
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from true then
    raise exception 'BILLING_REVIEW_CLOSE_INCOMPLETE' using errcode='P0001'; end if;
  return true;
end; $$;
revoke all on function private.close_family_billing_app_review_window(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function private.schedule_family_billing_app_review_close(target_user_id uuid)
returns bigint language plpgsql set search_path='' as $$
declare admission private.family_billing_test_accounts; job_name text; command text; existing record; job_id bigint;
begin
  perform private.assert_family_billing_app_review_maintenance();
  select * into admission from private.family_billing_test_accounts a where a.user_id=target_user_id
    and a.admission_kind='app_review' and a.enabled and a.approved_at<=clock_timestamp() and a.expires_at>clock_timestamp()
    and exists(select 1 from public.family_members m where m.user_id=a.user_id and m.family_id=a.family_id and m.role='owner') for share;
  if not found or to_regclass('cron.job') is null then
    raise exception 'BILLING_REVIEW_WINDOW_INVALID' using errcode='22023'; end if;
  job_name:='homeypaw-billing-app-review-'||admission.approval_generation::text;
  command:=format($command$begin;
set local statement_timeout='10s';
set local lock_timeout='800ms';
do $close$ begin
  if private.close_family_billing_app_review_window(%L::uuid,%L::uuid) then
    perform cron.alter_job((select jobid from cron.job where jobname=%L),active:=false);
  end if;
end $close$;
commit;$command$,admission.user_id,admission.approval_generation,job_name);
  execute 'select jobid,command,active,username,database,schedule from cron.job where jobname=$1' into existing using job_name;
  if existing.jobid is not null then
    -- pg_cron records the invoking execution role, not the pooler's login name.
    if existing.command<>command or not existing.active or existing.username<>current_user
      or existing.database<>current_database() or existing.schedule<>'* * * * *' then
      raise exception 'BILLING_REVIEW_CRON_CONFLICT' using errcode='P0001'; end if;
    return existing.jobid;
  end if;
  execute 'select cron.schedule($1,$2,$3)' into job_id using job_name,'* * * * *',command;
  return job_id;
end; $$;
revoke all on function private.schedule_family_billing_app_review_close(uuid) from public,anon,authenticated,service_role;

-- Approval/extension changes admission and installs its exact-generation closer
-- atomically. Its internal unlock is restored before returning; it does NOT
-- open Billing or change the committed Release Lock/Quota/Secrets state.
create function private.approve_family_billing_app_review(target_user_id uuid, target_family_id uuid, duration_seconds integer default 1209600)
returns jsonb language plpgsql set search_path='' as $$
declare prior private.family_billing_test_accounts; approved timestamptz; generation uuid; job_id bigint; prior_job bigint; previous_lock boolean;
begin
  perform private.assert_family_billing_app_review_maintenance();
  if duration_seconds is null or duration_seconds<=0 or duration_seconds>1209600 then
    raise exception 'BILLING_REVIEW_WINDOW_INVALID' using errcode='22023'; end if;
  perform set_config('lock_timeout','800ms',true);
  perform 1 from private.pre_cutover_release_lock where singleton for update;
  perform 1 from private.family_billing_config where singleton for update;
  lock table private.family_billing_test_accounts in share row exclusive mode;
  select enabled into previous_lock from private.pre_cutover_release_lock where singleton;
  if previous_lock is null then raise exception 'BILLING_REVIEW_WINDOW_INVALID' using errcode='22023'; end if;
  if not exists(select 1 from auth.users u join public.family_members m on m.user_id=u.id
      join public.families f on f.id=m.family_id where u.id=target_user_id and m.family_id=target_family_id and m.role='owner'
        and u.deleted_at is null and coalesce(u.banned_until<=clock_timestamp(),true))
    or exists(select 1 from private.family_billing_test_accounts where user_id<>target_user_id and enabled) then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  if (select storage_enforcement_enabled from private.family_media_quota_policy where singleton) is distinct from false then
    raise exception 'BILLING_REVIEW_QUOTA_MUST_STAY_OFF' using errcode='42501'; end if;
  select * into prior from private.family_billing_test_accounts where user_id=target_user_id;
  if prior.enabled and prior.admission_kind='development' then
    raise exception 'BILLING_TEST_CONCURRENT_WINDOW' using errcode='P0001'; end if;
  approved:=clock_timestamp(); generation:=gen_random_uuid();
  update private.pre_cutover_release_lock set enabled=false,updated_at=clock_timestamp() where singleton;
  insert into private.family_billing_test_accounts(user_id,family_id,enabled,approved_at,expires_at,admission_kind,approval_generation)
    values(target_user_id,target_family_id,true,approved,approved+make_interval(secs=>duration_seconds),'app_review',generation)
    on conflict(user_id) do update set family_id=excluded.family_id,enabled=true,approved_at=excluded.approved_at,
      expires_at=excluded.expires_at,admission_kind=excluded.admission_kind,approval_generation=excluded.approval_generation;
  job_id:=private.schedule_family_billing_app_review_close(target_user_id);
  if prior.admission_kind='app_review' then
    execute 'select jobid from cron.job where jobname=$1 and username=$2 and database=$3'
      into prior_job using 'homeypaw-billing-app-review-'||prior.approval_generation::text,current_user,current_database();
    if prior_job is not null then perform cron.alter_job(prior_job,active:=false); end if;
  end if;
  update private.pre_cutover_release_lock set enabled=previous_lock,updated_at=clock_timestamp() where singleton;
  return jsonb_build_object('generation',generation,'approved_at',approved,
    'expires_at',approved+make_interval(secs=>duration_seconds),'close_job_id',job_id);
end; $$;
revoke all on function private.approve_family_billing_app_review(uuid,uuid,integer) from public,anon,authenticated,service_role;

commit;

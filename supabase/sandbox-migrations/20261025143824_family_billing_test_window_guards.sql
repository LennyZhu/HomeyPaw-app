-- Sandbox user operations have a server deadline independent of Cron/SDK flags.
-- No admission, scheduler, Billing activation or historical transaction is seeded.
begin;

create function private.require_family_billing_test_writer(actor_user_id uuid, target_family_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare binding record; at_time timestamptz;
begin
  if (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    return target_family_id; -- Existing Production authorization stays unchanged.
  end if;
  if actor_user_id is null then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  select a.*,m.role into binding from private.family_billing_test_accounts a
    join auth.users u on u.id=a.user_id
    join public.family_members m on m.user_id=a.user_id and m.family_id=a.family_id
    where a.user_id=actor_user_id and m.role='owner'
      and (target_family_id is null or a.family_id=target_family_id)
    for share of a,m;
  at_time:=clock_timestamp(); -- Check after lock acquisition, never transaction start.
  if not found or not binding.enabled or binding.approved_at>at_time
    or binding.expires_at<=at_time or not isfinite(binding.approved_at)
    or not isfinite(binding.expires_at)
    or binding.expires_at>binding.approved_at+interval '90 minutes' then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  return binding.family_id;
end; $$;
revoke all on function private.require_family_billing_test_writer(uuid,uuid) from public,anon,authenticated,service_role;

-- Keep public RPC OIDs/ACL/owners and their existing business implementations.
-- Private delegates are not executable by any API role, including service_role.
do $$
declare signature text; definition text; worker text;
begin
  foreach signature in array array[
    'get_family_billing_customer()',
    'begin_family_billing_purchase(uuid,uuid,text)',
    'update_family_billing_intent(uuid,text)'
  ] loop
    worker:=split_part(signature,'(',1);
    definition:=pg_get_functiondef(('public.'||signature)::regprocedure);
    definition:=replace(definition,'FUNCTION public.'||worker||'(',
      'FUNCTION private.test_window_original_'||worker||'(');
    execute definition;
    execute 'revoke all on function private.test_window_original_'||signature||' from public,anon,authenticated,service_role';
  end loop;
end; $$;

create or replace function public.get_family_billing_customer()
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform private.require_family_billing_test_writer(auth.uid());
  result:=private.test_window_original_get_family_billing_customer();
  perform private.require_family_billing_test_writer(auth.uid());
  return result;
end; $$;

create or replace function public.begin_family_billing_purchase(target_family_id uuid,request_id uuid,period text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_family_billing_test_writer(auth.uid(),target_family_id);
  result:=private.test_window_original_begin_family_billing_purchase(target_family_id,request_id,period);
  perform private.require_family_billing_test_writer(auth.uid(),target_family_id);
  return result;
end; $$;

create or replace function public.update_family_billing_intent(target_intent_id uuid,next_status text)
returns void language plpgsql security definer set search_path='' as $$
declare family uuid;
begin
  select family_id into family from private.family_billing_intents where id=target_intent_id;
  perform private.require_family_billing_test_writer(auth.uid(),family);
  perform private.test_window_original_update_family_billing_intent(target_intent_id,next_status);
  perform private.require_family_billing_test_writer(auth.uid(),family);
end; $$;

-- The Edge Function supplies actor_user_id only after Auth.getUser verifies JWT.
-- This is service-only, with an explicit allowlist, not a general SQL/RPC proxy.
-- Every delegated write and its post-deadline check share one DB transaction.
create function public.execute_family_billing_test_user_operation(actor_user_id uuid, operation text, arguments jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare family uuid; customer uuid; result jsonb; event jsonb;
begin
  if auth.role() is distinct from 'service_role'
    or (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  family:=private.require_family_billing_test_writer(actor_user_id);
  if jsonb_typeof(arguments) is distinct from 'object' then
    raise exception 'BILLING_TEST_OPERATION_DENIED' using errcode='42501'; end if;
  if arguments ? 'target_user_id' and (arguments->>'target_user_id')::uuid is distinct from actor_user_id
    or arguments ? 'target_family_id' and (arguments->>'target_family_id')::uuid is distinct from family then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  if arguments ? 'target_customer_id' then customer:=(arguments->>'target_customer_id')::uuid; end if;
  if operation='receive_family_billing_webhook' then
    event:=arguments->'event';customer:=(event->>'app_user_id')::uuid;
  end if;
  if customer is not null then
    if not exists(select 1 from private.family_billing_customers c where c.id=customer and
      (c.user_id=actor_user_id or exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id and s.family_id=family)))
      or exists(select 1 from private.family_store_subscriptions s where s.customer_id=customer and s.family_id<>family)
      or exists(select 1 from private.family_billing_intents i where i.customer_id=customer and i.family_id<>family) then
      raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
  end if;
  case operation
    when 'get_family_billing_server_context' then
      if customer is null then raise exception 'BILLING_TEST_OPERATION_DENIED' using errcode='42501'; end if;
      result:=public.get_family_billing_server_context(customer);
    when 'get_family_billing_recovery_anchors' then result:=public.get_family_billing_recovery_anchors(customer);
    when 'start_family_billing_refresh' then result:=to_jsonb(public.start_family_billing_refresh(customer));
    when 'finish_family_billing_recovery' then
      perform public.finish_family_billing_recovery(customer,(arguments->>'generation')::bigint,arguments->>'result',arguments->>'error_code');
    when 'receive_family_billing_webhook' then
      result:=to_jsonb(public.receive_family_billing_webhook(event,arguments->>'payload_hash'));
    when 'apply_family_billing_snapshot' then
      result:=public.apply_family_billing_snapshot(customer,(arguments->>'generation')::bigint,arguments->'snapshot',arguments->>'source_event_id');
      if (result->>'family_id')::uuid is distinct from family then
        raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501'; end if;
    when 'get_family_billing_purchase_preflight_context' then
      result:=public.get_family_billing_purchase_preflight_context(actor_user_id);
    when 'finish_family_billing_purchase_preflight' then
      perform public.finish_family_billing_purchase_preflight(actor_user_id,family);
    else raise exception 'BILLING_TEST_OPERATION_DENIED' using errcode='42501';
  end case;
  perform private.require_family_billing_test_writer(actor_user_id,family);
  return coalesce(result,'null'::jsonb);
end; $$;
revoke all on function public.execute_family_billing_test_user_operation(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.execute_family_billing_test_user_operation(uuid,text,jsonb) to service_role;

-- Called by a separate, credential-free postgres Cron job. A stale job cannot
-- close a replacement admission. Failure rolls back everything; Cron retries.
create function private.close_expired_family_billing_test_window(target_user_id uuid, expected_approved_at timestamptz, expected_expires_at timestamptz)
returns boolean language plpgsql set search_path='' as $$
declare admission private.family_billing_test_accounts;
begin
  if session_user not in('postgres','cli_login_postgres')
    or not pg_catalog.pg_has_role(session_user,'postgres','MEMBER')
    or auth.uid() is not null or nullif(current_setting('request.jwt.claim.role',true),'') is not null
    or nullif(current_setting('request.jwt.claims',true),'') is not null
    or nullif(current_setting('request.headers',true),'') is not null then
    raise exception 'BILLING_TEST_MAINTENANCE_REQUIRED' using errcode='42501'; end if;
  if (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    raise exception 'BILLING_ENVIRONMENT_DENIED' using errcode='42501'; end if;
  if target_user_id is null or expected_approved_at is null or expected_expires_at is null
    or not isfinite(expected_approved_at) or not isfinite(expected_expires_at)
    or expected_expires_at<=expected_approved_at or expected_expires_at>expected_approved_at+interval '90 minutes' then
    raise exception 'BILLING_TEST_WINDOW_INVALID' using errcode='22023'; end if;
  -- The caller/Cron also sets statement_timeout; lock_timeout is enforced here.
  perform set_config('lock_timeout','800ms',true);
  perform 1 from private.pre_cutover_release_lock where singleton for update;
  perform 1 from private.family_billing_config where singleton for update;
  select * into admission from private.family_billing_test_accounts where user_id=target_user_id for update;
  if found and (admission.approved_at<>expected_approved_at or admission.expires_at<>expected_expires_at) then
    return true; -- A replacement window must never be closed by its old job.
  end if;
  if not admission.enabled and not (select enabled from private.family_billing_config where singleton)
    and (select enabled from private.pre_cutover_release_lock where singleton) then return true; end if;
  if clock_timestamp()<expected_expires_at then return false; end if;
  if exists(select 1 from private.family_billing_test_accounts where user_id<>target_user_id and enabled) then
    raise exception 'BILLING_TEST_CONCURRENT_WINDOW' using errcode='P0001'; end if;
  -- A lock already ON must not block the cleanup's guarded table writes.
  -- This unlock is visible only within this transaction, never to API clients.
  update private.pre_cutover_release_lock set enabled=false,updated_at=clock_timestamp() where singleton;
  update private.family_billing_config set enabled=false where singleton;
  update private.family_billing_test_accounts set enabled=false where user_id=target_user_id;
  update private.pre_cutover_release_lock set enabled=true,updated_at=clock_timestamp() where singleton;
  if (select enabled from private.family_billing_config where singleton)
    or exists(select 1 from private.family_billing_test_accounts where user_id=target_user_id and enabled)
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from true then
    raise exception 'BILLING_TEST_CLOSE_INCOMPLETE' using errcode='P0001'; end if;
  return true;
end; $$;
revoke all on function private.close_expired_family_billing_test_window(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- Explicit admin installation only; this migration never starts a scheduler.
-- Each generation has its own name. A failed job stays active and retries;
-- it disables itself only after an atomic close (or a verified stale window).
create function private.schedule_family_billing_test_window_close(target_user_id uuid)
returns bigint language plpgsql set search_path='' as $$
declare admission private.family_billing_test_accounts; job_name text; command text; existing record; job_id bigint;
begin
  if session_user not in('postgres','cli_login_postgres')
    or not pg_catalog.pg_has_role(session_user,'postgres','MEMBER')
    or auth.uid() is not null or nullif(current_setting('request.jwt.claim.role',true),'') is not null
    or nullif(current_setting('request.jwt.claims',true),'') is not null
    or nullif(current_setting('request.headers',true),'') is not null
    or (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    raise exception 'BILLING_TEST_MAINTENANCE_REQUIRED' using errcode='42501'; end if;
  select * into admission from private.family_billing_test_accounts a where a.user_id=target_user_id
    and a.enabled and a.approved_at<=clock_timestamp() and a.expires_at>clock_timestamp()
    and isfinite(a.approved_at) and isfinite(a.expires_at)
    and a.expires_at<=a.approved_at+interval '90 minutes'
    and exists(select 1 from public.family_members m where m.user_id=a.user_id and m.family_id=a.family_id and m.role='owner')
    for share;
  if not found or to_regclass('cron.job') is null then
    raise exception 'BILLING_TEST_WINDOW_INVALID' using errcode='22023'; end if;
  job_name:='homeypaw-billing-test-window-'||md5(admission.user_id::text||extract(epoch from admission.approved_at)::text||extract(epoch from admission.expires_at)::text);
  command:=format($command$begin;
set local statement_timeout='10s';
set local lock_timeout='800ms';
do $close$ begin
  if private.close_expired_family_billing_test_window(%L::uuid,%L::timestamptz,%L::timestamptz) then
    perform cron.alter_job((select jobid from cron.job where jobname=%L),active:=false);
  end if;
end $close$;
commit;$command$,admission.user_id,admission.approved_at,admission.expires_at,job_name);
  execute 'select jobid,command,active,username,database,schedule from cron.job where jobname=$1' into existing using job_name;
  if existing.jobid is not null then
    if existing.command<>command or not existing.active or existing.username<>session_user
      or existing.database<>current_database() or existing.schedule<>'10 seconds' then
      raise exception 'BILLING_TEST_CRON_CONFLICT' using errcode='P0001'; end if;
    return existing.jobid;
  end if;
  execute 'select cron.schedule($1,$2,$3)' into job_id using job_name,'10 seconds',command;
  return job_id;
end; $$;
revoke all on function private.schedule_family_billing_test_window_close(uuid) from public,anon,authenticated,service_role;
commit;

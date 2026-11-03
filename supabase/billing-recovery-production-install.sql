-- OPERATIONAL INSTALLER, NOT A MIGRATION. No execution is authorized by this file.
-- Generate with scripts/prepare-production-recovery.mjs. Run only through the
-- independently verified tknaobmlwmodsqtpqwkr Dashboard/admin connection.
-- SQL environment markers cannot independently prove the physical project ref.
-- Vault must already contain the exact endpoint and the dedicated internal bearer.
begin;
set local lock_timeout='800ms';
set local statement_timeout='10s';
__PRODUCTION_GUARD__
do $install_guard$ begin
  if (select enabled or release_ready from private.family_billing_config where singleton)
    or (select storage_enforcement_enabled from private.family_media_quota_policy where singleton) is distinct from false
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from false then
    raise exception 'PRODUCTION_RECOVERY_INSTALL_BASELINE_DENIED'; end if;
  if to_regclass('private.production_billing_recovery_dispatches') is not null
    or to_regprocedure('private.enqueue_production_family_billing_recovery()') is not null
    or exists(select 1 from cron.job where jobname='homeypaw-production-billing-recovery') then
    raise exception 'PRODUCTION_RECOVERY_ALREADY_EXISTS_INSPECT_FIRST'; end if;
end; $install_guard$;

-- Operational HTTP correlation only: no user, Family, transaction or secret data.
create table private.production_billing_recovery_dispatches (
  request_id bigint primary key,
  enqueued_at timestamptz not null default clock_timestamp()
);
alter table private.production_billing_recovery_dispatches enable row level security;
revoke all on private.production_billing_recovery_dispatches from public,anon,authenticated,service_role;

create function private.enqueue_production_family_billing_recovery()
returns bigint language plpgsql security definer set search_path='' as $enqueue$
declare endpoint text; auth_header text; request_id bigint;
begin
  -- release_ready deliberately does not gate lifecycle recovery for paid users.
  if not exists(select 1 from private.family_billing_config
      where singleton and environment='PRODUCTION' and enabled)
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from false then
    return null;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(741400014::bigint) then return null; end if;
  -- One HTTP invocation at a time within its bounded 90-second timeout.
  if exists(select 1 from private.production_billing_recovery_dispatches d
      where d.enqueued_at>clock_timestamp()-interval '100 seconds'
      and not exists(select 1 from net._http_response r where r.id=d.request_id)) then
    return null;
  end if;
  select decrypted_secret into strict endpoint from vault.decrypted_secrets
    where name='homeypaw_production_billing_recovery_url';
  select decrypted_secret into strict auth_header from vault.decrypted_secrets
    where name='homeypaw_production_billing_recovery_authorization';
  if endpoint<>'https://tknaobmlwmodsqtpqwkr.supabase.co/functions/v1/family-billing-reconcile'
    or auth_header !~ '^Bearer [^[:space:]]{32,}$' then
    raise exception 'PRODUCTION_RECOVERY_VAULT_DENIED'; end if;
  request_id:=net.http_post(url:=endpoint,
    headers:=jsonb_build_object('Authorization',auth_header,'Content-Type','application/json'),
    body:='{}'::jsonb,timeout_milliseconds:=90000);
  if request_id is null then raise exception 'PRODUCTION_RECOVERY_ENQUEUE_FAILED'; end if;
  insert into private.production_billing_recovery_dispatches(request_id) values(request_id);
  -- Bounded retention for this new operational table only, never Billing history.
  delete from private.production_billing_recovery_dispatches
    where enqueued_at<clock_timestamp()-interval '7 days';
  return request_id;
end; $enqueue$;
revoke all on function private.enqueue_production_family_billing_recovery()
  from public,anon,authenticated,service_role;

do $install_job$ declare installed_job bigint; begin
  installed_job:=cron.schedule('homeypaw-production-billing-recovery','* * * * *',
    'select private.enqueue_production_family_billing_recovery();');
  -- Same transaction: no active job is ever committed by installation.
  perform cron.alter_job(installed_job,active:=false);
  if not exists(select 1 from cron.job where jobid=installed_job and not active
      and database=current_database() and username=current_user) then
    raise exception 'PRODUCTION_RECOVERY_DISABLED_INSTALL_FAILED'; end if;
end; $install_job$;
commit;

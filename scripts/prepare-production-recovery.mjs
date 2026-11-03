// Offline SQL preparation only. No database client, subprocess, secrets or fetch.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const productionRef = 'tknaobmlwmodsqtpqwkr';
export const recoveryJob = 'homeypaw-production-billing-recovery';
const endpoint = `https://${productionRef}.supabase.co/functions/v1/family-billing-reconcile`;
const template = readFileSync(
  new URL(
    '../supabase/billing-recovery-production-install.sql',
    import.meta.url,
  ),
  'utf8',
);
const source = template.match(/as \$enqueue\$([\s\S]+?)\$enqueue\$;/)?.[1];
if (!source) throw new Error('PRODUCTION_RECOVERY_TEMPLATE_INVALID');
const sourceMd5 = createHash('md5').update(source).digest('hex');

const guard = `do $production_guard$ begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or session_user not in('postgres','cli_login_postgres')
    or not pg_has_role(session_user,'postgres','MEMBER')
    or not has_schema_privilege(current_user,'private','CREATE') then
    raise exception 'PRODUCTION_RECOVERY_ADMIN_DENIED'; end if;
  if not exists(select 1 from private.family_billing_config where singleton
      and environment='PRODUCTION' and rc_project_id is not null and rc_app_id is not null
      and rc_entitlement_id is not null and monthly_product_id='homeypaw.familyplus.monthly'
      and yearly_product_id='homeypaw.familyplus.yearly')
    or (select count(*) from supabase_migrations.schema_migrations)<>58
    or exists(select 1 from supabase_migrations.schema_migrations
      where version in('20261025143824','20261026051034','20261026074212','20261031141904')) then
    raise exception 'PRODUCTION_RECOVERY_DATABASE_DENIED'; end if;
  if to_regprocedure('public.get_family_billing_recovery_health()') is null
    or to_regprocedure('public.get_family_billing_reconciliation_work(integer)') is null
    or to_regprocedure('public.finish_family_billing_recovery(uuid,bigint,text,text)') is null
    or not exists(select 1 from pg_extension where extname='pg_cron')
    or not exists(select 1 from pg_extension where extname='pg_net')
    or not exists(select 1 from pg_extension where extname='supabase_vault') then
    raise exception 'PRODUCTION_RECOVERY_PREREQUISITES_MISSING'; end if;
  if (select count(*) from vault.decrypted_secrets
      where name='homeypaw_production_billing_recovery_url' and decrypted_secret='${endpoint}')<>1
    or (select count(*) from vault.decrypted_secrets where name='homeypaw_production_billing_recovery_url')<>1
    or (select count(*) from vault.decrypted_secrets
      where name='homeypaw_production_billing_recovery_authorization')<>1
    or (select count(*) from vault.decrypted_secrets
      where name='homeypaw_production_billing_recovery_authorization'
      and decrypted_secret ~ '^Bearer [^[:space:]]{32,}$')<>1 then
    raise exception 'PRODUCTION_RECOVERY_VAULT_DENIED'; end if;
end; $production_guard$;`;

const installedGuard = `do $installed_guard$ begin
  if (select count(*) from cron.job where jobname='${recoveryJob}')<>1
    or not exists(select 1 from cron.job where jobname='${recoveryJob}'
      and schedule='* * * * *' and database=current_database() and username='postgres'
      and command='select private.enqueue_production_family_billing_recovery();')
    or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname='enqueue_production_family_billing_recovery'
      and p.pronargs=0 and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig=array['search_path=""']::text[] and md5(p.prosrc)='${sourceMd5}') then
    raise exception 'PRODUCTION_RECOVERY_INSTALLED_SOURCE_DENIED'; end if;
  if exists(select 1 from unnest(array['anon','authenticated','service_role']) r
      where has_function_privilege(r,'private.enqueue_production_family_billing_recovery()','EXECUTE')
        or has_table_privilege(r,'private.production_billing_recovery_dispatches','SELECT,INSERT,UPDATE,DELETE')) then
    raise exception 'PRODUCTION_RECOVERY_PRIVATE_ACL_DENIED'; end if;
end; $installed_guard$;`;

export function productionRecoverySql(operation, confirmedRef) {
  if (confirmedRef !== productionRef)
    throw new Error('PRODUCTION_RECOVERY_TARGET_DENIED');
  if (operation === 'install')
    return template.replace('__PRODUCTION_GUARD__', () => guard);
  if (!['enable', 'disable', 'health'].includes(operation))
    throw new Error('PRODUCTION_RECOVERY_OPERATION_DENIED');
  // Disable must work even if credentials/mapping later break. Do not make an
  // emergency stop depend on Vault availability, a mapping or a History count.
  const stopGuard = `do $stop_guard$ begin
    if current_database()<>'postgres' or current_user<>'postgres'
      or session_user not in('postgres','cli_login_postgres')
      or not pg_has_role(session_user,'postgres','MEMBER')
      or (select environment from private.family_billing_config where singleton) is distinct from 'PRODUCTION' then
      raise exception 'PRODUCTION_RECOVERY_ADMIN_DENIED'; end if;
    if (select count(*) from cron.job where jobname='${recoveryJob}')<>1
      or not exists(select 1 from cron.job where jobname='${recoveryJob}'
        and database=current_database() and username='postgres'
        and command='select private.enqueue_production_family_billing_recovery();') then
      raise exception 'PRODUCTION_RECOVERY_JOB_DENIED'; end if;
  end; $stop_guard$;`;
  if (operation === 'disable')
    return `begin;\nset local lock_timeout='800ms';\n${stopGuard}\nselect cron.alter_job((select jobid from cron.job where jobname='${recoveryJob}'),active:=false);\ncommit;\n`;
  if (operation === 'enable')
    return `begin;\nset local lock_timeout='800ms';\nset local statement_timeout='10s';\n${guard}\n${installedGuard}
do $enable_guard$ begin
  if (select enabled from private.family_billing_config where singleton) is distinct from true
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from false then
    raise exception 'PRODUCTION_RECOVERY_LIFECYCLE_NOT_READY'; end if;
end; $enable_guard$;
select cron.alter_job((select jobid from cron.job where jobname='${recoveryJob}'),active:=true);
commit;\n`;
  return `begin read only;\n${guard}\n${installedGuard}
select jsonb_build_object(
  'job_active',(select active from cron.job where jobname='${recoveryJob}'),
  'dispatches_24h',(select count(*) from private.production_billing_recovery_dispatches where enqueued_at>now()-interval '24 hours'),
  'last_dispatch',(select max(enqueued_at) from private.production_billing_recovery_dispatches),
  'last_http_completed',(select max(r.created) from private.production_billing_recovery_dispatches d join net._http_response r on r.id=d.request_id),
  'last_http_status',(select r.status_code from private.production_billing_recovery_dispatches d join net._http_response r on r.id=d.request_id order by d.enqueued_at desc limit 1),
  'http_failures_1h',(select count(*) from private.production_billing_recovery_dispatches d join net._http_response r on r.id=d.request_id where d.enqueued_at>now()-interval '1 hour' and (r.timed_out or r.error_msg is not null or r.status_code is distinct from 200)),
  'uncompleted_over_3m',(select count(*) from private.production_billing_recovery_dispatches d where d.enqueued_at between now()-interval '3 hours' and now()-interval '3 minutes' and not exists(select 1 from net._http_response r where r.id=d.request_id)),
  'cron_failures_1h',(select count(*) from cron.job_run_details where jobid=(select jobid from cron.job where jobname='${recoveryJob}') and start_time>now()-interval '1 hour' and status='failed'),
  'billing',public.get_family_billing_recovery_health()
) as production_recovery_health;
rollback;\n`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [operation, flag, ref, ...extra] = process.argv.slice(2);
  if (operation === '--help') {
    console.log(
      'Offline only: node scripts/prepare-production-recovery.mjs <install|enable|disable|health> --project-ref tknaobmlwmodsqtpqwkr\nOutputs SQL; never connects or executes. Installation commits a disabled job. Each later cloud action needs separate authorization and independently verified project identity.',
    );
  } else {
    try {
      if (flag !== '--project-ref' || extra.length)
        throw new Error('INVALID_ARGUMENTS');
      process.stdout.write(productionRecoverySql(operation, ref));
    } catch {
      console.error(
        'Production Recovery preparation refused; check operation and explicit project ref.',
      );
      process.exitCode = 1;
    }
  }
}

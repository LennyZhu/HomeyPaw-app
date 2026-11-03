-- MANUAL, separately approved Sandbox-only installation. NOT a migration.
-- Run only after validating the explicit database target, applying the Recovery
-- forward, deploying the reconcile Function and authorizing its runtime window.
-- First provision Vault secrets via a trusted admin/parameterized connection:
--   homeypaw_billing_recovery_url = exact HTTPS endpoint below
--   homeypaw_billing_recovery_authorization = Bearer + existing dedicated
--     FAMILY_BILLING_RECONCILE_SECRET (not a service key or webhook secret).
-- Never paste secret values into this template, SQL editor history or logs.
-- Enable pg_cron/pg_net/Vault via supported Dashboard controls if absent.
begin;
do $$ begin
  if session_user not in('postgres','cli_login_postgres') or not pg_has_role(session_user,'postgres','MEMBER') then
    raise exception 'trusted admin session required'; end if;
  if not exists(select 1 from private.family_billing_config where singleton
    and environment='SANDBOX' and rc_project_id='projfa7a6e51' and rc_app_id='app99c199ed63') then
    raise exception 'Sandbox billing mapping required'; end if;
  if not exists(select 1 from vault.decrypted_secrets
    where name='homeypaw_billing_recovery_url'
      and decrypted_secret='https://yhxxsawcaffxonpconaq.supabase.co/functions/v1/family-billing-reconcile')
    or (select count(*) from vault.decrypted_secrets where name='homeypaw_billing_recovery_url')<>1
    or (select count(*) from vault.decrypted_secrets where name='homeypaw_billing_recovery_authorization'
      and decrypted_secret ~ '^Bearer [^[:space:]]{32,}$')<>1 then
    raise exception 'unique Sandbox Vault configuration required'; end if;
  if exists(select 1 from cron.job where jobname='homeypaw-billing-recovery') then
    raise exception 'Recovery job exists; inspect instead of replacing'; end if;
end; $$;

create function private.enqueue_family_billing_recovery()
returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; auth_header text;
begin
  if not exists(select 1 from private.family_billing_config where singleton and environment='SANDBOX' and enabled)
    or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from false then
    return null; -- Closed windows never reopen themselves.
  end if;
  select decrypted_secret into strict endpoint from vault.decrypted_secrets where name='homeypaw_billing_recovery_url';
  select decrypted_secret into strict auth_header from vault.decrypted_secrets where name='homeypaw_billing_recovery_authorization';
  if endpoint<>'https://yhxxsawcaffxonpconaq.supabase.co/functions/v1/family-billing-reconcile'
    or auth_header !~ '^Bearer [^[:space:]]{32,}$' then raise exception 'Sandbox target denied'; end if;
  return net.http_post(url:=endpoint,
    headers:=jsonb_build_object('Authorization',auth_header,'Content-Type','application/json'),
    body:='{}'::jsonb,timeout_milliseconds:=90000);
end; $$;
revoke all on function private.enqueue_family_billing_recovery() from public,anon,authenticated,service_role;
select cron.schedule('homeypaw-billing-recovery','* * * * *','select private.enqueue_family_billing_recovery();');
commit;

-- Emergency pause (separately executed, never deletes billing history):
-- select cron.unschedule('homeypaw-billing-recovery');

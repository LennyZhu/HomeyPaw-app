-- 1.4 sells a limit on saved Journal media, not a hard cap on unfinished TUS
-- bytes. Keep the strict-admission fact truthful and separate from an explicit
-- operator decision about residual temporary-storage cost. Neither is enabled
-- by installing this migration. Existing private ACL/RLS and Release Lock apply.
begin;
alter table private.family_media_quota_policy
  add column legacy_tus_residual_risk_accepted boolean not null default false;

create or replace function private.family_billing_can_charge()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select c.enabled and c.rc_project_id is not null and c.rc_app_id is not null
    and c.rc_entitlement_id is not null and c.monthly_product_id is not null and c.yearly_product_id is not null
    and c.monthly_product_id<>c.yearly_product_id and
    (c.environment='SANDBOX' or (c.release_ready and exists(
      select 1 from private.family_media_quota_policy q where q.singleton and q.storage_enforcement_enabled
        and (q.legacy_tus_admission_verified or q.legacy_tus_residual_risk_accepted)
        and q.capacity_epoch<=statement_timestamp())
      and exists(select 1 from pg_catalog.pg_trigger where tgrelid='storage.objects'::regclass
        and tgname='family_media_capacity_commit' and tgenabled='O')))
    from private.family_billing_config c where c.singleton),false);
$$;
revoke all on function private.family_billing_can_charge()
  from public,anon,authenticated,service_role;
-- No changes to Storage, its policies, upload clients, capacity settlement,
-- entitlements, Transition, Billing enabled, release_ready or enforcement flags.
commit;

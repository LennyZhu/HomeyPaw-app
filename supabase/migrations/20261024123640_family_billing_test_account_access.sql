-- Explicit, expiring approval of synthetic Sandbox identities. Empty by default.
-- No Production identity routing, billing switch or entitlement is changed.
begin;
create table private.family_billing_test_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  enabled boolean not null default false,
  approved_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > approved_at)
);
alter table private.family_billing_test_accounts enable row level security;
revoke all on private.family_billing_test_accounts from public,anon,authenticated,service_role;
create trigger pre_cutover_release_lock before insert or update or delete
  on private.family_billing_test_accounts for each row
  execute function private.assert_release_write_allowed();

create function public.get_family_billing_test_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare binding record; at_time timestamptz := statement_timestamp();
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid())
    or (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX' then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501';
  end if;
  select a.family_id,a.expires_at,m.role::text as role into binding
    from private.family_billing_test_accounts a join public.family_members m
      on m.user_id=a.user_id and m.family_id=a.family_id
    where a.user_id=auth.uid() and a.enabled and a.approved_at<=at_time
      and a.expires_at>at_time and m.role in('owner','member','viewer');
  if not found then
    raise exception 'BILLING_TEST_ACCESS_DENIED' using errcode='42501';
  end if;
  return jsonb_build_object('user_id',auth.uid(),'family_id',binding.family_id,
    'role',binding.role,'server_time',at_time,'expires_at',binding.expires_at,
    'environment','SANDBOX','project_ref','yhxxsawcaffxonpconaq');
end; $$;
revoke all on function public.get_family_billing_test_access() from public,anon,service_role;
grant execute on function public.get_family_billing_test_access() to authenticated;
commit;

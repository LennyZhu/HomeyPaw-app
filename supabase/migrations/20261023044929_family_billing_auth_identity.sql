-- New installations use the authenticated user's stable UUID at RevenueCat.
-- Retained payer rows and transaction chains are never reassigned on transfer,
-- leave or account deletion. Old prototype identities fail closed for review.
begin;
create or replace function public.get_family_billing_customer()
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); existing uuid;
begin
  perform private.assert_family_billing_sandbox_ready();
  if caller is null or not exists(select 1 from auth.users where id=caller) then
    raise exception 'authentication required' using errcode='42501'; end if;
  select id into existing from private.family_billing_customers where user_id=caller;
  if existing is not null and existing<>caller then
    raise exception 'BILLING_LEGACY_IDENTITY_REVIEW_REQUIRED' using errcode='P0001'; end if;
  insert into private.family_billing_customers(id,user_id) values(caller,caller)
    on conflict(user_id) do update set user_id=excluded.user_id
    returning id into existing;
  if existing<>caller then
    raise exception 'BILLING_LEGACY_IDENTITY_REVIEW_REQUIRED' using errcode='P0001'; end if;
  return existing;
end; $$;
revoke all on function public.get_family_billing_customer() from public,anon,authenticated;
grant execute on function public.get_family_billing_customer() to authenticated;
commit;

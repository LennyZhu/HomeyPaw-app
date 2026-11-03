-- Recovery operations only. No scheduler, activation, entitlement seed or
-- historical transaction rewrite. Existing release-lock triggers remain intact.
begin;

alter table private.family_billing_customers
  add column recovery_failures integer not null default 0 check(recovery_failures>=0);

create or replace function public.get_family_billing_reconciliation_work(job_limit integer default 25)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(id),'{}') from (
    select c.id from private.family_billing_customers c
    where not c.review_required and (c.next_retry_at is null or c.next_retry_at<=statement_timestamp())
      -- One invalid shared provider credential pauses automatic work globally,
      -- instead of quarantining another innocent payer on every Cron tick.
      and not exists(select 1 from private.family_billing_customers blocked
        where blocked.review_required and blocked.recovery_error in('BILLING_PROVIDER_HTTP_401','BILLING_PROVIDER_HTTP_403'))
      and (exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id)
        or exists(select 1 from private.family_billing_intents i where i.customer_id=c.id and
          (i.status='store_pending' or (i.status='prepared' and i.expires_at>statement_timestamp())))
        or exists(select 1 from private.family_billing_webhook_inbox e where e.customer_id=c.id and e.status in('pending','deferred')))
    order by c.last_attempt_at nulls first,c.created_at,c.id limit least(greatest(job_limit,1),25)
  ) work;
$$;

create or replace function public.finish_family_billing_recovery(target_customer_id uuid,generation bigint,result text,error_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare failures integer;
begin
  if result not in('reconciled','empty','pending_chain_anchor','retry','manual_review') then
    raise exception 'invalid recovery result' using errcode='22023'; end if;
  if error_code is not null and error_code !~ '^BILLING_[A-Z0-9_]{1,80}$' then
    raise exception 'invalid recovery code' using errcode='22023'; end if;
  select c.recovery_failures into failures from private.family_billing_customers c
    where c.id=target_customer_id and c.refresh_generation=generation for update;
  if not found then return; end if; -- Older in-flight completion is a no-op.
  failures:=case when result in('reconciled','empty') then 0 else least(failures+1,30) end;
  update private.family_billing_customers c set last_attempt_at=clock_timestamp(),
    recovery_failures=failures, recovery_error=error_code, review_required=result='manual_review',
    next_retry_at=case when result='manual_review' then null
      when result in('reconciled','empty') then clock_timestamp()+interval '5 minutes'
      else clock_timestamp()+make_interval(secs=>60*least(60,power(2,least(failures-1,6))::integer)) end,
    reconciled_at=case when result in('reconciled','empty') then clock_timestamp() else c.reconciled_at end
    where c.id=target_customer_id;
  if result='reconciled' then
    -- One fresh verified chain can acknowledge several delayed/retried wake-up
    -- events. Never leave older events permanently deferred, and never use their
    -- payload to grant access. The snapshot's generation and exact chain win.
    update private.family_billing_webhook_inbox e set status='processed',
      processed_at=clock_timestamp(),last_error=null
      where e.customer_id=target_customer_id and e.status in('pending','deferred')
        and e.event_type<>'TRANSFER' and exists(
          select 1 from private.family_store_subscriptions s
          where s.customer_id=e.customer_id and s.original_transaction_id=e.original_transaction_id
            and s.product_id=e.product_id and s.last_generation=generation
            and s.environment=(select environment from private.family_billing_config where singleton));
  end if;
end; $$;

create function public.get_family_billing_recovery_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with backlog as (
    select count(*) filter(where c.review_required) as review_required,
      count(*) filter(where c.recovery_error in('BILLING_PROVIDER_HTTP_401','BILLING_PROVIDER_HTTP_403')) as authentication_failures,
      count(*) filter(where c.recovery_failures>=3) as repeatedly_failing,
      count(*) filter(where not c.review_required and (c.next_retry_at is null or c.next_retry_at<=statement_timestamp())) as due,
      coalesce(max(extract(epoch from statement_timestamp()-coalesce(c.reconciled_at,c.created_at))),0)::bigint as oldest_unverified_seconds
    from private.family_billing_customers c where
      exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id)
      or exists(select 1 from private.family_billing_intents i where i.customer_id=c.id and
        (i.status='store_pending' or (i.status='prepared' and i.expires_at>statement_timestamp())))
      or exists(select 1 from private.family_billing_webhook_inbox e where e.customer_id=c.id and e.status in('pending','deferred'))
  ), inbox as (
    select count(*) as deferred,
      coalesce(max(extract(epoch from statement_timestamp()-received_at)),0)::bigint as oldest_deferred_seconds
    from private.family_billing_webhook_inbox where status in('pending','deferred')
  ) select to_jsonb(b)||to_jsonb(i)||jsonb_build_object(
    'billing_enabled',coalesce((select enabled from private.family_billing_config where singleton),false),
    'release_lock',coalesce((select enabled from private.pre_cutover_release_lock where singleton),true),
    'attention_required',b.review_required>0 or b.authentication_failures>0 or b.repeatedly_failing>0
      or b.oldest_unverified_seconds>900 or i.oldest_deferred_seconds>300)
    from backlog b cross join inbox i;
$$;
revoke all on function public.get_family_billing_recovery_health() from public,anon,authenticated,service_role;
grant execute on function public.get_family_billing_recovery_health() to service_role;
-- CREATE OR REPLACE preserves the existing service-only finish RPC ACL.
commit;

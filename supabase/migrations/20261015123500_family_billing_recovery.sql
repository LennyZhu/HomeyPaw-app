-- Phase 4B-1, Sandbox only. Apply only in disposable fixtures until separately
-- approved. No entitlement/config/policy activation and no scheduler creation.
begin;

alter table private.family_billing_customers
  add column last_attempt_at timestamptz,
  add column next_retry_at timestamptz,
  add column recovery_error text,
  add column review_required boolean not null default false;

create function public.get_family_billing_recovery_anchors(target_customer_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('original_transaction_id',e.original_transaction_id,'event_id',e.event_id)),'[]')
  from private.family_billing_webhook_inbox e
  where e.customer_id=target_customer_id and e.status in('pending','deferred')
    and e.original_transaction_id is not null and e.event_type<>'TRANSFER'
    and coalesce(e.last_error,'') not in('BILLING_BINDING_REVIEW_REQUIRED','BILLING_CHAIN_ALREADY_BOUND','BILLING_EVENT_ID_CONFLICT');
$$;

create function public.finish_family_billing_recovery(target_customer_id uuid,generation bigint,result text,error_code text default null)
returns void language plpgsql security definer set search_path='' as $$ begin
  if result not in('reconciled','empty','pending_chain_anchor','retry','manual_review') then
    raise exception 'invalid recovery result' using errcode='22023'; end if;
  update private.family_billing_customers c set last_attempt_at=clock_timestamp(),
    next_retry_at=clock_timestamp()+interval '1 minute', recovery_error=error_code,
    review_required=result='manual_review',
    reconciled_at=case when result in('reconciled','empty') then clock_timestamp() else c.reconciled_at end
    where c.id=target_customer_id and c.refresh_generation=generation;
end; $$;

create or replace function public.get_family_billing_reconciliation_work(job_limit integer default 25)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(id),'{}') from (
    select c.id from private.family_billing_customers c
    where not c.review_required and (c.next_retry_at is null or c.next_retry_at<=statement_timestamp())
      and (exists(select 1 from private.family_store_subscriptions s where s.customer_id=c.id)
        or exists(select 1 from private.family_billing_intents i where i.customer_id=c.id and
          (i.status='store_pending' or (i.status='prepared' and i.expires_at>statement_timestamp())))
        or exists(select 1 from private.family_billing_webhook_inbox e where e.customer_id=c.id and e.status in('pending','deferred')))
    order by c.last_attempt_at nulls first,c.created_at limit least(greatest(job_limit,1),25)
  ) work;
$$;
revoke all on function public.get_family_billing_recovery_anchors(uuid),public.finish_family_billing_recovery(uuid,bigint,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_family_billing_recovery_anchors(uuid),public.finish_family_billing_recovery(uuid,bigint,text,text) to service_role;

commit;

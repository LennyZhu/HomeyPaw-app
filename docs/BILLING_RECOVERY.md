# Billing Recovery operation

This is an operation runbook, not authorization to deploy or activate a project.
The accepted 2026-10-25 Sandbox deployment reached 56/56 and verified real
Cron → Edge Function → RevenueCat → database recovery, including Family A expiry,
Family B access and idempotency/health. Its test Cron is now inactive and its
Billing/runtime/client OFF, Release Lock ON, Quota OFF. These are prior accepted
results, not a new cloud observation. The minimum Sandbox deployment steps below
describe that completed procedure; do not repeat them as new release work.

For Production follow [FAMILY_PLUS_LAUNCH.md](FAMILY_PLUS_LAUNCH.md). The current
installer template pins Sandbox and is **not** a Production installer. Production
needs an explicitly reviewed target-bound Vault/Cron setup and separate approval.
During ordinary paid-service incidents pause **new orders** with
`private.family_billing_config.release_ready=false`; leave DB/runtime Billing,
`FAMILY_BILLING_RELEASE_APPROVED`, Webhook, Recovery and necessary database writes
working for existing and in-flight paid transactions. Do not reuse a Sandbox
window's global Billing OFF / Release Lock ON close procedure on paying users.

## Mechanism

- The existing reconcile Function accepts a dedicated internal bearer secret;
  user JWTs cannot select a payer/Family/transaction for the batch operation.
- Every minute, Cron wakes the bounded batch. Successfully checked customers
  become due after five minutes. Failures retry after 1, 2, 4, 8, 16, 32, then
  at most 60 minutes. At most five customers start per invocation, with a 45-second
  batch admission and 20-second provider budget per customer; each HTTP/RPC is bounded.
  In-flight RPC completion, failure recording and health reads have bounded drain
  time after admission closes; the scheduler HTTP timeout is 90 seconds.
  Remaining work stays eligible for a subsequent tick. Capacity/backlog must be
  monitored; five minutes is a polling interval, not a guaranteed SLA at scale.
- Known chains (including departed/deleted payers) use current RevenueCat API v2
  facts, exact original transaction, Apple App/product and environment. Generation
  fencing rejects an older in-flight read. Repeated runs update the same grant.
- Current transaction effective expiry permits verified grace; cancelling renewal
  keeps paid access. Refund/revocation/expiry cannot be undone by an old payload.
  An outage preserves only the previously verified bounded grant, not extra time.
- First-purchase recovery can use the authenticated inbox or provider event
  history. Missing original transaction identifiers remain pending; an operator
  must resend the original RevenueCat event if history has no usable anchor.
  No customer attributes, guessed IDs or manual Plus grants substitute for proof.
- 401/403 stops the batch, pauses future batch selection and flags review; identity, mapping or chain conflicts
  also require review. After fixing credentials/config, an operator separately
  authorizes clearing only the affected review hold and retry time. Never move
  the chain to another Family or clear all holds without examining their cause.

## Minimum approved Sandbox deployment

1. Verify explicit ref `yhxxsawcaffxonpconaq`, 55 applied versions and their hashes,
   preserved synthetic users/trades and all closed switches. Never use the default
   CLI linked project (`pawday-dev` / `tknaobmlwmodsqtpqwkr` is Production).
2. Apply only the new Recovery forward by the existing reviewed target-bound
   migration procedure, then deploy the changed reconcile/webhook shared bundle.
   Verify new service-only health RPC and existing transaction/entitlement counts.
3. Keep the existing >=32-character `FAMILY_BILLING_RECONCILE_SECRET`, separate
   from webhook/API secrets. Validate mapping/project/keys and both Function
   runtimes. Do not expose it to the App or use an anon/publishable key as auth.
4. After separate authorization, provision Vault endpoint and bearer via a trusted
   parameterized connection/secret mechanism, matching the Function secret. Enable
   pg_cron/pg_net/Vault if absent; use the Sandbox-only installer template at
   `supabase/billing-recovery-sandbox-cron.example.sql`. Its fixed URL and mapping
   checks supplement, not replace, the external database identity guard. It is
   not a Production installer and never changes Billing/Quota/Release Lock.
5. Separately authorize a bounded Sandbox processing window (runtime + DB Billing
   ON, Lock OFF, Quota OFF). Cron must refresh the existing Family A expired chain
   and Family B's then-current provider state without opening the App. Repeat a
   tick; verify one subscription/grant per chain, unchanged ownership, no new
   purchase, fresh `checked_at` and resolved deferred events. Stop on mismatch.
6. Close the window using the established close procedure; independently verify
   DB/Functions/client OFF, Lock ON and Quota OFF. Preserve all history. A closed
   Sandbox intentionally cannot process renewal/refund events until authorized.

## Monitoring and stop procedure

Use Dashboard Cron job history **and** `net._http_response`; Cron SQL success only
proves enqueueing, not HTTP success. The response is an aggregate count/health
summary. Function logs emit `billing_recovery` / `billing_reconcile_failed` with
sanitized codes, never payer/Family/transaction identifiers or provider payloads.

Service/admin-only `get_family_billing_recovery_health()` reports due/deferred,
oldest unchecked/deferred age, repeated failures and review/auth failures.
Investigate immediately on auth/review, >=3 failed attempts, deferred >5 minutes,
unchecked >15 minutes, or an enabled job with no HTTP completion for >3 minutes.
503 must be investigated, not hidden by Cron's enqueue success. Until an existing
alert integration is configured, a named operator must actively monitor these
Dashboard panels during acceptance and inspect them at least every five minutes
while the paid service is enabled. No alert destination was created here.

For incidents pause the job with `cron.unschedule('homeypaw-billing-recovery')`,
then use the approved window-close procedure if appropriate. Retain evidence,
fix credentials/provider errors and rerun current-state recovery; do not delete
inbox/subscriptions/media, repair history, forge webhooks or rebind purchases.

Production charging needs a separately approved target-bound deployment,
environment-specific Vault/secret setup, functioning background recovery and
monitoring. Closing a purchase UI or cancelling Apple auto-renew must not switch
off lifecycle processing for existing paying families. A maintenance lock or
disabled runtime deliberately pauses writes and must be handled as an incident.

References: [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[Function limits](https://supabase.com/docs/guides/functions/limits),
[RevenueCat delivery retries](https://www.revenuecat.com/docs/integrations/webhooks).

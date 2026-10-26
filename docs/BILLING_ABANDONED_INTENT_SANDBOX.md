# Sandbox local purchase request abandonment

Status as of **2026-10-26**: the Sandbox migration was deployed and independently
verified; Owner A / Family A's single historical Monthly request was safely
closed as `abandoned`, with identical-argument replay verified as idempotent.
The original request, expired subscription history and immutable audit remain;
Apple's transaction outcome is still `unknown`. It no longer blocks checkout.
This is a dated accepted result, not a new cloud check or authorization to repeat
the operation. Production must never receive this migration.

All three Sandbox forwards (`20261025143824`, `20261026051034`, `20261026074212`)
are deployed and verified, and now live only in `supabase/sandbox-migrations`.
The existing **Owner A / Family A** is admitted for the formal 14-day Apple
review window through **2026-11-09 17:14:06 HKT** (stored fractional second:
`.755111`). During review, Sandbox Database Billing / Functions Sandbox Billing
are **ON**, Quota Enforcement **OFF**, and Release Lock **OFF**. **Cron #7 is
enabled** for that authorization generation; expiry closes Database Billing,
revokes the admission and restores Lock ON. Functions Billing is restored OFF
separately after closure. The real short Cron close rehearsal already passed.

iOS 1.4.0 Build 12, Monthly, Yearly and the subscription group are all Waiting
for Review. No client change or rebuild is needed. See the dated status and
two-directory manifest rules in
[the Sandbox deployment README](../supabase/sandbox-migrations/README.md).
Do not put real user identifiers, account emails, credentials, Tokens, cloud
Secrets or raw evidence into Git. No Production operation is authorized here.

## Meaning and limits

`abandoned` terminates the local request, not an Apple payment. Its outcome remains
unknown. The original Intent and append-only audit survive, including after a
verified late chain is attached through an exact `family_store_subscriptions.intent_id`
or the explicit Family-only ambiguity audit.
The abandoned row never changes to `fulfilled`, and cannot be reopened or deleted.

Build 12's existing purchase/state RPCs exclude `abandoned` from checkout blocking.
The server context, Recovery work selection and health continue including
unconsumed abandoned requests, so Recovery still searches trusted provider events.
No client change, RPC argument/response change or Edge deployment is required.

New transaction chains still require the existing authenticated provider snapshot
and admitted event anchor: environment, store, app, entitlement, ownership,
customer, original customer, product and actual original transaction chain must
match. Known chains retain their existing Family and are never reassigned.

For new chains, candidates include unconsumed `prepared`, `store_pending` and
`abandoned` requests with the existing transaction-start constraints. No maximum
Apple latency is inferred from local abandonment.

- One candidate: retain the existing exact Intent association.
- Several candidates, all for the same verified payer and Family, including an
  administratively audited abandoned request: grant that Family from the verified
  provider snapshot without selecting an Intent. Store `intent_id=NULL` and one
  immutable `family_billing_intent_ambiguities` record containing every candidate,
  their full snapshots, the verified subscription snapshot and source event.
- Zero candidates, cross-Family candidates, unusable/non-Owner identity, wrong
  customer/app/product/environment or missing source event: retain the existing
  safe denial/manual-review path. No other Family's purchase can be claimed.

The nullable Intent association is protected by a deferred constraint trigger;
without the matching audit the subscription transaction cannot commit. Historical
non-null associations are not rewritten. Known chains keep their original Family.

The audited candidate set ceases blocking local checkout, while the records retain
their original statuses and chronology. This does not call one specific request
paid or failed; an abandoned request remains abandoned. Candidates remain available
for late-chain investigation/reconciliation. Existing `purchase_blocked` still
prevents another checkout while the verified subscription is active.

The private purchase/state delegates use this local-blocking predicate. Public
Build 12 signatures, response fields and admission checks remain unchanged. No
client modification, new account/email or Edge Functions deployment is required.

Local tests verify that the ambiguous same-Family path immediately exposes `plus`
through Build 12's existing state RPC after the trusted snapshot is applied.
Provider delivery/network latency is outside this guarantee. This change does not
make a transaction owned by another payer eligible for Family A, resolve a missing
provider event, or make an unreported Apple payment impossible. Any separately
authorized future request closure must obtain fresh trusted evidence and verify
its current safety baseline; the completed operation's evidence cannot be reused.

## Files and local validation

- `supabase/sandbox-migrations/20261026074212_family_billing_abandoned_intent.sql`
- `scripts/verify-family-billing-abandoned-intent.mjs`

Run `node scripts/verify-family-billing-abandoned-intent.mjs`. It uses only a
disposable DB cloned from the fixed local `supabase_db_pawday` container plus
provider mocks. It removes the DB and checks persistent local fingerprints. It
does not call provider/cloud APIs, run Cron, purchase or restore.

## Completed deployment and single-Intent procedure (historical)

These are the pre-activation steps already completed on 2026-10-26, including the
then-closed safety baseline. They are not the current review-window state and
must not be rerun against the already abandoned request or active admission.

1. Obtain explicit authorization for deploying this one Sandbox migration and
   closing the specific Owner A request. Verify project ID
   `yhxxsawcaffxonpconaq`, fixed verified TLS Session Pooler and same-session
   server identity. Never inherit `.env.local`, a linked ref or a fallback URL.
2. Recheck the exact Sandbox migration versions **and statement contents**, not
   just count. Expected starting history is the previously verified 58 entries,
   including `20261026051034`. Prepare an isolated deployment manifest containing
   precisely those 58 plus this forward; confirm only this forward is pending.
   Keep it outside the repository's Production `supabase/migrations` chain.
3. Verify DB Billing OFF, Functions Billing OFF by read-only secret-state checks,
   Quota OFF, Release Lock ON, no effective admissions or active temporary Cron.
   Deploy only this forward under trusted direct maintenance context. The SQL
   seeds no admission, scheduler, switch, request or entitlement.
4. Independently verify history, new function definitions/ACLs and RLS; confirm
   all switches, existing policies/90-minute and 14-day guards, actual Intent,
   subscriptions, entitlements and Cron are unchanged. Verify the new ambiguity audit is empty and null subscription links cannot commit without it. Do not combine deployment
   success with an unverified Intent mutation.
5. Resolve the full target IDs for the historical Monthly request, Owner A and
   Family A from the private audit. Verify exact customer = authenticated user = RevenueCat App User
   ID, current usable Owner membership, Monthly product, `store_pending`, expired
   local request and no other active pending request for this payer/Family.
6. With the protected RevenueCat read-only key, make fresh **paginated GETs** for
   that exact project's customer, Sandbox subscriptions, transactions, events,
   active entitlements and product/app identities. Check ownership/original
   customer, any pending payment/change, event/chain identity mismatch and
   cross-Family binding. Stop on inconsistency, incomplete pages or errors.
   Known expired chains may remain. New confirmed transactions/events,
   outstanding payments, active entitlements or conflicting identities require
   investigation instead of abandonment. Absence in RevenueCat is not proof of
   Apple failure.
7. Save the raw read-only result to a private `0600` audit artifact (no secrets).
   Build the evidence object below, and compute `evidence_sha256` over that saved
   artifact. Use a new operation UUID once and retain the **exact** object for
   idempotent replay. `observed_at` must be after the local request expiry and no
   older than two minutes at the database check. Refresh GETs if it becomes stale
   before the first successful call. Never assert zero unless actually checked.
8. In one direct administrator DB transaction with **no JWT/request context**,
   bind the three full IDs and the evidence as parameters, then invoke:

   ```sql
   begin;
   set local statement_timeout='10s';
   set local lock_timeout='800ms';
   select private.abandon_family_billing_intent(
     :intent_id::uuid, :owner_a_id::uuid, :family_a_id::uuid,
     :operation_id::uuid, 'local_request_ended_apple_outcome_unknown',
     :provider_evidence::jsonb
   );
   commit;
   ```

   These are binding placeholders, not ready-to-execute literal SQL. Use the
   verified explicit Sandbox wrapper; assert nonempty structured SQL output and
   ON_ERROR_STOP. The function is invoker-only, private and not executable by
   `anon`, `authenticated` or `service_role`. It serializes payer, Family and
   Intent, rechecks database transactions/events/entitlements, and atomically
   inserts audit plus changes only `store_pending` → `abandoned`. Its temporary
   trusted transaction-local release-write bypass is restored before returning;
   Billing/Lock/Quota/Cron values are not modified. A lock/error aborts everything.

9. Independently verify one abandonment audit row, empty transaction-ambiguity audit, exact before/after binding, outcome
   `unknown`, status `abandoned`, no deletion, no subscription/entitlement changes
   and unchanged safety state. Repeat the same function arguments once to verify
   the same audit is returned without another change. Preserve the audit output
   privately. Do not open a real review window or purchase merely to check the
   `pending_intent` response: the expired review identity correctly cannot read
   protected RPCs. The predicate and Build 12 calls are locally tested; any live
   authenticated check needs a separately authorized admission.
10. Stop after the authorized closure. The separately authorized formal 14-day
    activation was subsequently completed, as recorded above. Any further manual
    transaction resolution requires separate authorization. Never delete the
    abandoned row or audit as rollback; a real late transaction may reference it.

Required trusted-operator evidence schema (substitute actual checked values):

```json
{
  "observed_at": "<fresh timestamp with offset>",
  "project_ref": "yhxxsawcaffxonpconaq",
  "rc_project_id": "<configured RevenueCat project>",
  "app_id": "<configured Apple app>",
  "entitlement_id": "<configured entitlement>",
  "customer_id": "<Owner A UUID>",
  "original_customer_id": "<same Owner A UUID>",
  "intent_id": "<exact target Intent UUID>",
  "product_id": "<configured Monthly product>",
  "environment": "SANDBOX",
  "store": "APP_STORE",
  "transaction_outcome": "unknown",
  "pagination_complete": true,
  "transactions_since_intent": 0,
  "events_since_intent": 0,
  "active_entitlements": 0,
  "pending_payments": 0,
  "evidence_sha256": "<sha256 of private read-only result artifact>"
}
```

This object is a direct administrator's auditable attestation, not a provider
signature and not an API capability. SQL cannot authenticate a JSON claim of an
HTTP response; the private function therefore rejects all API callers and relies
on the trusted operator for the provider GETs. Database rechecks and conservative
late-chain matching remain mandatory regardless of this evidence.

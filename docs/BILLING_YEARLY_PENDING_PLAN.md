# Sandbox Yearly Pending: completed deployment and maintenance record

Updated **2026-11-01** from the authorized operation's saved verification evidence.
The Yearly forward was deployed and the specified request safely abandoned on
**2026-10-31**. This update is local documentation only, with no fresh cloud query.
Build 14 client changes remain a separate, not-yet-built release candidate.
Scope: independent Sandbox `yhxxsawcaffxonpconaq`, existing Owner A / Family A.
Never use this runbook or its migration in Production. Keep real identity
values, credentials, transaction identifiers and raw evidence outside Git.

## Accepted completion snapshot — 2026-10-31

- Migration **20261031141904: PASS**, History **60**, original 59 entries unchanged.
  Deployed SQL/hash and private function body/ACL were independently verified.
- Exact Yearly request **abandoned**, immutable audit retained, identical replay
  **PASS**; Apple payment outcome remains **unknown**, not failed/cancelled.
- Completely paginated RevenueCat verification covered the existing expired
  subscription, 12 historical transactions, 11 historical events and identity
  aliases. No new transaction/event, pending payment, active entitlement or
  ownership conflict was found. That absence does not prove Apple failure.
- Owner A / Family A remained Free, active entitlements **0**, blocking Pending
  requests **0**; all other Intents, subscriptions and entitlements were preserved.
- Restored review start: **2026-10-31 23:56:45.286226 HKT**.
  Actual expiry: **2026-11-09 17:14:05.286226 HKT**, within the original cap
  **2026-11-09 17:14:06.755111 HKT**; no new full 14-day grant was added.
- New generation and **Cron #8 active**, old **Cron #7 inactive**. The deployed
  deadline checks deny new protected operations independently of Cron timing.
- Final Sandbox Database / Functions Billing **ON**, Release Lock **OFF**,
  Quota **OFF**; Functions pause/resume were separately verified. Final approved
  account access, Billing State and Family Plus Summary reads passed.
- No Production connection/change, StoreKit purchase/restore, Edge deployment,
  EAS action or Git mutation was performed. Private evidence stays outside Git.

The procedure below records the completed operation's gates. It is not an
instruction to repeat deployment or abandonment. Any future cloud write needs
separate authorization and a fresh identity/state/evidence check.

## Client repair and evidence boundary

The preceding read-only investigation found a new Yearly `store_pending` request
created on 2026-10-31 at 19:52:52 HKT. At that investigation's snapshot, Family A
was Free, its Monthly history was expired, and RevenueCat had no new Yearly
subscription/event or active entitlement. This document does not recheck those
facts. The actual Apple payment outcome remains **unknown**.

Build 14's local client change permits the existing authenticated Owner product
read while Pending exists. It keeps the environment, admission, Billing Gate,
Release Lock and Family checks. Checkout and entitlement authority are unchanged.
Pending cannot itself become a product-loading error, and product reads do not
call purchase preflight, begin/update Intent, purchasePackage or grant access.

The new focused Mock is `scripts/verify-family-plus-pending-prices.mjs`.
The existing review Mock also checks the actual billing-client product-read path
with Pending and verifies that checkout rejects it before creating another Intent.
These are local fixtures, not a StoreKit purchase or production certification.

## Trusted evidence before deciding whether to abandon

1. Reverify the exact Sandbox project, Owner UID, canonical Owner membership,
   Family, customer/original customer, target Intent, configured Yearly product,
   expected `store_pending` status and local expiry. Do not use a latest-row guess.
2. Read fresh, completely paginated RevenueCat Sandbox customer subscriptions,
   events and active entitlements. Validate the configured app, App Store,
   environment, product and ownership, and check aliases/identity conflicts.
   Read subscription transactions for any relevant known or newly discovered
   chain. Compare the database bindings, webhook inbox, entitlements, other
   blocking requests, unresolved attribution and customer recovery/review flags.
   Any incomplete response, inconsistency, real pending payment, new confirmed
   transaction or ownership dispute stops abandonment for investigation.
3. If a trustworthy Apple transaction/original transaction identifier becomes
   available, use Apple's Sandbox App Store Server API status/history and verified
   signed transaction/renewal data. Verify signature, app/bundle, Sandbox, product,
   chain and attribution. An Intent UUID is not an Apple transaction identifier;
   do not invent one or infer a transaction's result from its creation time.
4. A successful transaction belongs in the existing trusted reconciliation path,
   with the Family/chain protections intact, even if it is already expired now.
   Do not abandon the local request as a substitute for processing that evidence.
5. If no trustworthy transaction is discoverable, the final Apple outcome cannot
   be proven. Absence from RevenueCat does not mean Apple failure. A local
   abandonment can only record that the request ended with outcome **unknown**,
   retain future reconciliation, and never imply failed/cancelled/refunded.

Capture actual read-only results in a private `0600` artifact outside Git. Hash
the evidence, retain complete-pagination proof and use the original workflow's
freshness boundary (no older than two minutes and after local expiry). Never
claim a zero count that was not actually checked. Refresh the evidence if stale.

RevenueCat's documented [customer resource endpoints](https://www.revenuecat.com/docs/api-v2/customer/resources)
provide subscriptions, events and active entitlements; they are not device SDK
getOfferings logs or proof that an unreported Apple transaction never occurred.
Apple's [subscription status endpoint](https://developer.apple.com/documentation/appstoreserverapi/get-all-subscription-statuses)
requires a real transaction identifier. No new cloud requests are made by this plan.

## Deployed minimal forward migration

The CLI generated version **20261031141904**. The file lives **only** at
`supabase/sandbox-migrations/20261031141904_family_billing_yearly_abandonment.sql`.
No deployed SQL was edited. The forward adds one private function; it changes
no account, Intent, transaction, entitlement, setting, admission, RLS or job.
SHA-256: `9431e8e34c144d4b747825e70a3a8373aa6f2c7d78febdb2c75cfd1c63bfb2a6`.

New private function signature:

```text
private.abandon_family_billing_yearly_intent(
  target_intent_id uuid, expected_owner_id uuid, expected_family_id uuid,
  expected_product_id text, operation_id uuid, reason text, provider_evidence jsonb
) -> jsonb
```

The existing Monthly-only function is unchanged. The Yearly-specific function
reuses its transaction, baseline, audit and evidence rules, with an exact
expected-product parameter checked against both the row and configured Yearly SKU:

- Strict Sandbox environment plus independently checked deployment project;
  trusted direct maintenance session with no JWT/request context. Revoke EXECUTE
  from PUBLIC, anon, authenticated and service_role; no public RPC or client setter.
- Require Database Billing OFF, Release Lock ON, Quota OFF and no valid admission.
  Independently require Functions Billing OFF in the operator preflight. The new
  function requires recent, same-project/SANDBOX OFF evidence as well as provider
  evidence, both observed after the most recent Release Lock update. SQL trusts
  the direct administrator's attestation; it cannot fetch provider data or Secrets.
- Same lock order: Release Lock/config/quota, payer, canonical Owner/Family,
  Family usage, exact Intent. Assert expected identity/product/state/expiry under
  locks. Recheck all relevant database transaction/entitlement/conflict evidence,
  including recovery/review flags and any related Intent ambiguity audit, before
  writing. In the existing schema `resolved_at` records Family consensus; it does
  not establish an exact Intent. Do not treat its non-null value as permission
  to abandon another request automatically.
- Reuse `family_billing_intent_abandonments` and its immutable audit trigger.
  In one transaction, insert the full before/evidence audit and change only the
  target local status `store_pending` to `abandoned`, outcome `unknown`.
  Keep original row, identity, product, timestamps, history and entitlements.
- Exact-argument replay returns the original audit without another mutation.
  Different operation/evidence or unexpected state rejects; a trusted late
  snapshot and the administrator operation serialize on the payer/Family locks.

The existing abandoned-state guard and audit table are product-neutral, so no
new state/table is required. `node scripts/verify-family-billing-yearly-abandonment.mjs`
passed in a disposable local Docker database: legal Yearly closure/replay,
identity/product/role/environment/evidence denial, trusted transaction/access
rejection, concurrency, status/audit rollback, original Monthly closure, late
binding and Family ambiguity, failed close/restore and bounded deadline restore.
The original public/private function definitions, ACLs and RLS remained identical
across installation. The persistent local DB fingerprints were unchanged and
the scratch DB was removed. These are SQL fixtures, not real provider evidence,
Functions runtime verification or a repeat pg_cron rehearsal.

## Late transactions and future Intents

Keep the currently deployed trusted snapshot matching unchanged. It already
considers `abandoned` for both configured products, and Recovery retains those
requests as evidence candidates:

- A known chain keeps its established customer and Family; never reassign it.
- A new chain must pass provider app/environment/store/product/ownership,
  customer/original-customer checks and the trusted event anchor.
- One eligible candidate permits an exact association. Its abandoned local state
  and audit remain immutable; entitlement comes from the verified transaction.
- Old Yearly plus future Yearly candidates in the same uniquely established
  Family can use the existing Family consensus path when an abandoned candidate
  is present. Leave `intent_id` null and retain the immutable full candidate
  ambiguity audit; grant that Family only from the verified transaction.
- Cross-Family candidates, conflicting customer/alias/chain or missing Owner
  authority stop automatic assignment and require review. Never pick the newest
  request. Monthly and Yearly candidates are filtered by the actual product.

No RevenueCat configuration change, public RPC contract change or **Edge Function
redeployment** is needed for this narrow SQL extension. Do not change
the trusted matching algorithm or bypass verification to finish review sooner.

## Completed close and restore procedure — historical

The completed operation retained the closed-window prerequisite. It did not run
abandonment inside the open review window. Its separately authorized sequence:

1. Save the existing admission/generation/deadline and exact Cron binding outside
   Git. Use the deployed generation-checked
   `private.close_family_billing_app_review_window(owner,generation,true)` path;
   set Functions Billing OFF separately. Confirm Database Billing OFF, Lock ON,
   Quota OFF, no valid admission; disable/verify the old generation's close task.
   Do not clear webhook/history records while processing is temporarily closed.
2. Deploy only the separately approved new Sandbox forward. With the closed
   baseline intact, refresh trusted evidence and invoke the new exact-bound
   Yearly administrator function. Replay identical arguments once for idempotency.
   Stop on new evidence/conflict; never force a status or manually grant Plus.
3. Verify the target row/audit, preserved history, Free/access facts and absence of
   blocking requests, plus retained late-transaction candidates. Do not use lack
   of a provider record as proof of Apple failure.
4. Use existing `private.approve_family_billing_app_review` to create a **new
   generation** for the remaining authorized time only. Preserve the original
   deadline **2026-11-09 17:14:06.755111 HKT**, not another fresh 14 days. Calculate
   remaining whole seconds with a safety margin in the same DB transaction;
   validate the returned expiry is no later than that deadline, otherwise roll
   back. If the deadline has elapsed, require new authorization instead.
5. Approval must atomically install the new exact-generation closer. Verify its
   active task, command, generation and expiry before reopening Database/Functions
   Billing and returning Lock OFF; Quota stays OFF. Do not assume the new task
   is still job #7. Old generation jobs must not close the new window.
6. Read-only acceptance: correct Owner/Family, admission, actual entitlement,
   purchase state, unchanged products and new close task. On any failure use the
   existing safe closer and restore Functions OFF / Database OFF / Lock ON.
   No purchase/restore test or repeat Cron rehearsal is needed for this operation.

This plan does not authorize closure, extension, Secret updates, migration
deployment, Intent modification, Build/Submit or Git Commit/Push.

## Historical operator gates used for this deployment

Do not execute this sequence again. The retained adapter is pinned to the
**59 → 60** transition and exact approved Yearly hash. It rejects the already
applied 60-entry baseline; that is expected and must not be repaired or relaxed.

### Verified Session Pooler adapter

Direct IPv6 is unreachable from the current operator network. The official
Sandbox Connect panel supplied the Session Pooler host
`aws-0-ap-southeast-2.pooler.supabase.com`, port **5432**, database `postgres`,
and username `postgres.yhxxsawcaffxonpconaq`. These are an exact allowlist for
this Sandbox, not a region-derived wildcard. Port 6543 (transaction mode),
another tenant/user/host, and connection-parameter overrides are rejected.
The existing Direct configuration checks and Production runtime checks remain.

`scripts/lib/billing-sandbox-session.mjs` supplies the operator adapter;
`scripts/check-billing-sandbox-session.mjs` exposes **read-only preview only**:

```sh
node scripts/check-billing-sandbox-session.mjs \
  --config /absolute/private/manifest.json \
  --confirm-project-ref yhxxsawcaffxonpconaq \
  --ca-file /absolute/private/official-supabase-ca.crt
```

The external manifest and CA must be owned by the operator, regular non-symlink
files with mode 0600, outside Git. Keep the password/complete URL in that private
manifest only. The Session URL must specify `sslmode=verify-full` and the same
absolute CA path as `--ca-file`; there are no other permitted URL parameters.
The public CA was downloaded using the Sandbox Dashboard Database Settings
link. Pinned CA SHA-256:
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
Legacy Direct manifests with `sslmode=require` remain accepted offline, but the
execution adapter **always** enforces verify-full with this CA. No verification
bypass or fallback is available; CA rotation requires a new official check.

The adapter uses one `psql -X -w` process through the fixed local Docker client's
binary, with explicit host/port/user/database. It clears inherited PG options,
passes the password through a subprocess environment variable (never argv),
passes the CA in memory, and suppresses raw error/SQL output. Preview forces
read-only transactions. It checks actual postgres session/current role,
database name, SANDBOX marker, the existing maintenance assertion, session
continuity across transactions, and transaction advisory-lock release. Project
binding additionally uses the exact official tenant username and the 59-entry
History fingerprint independently confirmed through the project-scoped
management connection: `e83a633011fc81a4050248c7fcc58e7d`.

Real read-only preview passed with all 59 original statement contents matching,
only pending Sandbox version `20261031141904`, and the approved Yearly SHA-256.
The two Production-only compatibility forwards remain excluded. A changed
baseline, extra pending Sandbox migration or altered Yearly file stops the tool.
The pre-deployment connection verification itself changed no migration, Intent,
Secret, switch, grant or Cron; the later authorized operation is recorded above.

The **completed separately authorized deployment** used
`buildYearlyMigrationTransaction()` and `sandboxPsqlInvocation()` from the same
adapter in the protected operator wrapper. The explicit authorized-version
argument accepts only `20261031141904` and that exact generated batch. There is
deliberately no cloud apply command in the preview CLI. The adapter defaults to
read-only and does not infer write authorization from a successful preview.

The SQL file itself remains byte-for-byte unchanged. In its execution copy the
builder adds same-session identity/closed-baseline guards, an exclusive History
table lock and the verified 59-entry fingerprint check after BEGIN; it inserts
the History row and checks function ACLs **before the original COMMIT**. History
stores the complete original SQL as its statement array element. This commits
DDL and History together, rather than applying a self-committing file followed
by separate CLI History registration. A deferred History failure was verified
locally to roll back both; concurrent History locking times out safely, and
replay rejects the now-applied version. Only ephemeral local test databases
substitute their database name and synthetic History fingerprint; the actual
Yearly SQL stays pinned. No cloud DDL/rollback test was performed.

The adapter does not replace the window-close, separate Functions OFF proof,
fresh RevenueCat evidence, exact Intent closure or bounded restore gates below.
Repeating any cloud write would require fresh explicit authorization.

Focused local verification (the CA is public; no cloud credentials needed):

```sh
node scripts/verify-family-billing-target.mjs
node scripts/verify-family-billing-session.mjs --ca-file /absolute/private/official-supabase-ca.crt
```

The second command constructs TLS process parameters and exercises atomicity in
a disposable local Docker database. It never connects to a cloud database.

### Authorized operation order

Use only the previously verified Sandbox deployment/maintenance wrapper with
an external private credential/evidence file and explicit project ref
`yhxxsawcaffxonpconaq`. Never use the repository's linked project, default
`db push`, Reset, Repair or a combined pending-migration push. Set PostgreSQL
`ON_ERROR_STOP`, `lock_timeout='800ms'`, `statement_timeout='10s'` and
`idle_in_transaction_session_timeout='10s'`. Use a direct trusted maintenance
session without JWT/HTTP context. An error stops dependent steps.

1. **Read and save:** verify actual project identity and database SANDBOX marker;
   compare actual Migration History/contents with the three accepted forwards;
   bind the exact Owner/Family/Intent/configured Yearly SKU. Save the active
   admission generation, original expiry including fractional seconds, and its
   exact close job. Save other admission/job snapshots for preservation checks.
2. **Close:** require the saved generation still matches the active row, then
   call `private.close_family_billing_app_review_window(owner,generation,true)`.
   Do not trust its Boolean alone: a stale-generation call deliberately returns
   true without closing a replacement. In the same transaction assert Database
   Billing OFF, Lock ON, Quota OFF and zero valid admissions before COMMIT;
   otherwise raise/ROLLBACK and stop. Disable only that verified old-generation
   job if still active. Do not delete the admission row or touch Recovery jobs.
3. **Pause Functions separately:** set only Sandbox
   `FAMILY_BILLING_SANDBOX_ENABLED=false` using the existing protected Secret
   update path. Read management metadata/digests again to verify the exact
   project, OFF value and update time; keep `FAMILY_BILLING_ENVIRONMENT=SANDBOX`,
   and the Production enable/approval flags false. Never print plaintext Secrets.
   Record the verification time after closure. Management configuration proof is
   not a claim about already in-flight runtime instances: the closed database and
   revoked admission remain the authoritative write barrier. If any independent
   Functions/config verification is unavailable, stop before abandonment.
4. **Deploy the single file:** independently recheck the closed baseline and file
   SHA-256. In the disposable CLI workdir include the exact verified _applied_
   remote History plus **only version 20261031141904** as pending, sourced from
   the Sandbox directory. Inspect the wrapper's read-only preview before applying.
   For this self-committing forward use the atomic Session Pooler batch above,
   not a CLI apply followed by a separate History insert. Do not also run db push.
   Retain the previous Sandbox exclusions for Production compatibility forwards.
   Independently verify History, function signature/ACL and unchanged data,
   switches, grants and jobs after deployment. Failure stops; no Reset/Repair.
5. **Refresh evidence and close the request:** after the above steps, repeat the
   trusted paginated reads. The required evidence contains the original Monthly
   workflow fields plus numeric `identity_conflicts: 0`,
   `unresolved_ambiguities: 0`, and:

   ```json
   {
     "functions_billing": {
       "project_ref": "yhxxsawcaffxonpconaq",
       "environment": "SANDBOX",
       "enabled": false,
       "observed_at": "<actual fresh verification timestamp>"
     }
   }
   ```

   Provider and Functions observations must each be at most two minutes old and
   no earlier than the current Release Lock `updated_at`; the provider observation
   must also be after the Intent's expiry. Bind real values as parameters outside
   Git, then execute one transaction:

   ```sql
   begin;
   select private.abandon_family_billing_yearly_intent(
     :intent_id::uuid, :owner_id::uuid, :family_id::uuid,
     :verified_yearly_product_id::text, :operation_id::uuid,
     'local_request_ended_apple_outcome_unknown', :provider_evidence::jsonb
   );
   commit;
   ```

   Replay the identical operation, reason and evidence once; expect the exact
   original audit. Different evidence/operation, a trusted success or a conflict
   is not permission to force closure. Preserve the evidence artifact and SHA-256.

6. **Verify the closed result:** abandoned/unknown plus immutable audit; all
   history retained, no active entitlement or blocking request, same valid Owner
   and Family. Verify late reconciliation eligibility. Keep the baseline closed
   if a required check fails; do not assume the result is Free from a UI label.
7. **Approve remaining time atomically:** use the original saved expiry, never
   `approve(...,1209600)` again. The following logic is covered by the isolated
   SQL verification; the trusted wrapper binds Owner/Family/deadline parameters:

   ```text
   BEGIN
     assert Database Billing OFF, Lock ON, Quota OFF, no valid admissions,
            and no blocking request for the verified Family;
     remaining_seconds = floor(saved_deadline - clock_timestamp()) - 1;
     assert 0 < remaining_seconds <= 1209600;
     result = private.approve_family_billing_app_review(
       verified_owner, verified_family, remaining_seconds);
     assert result.expires_at <= saved_deadline;
     assert exact new generation/Owner/Family/minute close task is active;
   COMMIT
   ```

   If schedule creation or any assertion fails, roll back the whole approval;
   the closed state remains. If the deadline has elapsed or safe restoration
   cannot be verified, keep it closed and report that a new authorization is
   required. Restoring uses a new generation/job, not re-enabling an old job.

8. **Resume Functions and database separately:** with Database Billing still OFF
   and Lock ON, update only `FAMILY_BILLING_SANDBOX_ENABLED=true`. Independently
   verify that Sandbox configuration/update, without invoking a mutation or
   purchase test. Then in one maintenance transaction recheck the current
   Owner/Family, new generation, unexpired bound deadline, exact active close
   task and Quota OFF; only then set Database Billing ON and Lock OFF. Failure
   invokes the generation-checked safe closer and restores Functions OFF.
9. **Final read-only acceptance:** record exact new start/expiry in HKT, Billing
   and Functions configuration, Lock OFF, Quota OFF, correct admission, actual
   Free/transaction facts, unchanged products and retained historical/audit data.
   Compare other admission/jobs with step 1. No purchase, restore or real Cron test.

The real Sandbox restore **passed**, including separately verified Functions
pause/resume and the bounded replacement generation/Cron. Its accepted snapshot
appears above. A later restore would require new authorization and live evidence;
these historical results and local fixtures cannot substitute for that.

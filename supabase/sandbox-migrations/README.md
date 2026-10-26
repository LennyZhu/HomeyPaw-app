# Billing test and App Review migrations (Sandbox only)

## Verified status — 2026-10-26

This is the accepted deployment/activation record, not a new cloud check. All
three Sandbox migrations below were deployed and verified in the independent
Sandbox `yhxxsawcaffxonpconaq`; the real Cron close rehearsal passed. iOS 1.4.0
Build 12, Monthly, Yearly and the subscription group have been submitted to Apple
App Review and are all Waiting for Review. Build 12 remains unchanged.

- The formal 14-day `app_review` admission uses the existing **Owner A / Family A**.
- Admission began **2026-10-26 17:14:06 HKT** and expires
  **2026-11-09 17:14:06 HKT** (stored fractional second: `.755111`). Sandbox
  Billing opened at **2026-10-26 17:14:20 HKT**.
- During this review window: **Database Billing ON; Functions Sandbox Billing
  ON; Quota Enforcement OFF; Release Lock OFF**. This grants no Production access
  or permission to enable Production charging.
- The old Monthly `store_pending` request was safely closed as `abandoned`;
  Apple's transaction outcome remains `unknown`. The request no longer blocks
  checkout; historical transactions, the request and its audit remain intact.
- **Cron #7 is enabled**, bound to the verified admission generation. At expiry
  it closes Database Billing, disables that admission and restores Release Lock
  ON; it then disables itself. Protected operations also reject expired access
  if Cron is delayed. Restore the Functions Sandbox Billing Secret OFF separately
  after closure using the existing authorized procedure.

Keep real Auth/Family/Intent UUIDs, account emails, passwords, Tokens, cloud
Secrets and raw operator evidence outside Git. Owner A / Family A are labels,
not embedded credentials. Do not re-run a deployment, abandonment or activation
from this status record; further cloud operations require separate authorization.

## Source isolation and unchanged SQL

This directory is intentionally **not** `supabase/migrations`. Its forwards are
excluded from the normal Production CLI migration manifest. Do not copy them
into a Production deployment. No credential, test identity, subscription or
approval is embedded here. Runtime/admin `environment='SANDBOX'` checks supplement,
but cannot replace, independent project identity verification. The 90-minute
forward does not reject Production at installation time: directory/manifest
isolation is mandatory. **Production must execute none of these three files.**

| Version | File in this directory | Deployment | SHA-256 |
| --- | --- | --- | --- |
| `20261025143824` | `20261025143824_family_billing_test_window_guards.sql` | Verified | `a71b2b0925166535369e74a7e0d1bee9bd03ed30b13d9fb315bd1cdc156816b7` |
| `20261026051034` | `20261026051034_family_billing_app_review_access.sql` | Verified | `591aa2265c01f91de1e1529b2926eb5c3e92dc16e66dc223ccf0403dc980dd5e` |
| `20261026074212` | `20261026074212_family_billing_abandoned_intent.sql` | Verified | `abb9cad7ee95f04999ef66a90c5cd4dffe8c82f747218c97095c22b0eb7732e6` |

On 2026-10-26, the first file moved from the default migration directory to this
directory with identical bytes, filename, version and SHA-256. No deployed SQL
or remote History changed. The Production directory retains the 58-file RC
baseline; the latest accepted Sandbox History has 59 entries. Two Production
compatibility forwards are absent from that Sandbox History. Never copy every
file from both directories into a Sandbox CLI manifest.

### File selection for the existing Sandbox deployment wrapper

Cloud wrappers are one-time, protected operator artifacts outside Git. Keep their
historical manifests/results intact. When preparing a separately authorized new
wrapper, replace a default-directory-only source lookup with this local lookup;
retain the existing connection, History/content, private credential and safety
guards. This function only resolves files and does not connect or deploy:

```python
def sandbox_migration_sources(root, verified_project_ref):
    if verified_project_ref != 'yhxxsawcaffxonpconaq':
        raise ValueError('SANDBOX_PROJECT_REQUIRED')
    available = {}
    for directory in ('supabase/migrations', 'supabase/sandbox-migrations'):
        for path in (root / directory).glob('*.sql'):
            version = path.name.split('_', 1)[0]
            if version in available:
                raise ValueError('DUPLICATE_MIGRATION_VERSION')
            available[version] = path
    return available
```

After independent same-session Sandbox identity and History verification, use
`available = sandbox_migration_sources(ROOT, verified_project_ref)` and select
only `available[row['version']]` for the exact verified applied History plus
the single separately approved pending forward. Compare original statement
contents and hashes before copying into the disposable CLI workdir. The three
files above are already applied, not new pending work. Never derive the
verified ref from a linked project/default environment. Never use this lookup
for Production: its standard source is only `supabase/migrations`.

`20261026051034_family_billing_app_review_access.sql` requires the already
deployed `20261025143824_family_billing_test_window_guards.sql`. It adds an
`app_review` admission kind and an unpredictable approval generation to the
existing private approval table. Existing rows default to `development`.
Development access remains bounded by 90 minutes; each review grant is bounded
by 1,209,600 server seconds (14 days). No grant or job is created by installation.

Build 12 is unchanged. Its separate Sandbox Auth session calls
`get_family_billing_test_access`, `get_family_plus_summary`,
`get_family_billing_state`, the existing purchase/intent RPCs and
`family-billing-reconcile`. Review reads and all those user Billing mutations
check the authoritative account/Family/current Owner/environment/approval/
deadline. Mutations recheck after acquiring locks and after delegated work.
The authenticated Edge branch already derives the actor through `Auth.getUser`
and scopes writes through `execute_family_billing_test_user_operation`.
Service-only Webhook/Recovery functions are unchanged. A user cannot select a
review type, change an approval, extend a deadline or call a private worker.
Auth accounts, already loaded content and ordinary Family RLS access are not
deleted/revoked by admission expiry; new protected review reads and Billing
requests are denied. Apple/RevenueCat transaction environment checks remain.

## Completed deployment procedure (historical; do not repeat)

The steps below describe the completed App Review forward installation, before
the formal activation recorded above. Their closed switches are installation
preconditions, not the current review-window state. Any new forward needs fresh
authorization and an independently verified current baseline.

1. Independently verify **yhxxsawcaffxonpconaq**, its actual migration versions,
   and the prerequisite guard definitions. Never use the repository's default
   linked target, Production environment files, or a name as identity proof.
2. Save the current safe switches, relevant function definitions/Owner/ACL,
   policies, existing approval metadata and Cron metadata outside Git (0700/0600).
   Recheck Owner A's current membership, expired Plus and pending purchase intents.
3. Build a disposable CLI working directory containing **only the exact applied
   remote migration versions plus this forward**. Select each original applied
   SQL file from the canonical or Sandbox directory; compare statement contents
   against remote History. Never edit an original, fabricate History or mix in
   older Production-only compatibility forwards absent from Sandbox. This also
   ensures later Sandbox deployments include all its Sandbox-only History.
4. With the established fail-closed wrapper, TLS verify-full and the dedicated
   Sandbox password file, list migrations using explicit `--db-url`. Require
   the sole pending version to be `20261026051034`, then apply it using the
   standard CLI against that same verified target. No reset, repair or retry.
5. Independently verify the new History and definitions, preserved Owner/ACL/
   policies/transactions, no valid approvals, Billing OFF, Quota OFF, Lock ON,
   and exactly unchanged Recovery/old Cron jobs. Installation must open nothing.
6. Cloud acceptance of a real close job is a separately authorized short synthetic
   expiry exercise, not inferred from local SQL/mock scheduler tests. Verify its
   real postgres execution, run details, atomic close and disabled job afterward.
   No new subscription, fake Plus or StoreKit purchase is needed.

No Edge Function or Build 12 deployment is required. The existing reconcile
function must still contain verified-Auth scoping to the dispatcher; stop if its
deployed code differs. Do not route a Sandbox event to Production or change a
Production webhook's environment policy.

## Approval/extension after separate authorization

Use one bounded transaction on the explicitly verified Sandbox connection,
`ON_ERROR_STOP`, `lock_timeout='800ms'`, `statement_timeout='10s'` and
`idle_in_transaction_session_timeout='10s'`. The connection must be a genuine
`postgres`/member `cli_login_postgres` session without JWT or HTTP context.

- Check that all other admissions are disabled and old test close jobs inactive.
  Do not modify `homeypaw-billing-recovery`.
- Resolve any purchase-blocking `store_pending` intent from trusted provider
  evidence under separate authorization. Do not delete/expire it merely by age.
- Call `private.approve_family_billing_app_review(<verified Owner UUID>,
<verified Family UUID>)`. It checks current ownership/Quota OFF and atomically
  installs the new generation's minute Cron. Extension uses the same operation:
  fresh server approval/deadline/generation, old generation job disabled. It never
  opens Billing or changes the committed Release Lock, entitlement or Secrets.
  Its internal unlock/restore is in the same transaction as approval and Cron;
  any failure rolls back the approval, job changes and unlock together.
- Only within an authorized review window, set Sandbox Billing ON and Release
  Lock OFF in the same transaction; verify approval and matching active job
  before COMMIT. Set only Sandbox Functions Billing Secret ON with safe failure
  closure. Quota stays OFF. Independently verify all states and report HKT dates.
- Never use this grant to overlap a 90-minute test window. Direct approval table
  writes remain private and review changes require a genuine maintenance session;
  the trigger rejects extensions without a new generation and approval time.

Release Lock OFF restores the existing ordinary Sandbox write paths for other
synthetic accounts under unchanged Family RLS. This change does not make those
users read-only. They still receive no Billing admission. Do not put real users
or Production data in this project, and control the existing test credentials.

## Close, failure and rollback

The credential-free minute Cron invokes
`private.close_family_billing_app_review_window(user_id,generation)`. At expiry
it closes Billing, disables that approval and restores Lock ON in one transaction,
even if Lock was already ON. It then disables only its own job. A failed close
rolls back and leaves the job active to retry. Monitor that job's
`cron.job_run_details` status; deadline denial does not depend on Cron success.
A stale generation cannot close a replacement window. No management/API Secret
is stored in Cron. Functions Secret is restored OFF manually after closure.

To end a current review early, use the same verified maintenance transaction and
`private.close_family_billing_app_review_window(user_id,generation,true)`, require
`true`, and disable that exact generation's job with `cron.alter_job`. Independently
verify Billing OFF, approval disabled, Lock ON and Recovery job unchanged; then
restore Sandbox Functions Billing Secret OFF. Keep subscriptions/history intact.

An error inside the migration's explicit SQL transaction rolls it back. If CLI
History registration fails after the file's COMMIT, do not assume the schema was
rolled back: stop, inspect definitions/History and do not retry or repair.
After a committed migration, use the safe closure above as operational
rollback; do not drop tables/functions, erase approvals, run a down migration or
repair History. Any code reversal needs a separately reviewed forward. No
Production deployment or permission exception is part of this process.

## Local functional verification (not part of Git cleanup)

`node scripts/verify-family-billing-app-review.mjs`

Uses a disposable local database with synthetic fixtures and a scheduler stub;
checks generated Cron SQL, not a hosted Cron execution. The existing helper
removes the temporary DB and compares persistent Local fingerprints afterward.

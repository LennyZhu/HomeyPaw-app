# HomeyPaw 1.4.0 (14) — Free-plan Production operations

## Decision and scope — 2026-11-03

The latest owner decision supersedes the earlier mandatory-Pro launch order:
launch Monthly/Yearly on Free, keep the approved prices and **5 GiB Family Plus
entitlement**, inspect usage daily, and upgrade for capacity later. Pro is an
operational expansion option, **not a mandatory activation prerequisite**. This
document authorizes no cloud, Git, payment or App Store operation.

## Accepted execution status — 2026-11-03

Production stages 1–4 completed under separate owner authorizations. This status
records their accepted evidence; Git synchronization does not re-query or change
any cloud service.

| Gate                                                        | Accepted result                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Independent encrypted Database/Storage backup and integrity | PASS; private artifacts outside Git                            |
| Isolated local restore                                      | PARTIAL; managed-service limitations in `PRODUCTION_BACKUP.md` |
| Recovery private objects and Production Vault references    | Installed and verified                                         |
| Database/Functions Billing and Release Approved             | ON                                                             |
| Recovery Cron #3 `homeypaw-production-billing-recovery`     | Active; real HTTP/auth/empty-work health PASS                  |
| Quota and authoritative Family usage refresh                | ON; current capacity epoch, no measurement errors              |
| Legacy TUS residual-risk acceptance                         | Explicitly accepted; flag true, strict-admission fact false    |
| `release_ready` / Release Lock                              | false / OFF; new checkout remains closed                       |
| Supabase plan                                               | Free, unchanged                                                |

**Upload-limit exception explicitly accepted by the owner:** the Production Free
Dashboard showed a **50 MB** global limit with editing disabled, while the video
bucket is **25 MiB** (photos 8 MiB, thumbnails 2 MiB, avatars 5 MiB). The original
global-25-MiB recommendation was **not met**. Record the actual 50 MB configuration;
do not represent the bucket cap as proof of a 25 MiB unfinished-TUS bound. The
owner accepted the residual unfinished-part/session-count/physical-cleanup risk
under that actual configuration, independently of overall Free resource risk.
No global limit, price, 5 GiB benefit or approved Build 14 behavior was changed.

The first Quota activation froze T0/capacity epoch at
**2026-11-03 20:40:20.940002 HKT**. Eligible existing Free Families received the
one-time 1 GiB transition ending **2026-11-18 20:40:20.940002 HKT**, exactly 360
server hours later with an exclusive end. Do not reset or extend that clock,
replay activation, reinstall Recovery or redeploy the accepted 58 migrations.
Existing media and original transaction/entitlement records were preserved.

Git baseline synchronization follows its separate owner authorization and is
recorded in the release commit/merge history. Remaining cloud actions are
`release_ready` activation/eligibility verification and App Store manual
publication, each requiring separate authorization. No new build is required for these operational files. Lifecycle
health monitoring and daily resource checks continue; no automatic alert channel
was installed. Sandbox/OrderMori operations remain outside these release actions.

### OrderMori isolation — mandatory hold

OrderMori is independently under Apple review and shares an Apple Sandbox Tester
with HomeyPaw. Never delete/reset its purchase history, change Tester region,
renewal speed or other settings, change OrderMori ASC/IAP/TestFlight/review data,
touch its code/EAS/builds, or trigger another Sandbox purchase for this release.
The shared Tester does not by itself prove a shared Supabase dependency.

Actual OrderMori dependency on HomeyPaw Sandbox is **UNKNOWN** in this local
preparation. Before **any** HomeyPaw Sandbox window closure, Functions flag change
or organization transfer, first prove from permitted configuration metadata that
OrderMori does not use that project's Auth/DB/Storage/Functions, credentials,
Webhook endpoint, Cron/Vault or other shared service. Verify provider App/bundle
and event filters without changing them. If verifying would require touching
prohibited OrderMori code/configuration, obtain an appropriate read-only evidence
path separately; do not assume independence or proceed. Existing HomeyPaw flags
being project-scoped alone does not prove absence of downstream dependencies.

This dependency hold applies **before** the Sandbox close steps below. Production
operations must bind only `tknaobmlwmodsqtpqwkr`; Sandbox operations bind only
`yhxxsawcaffxonpconaq`. Do not rotate/delete shared credentials, change either
app's Apple/RevenueCat configuration, or alter organization billing affecting an
unverified OrderMori dependency. Nothing in this preparation changes OrderMori.

Accepted baseline evidence is the 2026-11-03 read-only audit, not a live check by
this preparation task: Production `tknaobmlwmodsqtpqwkr`, 58/58 matching forwards,
approved Build 14 at `cd5867a588298c778ae79049937fa10f6cd857c5`, existing Billing
Functions and Production-only RevenueCat Webhook passed. Do not replay those
migrations, rebuild the binary, create another Webhook, or redeploy those Functions.
Four Sandbox forwards remain exclusively under `supabase/sandbox-migrations/`.

## Two independent gates

**Initial preparation on Free (completed; do not replay):** local tools/documents ready; separately authorized
operations may verify credentials, take independent backups, provision Vault and
install Recovery **inactive**. Billing, Release Approved, Quota and `release_ready`
stay OFF. Production Release Lock stays OFF to preserve existing 1.3.0 writes.
Preparation GO is not permission to publish the app or accept money.

**Free paid launch:** recoverable backups, exact credential/SDK mapping,
authenticated Webhook and functioning Recovery, metering/accepted-upload-limit/transition gates,
fresh resource headroom, named monitoring owner and explicit operational risk
acceptance must pass. A paid plan is not checked by the existing purchase gate.
No Pro-only check or new client/Billing interface is introduced here.

## Free capabilities and limits

Billing SQL, private RPCs/RLS, pg_cron, Vault, pg_net, existing Edge Functions,
RevenueCat Webhook/Reconcile and quota enforcement can operate on Free. RevenueCat
is a separate provider: confirm the existing reader's Customer Information,
subscription, transaction and event read permissions, SDK Apple public-key/App
mapping, and matching Webhook bearer without printing credentials. App/Product
read success alone does not prove Customer/transaction read scopes. Check the
existing configuration; do not create a duplicate integration or expand scopes
without need. No purchase is needed for configuration/read-only checks.

Free includes 500 MB database quota, fixed 2 GB disk, organization-shared 1 GB
Storage, 5 GB uncached and 5 GB cached egress per billing cycle, 50k MAU, 500k Edge
invocations, 2m Realtime messages and 200 peak connections. Organization usage
still includes Sandbox until transfer. Database billing averages and live disk
usage are distinct; record both the organization Usage page and project disk.
Free projects can pause after a week of low activity and lack managed daily
backups, PITR, paid support and an always-on guarantee. Cron activity alone is
not evidence that automatic pausing cannot occur.

The minute Recovery schedule adds about 43,200 Function invocations per 30-day
month, plus its small RPC/egress footprint. Include existing push/other functions
and Sandbox in the shared organization budget; it is not a separate paid Cron
subscription. No automatic paid Add-on or Compute resize is required to install it.

### Risks requiring explicit acceptance before paid launch

- **1 GB aggregate Storage cannot guarantee one Plus Family can immediately fill
  its 5 GiB entitlement.** The audit measured approximately 513 MiB already used.
  Even the launch transition's 1 GiB cap is a Family limit, not reserved physical
  capacity. Parallel or burst uploads can exhaust the remaining shared capacity
  between daily checks. This is real availability risk, not a reduced entitlement.
- Free fair-use restrictions can cause HTTP 402/API failures. Fixed disk pressure
  can place the database in read-only mode around 95% or stop it when full, even
  when application media quotas look fine. Egress includes downloads, backup
  transfers and other services, not only uploaded media.
- Pausing, provider faults or missed monitoring can delay paid entitlement grant,
  refund/revocation handling and upload availability. Free has no managed backup
  safety net. Daily capacity review alone does not detect a failed Webhook or
  Recovery worker promptly; the existing lifecycle runbook calls for five-minute
  health checks while paid processing is enabled until an alert integration exists.
- The present application gate has **no automatic Supabase organization-capacity
  cutoff**. The offline checker below is advisory. Do not claim automated safety,
  notification delivery or guaranteed 5 GiB availability.

An operational refusal of an upload must not delete stored media, change a
verified Apple entitlement, forge a refund, or silently downgrade a paid Family.
Reads/downloads/deletes remain permitted by application policy; a platform-wide
restriction can still make these unavailable. No code can promise availability
after the underlying platform has restricted the project.

## Monitoring without a mandatory paid service

Record project database/disk and **organization-wide** Storage/Egress/activity
from Dashboard at least daily, before launches/campaigns and after backup runs.
Use actual billing-cycle boundaries. Store only aggregate usage, never user data.
Copy `supabase/production-free-usage.example.json` to a protected external path,
replace every illustrative value/time and set `verified=true` only after checking
the sources. The example deliberately fails validation as delivered.

```sh
node scripts/check-production-free-usage.mjs /absolute/private/usage.json
```

The checker never connects, sends notifications or changes Billing. It rejects
missing metrics, wrong project, unknown/unverified and >24-hour-old snapshots.
It applies conservative decimal-byte limits, rather than overstating free space.

| Resource              | 70% warning | 85% upgrade trigger | 95% critical |
| --------------------- | ----------- | ------------------- | ------------ |
| Database quota        | 350 MB      | 425 MB              | 475 MB       |
| Disk                  | 1.4 GB      | 1.7 GB              | 1.9 GB       |
| Shared Storage        | 700 MB      | 850 MB              | 950 MB       |
| Egress, each category | 3.5 GB      | 4.25 GB             | 4.75 GB      |

Forecasted exhaustion before cycle end also triggers upgrade review, even below
70%. At warning increase checks to at least every six hours. Upgrade earlier
when expected uploads plus backup/download budget exceed headroom; do not wait
for 85% if a single known upload batch can consume the remainder. With a 5 GiB
promise, a credible request for that capacity is itself an expansion trigger.

Supabase billing/pausing emails should reach a monitored mailbox, but quota emails
can be sent **after** exceeding a quota; they are not a guaranteed early-warning
system. Local checker exit codes are 0 OK, 2 WARN, 3 upgrade/critical, 1 invalid.
For automatic reminders, separately authorize an existing local scheduler/alert
channel to run a verified collector and notify on nonzero/stale results. No
scheduler, email destination, cloud alert or collector was installed here.

Pro expansion later provides larger aggregate allowances, no inactivity pausing
and daily database backups. Upgrade only after user approval; verify the actual
new capacity/backup status. It does not automatically back up Storage objects or
reserve 5 GiB for every Family. Current USD 25 base/compute-credit pricing is an
estimate; a second project left in that organization can add Compute charges.
Transfer Sandbox separately when safe; never create an extra paid organization
or change Compute automatically in response to an alert.

## Production Recovery: reference installation/control procedure

Initial installation and activation below are completed for this Production
project. Retain them for review or a separately authorized recovery target; do
not repeat them as release tasks. Use `health` for later approved read-only checks
and `disable` only for an authorized worker incident.

No installer in this preparation task connects to a database. The SQL generator
requires the explicit Production ref and has no execute mode. Its statements
must later run through a **separately identity-verified** Production Dashboard
or trusted administrator connection. SQL's PRODUCTION marker cannot prove the
physical project. Never use a default linked CLI target, Sandbox Pooler manifest,
unverified host, Transaction Pooler, or disabled TLS verification. If using psql,
obtain the actual Production Connect/CA details; prefer one verified direct or
Session Pooler session with transactions and ON_ERROR_STOP. Do not guess a host.

1. Reuse the accepted 58-forward/source evidence; check for intervening drift and
   required service-only recovery RPCs/extensions, not a full regression. If the
   required objects are missing, stop and design a reviewed forward. Do not replay
   history. Confirm Billing/Quota/release_ready OFF and Release Lock OFF.
2. In this exact project's Vault, provision these **new names only** through the
   trusted Dashboard Vault form or a reviewed parameterized admin connection:
   `homeypaw_production_billing_recovery_url` =
   `https://tknaobmlwmodsqtpqwkr.supabase.co/functions/v1/family-billing-reconcile`;
   `homeypaw_production_billing_recovery_authorization` = `Bearer ` followed by
   the existing dedicated `FAMILY_BILLING_RECONCILE_SECRET` (>=32 nonspace chars).
   Do not rotate it, use a service key, paste it into SQL history, argv, chat or Git.
   Verify exactly one of each name and compare the bearer against the deployed
   Function secret via a protected comparison, emitting only PASS/FAIL. API reader,
   Webhook and Recovery secrets remain separate. A length check alone is not proof
   that the actual two secrets match.
3. Prepare installation SQL locally (the command only writes a local file):

   ```sh
   node scripts/prepare-production-recovery.mjs install --project-ref tknaobmlwmodsqtpqwkr > /private/tmp/homeypaw-production-recovery-install.sql
   ```

   After separate approval, review and execute the generated SQL in one trusted
   Production session. It creates only the private enqueue function, a private
   HTTP-request correlation table, and an **inactive** minute Cron. It checks
   environment, admin role, History count, Sandbox-version absence, core RPCs,
   mapping and unique Vault configuration. It does not update business switches,
   subscriptions, media or Migration History. Collision/re-run refuses instead of
   replacing existing objects. There is no standard `db push` and no new Migration
   or Edge deployment. The raw template is intentionally not executable unchanged.

4. Verify job `homeypaw-production-billing-recovery` inactive, exact command/owner,
   private ACLs and preserved 58 History rows and business switches. The tiny
   correlation table contains only request IDs/timestamps; only its own rows older
   than seven days are pruned. No transaction/audit records are pruned.
5. Lifecycle activation is a **separate authorization**: with `release_ready=false`
   and Lock OFF, enable DB Billing and Functions `FAMILY_BILLING_ENABLED` /
   `FAMILY_BILLING_RELEASE_APPROVED`; keep Functions Sandbox flag false and verify
   both runtime flags independently. No other Family receives a synthetic grant.
6. Generate `enable` SQL with the same command, substituting the operation. After
   authorization execute it; it checks installed source/ACL, enabled DB lifecycle
   and Lock OFF. It does not set any business flag. Inspect the real minute job,
   its HTTP response and existing recovery health/backlog; an empty customer batch
   can prove transport/auth configuration, **not a successful Apple payment**.
7. Generate `health` SQL likewise. Its transaction is read-only and exposes only
   aggregate health, HTTP status and times. Correlation uses the dispatch request
   ID, so unrelated push/cleanup HTTP responses cannot count as Billing success.
   Cron enqueue success is insufficient. Missing completion >3 minutes, non-200,
   401/403, review holds, repeated failures or aging backlog require investigation.
   pg_net responses are transient; retain sanitized acceptance evidence externally.
8. Generate `disable` to pause **only this exact job**, preserving its row/history.
   Disable intentionally works with a broken Vault, without reading its secrets.
   It does not cancel an in-flight invocation or disable Webhook. Enable after an
   incident revalidates source and prerequisites. Never unschedule unrelated jobs.

Existing Webhook authentication, event-ID/digest idempotency, environment/App
filter, verified current provider facts, generation fencing and retry/backoff
logic are unchanged and reuse prior PASS evidence. Before paid activation confirm
the existing Production-only Webhook bearer matches the deployed secret and the
SDK/API reader map to the same App/project. Safe configuration/empty-batch probes
may be authorized separately; do not forge a purchase event to prove money flow.
401/403 requires correction/review, not retrying credentials indefinitely. On
transient errors preserve the last bounded verified grant and queued recovery.

## Release sequence (Free; each write separately approved)

Steps 1–2 and 4–6 are completed as recorded above. Retain their requirements as
historical execution evidence, not instructions to repeat cloud changes. Git
synchronization follows its separate release authorization; step 7 still requires
separate cloud authorization.

1. Complete the backup/restore acceptance in `PRODUCTION_BACKUP.md`, monitoring
   ownership and explicit Free availability/capacity/TUS risk acknowledgements.
2. Install Recovery inactive and verify credentials/reader/Webhook. Existing
   approved code, Functions, 58 forwards and Apple tests are not repeated.
3. Review and synchronize release `develop` -> `main` under separate Git approval
   after these local operational files are reviewed/committed by the owner. Keep
   the Build 14 source commit recorded; operational-only commits do not require a
   new binary. No merge/commit/push/fetch was performed by this preparation task.
4. Enable and verify Production lifecycle/Recovery with new checkout closed, as
   above. Keep normal 1.3.0/Auth/Family/media reads and writes unblocked; do not
   raise the minimum client version or enable the global Release Lock.
5. Record the actual upload controls: global **50 MB** as shown by this Free
   project's Dashboard, with the owner's explicit exception to the original
   25 MiB global recommendation; bucket caps are photos 8 MiB, videos 25 MiB,
   thumbnails 2 MiB and avatars 5 MiB. These do not establish a cumulative bound
   on unfinished TUS transport parts or retained Family sessions.
6. Completed with explicit authorization: `legacy_tus_residual_risk_accepted=true`; never falsify
   `legacy_tus_admission_verified`. In the controlled release window first Quota
   OFF -> ON invokes existing trusted metering/epoch refresh and transition logic.
   Unknown/unmapped usage aborts the transaction; do not zero-fill. The previous
   audit found one stale epoch and one over-300-MiB Free Family, so use fresh data.
   Eligible existing Families get one 1 GiB / **360 server-hour** transition from
   actual T0, not approval date. Existing Plus has priority. Re-enabling cannot
   restart that clock. No user media is deleted when the transition expires.
7. Independently verify epoch, cohort/T0/expiry, effective capacities, RPC/trigger
   readiness, current quota headroom and provider processing. Only then authorize
   `release_ready=true`, verify no-purchase eligibility, and separately authorize
   ASC manual release of approved Build 14. No price or entitlement change.

Normal stop-loss is `release_ready=false`, preserving DB/Functions Billing,
Release Approved, Webhook/Recovery and Lock OFF for existing/in-flight paid users.
Do not switch Billing OFF or Lock ON as ordinary Production rollback. Pause the
Recovery job only if that worker itself is unsafe; keep Webhook processing when
safe. Quota relaxation/media-only admission restrictions require a separate
decision; do not globally lock 1.3.0 collaboration. Do not restore a stale database
over real payments, reset T0, delete media or manually downgrade paid entitlements.

## Sandbox November 2 Pending and Free-organization transfer

Latest existing evidence (not re-queried here): review Family has a new Monthly
`store_pending` created November 2; no live entitlement, three expired subscriptions,
43 processed inbox events and recent November 2 events. Apple outcome is UNKNOWN.
This is **not** the previously abandoned Monthly or Yearly request.

1. Read fresh, fully paginated RevenueCat subscriptions, transactions, events,
   entitlements, pending/payment/product-change and identity/chain information;
   correlate exact Owner/Family/Intent and real transaction identifiers. Inspect
   matching database chains, review holds/inbox and current Owner binding. Provider
   evidence must satisfy the deployed function's two-minute freshness requirement.
   First resolve the OrderMori dependency hold above; until then window shutdown
   and transfer are not executable, regardless of HomeyPaw Pending results.
2. `private.abandon_family_billing_intent(uuid,uuid,uuid,uuid,text,jsonb)` supports
   configured Monthly generally, rather than only the original ID. However it
   requires a closed window, no active entitlement, **zero transactions/events
   since this Intent** and no related DB subscription/event/other-pending conflict.
   November 2 purchase/renewal/expiration evidence can therefore make reuse fail,
   even if access is expired now. Do not submit zero counts after filtering away
   inconvenient evidence. Aggregate event counts do not identify their payer.
3. Prefer the existing authenticated Reconcile/Webhook route if trusted facts
   uniquely link a real chain. If it cannot safely resolve the Intent and Monthly
   abandonment preconditions fail, **stop**: a separate evidence-specific forward
   design/authorization is needed. Do not copy the Yearly exception, delete an
   Intent, guess the latest candidate, or equate local timeout with Apple failure.
   No new Sandbox abandonment code is included in this task.
4. Before final shutdown inventory unresolved events/chain anchors and capture
   protected provider proof. Preserve exact original event IDs and provider
   history for a later trusted resend. Confirm all presently known lifecycle work
   is reconciled; if it cannot be, postpone shutdown/transfer or separately approve
   a bounded reconciliation period. Absence of new records cannot rule out every
   unreported Apple transaction.
5. Bind the **current** review generation, verify it still matches, then use the
   deployed `private.close_family_billing_app_review_window(owner,generation,true)`
   in a guarded transaction. Verify DB Billing OFF, valid admission 0, Quota OFF,
   Lock ON; a stale-generation true return alone proves nothing. Disable only its
   exact matching closer (expected #8, never assumed blindly). Keep original
   deadline and other jobs/data unchanged. Separately set Functions Sandbox Billing
   OFF and verify configuration/digest independently. Do not close Production.
6. Functions OFF returns 503 before inbox ingestion. RevenueCat automatic retries
   are finite (about 80 minutes across five retries); they are **not** a durable
   queue for an offline/free Sandbox. Retain its existing Webhook/integration and
   late-candidate records; before future tests authorize temporary safe processing,
   fetch current provider facts/full history and resend the authentic original
   event through RevenueCat if the first-chain anchor is missing. Do not fabricate
   events, manually grant Plus, or promise that all late events process while OFF.
7. Stop transfer for unknown/non-isolated OrderMori dependency, unresolved new chain/ownership conflict, unsafe Pending,
   missing event anchor/replay plan, failed close/Functions verification, incomplete
   backup or transfer preview failure. The Pending is not a Supabase transfer-rule
   blocker; **currently it blocks declaring the Sandbox operationally closed**.
8. With separate authorization create a Free target organization and transfer the
   existing project only. Compare original ref/URL, 60 History rows/four forwards,
   Auth/Family ownership, Storage inventory, chains/Intents/immutable audits,
   Functions/source versions, secret digests, Vault usability, disabled matching
   Cron, closed gates and current official Session Pooler/TLS identity. Verify
   CLI/MCP access scopes after the organization changes. Do not rebuild Build 14,
   reset history, recreate users, or reopen review Billing merely for transfer.

## Local preparation evidence — 2026-11-03

New offline generator/usage tests and isolated PostgreSQL tests use synthetic
configuration, a synthetic Vault view and a stub HTTP transport, in a new
`--network none` container with real Cron execution disabled. They cover wrong
target/environment/role/endpoint refusal, late transaction rollback, disabled
installation, private ACL/source guards, bounded dispatch, correlated HTTP 200/503
health and disable despite broken Vault. This is not a cloud Cron rehearsal,
real Vault/RevenueCat credential proof, user-data backup or paid purchase test.
58 formal SQL files still match the accepted deployment evidence; the four
Sandbox SQL hashes are unchanged. No new migration, runtime Function or client
file is needed for this operational installer.

```sh
node scripts/verify-production-release-operations.mjs
node scripts/verify-production-release-operations.mjs --isolated-sql
```

The second command needs the already installed pinned local Supabase Postgres
image; it neither pulls an image nor accesses the persistent local project.
Formatting/static checks and scans apply only to these new/updated operator files.
These local tests alone never proved cloud installation, backup/restore or live
authentication. Later separately authorized stages established the execution
results at the top of this document. Full hosted-service restoration remains
PARTIAL; new Sandbox Pending reconciliation and OrderMori independence were not
part of those Production stages and remain unperformed.

| Preparation check                                                       | Result                                  |
| ----------------------------------------------------------------------- | --------------------------------------- |
| Offline target/control/threshold/forecast tests                         | PASS                                    |
| Isolated SQL install, rollback, ACL, HTTP correlation and safe disable  | PASS                                    |
| Targeted ESLint and Prettier                                            | PASS                                    |
| Nine operator files: credential-pattern and whitespace scan             | PASS                                    |
| Accepted 58 formal SQL contents and four Sandbox hashes preserved       | PASS                                    |
| Later cloud installation, encrypted backups, live credential/HTTP proof | PASS; isolated restore remains PARTIAL  |
| OrderMori dependency isolation                                          | UNKNOWN — blocks Sandbox close/transfer |

## Sources checked 2026-11-03

- [Supabase pricing](https://supabase.com/pricing) and [Free usage/billing](https://supabase.com/docs/guides/platform/billing-on-supabase).
- [Database/disk behavior](https://supabase.com/docs/guides/platform/database-size), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [MAU quota notifications](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users).
- [Function scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Cron](https://supabase.com/docs/guides/cron), [Vault](https://supabase.com/docs/guides/database/vault).
- [RevenueCat Webhooks, authentication, finite retries and resend](https://www.revenuecat.com/docs/integrations/webhooks). Keep existing Authorization verification; no signing/config change is introduced.
- [Project transfers](https://supabase.com/docs/guides/platform/project-transfer).

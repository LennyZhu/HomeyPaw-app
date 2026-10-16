# Family Plus Phase 4B-2 — blank Supabase acceptance

> Historical 48-migration acceptance record. Persistent Local's old 45-applied
> state below is a phase-time snapshot. Current Local is 49/49; Billing and Quota
> Enforcement remain OFF. See the
> [current baseline and Sandbox contract](FAMILY_PLUS_PHASE4E1R.md). The temporary
> Billing test adapter described here has since been replaced by repository-owned
> blank-instance initialization; original business assertions remain.

2026-10-15. Branch `develop`, HEAD
`aa418b5a9f2227d28e1f2a09a4a9ff43cdb356a6`.

## Result and scope

**Local blank initialization: PASS.** A new standard Supabase instance applied
all **48** repository migrations, ending at `20261015123500`. The snapshot
included the three uncommitted Quota, Billing and Recovery migrations. All 48
source files remained byte-identical to their phase-start hashes; no historical
migration was edited, skipped or replaced.

The instance used project `homeypaw-4b2-r9d95ete`, a new temporary workdir,
independent Docker resources, API port 55431 and database port 55432. Supabase
CLI initialized its standard system schemas. No schema clone, database dump,
existing Local data, linked cloud project or Production credential was used.
Studio, analytics and Edge runtime were excluded; hosted Edge execution was
therefore not tested.

Runtime: Supabase CLI 2.115.0, Postgres 17.6.1.159, Storage API 1.69.11,
PostgREST 16.1, Realtime 2.129.0 and GoTrue 2.195.0. No tool upgrade was performed.
Transport results describe these local images; hosted Storage must be checked
again rather than assuming identical TTL or termination behavior.

Each SQL/provider/transport suite started with another complete 48-migration
replay on this same disposable instance. A temporary test adapter replaced the
older clone-based setup, asserted exact migration history and used synthetic
fixtures. Duplicate migration-install setup became assertions that those
migrations were already installed. Business assertions remained in place.

## Initialization defaults and Sandbox bootstrap

Defaults were inspected before any bootstrap writes:

| Setting                                          | Blank-chain default |
| ------------------------------------------------ | ------------------- |
| Pre-cutover release lock                         | ON                  |
| iOS minimum                                      | 1.1.1 / 5           |
| Mutation gate                                    | OFF                 |
| Maintenance                                      | OFF                 |
| Billing                                          | OFF                 |
| Storage enforcement                              | OFF                 |
| Metering start / video timezone / counting scope | NULL / undecided    |
| Auth users / Families / Storage objects          | 0 / 0 / 0           |

The release lock actually blocks signup/Profile creation (HTTP 500, P0001).
A future independent Sandbox needs a separately authorized bootstrap after
target identity verification: unlock that Sandbox, review its release policy,
keep maintenance and quota enforcement OFF, then configure Sandbox-only Billing
provider identifiers. Do not adopt historical minimum values as a release
decision or activate transition cohorts.

In this temporary instance, trusted direct SQL explicitly set the service-role
request claim before bootstrap. Once the mutation gate is enabled, a SQL session
with no request role/header can itself receive `APP_UPDATE_REQUIRED`. The test
used iOS 1.3.0 / 10 request headers and tested an enabled mutation gate. This was
fixture configuration, not a Production release-policy change. It created no
real entitlement or transition qualification.

No reusable cloud bootstrap/deployment writer was added. Future writes must
repeat the Phase 4B-1 pinned ref, URL, credential attribution and hosted identity
checks; offline manifest validation alone does not authorize deployment.

## Real local API acceptance

Six synthetic users covered Owner, Member, Viewer, Removed Member, another
Family's Owner and an unjoined account. Actual loopback HTTP/WebSocket tests
passed:

- GoTrue signup/session and automatic Profile creation; PostgREST grants.
- Family creation, invite/join/removal, canonical roles and single-Family rule.
- Stable payer UUID; Owner preflight/intent; shared entitlement reads for current
  members; unauthorized write/execute and cross-Family/removed access denial.
- Five private buckets: `post-media`, `post-videos`,
  `post-video-thumbnails`, `pet-avatars`, `profile-avatars`.
- Storage upload/read/delete and family isolation; published media readable by
  Member/Viewer; Viewer/Removed/cross-Family uploads denied.
- Legacy photo/video publication without quota sessions and trusted byte
  reconciliation, with enforcement OFF.
- Private Family Realtime subscription and DB-triggered broadcast to Member;
  Viewer/Removed/cross-Family subscriptions denied.

The API tests used tiny synthetic JPEG/MP4 payloads, not private media. A Realtime
test initially used an incorrect RPC argument name; correcting the temporary
harness to `target_client_message_id` passed without a product-code change.

## Billing, Recovery and Quota regressions

PASS against the full-chain database:

- Billing SQL: monthly/yearly intents, current Owner authorization, transaction
  and Family uniqueness, shared rights, restore/renew/cancel/pending/failure,
  grace/retry/expiry/refund/revocation, Owner transfer and payer exit/deletion.
- Provider mocks plus real SQL: authenticated inbox, replay/conflict rejection,
  stale/overlapping refresh generation fencing, deferred trusted-anchor recovery,
  missing-anchor safety, Sandbox/environment and cross-Family isolation.
- Unknown provider facts preserve a previously verified unexpired grant; they do
  not extend it. Added rollback SQL assertions prove that its trusted expiry
  returns the Family to Free even without another webhook/provider refresh.
- Quota boundaries: 300 MiB / 1 GiB / 5 GiB; actual metadata settlement; deletion,
  cleanup and retry/idempotency; transition unlimited-video fixtures.
- Real concurrent transactions: four video reservations yield exactly three
  slots; photo reservations serialize at 300 MiB; concurrent finalize accounts
  for one object exactly once.
- Real Storage/TUS: POST/PATCH/HEAD/resume, membership revocation, explicit
  termination, session expiry, thumbnail settlement and publication; confirmed
  cleanup releases bytes without deleting historical access prematurely.

Contract checks found all 14 Quota/Billing/Recovery tables and 33 distinct
function names expected from those migrations. Their 35 private Family indexes
were valid; no unvalidated constraints or disabled noninternal triggers were
found in those private Family objects. Auth/Storage/Realtime and installed
extensions were exercised, not inferred solely from function definitions.

### Known limitations remain

Storage API's configured 12-second TUS TTL still allowed a late PATCH after 13
seconds in the local file backend. Explicit termination worked. A test-only
reservation policy denied expired session completion, but also rejected an
unchanged legacy upload without a session. That policy is absent from the
forward migration and was confined to the disposable test database.

Thus **Production hard quota remains NO-GO / OFF**. Legacy 1.3.0 compatibility,
trusted transport closure/cleanup orchestration and hosted Storage behavior still
need a release strategy. No permanent legacy bypass was introduced. Calendar
timezone and downgrade counting policy remain undecided.

Real RevenueCat/Apple responses, native SDK signing/purchases, hosted Edge auth,
scheduler/alerts and cloud project identity remain **UNVERIFIED**. Provider mock
PASS is not Apple Sandbox purchase PASS. No RevenueCat/Apple request or cloud
Supabase connection was made in this phase.

## Static checks

PASS: TypeScript; cached Deno typecheck for both Billing Edge Functions; targeted
ESLint; Prettier; i18n parity; Billing client/access/target verifiers; Care UI and
Completion Time; Journal Detail/read-client; Schedule UI/Reminder return; and
`git diff --check`. Edge ESLint disabled only Node's import-resolution rule for
Deno imports; Deno itself resolved/typechecked those imports.

## Preservation, cleanup and next gates

Original persistent Local stayed at **45 applied**, latest `20261014070450`;
Quota/Billing/Recovery remained pending and their schema was not installed.
Before/after fingerprints matched for **66 tables**, public/private function
definitions and RLS policies, including Auth, Storage metadata, outbox/config and
migration history. All prior work was preserved; only the Recovery test SQL was
extended and this report added.

Cleanup PASS: the seven temporary Supabase containers, temporary transport
container, project volumes/network and temporary workdir (including generated
local credentials/private logs) were removed. No matching resources remain.
All 12 existing development container identities were preserved; 11 remained
running, and the old Edge runtime had already stopped on 2026-10-14. A second
post-cleanup fingerprint comparison still matched the original Local baseline.
Shared Docker image caches were retained.

| Gate                                             | Decision                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Phase 4B-2 blank local full-chain initialization | PASS                                                                                      |
| Phase 4B-3 create independent cloud Sandbox      | GO, subject to user approval and organization/resource availability                       |
| Cloud Billing deployment now                     | NO-GO until new cloud identity, credentials, bootstrap and hosted acceptance are verified |
| Real Apple Sandbox purchase now                  | NO-GO until backend/native/configuration gates and manual device acceptance               |

Phase 4B-3 should first create an independently identified project with synthetic
data only; verify its identity and cost before any migration; then separately
authorize full-chain apply/bootstrap. Only after hosted Auth/RLS/Storage,
Billing secrets, webhook auth and recovery operations pass should a Sandbox Dev
Client and user-operated Apple purchase be considered. This phase stops here.

No commit/push/merge, cloud migration/deployment, Production connection/change,
real payment, transition activation, enforcement, EAS build, simulator or device
test occurred. App version/build and all migrations are unchanged.

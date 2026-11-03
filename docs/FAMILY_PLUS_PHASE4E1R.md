# Family Plus — current local baseline and Sandbox gates

2026-10-16, Phase 4E-1R. This is the current configuration reference. Phase 2,
3, 4B, 4C and 4D-1 reports retain their dated acceptance evidence; their old
45/47/48 migration counts and pending-state descriptions are historical.

## Current state

- Branch: `develop`; phase-start HEAD `aa418b5a9f2227d28e1f2a09a4a9ff43cdb356a6`.
- App configuration remains **1.3.0 / iOS Build 10**.
- Persistent Local: **49/49 applied, pending 0**, API `127.0.0.1:54321`, DB
  `127.0.0.1:54322`, container `supabase_db_pawday`, cluster
  `7690043882209464358`.
- Billing **OFF**, Storage Quota Enforcement **OFF**; no paid or transition
  entitlement is seeded. The monthly video timezone/counting/start policy is
  unconfigured, so the read adapter must preserve Unknown counts.
- The Quota migration performs initial Storage observation. The preceding local
  acceptance confirmed 11 registered objects / 11,770,938 bytes; future unknown
  or inconsistent measurements must remain pending rather than become zero.
- Production project ref is **`tknaobmlwmodsqtpqwkr`**. Its display name
  **`pawday-dev` does not make it a development project**. Local 49/49 says
  nothing about Production migration history. This phase does not contact it.
- Independent cloud Sandbox, hosted Billing, Webhook/recovery scheduling and
  actual Apple Sandbox purchases remain **unverified / not deployed**.

## Current runtime contract

Authority is the actual implementation in
`supabase/functions/_shared/family-billing-runtime.ts` and
`supabase/functions/_shared/family-billing-target.mjs`.

The runtime reads only explicit Billing credentials. It does **not** fall back
to `SUPABASE_URL`, platform service keys, CLI login, linked project or `.env.local`.
The CLI is still linked to Production; never use that default as a Sandbox target.

| Setting                              | Required cloud Sandbox meaning                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `FAMILY_BILLING_SANDBOX_ENABLED`     | `true` only after separate Sandbox authorization; templates remain `false`                         |
| `FAMILY_BILLING_TARGET_MODE`         | `cloud`                                                                                            |
| `FAMILY_BILLING_SANDBOX_PROJECT_REF` | Explicit independent 20-letter ref, never the Production ref                                       |
| `FAMILY_BILLING_SUPABASE_URL`        | Canonical HTTPS origin for that exact ref, no credentials, port, query, fragment or extra path     |
| `DENO_DEPLOYMENT_ID`                 | Supabase-supplied deployment identity containing that same ref; never fabricate/set a hosted value |
| `FAMILY_BILLING_SERVICE_ROLE_KEY`    | Explicit legacy JWT attributed to that ref and `service_role`                                      |
| `FAMILY_BILLING_ANON_KEY`            | Explicit legacy JWT attributed to that ref and `anon`                                              |
| `REVENUECAT_PROJECT_ID`              | Independently reviewed RevenueCat project                                                          |
| `REVENUECAT_SECRET_API_KEY`          | Server-only provider credential for that project and required read resources                       |
| `REVENUECAT_WEBHOOK_AUTH_SECRET`     | Separate secret of at least 32 characters; configured as `Authorization: Bearer <secret>`          |
| `FAMILY_BILLING_RECONCILE_SECRET`    | Different internal bearer secret of at least 32 characters; never reuse the webhook secret         |

Credential payload inspection checks configuration attribution, not JWT signature
authenticity. Supabase must authenticate the actual requests. Opaque secret or
publishable credentials are currently rejected by this prototype's offline
attribution contract; do not silently bypass that guard to accommodate them.
No provider key, URL or password has been supplied by this document.

The old server `FAMILY_BILLING_SANDBOX_HOST` instruction is obsolete. The client
still separately uses `EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_HOST` as its cloud host
allowlist, together with explicit URL/ref/mode, iOS, `__DEV__`, native Dev Launcher
and DEVELOPMENT/AD_HOC provisioning. Release/TestFlight and ordinary Ad Hoc
release builds are denied. `EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY` must be the
correct Apple App's public `appl_` key, never a `test_` Test Store key. An old Dev
Client needs a future native rebuild to gain the SDK; no build is run here.

Local runtime mode is separate: `local`, `local-pawday`, HTTP loopback/local Kong,
locally attributed credentials and **no hosted deployment identity**. A hosted
function cannot evade cloud checks by changing its mode to local. These runtime
options do not authorize enabling Billing on the persistent Local database.

## Templates and future authorization

Empty, committable templates:

- `.env.example` (public client settings only)
- `supabase/functions/billing-sandbox.env.example`
- `supabase/billing-sandbox-target.example.json`

Filled configuration must stay outside Git, mode 0600. The manifest checker
requires an explicit absolute external path and matching confirmed project ref;
it rejects the Production ref and reports `remoteIdentityVerified=false` and
`writesAuthorized=false`. Its offline PASS is **not deployment approval**.

Before any future deployment, obtain separate authorization and perform a
read-only handshake to the explicit independent project. Verify actual database,
Auth/Storage/API identity, credentials and RevenueCat project/App mapping. Review
the blank-chain release lock/bootstrap and all migration versions; never repair
Production history or copy Production data, secrets or release settings.

Private Sandbox billing configuration also needs the verified RC project/App,
monthly/yearly Store product IDs and entitlement resource mapping. The logical
entitlement is `family_plus`, Offering `default`, products
`homeypaw.familyplus.monthly` and `homeypaw.familyplus.yearly`. The current v2
adapter compares provider resource IDs, so do not assume a lookup key equals the
API's resource ID. Check the actual response in the later authorized environment.

Only after independent hosted identity/authentication and environment rejection
tests pass may a separately authorized RevenueCat Webhook be configured at that
Sandbox HTTPS endpoint. Filter to Sandbox and the intended App, set the matching
Authorization header, and test unauthorized/Production rejection before buying.
Keep original App User ID restore behavior and the Sandbox restore override OFF.
Do not recreate existing Apple products or change dashboard settings in this phase.

No cloud deployment command is provided: no cloud target/bootstrap/deployment
workflow has been verified. Runtime fail-closed checks do not protect arbitrary
CLI commands run against the linked Production project.

## Verification repairs and scope

The old Billing SQL/Webhook verifiers cloned an already migrated schema and
then unconditionally ran Billing/Recovery DDL again. Running each original body
against a fresh full-chain instance reproduced `family_billing_config already
exists`; only the old target helper was substituted for this safe reproduction.

Both normal repository commands now use the shared blank-instance helper:

```sh
npm run verify:family-billing-sql
npm run verify:family-billing-webhook
npm run verify:family-plus-data-sql
npm run verify:ipad-layout
```

Run the database commands sequentially because the helper uses dedicated test
ports 54461/54462. Every invocation starts a new workdir, project and cluster,
copies only migration files, asserts the full migration history and disabled
defaults, then installs synthetic Auth/Family fixtures. It copies no linked ref,
environment file or existing user data. Its target cluster must differ from the
persistent Local cluster. Business assertions are retained, including SQL
authorization failures, deferred recovery, replay conflicts, grace boundaries
and overlapping reconciliation responses. No SQL errors are swallowed.

Cleanup targets only that generated project. Persistent Local row/history
fingerprints are compared before and after. The read-only comparison never
executes a persistent migration, cleanup worker or outbox consumer.

The iPad verifier leaves release-version consistency to `verify:release-config`.
It retains layout checks and executes the current measured-width Viewer resize
effect at iPhone/iPad widths, rather than requiring an obsolete dependency string.
No production Viewer or iPad screen is changed.

## Remaining release gates

- Quota-aware upload integration and trusted transport termination/recovery are
  unfinished. Safe hard-quota compatibility for unmodified iOS 1.3.0 is still
  blocked; legacy upload policies stay unchanged and enforcement stays OFF.
- Monthly timezone, downgrade-month counting and exact Transition boundaries
  still need product decisions. Do not activate a cohort or countdown.
- Provider transaction/anchor/grace/refund fields, first purchase and restore
  behavior require real Apple Sandbox acceptance. Mock/SQL PASS is not IAP PASS.
- Recovery scheduling, retry monitoring, alerts and operational manual-review
  procedures are not deployed. A missing trusted original transaction anchor
  remains pending/review; never infer a chain or transfer its Family binding.
- Saving a prototype to `develop` does not authorize merging `main`, deploying
  Production or exposing paid membership. Those require separate release gates.

Repository workflows/hooks contain no automatic deployment action. Remote
dashboard integrations have not been independently inspected; confirm them
before any later push. No commit, push, cloud write, build or purchase is part
of this phase.

## Phase 4E-1R execution results

The normal Billing SQL and Webhook commands each passed **twice consecutively**,
each time in a fresh 49-migration cluster; the Family Plus data SQL/API suite
also passed. The first added cluster-identity check exposed transaction command
tags in the old fingerprint output; quiet psql output now provides parseable
JSON with ON_ERROR_STOP. No SQL error or failed business assertion was ignored.

AST comparison proves the SQL verifier's six and Webhook verifier's 115 original
business statements are unchanged after removing only the duplicate DDL setup.
All 49 migration files, client business sources, Edge business sources, existing
SQL fixtures and native/release configuration are byte-identical to phase start.

| Check                                                                      | Result                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Old Billing original bodies, redirected only to an independent test target | Both reproduced duplicate-relation failure                                       |
| Old iPad baseline                                                          | Failed fixed 1.1.0/4 assertion; then exposed obsolete pager dependency assertion |
| Billing SQL, normal repository command                                     | PASS twice; includes Quota and Recovery SQL                                      |
| Billing Webhook, normal repository command                                 | PASS twice; synthetic provider HTTP + real isolated SQL                          |
| Family Plus data SQL/API, blank 49/49                                      | PASS                                                                             |
| iPad layout, real measured-width effect                                    | PASS; widths 0/390/834/1194 preserve selected page                               |
| TypeScript, Deno Edge typecheck                                            | PASS                                                                             |
| Targeted ESLint, Prettier, i18n parity                                     | PASS; Edge uses documented Deno import-resolution scope                          |
| Billing client, target/signing guard, Grace access                         | PASS (mock/pure tests)                                                           |
| Family Plus UI, data adapter, role/navigation/Preview isolation            | PASS                                                                             |
| Profile, Family C4I, Journal Detail/browsing/read receipts                 | PASS                                                                             |
| Care UI/completion time, Schedule UI/Reminder return                       | PASS                                                                             |
| Family Chat and Chat Push client regressions                               | PASS                                                                             |
| Release config                                                             | PASS, 1.3.0 / Build 10 unchanged                                                 |
| Ignore rules                                                               | PASS: 17 sensitive-path cases ignored, 10 source/template cases remain visible   |
| Candidate secret scan                                                      | PASS; only synthetic fixture connection-string matches                           |
| Persistent Local before/after fingerprints                                 | Unchanged for every isolated run                                                 |
| Git diff whitespace check                                                  | PASS                                                                             |

Storage transport and the standalone clone-based Quota concurrency wrapper were
not rerun here: this repair concerns Billing initialization. Their prior isolated
transport/concurrency evidence is retained in Phase 2/4B-2. Quota/Recovery SQL
business assertions were rerun through both normal Billing SQL runs and the
full-chain data suite. No real Apple or RevenueCat network purchase was made.

The seven temporary project attempts (including safe before-fix reproduction
and the fingerprint-parser failure) were cleaned up. No persistent Local
migration/Storage write, Production connection/write, cloud deployment,
dashboard change, real Billing/quota activation, native run or build occurred.

## Commit preparation and complete pending manifest

Phase-end branch/HEAD remain `develop` /
`aa418b5a9f2227d28e1f2a09a4a9ff43cdb356a6`. Git index is unchanged.
There are **13 tracked modifications + 49 untracked files = 62 pending files**.
No prior work was removed.

Recommended plan after explicit approval:

1. Optional independent iPad test commit containing only
   `scripts/verify-ipad-layout.mjs`:
   `test(ipad): align layout verifier with measured viewport`.
2. One atomic commit containing the remaining **61** Family Plus files below,
   including its tests, configuration templates, ignore rules and documents:
   `feat(family-plus): add guarded billing and storage quota prototypes`.

Keeping the Family Plus changes together avoids splitting shared routes,
presentation adapters, generated RPC types, locales, package scripts and their
four dependent forward migrations. No intermediate feature commit is required.
The iPad test has no dependency on those new feature modules.

**Commit Readiness: GO for saving the reviewed develop prototype only.**
Production deployment, real Apple Sandbox purchase, quota enforcement and main
release remain NO-GO / separately gated. No Git staging, commit, push or merge
was performed. Remote deployment integrations still require confirmation before
a future push; local repository workflows/hooks contain no deployment action.

Exact phase-end `git status --porcelain=v1 --untracked-files=all`:

```text
 M .env.example
 M .gitignore
 M eas.json
 M package-lock.json
 M package.json
 M scripts/verify-ipad-layout.mjs
 M src/app/_layout.tsx
 M src/features/family/family-settings-screen.tsx
 M src/features/profile/profile-screen.tsx
 M src/i18n/locales/en.json
 M src/i18n/locales/zh-HK.json
 M src/types/database.ts
 M supabase/config.toml
?? docs/FAMILY_PLUS_PHASE4B1.md
?? docs/FAMILY_PLUS_PHASE4B2.md
?? docs/FAMILY_PLUS_PHASE4C_UI.md
?? docs/FAMILY_PLUS_PHASE4D1.md
?? docs/FAMILY_PLUS_PHASE4E1R.md
?? docs/FAMILY_PLUS_SANDBOX_PROTOTYPE.md
?? docs/FAMILY_STORAGE_QUOTA_PROTOTYPE.md
?? scripts/check-billing-sandbox-target.mjs
?? scripts/lib/blank-family-plus.mjs
?? scripts/lib/isolated-family-media.mjs
?? scripts/sql/family-billing-recovery.sql
?? scripts/sql/family-billing-sandbox.sql
?? scripts/sql/family-plus-read-summary.sql
?? scripts/sql/family-storage-quota-prototype.sql
?? scripts/verify-family-billing-access.mjs
?? scripts/verify-family-billing-client.mjs
?? scripts/verify-family-billing-sql.mjs
?? scripts/verify-family-billing-target.mjs
?? scripts/verify-family-billing-webhook.mjs
?? scripts/verify-family-plus-data-client.mjs
?? scripts/verify-family-plus-data-sql.mjs
?? scripts/verify-family-plus-ui.mjs
?? scripts/verify-family-storage-quota.mjs
?? scripts/verify-family-storage-transport.mjs
?? src/app/family-plus-sandbox.tsx
?? src/app/family-plus.tsx
?? src/features/billing/billing-client.ts
?? src/features/billing/billing-sandbox-gate.ts
?? src/features/billing/components/family-plus-badge.tsx
?? src/features/billing/components/family-storage-summary.tsx
?? src/features/billing/family-plus-api.ts
?? src/features/billing/family-plus-data.ts
?? src/features/billing/family-plus-presentation.ts
?? src/features/billing/family-plus-preview.ts
?? src/features/billing/family-plus-sandbox-screen.tsx
?? src/features/billing/family-plus-screen.tsx
?? src/features/billing/use-family-plus-preview.tsx
?? src/features/billing/use-family-plus.ts
?? supabase/billing-sandbox-target.example.json
?? supabase/functions/_shared/family-billing-runtime.ts
?? supabase/functions/_shared/family-billing-sandbox.mjs
?? supabase/functions/_shared/family-billing-target.mjs
?? supabase/functions/billing-sandbox.env.example
?? supabase/functions/family-billing-reconcile/index.ts
?? supabase/functions/family-billing-webhook/index.ts
?? supabase/migrations/20261014104554_family_storage_quota_prototype.sql
?? supabase/migrations/20261014114837_family_billing_sandbox_prototype.sql
?? supabase/migrations/20261015123500_family_billing_recovery.sql
?? supabase/migrations/20261016053022_family_plus_read_summary.sql
```

# Family Plus Phase 4B-1 — local blocker fixes

> Historical phase-time acceptance record. Old 45/48 migration counts and
> unapplied/UNVERIFIED statements below describe that phase only. Current Local
> is 49/49; Billing and Quota Enforcement remain OFF. The
> [current baseline and Sandbox contract](FAMILY_PLUS_PHASE4E1R.md) supersedes
> deployment instructions without changing this evidence.

2026-10-15. Local code, mock provider responses and disposable SQL only. No
Production/cloud connection, persistent-local migration, Edge deployment,
scheduler, purchase, build, simulator/device, commit or push.

## Access authority

The old customer `active_entitlements` expiry can aggregate subscriptions and
environments. Capping it at the billing-period end also prematurely expires
grace. The adapter now fetches transactions under the verified RevenueCat
subscription and matches the **current store transaction ID**, product, purchase
time and billing-period expiry. RevenueCat's OpenAPI defines that transaction's
`effective_expiration_date` as including potential grace. Only a provider-granted
`in_grace_period` uses this explicit boundary; normal active/trial/cancelled
access remains bounded by the paid period. Cancel auto-renew keeps paid access.
Provider `gives_access=false` revokes access for retry/expiry/refund/revocation.
Unknown, inconsistent or missing facts return `BILLING_PROVIDER_ACCESS_PENDING`;
they neither invent a grace interval nor overwrite an existing verified grant.
Existing grants still expire at their previously verified boundary.

This is a documented-contract implementation and **mock PASS**, not proof that
real Apple Sandbox responses have these exact fields/timestamp relationships.
Verify current transaction identifiers, `effective_expiration_date`, refund and
grace fields on real responses before calling the provider integration PASS.

Sources: [RevenueCat transactions](https://www.revenuecat.com/docs/api-v2/subscription-transactions),
[OpenAPI field definitions](https://www.revenuecat.com/docs/redocusaurus/openapi-v2-subscription-transactions.yaml),
[subscription access](https://www.revenuecat.com/docs/api-v2/subscription-data-model).

## Dev Client signing

`__DEV__`, native `ExpoDevLauncher` and DEVELOPMENT or AD_HOC provisioning are
all required. APP_STORE/TestFlight, enterprise, simulator, unknown signing and
ordinary Ad Hoc release builds remain rejected. `billing-sandbox` extends the
existing internal development profile; it changes neither production profile
nor version/build. The new native SDK still requires rebuilding a Dev Client.
Public config is only a UX gate. Server Owner authorization, provider identity,
store and SANDBOX checks remain the security boundary.

## Explicit target identity

Existing `.env.local` and CLI linked-ref can point to Production. No Billing
deployment wrapper previously existed; none is added that executes writes.
General release/cleanup scripts are not Sandbox deployment tools.

The Edge runtime now reads ONLY explicit `FAMILY_BILLING_*` URL/keys/ref/mode,
never default Supabase credentials as fallback. Cloud requires:

- independent 20-letter ref, canonical HTTPS URL for that ref;
- platform-supplied `DENO_DEPLOYMENT_ID` with the same ref;
- explicit legacy service-role and anon JWT credentials with matching ref/role.

JWT payload inspection here is configuration attribution, **not signature
authentication**. Supabase authenticates actual requests. Opaque `sb_secret_` /
publishable credentials cannot be attributed offline and fail closed in this
prototype. Review a server-attested alternative before changing this constraint.
The approved cloud ref must never be the Production ref.

Local mode requires `local-pawday`, HTTP loopback/local Kong, locally attributed
credentials and **no hosted deployment ID**. Thus setting cloud mode to local in
a hosted function cannot enable the former Kong exception.

Templates: `supabase/functions/billing-sandbox.env.example` and
`supabase/billing-sandbox-target.example.json`. Templates contain no credentials.
Filled manifests must live outside Git, mode 0600. Never copy Production keys,
password files or credentials. Never manually set hosted `DENO_DEPLOYMENT_ID`.

Offline check, after a separate approval to prepare Sandbox configuration:

```sh
node scripts/check-billing-sandbox-target.mjs --config /absolute/external/manifest.json --confirm-project-ref <sandbox-ref>
```

This command never loads dotenv/linked project/CLI stored credentials, connects,
migrates or deploys. Its PASS only validates configuration consistency; it
explicitly reports `remoteIdentityVerified=false`, `writesAuthorized=false`.
Database passwords and the `appl_` key's actual project/App cannot be proven
offline. A later separately authorized read-only handshake against the pinned
Sandbox must verify real credentials, project objects and RC mapping before any
write. Do not run generic `db push`/`functions deploy` using the linked project.
Future execution must repeat identity checks with explicit ref/DB target.

For a future Sandbox build, all public Supabase URL/key, mode/ref/host and
`appl_` key must be provided in its reviewed EAS/Metro environment. The profile
does not supply a fallback project. Missing/wrong values disable Billing.
Inspect the build's actual environment before logging in or using the App;
this gate does not change the global Supabase client's ordinary app behavior.

## Recovery and manual review

New **unapplied** forward migration `20261015123500_family_billing_recovery.sql`
adds service-only trusted inbox-anchor retrieval and generation-fenced attempt
results, retry time and manual-review marker. Existing Phase 2/3 migration files
are unchanged. Repository now has 48 migrations; persistent Local remains 45,
with Quota, Billing and recovery pending. No initialization replay performed.

Already received authenticated pending/deferred anchors can now bind after a
provider outage without relying on event history exposing an original ID. They
are never reconstructed as a partial event with a new payload digest. Repeated
original delivery is still idempotent. Fresh provider reads plus generation
fencing protect against old payloads and concurrent responses.

| Failure                                                                         | Action                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Network/429/5xx/provider facts pending                                          | Retry, preserve last bounded grant                                                              |
| Trusted deferred inbox anchor                                                   | Retry from inbox and fresh provider facts                                                       |
| First webhook never received; history lacks original ID                         | Remain `pending_chain_anchor`; resend original authenticated RevenueCat event; no guessed claim |
| Owner changed before binding, chain conflict, identity/product/project mismatch | Manual review; automatic batch holds that customer                                              |
| TRANSFER or unsupported event                                                   | No transfer/grant; inspect ignored inbox reason manually                                        |
| Unknown billing UUID                                                            | Ignore; never create/bind customer from webhook                                                 |

Proposed future Sandbox scheduler: every minute, HTTPS POST the reconcile
endpoint with a separate >=32-character internal bearer secret held by Vault or
the scheduler's secret manager. No user session/service key in the HTTP payload.
Process at most five customers per invocation; eligible work uses attempt order
and a one-minute retry delay. Overlapping invocations remain generation-fenced.
Response distinguishes completed/pending/failed/review; failures/review return 503. Monitor deferred age, customers awaiting anchors and review flags; alert on
review immediately and pending/failures persisting >5 minutes. Export no private
payload or secret to alert logs. Confirm actual function timeout/provider rate
limits and tune batch size in cloud acceptance. No scheduler/alert is deployed.

Do not automatically clear `store_pending` after ambiguous purchase failures;
payment might have succeeded. Manual review must use trusted provider evidence.
No new API permits an operator/client to reassign an existing chain's Family.

## Gates

- Local fixes: verified by client/access/target + isolated SQL/provider mocks.
- Empty Supabase full-chain initialization: **UNVERIFIED**, next Phase 4B-2 only.
- Hosted Billing: **UNVERIFIED / NO-GO pending initialization/config/runtime tests**.
- Real Apple Sandbox purchase: **UNVERIFIED / NO-GO pending backend/native gates**.
- Production hard quota: **OFF**, legacy 1.3.0 compatibility blocker unchanged.

Monthly timezone/downgrade policy and transition activation remain undecided.
Real provider first-anchor recovery, lifecycle/refund/grace, Apple signing,
localized prices, key mapping and hosted auth are still manual acceptance items.

## Verified locally

PASS: TypeScript, cached Deno Edge typecheck, targeted ESLint, Prettier, i18n
parity, Billing client/access/target verifiers, isolated Billing SQL (including
canonical Family roles and recovery ACL), mock provider + isolated SQL webhook
tests, Care Completion Time, Journal Detail UI, Schedule UI and Family Chat
client regressions, and `git diff --check`. Deno npm imports are resolved by Deno;
Edge ESLint disables only its Node import-resolution rule for that invocation.

The webhook suite includes a truly expired paid period with a future verified
grace boundary, missing grace facts preserving the previous bounded grant,
first deferred anchor recovery without provider history, duplicate delivery,
old payload after revocation, and overlapping HTTP responses fenced by real SQL.
Expected SQL denial/conflict errors are asserted, not failed tests.

Disposable databases were removed. Persistent Local table/function/policy/outbox/
history fingerprints stayed equal before/after; final read-only inspection is
45 applied, latest `20261014070450`, no Quota/Billing/recovery schema installed.
Care migrations, original Quota/Billing migrations, Phase 2 verifiers,
`app.json` and package lock remain byte-identical to the phase-start hashes.

## Phase 4B-1 file manifest

Modified existing prototype files:

- `.env.example`, `eas.json`, `package.json`
- `src/features/billing/billing-client.ts`
- `src/features/billing/billing-sandbox-gate.ts`
- `supabase/functions/_shared/family-billing-runtime.ts`
- `supabase/functions/_shared/family-billing-sandbox.mjs`
- `supabase/functions/family-billing-reconcile/index.ts`
- `scripts/verify-family-billing-client.mjs`
- `scripts/verify-family-billing-sql.mjs`
- `scripts/verify-family-billing-webhook.mjs`
- `docs/FAMILY_PLUS_SANDBOX_PROTOTYPE.md` (historical-record pointer only)

Added:

- `supabase/migrations/20261015123500_family_billing_recovery.sql` (unapplied)
- `supabase/functions/_shared/family-billing-target.mjs`
- `supabase/functions/billing-sandbox.env.example`
- `supabase/billing-sandbox-target.example.json`
- `scripts/check-billing-sandbox-target.mjs`
- `scripts/verify-family-billing-access.mjs`
- `scripts/verify-family-billing-target.mjs`
- `scripts/sql/family-billing-recovery.sql`
- `docs/FAMILY_PLUS_PHASE4B1.md`

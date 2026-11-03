# Family Plus — Phase 3 Sandbox prototype

> Historical Phase 3 record. The old migration counts and pending descriptions
> below are phase-time snapshots, not current deployment instructions. Current
> Local is 49/49; Billing and Quota Enforcement remain OFF. Use the
> [current baseline and Sandbox contract](FAMILY_PLUS_PHASE4E1R.md), with
> [Phase 4B-1](FAMILY_PLUS_PHASE4B1.md) retaining its safety-fix evidence.

2026-10-14. Development branch only. **No real Apple/RevenueCat purchase has
been performed.** Native SDK tests and provider HTTP responses are mocked; SQL
runs in disposable local databases cloned from the current 45-migration schema.
No persistent migration, Production connection, deployment or native build.

## Implemented path

Development-only Profile entry → `family-plus-sandbox` → stable server-generated
payer UUID → RevenueCat SDK / StoreKit 2 → server purchase intent → Apple Sandbox
store sheet → RevenueCat authenticated wake-up → fresh RevenueCat REST v2
subscription/product/entitlement query → Supabase immutable transaction-chain
binding → the existing Phase 2 `family_media_entitlements` → all current Family
members read the same Plus state.

Only current Owner can prepare/start a purchase. The server locks the Family
and rejects active subscriptions or an unresolved purchase before another
purchase. Package product ID must match the intent's configured monthly/yearly
SKU. Prices use SDK `product.priceString`; no price or real product ID is seeded.

Before the intent, a service preflight refreshes every payer already bound to
the Family, including former/deleted Owners, as well as the current payer. A
new Owner's empty personal RevenueCat account cannot authorize a duplicate
purchase. A single-use, 30-second server check is required by the actual intent
RPC; clients cannot mint it. Store-side changes during the asynchronous purchase
window still require duplicate-binding review rather than an automatic refund.

The SDK is configured with an identified billing UUID from the first call;
there is no anonymous configuration, Family ID identity, shared member login,
subscriber-attribute entitlement or client `isPlus` grant. CustomerInfo never
grants Family access. Mutations keep existing version and pre-cutover guards.

## Native audit and test entry

- Existing Expo `57.0.22`, React Native `0.86.3`, React `19.2.3`, Dev Client
  `57.0.19`, iOS bundle ID `com.zhushunli.homeypaw`.
- Pin core `react-native-purchases` **10.13.0** only. Peer requires RN >=0.73;
  installed podspec targets iOS 13 / Swift 5.7 and HybridCommon 19.11.0.
  Expo SDK 57's minimum iOS is higher. Expo autolinking resolves RNPurchases.
- This is static compatibility evidence, **not native compilation PASS**. An
  existing Dev Client cannot gain a new native SDK through Metro alone.
- Enable public Sandbox flag/key/approved host only in a dedicated development
  environment. Entry is absent from release, Android and web; direct route also
  redirects when disabled. Before SDK setup, require a development-signed iOS
  application, not merely `__DEV__`. App Store/TestFlight builds are refused by
  this prototype. Codex does not build or run a device.
- Auth/Family changes remount screen state. A shared operation lock prevents
  repeated taps and SDK identity switches during an in-flight operation.
- Restore/manage remain available to a signed-in payer without a current Family;
  restore never creates a Family claim. Native management uses the existing
  Apple subscription UI through `showManageSubscriptions()`.

## Database and service boundary

New migration `20261014114837_family_billing_sandbox_prototype.sql` follows the
unapplied Phase 2 migration. Adds private config, billing customers, intents,
webhook inbox, store subscriptions and purchase-preflight checks; adds nullable billing provenance to the
**existing** entitlement table. Does not replace Phase 2 limits/registry/session
functions, change quota policy or touch Care migrations.

Configuration starts disabled with no products/project IDs/entitlements.
Authenticated users cannot read or write private tables or call ingestion,
snapshot, configuration or reconciliation RPCs. Member/Viewer read only their
canonical Family state. Removed/Former/cross-Family access is denied.

Store subscriptions are unique by Sandbox + App Store + original transaction ID
and also by RevenueCat subscription ID. No API updates their Family/customer
binding. Restoring under another billing identity is rejected. Restore behaviour
must be explicitly **Keep with original App User ID**, including Sandbox override.
RevenueCat's default transfer behaviour must not be used.

Subscription changes update one entitlement row per subscription, with a bounded
server-verified expiry. Cancel auto-renew does not prematurely revoke access;
grace requires provider `gives_access` and a verified future expiry; billing retry
without access, expiry, refund or revocation remove Plus only. History/core
features remain untouched. Subscription periods are not used as video calendar
policy; unresolved natural-month/downgrade policy remains NULL.

Owner transfer after binding leaves payer and Family unchanged. Payer exit also
keeps that binding; an unrelated new Family gains nothing. Auth deletion sets
the user link NULL while retaining the opaque billing UUID and transaction record
for renewal/reconciliation. It **does not cancel Apple auto-renew**. The payer
manages/cancels in Apple settings; account-deletion disclosure, retention period
and support-assisted identity recovery require review before paid release.

While the payer still has a nonterminal subscription for another Family, this
prototype rejects another purchase intent (`BILLING_PAYER_ALREADY_BOUND`) to avoid
an Apple subscription-group upgrade renewing the wrong Family. This is reversible
admission behaviour, not a new permanent payer-to-Family uniqueness constraint.
Moving a payer to a new Family after lapse/identity recovery needs product and
real-store review; the old transaction chain is never silently reassigned.

An Owner change before first binding puts the paid transaction into review rather
than assigning it to another Family. A prepared intent can start within 15 minutes;
after store start it remains pending across delayed approval, blocking duplicate
purchase until trusted reconciliation resolves it. Ambiguous network failures
do not clear that protection. Cancellation never refunds or cancels a store
subscription in SQL. Purchases initiated outside HomeyPaw cannot be universally
prevented; overlapping external subscriptions require support, not automatic
transfer or cancellation.

## Webhook and authoritative reconciliation

RevenueCat currently documents a dashboard-configured `Authorization` header;
the handler verifies a >=32-character bearer secret using fixed-length digest
comparison before inbox access. This prototype does not invent a signature.
Current docs also describe optional HMAC signing; it is not configured or claimed
here. Deploy behind HTTPS, use separate webhook/reconciliation secrets and keep
the RevenueCat secret API key on the server.

Inbox stores event ID, canonical digest, minimal identifiers/type/timestamps and
processing state, not raw receipts, payment details or SDK data. Duplicate IDs
are idempotent; changed content under an existing ID is rejected. No event-age
cutoff discards legitimate delayed retries. Event ordering/expiry does not drive
access: each wake-up fetches current provider authority. A generation acquired
before fetch fences a stale in-flight response. Failed queries return 503 and
leave the event deferred for retry; they do not erase a still-valid entitlement.

Provider reads enforce project, app, Apple store, Sandbox, purchased ownership,
original/current billing customer, allowed product and entitlement. Pagination
and redirects cannot send a secret to another host. Customer aggregate expiry
cannot extend a Sandbox chain beyond its own verified period. Test the actual
grace-period field values; if a future bound cannot be established, fail closed.

Known chains reconcile even when a webhook is lost. First binding requires an
authenticated original-transaction anchor. Server event-history recovery is
implemented **only when the actual response supplies that field**; the documented
sample does not guarantee it. Without it, return `pending_chain_anchor`. Resend
the original RevenueCat delivery, or add independently verified Apple transaction
retrieval in a later stage. Do not invent the original ID from a renewal ID.

The optional internal batch endpoint selects up to 25 known/pending customers,
including deleted payer accounts. No scheduler is deployed/activated here. A
client reconciliation body cannot select another customer, Family or transaction;
server JWT validation derives its billing identity. External target guard rejects
the Production ref even if put in an allowlist; only loopback/local runtime or an
explicitly approved HTTPS Sandbox host is allowed. Both inbound and fetched store
environments must be Sandbox. This code does not provide Production billing.

## Historical user-owned configuration checklist

This is the Phase 3 checklist, not authorization to recreate products or deploy.
Current requirements and remaining gates are in the current baseline linked above.

1. Apple Developer/App Store Connect: check active Paid Apps Agreement and required
   Bank/Tax information; match bundle ID/team and In-App Purchase capability.
2. Create one auto-renewable subscription group with planned monthly/yearly SKUs,
   localization, duration and reviewed regional pricing. Do not submit or enable
   real paid availability in this phase. HomeyPaw Family sharing is its own model;
   do not enable Apple Family Sharing as a substitute.
3. Create Sandbox testers and a development-signed physical iOS build containing
   the new native SDK. Verify Apple Sandbox account and store sheet before testing.
4. RevenueCat: dedicated Sandbox prototype project/App mapped to the same bundle
   ID, correct Apple In-App Purchase credentials, imported SKUs, logical Family
   Plus entitlement and current Offering containing monthly/yearly packages.
   Use an Apple `appl_` public SDK key, not a Test Store `test_` key.
5. Set **Keep with original App User ID** for project restore behaviour and its
   Sandbox override. Review Apple server-to-server tracking/App User ID settings;
   this prototype uses a UUID v4 billing identity but has not verified dashboard
   settings or real server-to-server notifications.
6. The original two-pending-migration description applied only to Phase 3.
   Persistent Local is now 49/49 following separately authorized local acceptance;
   this does not describe Production or authorize a cloud migration.
7. The original server host/default-key instructions have been superseded.
   Current runtime requires explicit Billing mode/ref/URL/credentials and the
   platform's hosted identity; see the current baseline. No default Supabase
   credentials or linked-project fallback is permitted. Secrets stay outside Git.
8. Deploy only to that approved Sandbox target in a later authorized step; use an
   HTTPS `family-billing-webhook` endpoint and matching dashboard bearer header.
   Connect recovery scheduling only after reviewing retries/monitoring. No
   Production deployment, regions change, paid product or fee was created here.

## Acceptance and remaining gates

Automated verifiers distinguish **synthetic SQL**, **mock RevenueCat HTTP + real
isolated SQL**, and **mock native SDK**. They cover monthly/yearly, cancel/failure,
pending, restore/renewal, cancel auto-renew, grace/retry/expiry/refund/revoke,
duplicate/out-of-order events, provider outage, reconciliation, chain theft,
Owner/payer lifecycle and Family authorization. None is real Apple IAP PASS.

User manual steps: two Owners/test Families plus Member/Viewer; buy monthly then
yearly with separate Sandbox test chains; cancel/fail/defer; restore original and
wrong accounts; observe accelerated renewal, auto-renew off, grace/retry, expiry,
refund/revoke and actual API/webhook fields. Repeat after Owner transfer/payer exit;
verify current members share rights while an unrelated Family does not. Inspect
real development signing/StoreKit behaviour and account deletion separately.

**GO for code review and Sandbox configuration. NO-GO for paid launch or quota
enforcement.** Required gates: manual configuration, native build/device acceptance,
real provider contracts (especially first-anchor recovery and grace), a deployed
recovery loop, disclosure/retention/recovery policy. Phase 2 legacy 1.3.0 hard-quota
compatibility remains a blocker and is not changed to PASS.

Persistent local DB remains **45 applied**; repository **47 migrations**, with
only Phase 2 and Phase 3 pending. No current local jobs/data were consumed.

## Phase 3 file manifest

Added:

- `supabase/migrations/20261014114837_family_billing_sandbox_prototype.sql`
- `supabase/functions/_shared/family-billing-sandbox.mjs`
- `supabase/functions/_shared/family-billing-runtime.ts`
- `supabase/functions/family-billing-webhook/index.ts`
- `supabase/functions/family-billing-reconcile/index.ts`
- `src/features/billing/billing-sandbox-gate.ts`
- `src/features/billing/billing-client.ts`
- `src/features/billing/family-plus-sandbox-screen.tsx`
- `src/app/family-plus-sandbox.tsx`
- `scripts/verify-family-billing-sql.mjs`
- `scripts/verify-family-billing-webhook.mjs`
- `scripts/verify-family-billing-client.mjs`
- `scripts/sql/family-billing-sandbox.sql`
- `docs/FAMILY_PLUS_SANDBOX_PROTOTYPE.md`

Modified: `package.json`, `package-lock.json`, `.env.example`,
`supabase/config.toml`, `src/types/database.ts`, `src/app/_layout.tsx`,
`src/features/profile/profile-screen.tsx`, `src/i18n/locales/en.json`,
`src/i18n/locales/zh-HK.json`. Existing Phase 2 files remain byte-identical.

Sources checked: [Expo 57](https://docs.expo.dev/versions/v57.0.0/),
[RevenueCat Expo](https://www.revenuecat.com/docs/getting-started/installation/expo),
[Webhook security](https://www.revenuecat.com/docs/integrations/webhooks),
[Restore behaviour](https://www.revenuecat.com/docs/projects/restore-behavior),
[Subscription model](https://www.revenuecat.com/docs/api-v2/subscription-data-model),
[Customer resources](https://www.revenuecat.com/docs/api-v2/customer/resources),
[Apple Sandbox](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/create-a-sandbox-apple-account/).

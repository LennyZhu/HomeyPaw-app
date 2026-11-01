# Family Plus: signed Sandbox RC and final App Review binary

## Build 14 preparation — 2026-11-01

The local candidate is **HomeyPaw 1.4.0 (14)**, Bundle ID
`com.zhushunli.homeypaw`, EAS **production** profile. Build 13's review Pending
state could suppress the Apple product query; this candidate separates price
reads from Pending, retains all checkout gates, distinguishes price/Pending/Gate
UI states and supports bounded retry with account/Family/environment isolation.
No Billing API, native purchase implementation or dependency changed.

`eas.json` pins Production `HOMEYPAW_IOS_BUILD_NUMBER=14` (previously 13).
`app.config.js` resolves that value into the native iOS build number. The existing
local/RC default in `app.json` remains **11**; this is intentional profile-local
version management. App Version **1.4.0**, `appVersionSource=local`,
`autoIncrement=false`, store distribution, Production Supabase target and the
separate Sandbox Test Account Login entry remain unchanged.

The accepted backend snapshot is **2026-10-31 23:58 HKT**: Sandbox History **60**,
specified Yearly request `abandoned` / Apple outcome `unknown`, Family A Free,
active entitlements **0**, blocking Pending **0**. Database / Functions Billing
**ON**, Release Lock **OFF**, Quota **OFF**, replacement **Cron #8 active**, old
**#7 inactive**. The remaining review grant expires
**2026-11-09 17:14:05.286226 HKT**. See the
[completed Yearly record](BILLING_YEARLY_PENDING_PLAN.md). This preparation task
uses saved evidence only; it makes no backend or RevenueCat connection/change.

Local readiness checks are limited to TypeScript, targeted Lint, i18n parity,
Family Plus Pending-price Mock, EAS Production configuration introspection,
diff whitespace and pending-file credential/isolation checks. The configuration
check uses synthetic public inputs; it does not verify remote EAS variables,
Apple build-number availability, credentials or a signed artifact.
Use `node scripts/verify-release-config.mjs --config-only` to avoid the unrelated
startup-policy and push-registration Mock cases in that script.

Recorded local results on **2026-11-01**:

- Checks used the existing supported **Node 24.22.1** runtime. This machine's
  default Node 24.0.0 is below the project's engine floor; use Node 22.13.x,
  24.3+ or 25+ for local release commands. EAS remains pinned to Node **22.13.0**.
- **PASS** TypeScript (`tsc --noEmit`) and ESLint on the 11 changed JS/TS files.
- **PASS** English / zh-HK i18n parity and the Pending-price Hook/screen Mock:
  real localized price display with Pending, checkout still denied, no false
  product error, retry/reconnect/re-entry and stale-scope isolation.
- **PASS** Expo config-only introspection resolves Production to **1.4.0 (14)**,
  the correct Bundle ID, original target/review-entry flags and local version policy.
- **PASS** Four Sandbox SQL hashes and directory isolation. Yearly's local bytes
  match the previous deployment audit's complete original SQL; no live query.
- **PASS** Pending-file secret/credential/real-review-ID scan, upload-scope
  checks, no tracked ignored environment files, and `git diff --check`. Only
  explicitly synthetic test inputs and unchanged public/example emails matched.

There are 18 pending files, all within this release's scope, and no staged files.
The Build 14 source commit does not exist until the user commits the changes.
No SQL/database regression, purchase/restore or device/simulator test was rerun.

After manually committing the reviewed files to `develop`, build and submit the
specific resulting Build 14 artifact in separate steps:

```sh
EXPO_NO_DOTENV=1 npx eas-cli build --platform ios --profile production
EXPO_NO_DOTENV=1 npx eas-cli submit --platform ios --profile production --id '<BUILD_14_EAS_BUILD_ID>'
```

Replace the ID with the successful Build 14 result. EAS Submit uploads to App
Store Connect; select Build 14 for the 1.4.0 submission there. No EAS Build/Submit,
Git staging/commit/push/merge or new cloud operation is performed by this record.
Production launch/charging remains a separately authorized release step.

## Historical submitted review status — 2026-10-26

iOS 1.4.0 Build 12 (source commit
`899ca06a434bbce35284699c4360ea817c83f7dc`), Monthly, Yearly and the subscription
group are all submitted and Waiting for Review. Keep that binary unchanged.
The existing Owner A / Family A uses the activated 14-day Sandbox admission
through **2026-11-09 17:14:06 HKT**. Its old Monthly request is `abandoned`, with
Apple's outcome still `unknown`, and no longer blocks checkout. All three
Sandbox forwards are deployed/verified and isolated in `supabase/sandbox-migrations`.

During review: Sandbox Database Billing / Functions Billing **ON**, Quota **OFF**,
Release Lock **OFF**; generation-bound **Cron #7 is enabled**. The real short close
rehearsal passed. See the
[Sandbox deployment record](../supabase/sandbox-migrations/README.md) for exact
timing, unchanged SQL hashes and closure/Functions Secret handling. This records
accepted results without a fresh cloud check. Never commit review credentials,
real user identifiers, Tokens or cloud Secrets. Production is not authorized
to run the three Sandbox forwards or enable charging by this review record.

## Release sequence — 2026-10-25 historical plan

Follow [the 1.4.0 execution plan](FAMILY_PLUS_LAUNCH.md) for the current release
decision: monthly and annual billing on public release day, manual Apple release,
Production organization Pro upgrade after approval and before public launch.
Use the next available **production-target** artifact (currently configured as
1.4.0 Build 12) first in TestFlight, then submit that same artifact. Verify its
build number is unused before building. Build 11's Sandbox purchase acceptance
does not prove the Production artifact's isolated review route or restore fix.
The Production build needs `EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED=true` in its
build environment; server `release_ready=false` keeps ordinary checkout closed
during review. Only the admitted synthetic-account Sandbox route is opened for
review, with an explicit expiry and availability covering the review period.

At that time Sandbox was 56/56 per accepted deployment evidence, Recovery
acceptance passed and the testing window/Cron was closed. This precedes the
formal review activation above. No new cloud check is claimed here. The
55/55 and empty preview-environment observations below are dated historical
snapshots, not current missing-deployment findings. Production migration state,
EAS/ASC build-number availability and final build environment require separately
authorized verification. No build or deployment is authorized by this document.

## Explicit build targets

| Profile              | Distribution                | Main backend                | Native billing                                          |
| -------------------- | --------------------------- | --------------------------- | ------------------------------------------------------- |
| `billing-sandbox`    | Internal Development Client | Explicit Sandbox            | Existing Development/Ad Hoc flow                        |
| `billing-rc-sandbox` | Store / TestFlight          | `yhxxsawcaffxonpconaq` only | Store signing, no Metro/Dev Launcher                    |
| `production`         | Store                       | `tknaobmlwmodsqtpqwkr` only | Production billing; separate approved test-account page |

All use `com.zhushunli.homeypaw`, matching the Apple products. Do not submit the
Sandbox RC artifact as the public App Store binary. The final review artifact is
a separate `production` build. There is no runtime receipt-based backend fallback.
Missing or inconsistent non-Development target configuration fails closed.
`eas-build-pre-install` checks the selected profile, target, URLs, public keys,
Apple SDK key and Bundle ID before building. It neither contacts nor deploys a
backend. Client build/signing checks never replace backend authorization.

### Sandbox TestFlight RC

In the EAS **preview** environment, supply only public client values:

- `EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY`: Sandbox publishable/anon key.
- `EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY`: HomeyPaw Apple App's `appl_` SDK key.

The profile pins the Sandbox URL/ref and cloud mode. It does not inherit the
Development profile or any Production credential fallback. Server Billing and
Release Lock must separately permit testing; the profile itself enables no
database/runtime switch. Generic `preview` is not a Billing target.

After the independently reviewed version/build configuration and keys are ready:

```sh
EXPO_NO_DOTENV=1 eas build --platform ios --profile billing-rc-sandbox
```

No auto-submit. A successful TestFlight purchase is not final App Review proof.
The current app/package version is **1.4.0**. EAS iOS history checked on
2026-10-24 contains Build 1–10; the Sandbox RC uses **11**, and the separate final
Production profile uses **12**. `app.config.js` resolves each profile's pinned
`HOMEYPAW_IOS_BUILD_NUMBER`; local development defaults to app.json's 11.
Recheck availability if another build is created before uploading; EAS history
does not prove that no IPA has been uploaded outside EAS to App Store Connect.

The EAS **preview** environment was empty at this check. Before building, add
the two public variables above in **HomeyPaw project → Environment variables →
preview**, using the Sandbox publishable key and HomeyPaw Apple `appl_` SDK key.
Use Plain text or Sensitive visibility (not Secret: these public inputs must be
readable during local EAS configuration). Never add service-role/admin keys,
RevenueCat server keys or test-account passwords. The profile already pins the
Sandbox URL. Generic Production client variables are rejected in the RC guard.

## Final Production binary: approved test-account purchase page

The normal app, Auth session and Family data stay on Production. Its webhook,
RevenueCat API reads and SQL snapshot application continue rejecting SANDBOX
transactions. No paid Sandbox entitlement is copied into Production.

The sign-in page can expose **Test account sign-in** (`/billing-test-account`)
only in an explicitly configured Production store build with all required public
configuration. Document this visible route in App Review Notes; it is not a
hidden paid-feature unlock or an alternative payment system.

The route uses a separate, non-persistent Sandbox Auth client and its own
in-memory QueryClient. It never changes the main app's Supabase target, Auth
session or cache. The reviewer enters synthetic Sandbox credentials; no account,
password, Admin key or service secret is embedded in the binary. No signup or
account provisioning is available through the route.

After normal Sandbox password authentication, `auth.getUser()` and the read-only
`get_family_billing_test_access()` RPC must verify an enabled, unexpired,
server-approved account-to-Family binding and current canonical membership.
Client flags, email text and user-editable metadata grant no admission. The RPC
also denies a database configured for PRODUCTION billing. Approval is rechecked
before native billing operations; logout, expiry, revocation and scope changes
deny further operations. Closing the page clears its session and private cache.

The page reuses the real Family Plus UI and a scoped instance of the existing
Billing client. Owner, purchase intent, original payer, transaction environment,
Family binding, webhook and server snapshot checks all remain mandatory. Member
and Viewer remain read-only. RevenueCat uses the authenticated **Sandbox Auth
UUID**, not a Family ID or the main Production identity. The native SDK lock is
shared across instances. A successful StoreKit result never grants Plus locally.

Apple/RevenueCat, not a client `isSandbox` declaration, determines the transaction
environment. A PRODUCTION event sent to the Sandbox still fails, as does a
SANDBOX event sent to Production. The test-account route is for Apple test
transactions only; never use a real paying Apple account there.

### Still required before final-binary review testing

1. Approved forwards **53 → 54 → 55** were applied to Sandbox on 2026-10-24.
   Independent read-only verification confirmed **55/55**, original versions,
   statement hashes and preserved business fingerprints, buckets, policies and
   RPC grants. Billing/Quota remain OFF, Release Lock ON, TUS residual-risk
   acceptance OFF, Transition not started. No Production connection or persistent
   Local change was made. Migration 55 creates an empty private approval table
   and a read-only RPC, not accounts, subscriptions or Plus grants. Repository
   migration count alone is not proof of another environment's deployment.
2. In an approved, protected Sandbox maintenance transaction, approve only
   synthetic Auth UUIDs and their existing Family IDs with an explicit expiry.
   Restore/verify Release Lock using the established transaction procedure.
   There is no client approval/mutation RPC. Production needs no review-user
   exception, review entitlement table or permission change for this route.
   This is a separate data write, not part of migration deployment. Propose the
   exact existing synthetic Auth UUID/Family ID and an explicit server expiry
   covering the intended review window for user approval first. Within one
   transaction, lock/verify the existing safe switches, temporarily unlock,
   insert the minimal approval, restore Release Lock ON, verify and commit;
   rollback on any error, then independently verify the lock and approval. No
   Plus grant or account is created. A normal Sandbox RC login does not require
   this final Production binary's separate review-account admission.
3. In EAS **production**, supply the Production publishable key and HomeyPaw
   `EXPO_PUBLIC_REVENUECAT_APPLE_KEY`, plus the **Sandbox public** key and fixed
   Sandbox URL for the isolated page. The Apple App SDK key is public and can
   serve Apple's two environments; never use a `test_` key or a server secret.
   The profile opts in the test-account form; server approval remains required.
4. Separately authorize the usual Sandbox purchase window. Billing/runtime OFF
   and Release Lock ON intentionally prevent a purchase even after admission.
5. Build the actual `production` artifact, supply the expiring test credentials
   and visible entry instructions privately in App Review Notes, and manually
   verify Apple SANDBOX transaction → Sandbox webhook → Sandbox Family Summary.
   Confirm the main Production session/data never change. Close the testing
   window afterward without deleting transactions or entitlements.

No claim of real TestFlight/final-binary purchase PASS is made by local tests.
Never solve review by accepting all environments in a Production webhook.

## Local verification

- `npm run verify:billing-store-target`: profile/config/signing, mock normal Auth
  and test-account admission, revocation/expiry/identity, no Production fallback.
- `npm run verify:family-billing-client`: shared native operation implementation,
  authenticated UUID, Store RC and isolated test-account client scopes.
- `npm run verify:family-plus-integration`: both directions of environment denial.
- `node scripts/verify-billing-test-account-sql.mjs`: private ACL/RLS, canonical
  Family membership and server expiry/environment in a disposable database;
  persistent Local fingerprints must remain unchanged.

Sources: [Expo SDK 57 Application](https://docs.expo.dev/versions/v57.0.0/sdk/application/),
[EAS environments](https://docs.expo.dev/eas/environment-variables/),
[RevenueCat Apple Sandbox/TestFlight](https://www.revenuecat.com/docs/test-and-launch/sandbox/apple-app-store).

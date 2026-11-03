# Family Plus Phase 4C — Development UI preview

> Historical UI-phase record. References to pending local migrations below are
> snapshots; current Local is 49/49. Billing and Quota Enforcement remain OFF.
> See the [current baseline and Sandbox contract](FAMILY_PLUS_PHASE4E1R.md).

2026-10-16. This is a local client UI prototype, not a purchasing milestone.

## Open the preview

Use the existing Development/Metro workflow with a local Supabase URL such as
`http://127.0.0.1:54321`. Do not reuse Production environment settings. Sign in
with a local test account that belongs to a Family, then open:

**我的 → 個人資料下方的「家庭方案」卡片**

Or **我的 → 管理家庭 → 家庭方案**. Both open the same `/family-plus` page.

English: **My → Family Plan**, or **My → Manage Family → Family Plan**.

The `/family-plus` route and Family Settings entry require `__DEV__` plus an
HTTP loopback Supabase URL. Release/TestFlight and all cloud URLs, including
Production, are denied. No extra flag, RevenueCat key or new native build is
needed for this UI. It does not require the three pending local migrations.
The older `/family-plus-sandbox` integration test screen is unchanged and is
not the UI preview entry.

Expand **切換預覽情境 / Change preview scenario** to inspect Free, Plus active,
grace, renewal cancelled, expired, revoked, unavailable and transition, plus loading,
empty, error and offline. Only an actual Owner can simulate other roles; Member
and Viewer cannot switch the preview to Owner. The initial role comes from
canonical Family context. Missing/loading/error Family context or an unknown
role never enables billing actions or claims a current Free/Plus plan.
The initial scenario is **unavailable**, never an assumed Free or Plus identity.
Choose a scenario explicitly. Its in-memory state is shared by My, Manage Family
and Family Plus while the same signed-in user and Family remain selected.
Leaving the page keeps that example for cross-page inspection. Logout, account
or Family changes, and a fresh App JS runtime discard it; returning to an earlier
Family does not restore a previous paid example. No preview state is persisted.

## Phase 4C-UI-2 hierarchy

The neutral My card sits between profile identity and My Pets, uses the existing
soft green surface, and is a two-line entry with a small paw icon. Content and
16pt padding produce approximately 76pt at normal type, without a fixed height;
larger text can grow it. The menu follows at 16pt. Phase 4C-UI-4 keeps this compact
layout and mirrors the shared preview identity, explicitly labelled as a preview.

## Phase 4C-UI-4 Family identity

`FamilyPlusBadge` uses a small paw, coral text and the existing pale coral surface.
Preview badges read **PLUS · 預覽 / PLUS · PREVIEW**, with an explicit accessible
label saying this is not a real subscription. Badge and readable status appear
only in the My Family Plan card, beside the Family name in Manage Family, and
beside the current plan on Family Plus. They never identify a person or Pet.
Names/headings can wrap, and badges have no fixed height or disabled font scaling.

- Active: badge plus enabled status.
- Grace: badge only with positive access evidence, alongside a payment reminder.
- Cancelled: badge only while access is confirmed valid; cancellation is visible.
- Free, expired, revoked, unavailable and transition: no active Plus badge.
- Missing Family, unknown role, loading or failed context: neutral status, no badge
  or purchase permission. No fabricated expiry date is shown.

`familyPlusIdentity` is a shared display adapter. Future server snapshots require
explicit server-verified access and an unexpired validity boundary, including
grace/cancelled states. Missing, denied or expired evidence displays unavailable
rather than claiming active. Development examples are accepted only under the
existing Development + HTTP loopback guard. This does not grant any quota rights.

`useFamilyPlusPreview` reads one disposable memory scenario scoped to user and
Family. A root lifecycle observes the existing Family selection store, which Auth
already clears on logout/account changes. Scope changes reset the scenario and
invalidate stale callbacks; no per-Family cache of paid examples is retained.
Pet changes do not affect it. Owner/Member/Viewer share the same Family identity;
role simulation affects only the membership page's action preview, not that identity.
Only Owner has purchase/restore/manage placeholders. Release/cloud hooks return
no preview snapshot and the badge independently rejects development examples.

The membership page now orders title/introduction, compact preview notice,
current plan/storage, three Plus benefits, billing period/purchase preview,
comparison, then grouped video/subscription/payer/legal information. Full
preview explanation and scenario tools appear only when expanded. Prices remain
explicit reference amounts. Monthly/yearly selection behavior is unchanged.

Phase 4C-UI-3 trims the collapsed notice to a single-line-first bar: sample-data
label plus scenario action. Its 44pt action and 4pt vertical padding target 52pt
at normal type. Large text can wrap/stack. The following status has a 16pt gap;
other section spacing, expanded controls and safety checks are unchanged.

## UI and product truth

- Existing warm white/coral theme, Screen, AppText, AppButton, SettingsRow and
  shared spacing/typography; no new dependency or global design-system change.
- Free/Plus comparison, shared storage progress/remaining/overage and monthly
  publication count; historical media retention and core free features remain
  explicit. All quantities/statuses are visibly marked examples.
- Free: 300 MiB and three successfully published videos per calendar month.
  Plus: 5 GiB and unlimited monthly videos, subject to existing 15-second,
  file-size and space restrictions. Deletion does not refund a monthly slot.
- Expired example retains content and illustrates an over-limit Free plan.
  Unavailable status has no invented zero usage, balance or subscription result.
- Transition is only a future display example: no cohort, activation, clock or
  entitlement is created.
- Owner can choose monthly/yearly and try purchase/restore/manage placeholders.
  Active/grace/cancelled plans do not offer another purchase. Member/Viewer see
  shared benefits/usage and an Owner-management explanation; no billing actions.
- Every billing placeholder only produces a development-preview notice. No
  success state, purchase, restore, management SDK call, reconciliation, intent,
  RPC or entitlement mutation is performed.

## Prices and legal information

US$3.99 monthly and US$29.99 yearly are isolated Development reference fixtures,
not StoreKit offers. The yearly example states one annual charge, automatic
renewal and about 37% savings against twelve reference monthly payments. No
trial, installments or lifetime offer exists.

The presentation contract accepts an Apple-localized `priceString` with source
`apple`; it never falls back to USD when a product is missing. Reference savings
copy is not shown for that source. No real Offering is loaded in this phase.

Legal links reuse repository addresses:
`https://homeypaw.vercel.app/terms` and
`https://homeypaw.vercel.app/privacy`. Link failures show a retry-later message.
Ownership transfer does not transfer Apple billing; the original payer should
manage an existing subscription.

## Data boundary and next integration

`FamilyPlusSnapshot` is a presentation contract, not an entitlement store.
Only an in-memory Development fixture implements it here. The Phase 3 Billing
client, identities, purchase-intent protocol and server checks are unchanged.
The new UI imports neither that client nor RevenueCat SDK/Supabase mutations.
Existing Family queries identify the signed-in user's Family/initial role.
The page never uses a selected Pet as membership identity.

A later trusted adapter must combine server-authorized Family entitlement/quota
facts with localized StoreKit products. Current `get_family_billing_state`
returns tier/flags but does not expose every grace/cancellation/expiry display
detail; do not infer these from client metadata or aggregate CustomerInfo.
Owner UI visibility never replaces service authorization or original-transaction
uniqueness. Cloud identity, backend deployment, provider reconciliation and
real Apple Sandbox validation remain separate gates. Quota enforcement stays
OFF; monthly timezone/downgrade rules are not fixed by these fixtures.

## Acceptance and limitations

Run `npm run verify:family-plus-ui` for executed TSX state/role interactions,
preview purchase/restore/manage feedback, local/release target guards, missing
data, reload, price localization, zero-Pet identity and navigation assertions.
Mocks intentionally reject any unexpected SDK/network/persistence dependency.
Coverage includes explicit access/expiry boundaries, all badge states, real scene
clicks across three page components, all roles, long Family names, lifecycle
logout/Family reset, stale callback rejection and Release/cloud denial.
Also run typecheck, targeted ESLint/Prettier, i18n parity and existing Billing,
Profile, Family authorization and Family Chat client regressions.

Screen provides safe areas and readable iPad width. Plan options stack on phones
and at large font sizes; labels wrap without disabling font scaling. The app
currently pins `userInterfaceStyle: light` and only defines a light palette.
This phase preserves that system rather than adding a separate dark theme.

For manual acceptance, select Active in Family Plus, return to My, then open
Manage Family: all three should show the same explicitly marked preview badge.
Switch to Free and confirm all three lose it. Repeat Grace, cancelled, expired,
revoked and unavailable; inspect payment/status copy as well as the badge. Check
Member/Viewer can view but have no purchase/restore actions, and switch Pets to
confirm identity remains unchanged. Logout/relogin and a fresh App runtime must
start unavailable. Inspect long names, iPad and large text for natural wrapping.

Native layout, Dynamic Type rendering and screenshots await user acceptance;
automated TSX checks are not simulator/device visual tests. No simulator,
device, EAS build, purchase, cloud connection, migration, deployment, dashboard
change, version/build change, quota enforcement, commit, push or merge is part
of this phase.

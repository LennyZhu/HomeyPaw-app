# 1.4.1 Family member entitlements

Local implementation only. Nothing in this change deploys SQL, modifies hosted
families/invitations, or changes Billing, media quotas, prices or StoreKit settings.

## Rules and authority

- Free: 2 people total; Family Plus Monthly/Yearly: 10 people total. The Owner
  and every canonical `family_members` row, including Viewers, count once.
- `private.family_member_plan` requires a currently valid private Plus grant
  joined to its verified App Store subscription for the same Family, configured
  environment and configured Monthly/Yearly product. Cancelled renewal retains
  seats until verified access expires; supported payment grace retains seats.
  A client flag, a bare grant, a media transition, or another Family's subscription
  cannot grant 10 seats. Closing checkout does not revoke verified paid access.
- Counts never truncate or repair historical data. No existing membership,
  role, read policy, login, chat, pet-care or historical-record access is changed.
  Expiry/downgrade limits growth only, even when current headcount exceeds 2 or 10.
- Both invitation creation and acceptance check the current plan on the server.
  The canonical membership trigger also enforces growth, including Viewer rows.
  Existing-member role changes and Pet mirrors do not create new people and are
  allowed for over-limit families (including creation of another Pet's mirrors).

## Reservations and historical invitations

Before this change there is one unrevoked shared invitation code per Family,
valid for 7 days, with at most 5 uses, and a 10-person **Owner/Member** join limit
(the previous trigger excluded Viewers). The code
does not identify five specific invitees. Expiry/revocation releases unused uses.

The forward migration takes short table locks and snapshots **only currently
valid, unused invitation capacity**, checking the canonical/legacy mirror first.
It does not revoke, delete, extend or rewrite those invitations. The immutable
private snapshot records original ID/Family/hash/timestamps, original use budget
and both counts at cutover. Each legacy acceptance has append-only transactional
audit evidence. It may exceed the new total-headcount limit, but cannot exceed
10 Owner/Member rows, the fixed total ceiling `10 + Viewers at cutover`, the
original remaining uses (at most 5), or original expiry. For example, 9 counted
people + 1 existing Viewer may accept one legacy invite to become 11 total,
matching the original promise. All 11 remain; new invitations are blocked. No
new Viewer can expand the captured legacy total ceiling.
Revocation, expiry and exhaustion remain effective. Failed joins roll back the
audit, membership, mirrors and use increment together. No later invitation can
obtain this allowance, even by changing its client timestamp.

New invitations have `max_uses = least(5, current_limit - current_members)`;
Free with one Owner gets one use. The existing single-code uniqueness and Family
transaction lock serialize creation/regeneration, acceptance and lifecycle
operations. Regeneration explicitly replaces the existing reservation; a failed
full-family creation cannot revoke the old code. A legacy replacement requires
client confirmation and gets the current plan's limit, not legacy eligibility.
On downgrade, unused **new-rule** invitations keep their records and expiry but
every acceptance must fit the current limit. Summary reservations show currently
admissible places, not a promise to exceed a downgraded plan.

A canonical invitation INSERT trigger also guards older RPC bodies already
running at cutover: their five-use reservation is clamped to available places,
or the whole operation rolls back without revoking the previous invitation.
An in-flight old join exceeding the new limit fails safely and can retry through
the replaced RPC to consume its valid legacy allowance; it cannot bypass the
transaction-scoped exception audit.

All writes use the existing Family advisory-lock namespace and database
transactions. The private allowance/audit cannot be written by clients or service
roles. A transaction-ID-bound private audit row authorizes an exceptional legacy
membership insert; client-set session flags do not. Repeatable-read transactions
are rejected with `40001` rather than permitting a stale-snapshot capacity race;
PostgREST's existing read-committed RPC path is unchanged.

## Client and 1.4.0 compatibility

`get_family_member_capacity(uuid)` is an additive, authenticated, Family-scoped
read RPC. It performs no metering, billing or subscription write. The new client
uses identity-scoped keys, server time, expiry timers, focus/reconnect refresh,
15-second reads and mutation invalidation. A missing/unavailable capacity RPC
disables only new invitation creation; members and existing basic actions remain.
No optimistic Plus or hardcoded 10-person fallback is used.

Member UI shows actual `count / 2` or `count / 10` (for example `5 / 2`), keeps
all member rows, and shows Owner-only creation/upgrade controls. Existing legacy
codes remain viewable/revocable while full; regeneration cannot bypass a limit.
The paywall adds the bilingual 10-person benefit and the Owner-inclusive Free/Plus
comparison. The 300 MiB / 5 GiB media benefits and purchase code are unchanged.

Existing creation/join/revoke RPC signatures, column order and return types remain
unchanged. Both legacy Pet wrappers still delegate to canonical Family RPCs.
`family_member_limit_reached`/`P0001` remains the full-family error; `DETAIL`
distinguishes Free/Plus. Authentication/Owner denial retains `42501`; invalid,
revoked, expired or exhausted codes retain `invite_invalid`. 1.4.0 can display
its old generic/10-person wording on rejection, but does not need new fields and
cannot bypass server limits. No old client member list or access is removed.

## Offline verification

- `npm run verify:family-member-capacity-client`: JSX, read-hook/identity mocks,
  expiry, role gates, complete lists and bilingual copy. No service/native calls.
- `npm run verify:family-member-entitlements`: actual forward SQL against minimal
  synthetic dependencies in a disposable cached PostgreSQL 17 Docker container,
  `network=none`, no host ports/mounts, no linked refs or credentials. Exercises
  real separate-session races and rollback. Removes only its own container.
- TypeScript, targeted ESLint, i18n parity and `git diff --check`.

This is a targeted dependency-fixture verification, **not** a full managed
Supabase/RLS/HTTP replay or native-device acceptance. The old fixed-cap integration
script is a historical 1.4.0 verifier, not the new entitlement policy acceptance.

## Changed files

- Database: [forward migration](../supabase/migrations/20261104135554_family_subscription_member_limits.sql).
- Capacity: [rules/parser](../src/features/family/family-member-limit.ts),
  [read hook](../src/features/family/use-family-member-capacity.ts),
  [cache keys](../src/features/family/family-query-keys.ts),
  [mutation refresh](../src/features/family/family-queries.ts),
  [RPC type](../src/types/database.ts).
- UI: [member screen](../src/features/family/pet-members-screen.tsx),
  [Family settings](../src/features/family/family-settings-screen.tsx),
  [join errors](../src/features/family/join-family-screen.tsx),
  [paywall](../src/features/billing/family-plus-screen.tsx).
- Copy: [English](../src/i18n/locales/en.json), [zh-HK](../src/i18n/locales/zh-HK.json).
- Verification: [SQL runner](../scripts/verify-family-member-entitlements.mjs),
  [synthetic fixture](../scripts/sql/family-member-capacity-fixture.sql),
  [client mocks](../scripts/verify-family-member-capacity-client.mjs),
  [existing paywall test dependency](../scripts/verify-family-plus-ui.mjs),
  [package scripts](../package.json), and this document.

2026-11-04 local result: TypeScript, targeted ESLint, i18n parity, formatting,
client mocks, existing paywall UI checks and the isolated SQL fixture PASS.
Separate-session creation/join races, cached old creation, legacy Viewer
eligibility and rollback passed. All 58 tracked standard migrations and four
tracked Sandbox migrations retain their original bytes; the four Sandbox SQL
files remain outside the standard migration directory. No hosted validation,
deployment, native run, build, commit or push has been performed.

## Safe release order (separate authorization required)

1. Review/commit this feature separately; retain all deployed historical SQL and
   the four Sandbox-only migrations in `supabase/sandbox-migrations/` unchanged.
2. Obtain authorization for one new standard forward migration:
   `20261104135554_family_subscription_member_limits.sql`. Recheck target identity,
   expected history and a current recoverable backup. No existing 58 migrations
   or Billing Functions need replay/redeployment.
3. Schedule deployment immediately before 1.4.1 availability to minimize the
   period when 1.4.0 shows outdated invitation limits. The server rules and legacy
   snapshot take effect at migration commit; the new UI takes effect only after
   users install 1.4.1. Never grandfather by app version or request-supplied time.
4. Deploy only the approved forward migration transaction. Lock timeout, mirror
   drift, permission or SQL error must abort/roll back the whole migration. Do not
   repair/delete historical members or pending invitations to make it pass.
5. Read-only verify the new function permissions, actual counts, plan decisions,
   legacy allowance totals and unchanged membership/invite fingerprints. Check
   existing access and old RPC contracts; no real invitation or purchase tests
   without separate authorization.
6. Build and review 1.4.1 only after the server contract is ready. Fully disclose
   the benefit/legacy behavior in review notes. Consider synchronizing Monthly
   and Yearly subscription descriptions to say **10 total including the Owner**;
   do not alter price, SKU, Apple Family Sharing or RevenueCat Entitlement.

On a post-deployment issue, keep existing memberships/allowances/audit intact.
Do not deploy the older fixed-cap SQL or delete newly joined members as rollback.
Pause the client rollout and prepare a reviewed forward fix under fresh
authorization. No action here touches OrderMori or a shared Apple Sandbox Tester.

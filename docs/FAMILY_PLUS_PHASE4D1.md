# Family Plus Phase 4D-1 — trusted local reads

> Historical phase-time acceptance record. The 45-applied/four-pending and
> not-ready Local descriptions below predate Phase 4D-2. Current Local is 49/49
> with trusted initial media observation; Billing and Quota Enforcement remain
> OFF. See the [current baseline and Sandbox contract](FAMILY_PLUS_PHASE4E1R.md).

2026-10-16, `develop`. Read-only integration milestone, not a payment or quota
activation. Version/build remain 1.3.0 / 10. No cloud configuration is read.

## Existing authority and gaps

`private.family_media_entitlements` is the effective Family grant authority.
Phase 3 service-only snapshot application derives bounded grants from a verified
store subscription; it never accepts client `isPlus` or CustomerInfo as authority.
Owner transfer leaves that Family binding and the independent payer unchanged.

Existing `get_family_billing_state(uuid)` authorizes canonical Family members,
but exposes only tier, purchase blockers and Sandbox flags. It cannot describe
grace/cancellation or exact access evidence. Existing `get_family_media_quota`
coalesces an absent/uninitialized usage row to zero. Neither contract is enough
for truthful UI by itself. They remain unchanged for compatibility.

## New read contract

Forward migration `20261016053022_family_plus_read_summary.sql` adds only
`public.get_family_plus_summary(uuid)`. It is STABLE, has an empty search path,
and reads protected private tables via a restricted security-definer boundary.
Only authenticated callers have EXECUTE. It requires a still-existing Auth user
and canonical `family_members` row; Owner, Member and Viewer share Family facts.
Removed/Former/stale Pet mirrors, other Families and anonymous users are denied.
No private schema/table grants, payment IDs, billing UUIDs or secret values are
exposed. A PostgreSQL read-only transaction successfully calls the function.

The versioned response includes Family/caller IDs, current role, server time,
state, bounded access evidence, server confirmation/reconciliation timestamps,
capacity, enforcement flag, usage categories and monthly policy readiness.
There is no lazy initialization, reconciliation write, purchase intent or grant
mutation in a read request.

The effective grant is chosen using the same bounded rules as Phase 2 limits.
Linked grants must match the exact subscription, Family and environment.
Grace and cancelled-active require positive access and an unexpired trusted
boundary. Refund/revoke and expiry remove the badge; inconsistent facts become
unavailable. Retry without grace is not labelled an active or revoked plan.
Transition remains distinct from paid Plus. Isolated administrator fixtures may
provide bounded server grants; no fixture or activation is seeded by migration.

## Metering semantics and remaining limitations

Journal photos, videos and thumbnails are counted; avatars remain excluded.
`private.family_media_objects` and `family_media_usage` hold trusted server
measurements. The endpoint does not sum client-reported sizes or invoke Storage
listing from the client. Uninitialized reconciliation, measurement errors,
unmappable objects, Storage/registry generation or byte mismatches, or stale
totals return unknown/pending used bytes, never an invented zero.

- Used bytes include live registered objects until trusted cleanup acknowledgment.
- Upload reservations are separate and are not added again to used storage.
- Unpublished objects and pending cleanup are classified separately inside usage.
- Unobserved/late completed uploads make exact usage pending; reads do not settle
  or release them. Physical deletion alone does not grant an early refund.
- A confirmed empty Family can legitimately return zero; no Pets are required.

Monthly counts come from durable successful-publication facts in
`private.family_video_publications`, not remaining video rows. Deletion does not
refund counts. The calendar timezone, counting scope and metering start remain
unconfigured by default. Partial-month coverage, invalid policy, or unobserved
published videos suppress the count. Configured test policies are explicitly
candidate rules. The timezone and downgrade-month counting product decisions
remain unresolved; this migration does not choose them or activate transition.

At this phase's 45-applied snapshot, Quota observation was not installed. Its
later authorized migration performs an initial scan; unobserved/late uploads and
cleanup still require trusted reconciliation. Legacy 1.3.0 hard-quota upload
compatibility remains blocked. Storage enforcement remains OFF.

## Client data path and source separation

`family-plus-api.ts` calls only the new read RPC and only under the existing
Development + HTTP loopback guard. `family-plus-data.ts` validates the response
and caller/Family scope, then maps it to the existing presentation contract.
Access display uses server time plus elapsed monotonic time, not device calendar
time as entitlement authority. Queries refresh every 15 seconds; actual upload
and purchase authorization always remain server responsibilities.

`use-family-plus.ts` is shared by My, Manage Family and Family Plus. Query keys
are under `families / user / detail / family / plus-summary`, so the existing
Family revocation cleanup covers them. No Pet is in the key. Logout's existing
query clear, abort signals, caller/Family checks, no placeholder data and zero
unused-cache retention prevent late results from becoming another identity's
state. Errors/offline/unknown context hide the paid identity even if cached
data exists. Real-data mode never falls back to fixtures.

The existing disposable Preview memory also tracks the explicitly selected
data source. Selecting a scenario returns to Preview; choosing **讀取本機資料
（唯讀）** switches all three pages to server reads. Context loading/errors do
not silently change that source. Logout/Family/account changes reset the entire
disposable selection. Preview still has its own marked badge and no persistence
or backend write. Real local data carries a local-data label and has no reference
USD prices, purchase, restore or management controls. Release/cloud access stays
closed; no production subscription UI was enabled.

## Verification and next gate

Commands:

- `npm run verify:family-plus-data-client`
- `npm run verify:family-plus-data-sql` (creates and removes an independent blank
  local Supabase instance; never run migrations against the persistent instance)
- `npm run verify:family-plus-ui`, typecheck, targeted lint/format, i18n parity,
  Profile/Family navigation/authorization and existing Billing regressions.

The SQL suite replays all 49 migrations from zero, uses synthetic data, runs
existing Quota/Billing/Recovery assertions, tests real local PostgREST JWT access,
and executes the actual supabase-js API/parser/presentation path for all roles.
It compares persistent Local row fingerprints and migration history before and
after, then removes only the temporary project's containers and volumes.
No original local pending jobs or worker are consumed.

Final results: PASS for the new client/data/UI verifiers, blank 49/49 replay,
SQL and real local API/adapter integration, Quota/Billing/Recovery regression,
TypeScript, targeted ESLint, Prettier, i18n parity, Profile/Family authorization
and navigation, Billing client/access/target guards, Chat, Care completion,
Journal browsing, Schedule UI and `git diff --check`. No Edge Function changed,
so Deno checking is not applicable to this diff. Native UI remains untested.

## Files in this phase

New:

- `supabase/migrations/20261016053022_family_plus_read_summary.sql`
- `src/features/billing/family-plus-api.ts`
- `src/features/billing/family-plus-data.ts`
- `src/features/billing/use-family-plus.ts`
- `scripts/lib/blank-family-plus.mjs`
- `scripts/sql/family-plus-read-summary.sql`
- `scripts/verify-family-plus-data-client.mjs`
- `scripts/verify-family-plus-data-sql.mjs`
- this document

Updated:

- `src/features/billing/family-plus-presentation.ts`
- `src/features/billing/family-plus-preview.ts`
- `src/features/billing/use-family-plus-preview.tsx`
- `src/features/billing/family-plus-screen.tsx`
- `src/features/billing/components/family-storage-summary.tsx`
- `src/features/profile/profile-screen.tsx`
- `src/features/family/family-settings-screen.tsx`
- `src/i18n/locales/zh-HK.json`, `src/i18n/locales/en.json`
- `src/types/database.ts`
- `scripts/verify-family-plus-ui.mjs`
- `package.json` (two verification commands only)

All 48 previous migration files and the Phase 2/3/4B server implementation remain
byte-identical. The phase-start comparison records 600 other existing files
unchanged; there are no deleted files, dependency additions or lockfile changes.

Historical phase-end state: persistent Local was 45 migrations, with four pending files (Quota,
Billing, Recovery, read summary). With the current DB, selecting real reads must
show not-ready and no sample usage. Applying those four files and initializing
trusted observation require separate Phase 4D-2 approval. This document does not
authorize those writes. After review, Phase 4D-2 local integration acceptance is
the next gate; cloud Billing, Apple Sandbox purchases and quota enforcement are
not ready or tested by this milestone.

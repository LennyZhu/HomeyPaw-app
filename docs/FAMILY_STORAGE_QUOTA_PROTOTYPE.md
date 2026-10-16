# Family Storage Quota — Phase 2

> Historical Phase 2 record. The old 45-applied/pending migration state below
> is not current: persistent Local is now 49/49 following authorized acceptance.
> Billing and Quota Enforcement remain OFF. See the
> [current baseline and Sandbox contract](FAMILY_PLUS_PHASE4E1R.md).

2026-10-14. Local/isolated prototype only. No Production connection, migration,
Storage policy, payment setup, entitlement snapshot or transition activation.

## Scope and defaults

Meter `post-media`, `post-videos`, `post-video-thumbnails`. Avatars remain outside
the quota: account avatars are user-scoped; Pet avatars serve the free core UI.
Their existing file caps and cleanup continue unchanged. Including them later is
a separate product decision, not a hidden charge in this prototype.

Free is 300 MiB / three successful video publications per calendar month;
Transition is 1 GiB with no segment limit; Plus is 5 GiB with no segment limit.
The existing 15-second, 25 MiB video and 2 MiB thumbnail limits remain unchanged.

`storage_enforcement_enabled = false` is protected by a CHECK constraint. The
migration adds no Storage policy or Storage trigger and replaces no existing
Journal/Care RPC. Global hard enforcement requires a later reviewed migration.
The explicitly opted-in reservation RPC exercises atomic quota admission; old
1.3.0 does not call it and retains its original upload protocol.

All private tables have RLS and no client DML grants. There is no client-facing
entitlement/configuration upgrade API. Test grants are direct writes to the
disposable DB, absent from the migration and always rolled back/destroyed.

## Unresolved product choices

- `video_calendar_time_zone`, `video_counting_scope`, `metering_started_at` remain
  NULL. Free video admission fails with `QUOTA_VIDEO_POLICY_NOT_CONFIGURED` until
  the server has explicitly configured all three. Legacy publication observation
  remains non-blocking. Fixtures choose Hong Kong and test both `all_successful`
  and `free_only`; neither is a product default.
- Entitlements require explicit starts/ends and `ends_inclusive`; there is no
  default boundary or automatic 30-day calculation. Both end boundaries are
  tested. No real entitlement or eligible-Family cohort is inserted.
- Publication facts retain their first server timestamp and tier, so the eventual
  downgrade-month rule can be derived without erasing or inventing history.
- Existing valid reservations are not deleted on downgrade. A new reservation
  checks the current tier; opted-in video publication rechecks the current
  monthly policy, including a month rollover. This must be reviewed alongside
  the eventual transition/late-publication policy before activation.

## Backend contract

Private tables: policy, entitlement windows, Family usage, media object registry,
measurement errors, upload sessions, upload items, successful video publications.
Family UUID ownership survives Pet/Family deletion until physical cleanup. These
records must later receive an explicit operational retention policy; they are not
financial records and do not implement an Apple payer binding.

Authenticated APIs:

- `get_family_media_quota(family_id)`: current member (including Viewer), reads
  usage snapshot/reconciliation timestamp, tier/cap and configured video period.
- `reserve_family_media_upload(request_id, pet_id, post_id, photo_ids, video_id)`:
  current canonical Owner/Member. Server derives Family and paths. Only UUIDs are
  accepted: no client file size, plan or usage value is authoritative.
- `settle_family_media_upload(session_id)`: original actor still contributing;
  reads final Storage metadata, validates owner and size, settles actual bytes.
- `cancel_family_media_upload(session_id)`: requests cancellation, never asserts
  that transport has already stopped or refunds permanent video usage.

Service-only APIs:

- `reconcile_family_media_usage(family_id)`: observes actual Storage objects,
  including unreferenced objects; reports malformed/unmappable metadata.
- `acknowledge_family_media_deletion(object_id)`: only after successful/idempotent
  Storage API deletion and absent metadata. Missing metadata alone is not an
  automatic refund. Existing cleanup-job completion invokes this automatically.
- `queue_closed_family_media_cleanup(session_id)`: after trusted transport
  termination/revocation, queues abandoned paths in the existing cleanup queue.
  Rejects active/published/referenced uploads; repeated calls deduplicate jobs.
- `release_closed_family_media_upload(session_id)`: requires cancelled/expired
  state and cleaned objects; trusted service must additionally establish TUS
  termination/absence and revoke outstanding capabilities before calling it.

The database cannot independently prove external TUS closure. The server-only
closure acknowledgement is a trust boundary, not a client boolean. A production
transport controller and its recovery job are still required before enforcement.

## Atomic accounting

Membership share lock -> Family usage row lock -> session/registry locks. All
new-protocol reservations and publication checks serialize at the Family row.
The budget is charged objects plus outstanding reservations. Conservative
reservation caps are 8 MiB/photo and 25+2 MiB/video pair. A tighter reservation
needs a separately verified per-upload byte cap; accepting a client-reported
smaller size would not be safe. This can reject an upload that would fit after
compression, which is a known prototype UX tradeoff.

Settlement uses Storage-generated `metadata.size`; completed objects replace
their reserved upper bound with actual bytes. Partially completed manifests keep
the other upper bounds. Repeated settlement is idempotent. A trusted reconciler
is needed for abandoned uploads; the quota getter deliberately exposes a
snapshot timestamp and reserve always reconciles before admission.

Successful Post metadata commit records a video once per physical Storage object
generation. Retries and metadata reinsertion cannot change its first publication
time. Failed/cancelled/unpublished uploads have no permanent publication fact.
Deleting Post/Pet/Family does not refund that fact. Deletes only mark object
cleanup pending; successful physical deletion releases bytes exactly once.
Historical data stays intact after a tier downgrade, even when already over cap.

Observers are deferred, so legacy update RPC delete/reinsert of retained metadata
is evaluated against the final reference set. The old cleanup queue and worker
remain the only canonical cleanup mechanism; no queue is consumed by these tests.

## Actual transport evidence and compatibility blocker

Tests clone the current schema into a disposable local DB and run a separate
Storage API container with an empty tmpfs, using the existing local image
`storage-api:v1.77.5`. Original local table/function/policy/history fingerprints
are checked after cleanup. No existing data or binary objects are imported.

- Standard uploads perform a permission dry-run; writes inside an INSERT RLS
  check roll back. The final internal metadata write does not preserve such
  reservations. Therefore a mutable RLS check is not a durable reservation API.
- Legacy TUS POST, partial PATCH, HEAD and resumed PATCH work without a session,
  even after the prototype migration. Canonical Member needs no Pet mirror.
- Changed RLS and removed membership reject later PATCH requests.
- With TUS expiry configured to 12 seconds and a 13-second wait, this local
  file-backed version still accepts late completion (204, actual object present).
  A timer is not proof of revocation. This is local evidence, not a claim about
  Production's untested cloud expiration behavior.
- Explicit TUS DELETE prevents later completion. The isolated new-protocol RLS
  experiment denies late chunks when the quota grant expires; trusted service
  termination/absence proof permits safe temporary-slot release.
- A reservation-only policy rejects unmodified 1.3.0 direct upload. That policy
  exists only in the disposable test DB and is NOT in the forward migration.

**Blocker:** transparent, safe global hard quota for unmodified 1.3.0 has not been
established. Do not implement a version-header exemption or blind `SUM(size)` RLS
check. Keep observation/global enforcement OFF. Executable preferred upgrade
path: publish the quota-aware client, communicate the change, and only after
product approval of an update/cutover strategy require durable reservations at
Storage. A global minimum-version change is a separate release decision and is
not performed here; core collaboration remains free in the new client. A claimed
transparent legacy gateway needs a supported hosted-Storage hook and real
concurrency/late-completion verification before it can be offered as an alternative.

Signed-upload capabilities bypass the ordinary JWT/RLS path in the inspected
Storage implementation. This prototype issues none. Future signed uploads must
have separately budgeted/validated byte caps, lifetime and revocation behavior;
they must not undermine the durable reservation requirement.

## Verification and next gate

Run `verify:family-storage-quota` and `verify:family-storage-transport` locally.
The first tests byte boundaries, scopes, roles, publication/cleanup/idempotency,
expiry and real concurrent quota allocation. The second performs real isolated
HTTP uploads, TUS, Post publication and API cleanup, plus test-only RLS experiments.

GO for an independently authorized Apple IAP / RevenueCat **Sandbox** prototype
with server-only test entitlements. NO-GO for Production hard quota, activation,
payment setup or claims of complete legacy compatibility. No UI/native testing
is performed in Phase 2.

The persistent development DB stays at 45/45 applied migrations. This new 46th
forward migration is pending there; it was executed only in disposable schema
clones. No reset or persistent local migration was required for this prototype.
The two existing Care Completion migrations and all application sources remain
unchanged. Before/after fingerprints cover original local tables (including
outbox), functions, Storage policies and migration history.

Before activation, prefer an explicit server-fixed Family calendar timezone and
a half-open transition window `[start, end)`, subject to product approval. The
prototype singleton calendar is only an experimental configuration; raw UTC
publication facts allow a future per-Family policy without rewriting history.
Whether transition-month videos count toward Free remains unresolved; both
counting strategies are tested without selecting a real default.

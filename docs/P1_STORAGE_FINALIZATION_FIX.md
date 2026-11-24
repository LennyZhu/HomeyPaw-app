# P1 Storage permission-probe compatibility (2026-11-24)

## Evidence and root cause

Read-only Production scope: `tknaobmlwmodsqtpqwkr`. History was 59.
Two Storage log errors in 20:15–20:45 HKT matched the reported 20:23/20:39 failures:
Storage appVersion 1.96.4, operation storage.object.upload, request role
authenticated, HTTP 400, QUOTA_STORAGE_FINALIZATION_UNVERIFIED.
No request URLs, identifiers, JWTs, media or journal content were exported.

Production's private.enforce_family_media_capacity() matches the historical
20261023055340 definition (body SHA-256
`d19d3259f6f4c5cbb4e0c715f59d10557e3f8a4d3877aabebfc315b391655428`).
It recognizes a rollback-only permission probe ONLY when the trusted Storage
login has role authenticated AND object.version = '1'. All other non-delete
Storage writes require service_role before measurement or quota calculation.
Thus this error is not evidence of an exceeded 5 GiB allowance.

The [1.96.4 uploader](https://github.com/supabase/storage/blob/v1.96.4/src/storage/uploader.ts)
uses randomUUID() in authorizeUpload instead of the old literal '1'.
Its [testPermission implementation](https://github.com/supabase/storage/blob/v1.96.4/src/storage/database/pg.ts)
rolls back the transaction or nested savepoint.
The old trigger rejects that legitimate caller-role probe as an unverified final.
The same HTTP 400 was reproduced on an isolated 1.96.4 Storage API before fixing.

The log's role field is the request role; it is not independently treated as a
database-session trace. The specific raised branch, deployed SQL, pinned upstream
source and same-version HTTP reproduction establish the failure mechanism.

## Client paths and impact

- Photos: src/features/posts/post-media.ts directly calls Storage upload with
  an ArrayBuffer, JPEG content type and upsert:false.
- Videos: post-video-storage.ts calls post-video-tus.ts, then a standard upload
  for the thumbnail. Both protocols use the backend uploader/finalization gate.
- No current src call to reserve_family_media_upload or settle_family_media_upload:
  the deployed legacy transport counts actual final objects without requiring
  a quota session. reserved_bytes=0 is expected, not the reason for this failure.
  Those RPCs remain available for quota-aware clients and are regression tested.
- No current client Signed Upload call. Its signing probe is caller-role; its
  upload probe may be service-role without backend size. That probe also needs
  a rollback-only path; it must never be mistaken for measured final metadata.
- The trigger covers post-media, post-videos and post-video-thumbnails regardless
  of Free/Plus or app version. On affected Storage versions it can block Free,
  Plus, older clients, videos and thumbnails, not just the reported Plus photo.
- create-post-screen.tsx selects posts.errors.publish for the generic catch.
  The bilingual message preserves selections; it does not diagnose quota.
  The failing request is the Storage write before journal publication.

## Minimal forward and trust boundary

Only new forward SQL:
`supabase/migrations/20261124125009_family_media_storage_probe_rollback.sql`.

1. Assert the exact pre-fix function body and enabled original Storage trigger.
2. Add one app-owned private guard table, with RLS and all client/service-role
   table privileges revoked. Its rows contain only random guard IDs.
3. Add a private deferred constraint trigger on that table. Every queued guard
   raises SQLSTATE 42501 at COMMIT. Do not decide trust again from the role at
   COMMIT: tests explicitly restore service_role before attempting to commit.
4. Adjust only the probe branch of the existing capacity function:
   trusted session_user=supabase_storage_admin plus authenticated role, or a
   service-role write still lacking backend size, must insert a guard.
   The API must roll back that guard with its permission probe/savepoint.
5. All real final writes still require service_role, backend size, valid path,
   matching owner, current Owner/Member membership, family lock, reservation
   validity, complete measurement and used+reserved within the current limit.

A probe version, client metadata or role claim is never sufficient authority.
An escaped probe cannot commit even after role restoration. A successful
transaction leaves the guard table empty. Normal rollback probes may create
dead tuples; ordinary PostgreSQL vacuum manages these, not a new cleanup Cron.

No managed Storage ownership/ACL changes are needed: a constraint trigger on
storage.objects itself would require its owner, unlike the private-table design.
No RLS policy, trigger enablement, capacity limit, transition, Billing, membership,
subscription, historical row or existing migration is changed.
The original finalization trigger remains active. Existing no-op metadata
updates and deletes retain their existing behavior.
Legacy TUS temporary-part storage/egress residual risk is unchanged; this fixes
final-object publication and accounting, not incomplete-part admission.

## Targeted local verification

Commands (Node and Docker must be available):

```sh
node scripts/verify-family-media-capacity.mjs --storage-probe-fix
node scripts/verify-family-media-capacity.mjs --storage-probe-fix --legacy-storage
node --check scripts/verify-family-media-capacity.mjs
node --check scripts/lib/isolated-family-media.mjs
npx --no-install eslint scripts/verify-family-media-capacity.mjs scripts/lib/isolated-family-media.mjs
npx --no-install prettier --check scripts/verify-family-media-capacity.mjs scripts/lib/isolated-family-media.mjs
git diff --check
```

The harness pins the local Unix Docker socket, clones schema into a temporary
database, seeds synthetic fixtures and starts a separate file-backed Storage API
with temporary media/environment files (0600). Every database URL must target
the fixed local DB container; HTTP is loopback. The only allowed image override
is the incident image public.ecr.aws/supabase/storage-api:v1.96.4 (downloaded
digest sha256:f18e8e2ee36387418a4df1f55c1bfd8a0ee0c3e9be394f67f27eb1f0f424a068).
The legacy pass uses the existing local 1.77.5 image. No hosted credentials,
accounts, buying, simulator or complete app regression are involved.
The harness removes its own resources and asserts persistent local table,
function, policy, outbox and Migration History fingerprints did not change.

Assertions include original incident reproduction; failed-install rollback;
literal/random and nested probes; direct SQL spoof denial; escaped-probe COMMIT,
role-restore and SET CONSTRAINTS rejection; missing-size final rejection; Free
and linked synthetic Plus photo publication via unchanged create_post_v2;
expired-transition Plus access; Signed Upload; duplicate charge/reference
protection; actual Free/Plus cap edges and downgrade retention; Viewer/outsider/
cross-family denial; concurrent last-byte contention; TUS resume/finalization,
thumbnail aggregation; and reserve/cancel/expiry competition.
Expected negative-test errors are not test failures.
Synthetic seed sizes simulate quota edges; only newly uploaded media bytes are
real local binary writes. This is not managed-cloud upload acceptance.

## Production deployment and rollback — separate authorization required

1. Reconfirm explicit Production identity, source SHA-256, old function hash,
   History 59 and the single pending version; record current flags, Storage
   trigger, object/registry/usage/reservation and business-data fingerprints.
2. Use the validated single-version deployment path. Apply this original SQL and
   register version 20261124125009 in one bounded transaction (expected 59 → 60).
   Do not bulk-push, repair, replay history or redeploy Functions.
3. Independently read back function/source, guard-table RLS/ACL, deferred trigger,
   empty guard table, unchanged original capacity-trigger enablement, quota and
   business flags, existing metadata/usage and preserved history.
4. Only after that acceptance should the affected user normally retry the
   retained photo. A real upload is a separate user action, not performed here.
   No iOS rebuild or API-contract change is needed.

Any installation error rolls back the SQL transaction; stop and inspect History
and actual schema after an ambiguous transport failure, never retry blindly.
For a post-commit safety regression, use a separately reviewed/authorized forward
migration to restore the saved pre-fix capacity function; leave the unused private
guard table/constraint in place. This restores the known fail-closed upload error,
not upload availability. It does not delete media or refund/revoke entitlements.
Never remove the guard while retaining the new probe bypass, disable the capacity
trigger, loosen RLS, switch Quota OFF or reset history as a rollback.
No cloud deployment or rollback is authorized by this document.

## Final local result — 2026-11-24

PASS on BOTH Storage 1.96.4 and 1.77.5 (both processes exit 0).
The same-version run reproduces the original HTTP 400 before installing the
candidate. Both complete the final-capacity, role/forgery, concurrency, Signed
Upload, photo-publication, TUS/video, reservation/settlement and rollback checks.
Free and Plus publication use the existing create_post_v2 RPC. The 548 MB Plus
case uses a synthetic linked active subscription plus an expired transition,
never a provider call or a real purchase. Test-only seed bytes model quota edges.
Both report persistent local DB/schema/policy/outbox/history fingerprints
unchanged and remove their temporary resources.

Node syntax checks, targeted ESLint, Prettier, git diff --check and a sensitive
literal scan PASS. A structural comparison confirms that the existing capacity
function changes only its probe branch and comments; the rest of its enforcement
body is byte-equivalent after removing those changes. No client code is changed.

Migration SHA-256:
`d87028d2a3e89ff37a94bc6b5a6a862d3c8d34bea3895914e62cc347c5fafe17`

Changed files: this document, the new forward migration,
scripts/verify-family-media-capacity.mjs and scripts/lib/isolated-family-media.mjs.
No historical migration changed. Production/Sandbox/OrderMori writes, purchases,
Git commit/push, EAS and App Store actions were NOT performed.
Production's reported upload incident remains unremediated until separately
authorized deployment and managed-environment acceptance.

## Repaired deployment packaging — 2026-11-24

The first Production attempt failed BEFORE Migration DDL, because the deployment
wrapper omitted the outer jsonb_build_object closing parenthesis at its two
reused snapshot/compare sites. Independent read-only checks confirmed History
59, original function body, no guard objects, no open failed transaction or
remaining deployment table locks, and unchanged business switches/Cron.
The approved Migration source was not changed.

The repaired complete SQL is saved as a 0600 file in a private temporary
deployment directory, with a manifest. It changes only those two wrapper
parentheses. Complete Production deployment-file SHA-256:
`de509fbb2592c37d20924e066a48dbe9f4c6873d2ad7f23907214f8ee9101863`.
The Migration source SHA-256 remains
`d87028d2a3e89ff37a94bc6b5a6a862d3c8d34bea3895914e62cc347c5fafe17`.

`scripts/verify-p1-storage-deployment.mjs <manifest.json>` executed the FULL
saved SQL using psql -f with ON_ERROR_STOP in a disposable local PostgreSQL DB.
Only the isolated database name and existing History/Cron fingerprint bindings
differ from the Production file; reversing those three bindings reconstructs
the Production file byte-for-byte. No statement, safety check, original source
byte or History registration is omitted.

PASS: a check constraint deliberately fails the actual History INSERT AFTER the
Migration DDL and postchecks; connection closure rolls back all objects, old
function and History. Removing that test-only constraint allows the complete
file to commit 59→60, verify exact original source/installed bodies/deferred
guard/ACL, preserve all previous History, and reject replay without changes.
Persistent local DB/schema/policy/outbox/history fingerprints remain unchanged.
No previous business regression suite was repeated. Node syntax, targeted ESLint
and git diff --check PASS.

The subsequent Production read-only check (2026-11-24 21:20:28 HKT) found History
59, target absent and original function/flags/Cron unchanged. Re-execution still
requires the user's explicit fresh authorization. At execution, load the saved
complete SQL file, verify both file/source hashes and target, and submit its
contents once through the existing verified Production management connection.
Do not rebuild or manually splice SQL at execution time. If it fails, confirm
rollback and stop; if it succeeds but has a safety anomaly, report and stop.



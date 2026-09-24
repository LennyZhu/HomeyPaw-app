# R3 minimum client version and C4I release gate

The current App Store Production baseline is HomeyPaw `1.1.1 (5)`; its primary change is the image-cache fix already present on this branch. The development branch still carries older `app.json` build metadata; assign a **new** Multi-Pet-compatible version/build before publishing (EAS `appVersionSource: local`, production `autoIncrement: false`). `runtimeVersion` is not configured. The About screen's App Store lookup is optional and dismissible; it is not the release gate. The formal App Store app ID is `6806111286`, already used by About and EAS submit metadata.

## Contract

`public.app_release_policy` has one read-only-to-clients `ios` row: `minimum_app_version`, `minimum_build`, optional recommended version and maintenance message, `maintenance_mode`, `enforce_mutation_gate`, and `updated_at`. It starts at `1.1.1 (5)` with both switches false; applying the migration alone does not force an upgrade. Operators change it only through a reviewed Production release step. Ordinary `anon`/`authenticated` callers have SELECT but no INSERT/UPDATE/DELETE. The installed iOS app reads its **native** version/build via `expo-application`; it compares numeric semantic-version segments, then build when versions are equal. It checks at bootstrap before normal routes/coordinators and on foreground; upgrade/maintenance screens cannot be dismissed into the app. A transient config/network error allows a previously allowed app to continue and recheck later; a previously known blocked decision remains blocked until a successful recheck. A missing/malformed row is a check failure, not proof that the installed app is unsupported.

All new Supabase client requests include `X-HomeyPaw-Platform`, `X-HomeyPaw-App-Version`, and `X-HomeyPaw-Build` from the installed binary. These headers are compatibility signals, **not identity or authorization**. Auth/JWT, RLS, and canonical Family roles remain authoritative. The three destructive Edge Functions read the same policy after JWT validation and reject an unsupported client (HTTP 426) or maintenance (HTTP 503) before mutation. Edge policy lookup failure fails closed. They forward the headers to caller-bound RPCs. The database trigger checks PostgREST `request.headers` on canonical `families`, `family_members`, `pets`, and `family_invites` writes when `enforce_mutation_gate` is true. This covers direct RPC-only Family/Pet create, invite/join/leave/remove/transfer, and delete flows, including old `create_pet` calls with no headers. Service-role/internal operations bypass the client-compatibility trigger, but remain subject to their existing authorization and orchestration controls. The gate is not a defense against a modified client forging version headers.

R3 does not version-gate every Journal/Care/Chat/Schedule write after release. During migration, the independent pre-cutover lock blocks all application-table writes, including those domains, even when the caller uses an old binary without version headers. The lock is seeded ON by `20260919090000_pre_cutover_release_lock.sql`, before Phase A. The R3 migration neither updates nor unlocks it. Read requests remain available; sign-up may fail closed because it writes a profile. Authentication sign-in remains available. A review must confirm any additional old-client incompatibility before unlocking.

## Production sequence — template only; no Production action in R5A

1. Confirm Production migration history, the recorded R4 preflight, backup, and the actual deployed Storage/Edge versions. Do not proceed if the first pending migration is not `20260919090000_pre_cutover_release_lock.sql` or if the production Storage service rejects its restrictive policies/trigger.
2. Apply the ordered pending migrations with one reviewed `supabase db push`. The first migration seeds the lock ON. Its public/private table triggers, Storage restrictive policies and trigger, and Auth-user delete trigger keep old client and old destructive Edge writes blocked if Phase A or any later migration fails. Direct migration SQL runs as `postgres`; service-role API requests remain blocked. Never unlock to repair a failed migration. Forward-fix the failed migration while locked, then resume the remaining migrations. A failure _before the first migration commits_ leaves legacy schema untouched and requires a fresh preflight before retry.
3. Confirm the lock is ON after the chain, including R3 and C4I. Deploy the new destructive Edge functions (`delete-post`, `delete-pet`, `delete-account`) and confirm they return HTTP 503 while locked. Configure the cleanup worker, but do not claim/settle real jobs while the lock is ON; those queue mutations intentionally fail closed. The Edge release helper checks the pre-cutover lock before R3 policy. Keep the worker scheduler stopped until release checks pass.
4. Publish and verify the compatible new iOS binary in the App Store. Choose its actual native semantic version/build as the minimum; do not set a guessed build number. Confirm it uses `create_family_pet` for an existing Family.
5. While the pre-cutover lock remains ON, set R3 `minimum_app_version`/`minimum_build` to that available binary, set `enforce_mutation_gate = true`, and use `maintenance_mode = true` through read-only smoke tests. Verify an old `1.1.1 (5)` client fails, the exact minimum build can read, and the new Edge/worker configuration is ready. Then clear R3 maintenance and explicitly release the independent lock with the trusted SQL below. The SQL Editor/connection must run as `postgres`; no ordinary client or service-role REST request can update the private lock table.
6. Verify the exact minimum build can write after release, while the old build remains blocked by R3. Run a controlled cleanup-worker job and inspect queue settlement before enabling its scheduler. Observe 426/503 Edge responses, DB `APP_UPDATE_REQUIRED`/`APP_MAINTENANCE` errors, support reports, and lifecycle metrics. Re-enable the pre-cutover lock with trusted SQL if a post-release emergency requires full write isolation.

The ordered chain is PRE-CUTOVER LOCK → A → B1 → B2 → C2 → C3 → C4B → C4C → C4D-BC → C4E → C4F → C4G → R3 → C4I → R2. A one-shot database push is acceptable **only when the first lock migration and its Storage enforcement are confirmed on the target project**. A partial push remains fail-closed; repair forward under the lock. No pause between individual migrations is required. Do not use `service_role` API calls for migration backfills: the lock intentionally rejects them just as it rejects old Edge service-role calls.

Trusted release SQL, to run only after all six prerequisites (migrations complete, destructive Edge deployed, worker configured, actual minimum set, App Store build available, smoke checks passed):

```sql
select enabled from private.pre_cutover_release_lock where singleton;
update private.pre_cutover_release_lock
set enabled = false, updated_at = now()
where singleton and enabled;
select enabled from private.pre_cutover_release_lock where singleton;
```

The private table is not exposed to ordinary clients. `public.is_pre_cutover_release_locked()` reveals only the boolean needed by Edge and Storage policies. It has no mutation path. During the lock, Storage uploads/replacements/deletes are blocked for authenticated clients by restrictive RLS and at the row trigger for service-key operations. In the local Storage API, an RLS-blocked authenticated delete can return an empty success rather than an error; the verifier checks that the object bytes remain. A blocked service-key delete returns an error and also retains bytes. Production Storage behavior must be smoke-checked before treating the migration as GO, because the hosted Storage version can differ from local.

For local regression, run `supabase db reset --local` first, then `npm run verify:pre-cutover-release-lock` while the local Edge runtime is serving. The verifier checks the default ON state and intentionally leaves the **local** lock OFF so the existing domain verifiers can create fixtures. A subsequent local DB reset restores the default ON state. This local-only test unlock is not a Production release step.

Example _read-only_ verification query (do not use R3 to update Production):

```sql
select platform, minimum_app_version, minimum_build,
       recommended_app_version, maintenance_mode, enforce_mutation_gate,
       maintenance_message, updated_at
from public.app_release_policy;
```

An old `1.1.1 (5)` binary is **unsupported after C4I cutover**: it calls `create_pet` for another Pet, cannot recover correctly after the last Pet is removed from a still-existing Family, and lacks complete Owner lifecycle UI. R3 deliberately adds no old-`create_pet` fallback. Client-side blocking alone is insufficient for already-online old clients; the DB and Edge gates above must be enabled before leaving maintenance. `1.1.1 (5)` remains the current App Store Production baseline and the seeded minimum until a reviewed Production config update chooses a released Multi-Pet-compatible successor with a higher version/build.

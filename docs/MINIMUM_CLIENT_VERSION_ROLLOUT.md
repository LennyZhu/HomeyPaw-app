# R3 minimum client version and C4I release gate

The current App Store Production baseline is HomeyPaw `1.1.1 (5)`; its primary change is the image-cache fix already present on this branch. The development branch still carries older `app.json` build metadata; assign a **new** Multi-Pet-compatible version/build before publishing (EAS `appVersionSource: local`, production `autoIncrement: false`). `runtimeVersion` is not configured. The About screen's App Store lookup is optional and dismissible; it is not the release gate. The formal App Store app ID is `6806111286`, already used by About and EAS submit metadata.

## Contract

`public.app_release_policy` has one read-only-to-clients `ios` row: `minimum_app_version`, `minimum_build`, optional recommended version and maintenance message, `maintenance_mode`, `enforce_mutation_gate`, and `updated_at`. It starts at `1.1.1 (5)` with both switches false; applying the migration alone does not force an upgrade. Operators change it only through a reviewed Production release step. Ordinary `anon`/`authenticated` callers have SELECT but no INSERT/UPDATE/DELETE. The installed iOS app reads its **native** version/build via `expo-application`; it compares numeric semantic-version segments, then build when versions are equal. It checks at bootstrap before normal routes/coordinators and on foreground; upgrade/maintenance screens cannot be dismissed into the app. A transient config/network error allows a previously allowed app to continue and recheck later; a previously known blocked decision remains blocked until a successful recheck. A missing/malformed row is a check failure, not proof that the installed app is unsupported.

All new Supabase client requests include `X-HomeyPaw-Platform`, `X-HomeyPaw-App-Version`, and `X-HomeyPaw-Build` from the installed binary. These headers are compatibility signals, **not identity or authorization**. Auth/JWT, RLS, and canonical Family roles remain authoritative. The three destructive Edge Functions read the same policy after JWT validation and reject an unsupported client (HTTP 426) or maintenance (HTTP 503) before mutation. Edge policy lookup failure fails closed. They forward the headers to caller-bound RPCs. The database trigger checks PostgREST `request.headers` on canonical `families`, `family_members`, `pets`, and `family_invites` writes when `enforce_mutation_gate` is true. This covers direct RPC-only Family/Pet create, invite/join/leave/remove/transfer, and delete flows, including old `create_pet` calls with no headers. Service-role/internal operations bypass the client-compatibility trigger, but remain subject to their existing authorization and orchestration controls. The gate is not a defense against a modified client forging version headers.

R3 does not version-gate every Journal/Care/Chat/Schedule write. Those retain their existing JWT/RLS and lifecycle rules. The gate protects the documented incompatible Family/Pet and destructive paths; any additional old-client incompatibility found during final release testing is a rollout blocker until separately addressed.

## Production sequence — template only; no Production action in R3

1. Confirm Production migration history and data preflight. R3's migration is ordered after C4G and **before C4I** in this repository. If Production already applied C4I, resolve migration-history ordering before any push; do not guess.
2. Publish and verify a compatible new iOS binary in the App Store. Choose its actual native semantic version/build as the minimum. Do not set a guessed build number. Confirm the binary uses `create_family_pet` for an existing Family.
3. Apply the approved R3 policy migration and deploy the three R3 Edge versions. While `enforce_mutation_gate = false` and `maintenance_mode = false`, the existing behavior remains available.
4. Enter a controlled migration window: set `maintenance_mode = true`. The new app shows maintenance; Edge destructive requests and canonical Family/Pet writes stop, including old clients with no headers. Verify this before C4I.
5. Apply the remaining approved migration sequence, including C4I, and finish backend/worker preflight. In one reviewed config update, set `minimum_app_version` and `minimum_build` to the **already available compatible build**, set `enforce_mutation_gate = true`, then clear `maintenance_mode`. Validate from an old `1.1.1 (5)` client (must fail), the exact minimum build (must pass), and a new-version destructive call. Do not bypass C4I's single-Family invariant.
6. Observe 426/503 Edge responses, DB `APP_UPDATE_REQUIRED`/`APP_MAINTENANCE` errors, support reports, and backend lifecycle metrics. Keep an operator path to turn maintenance back on. Do not lower the minimum merely to make a failing old client work with C4I.

Example _read-only_ verification query (do not use R3 to update Production):

```sql
select platform, minimum_app_version, minimum_build,
       recommended_app_version, maintenance_mode, enforce_mutation_gate,
       maintenance_message, updated_at
from public.app_release_policy;
```

An old `1.1.1 (5)` binary is **unsupported after C4I cutover**: it calls `create_pet` for another Pet, cannot recover correctly after the last Pet is removed from a still-existing Family, and lacks complete Owner lifecycle UI. R3 deliberately adds no old-`create_pet` fallback. Client-side blocking alone is insufficient for already-online old clients; the DB and Edge gates above must be enabled before leaving maintenance. `1.1.1 (5)` remains the current App Store Production baseline and the seeded minimum until a reviewed Production config update chooses a released Multi-Pet-compatible successor with a higher version/build.

# Phase 9 Local Preparation

Updated 2026-08-28. This document began as the local-preparation record and now records the completed production-build, TestFlight-upload, and Internal Testing handoff.

## Result

`PHASE 9 COMPLETE — INTERNAL TESTFLIGHT BUILD 1 VALIDATED`

The EAS project, Apple Bundle ID, App Store Connect app, Distribution certificate, App Store provisioning profile, production build, and Internal TestFlight upload have been created and verified. Build `1.0.0 (1)` is `VALID` and `IN_BETA_TESTING`; the release owner reports core acceptance `PASS`. No App Review submission has occurred.

## Locked Production Identity

- Brand: `HomeyPaw`
- Bundle ID: `com.zhushunli.homeypaw`
- Version/build: `1.0.0 (1)`
- Expo owner/slug: `homeypaw` / `homeypaw`
- Compatibility URL scheme: `pawday`
- Production Chat: hidden; no release route or tab
- Notifications: local only; no remote push
- Encryption declaration: `ITSAppUsesNonExemptEncryption = false`
- EAS build ID: `d1ef9ee0-78aa-41ff-891b-f81e326dc29a`
- EAS submission ID: `81a743e4-d4a3-46a8-bf3c-84e700f4e374`

## Completed Local Preparation

- Production app config, resolved Expo config, permissions, icons, Splash, and localized purpose strings reviewed.
- EAS production profile is explicit store distribution using the `production` environment; project `@homeypaw/homeypaw` is linked through project ID `3623de2b-5a77-48ec-b2ec-45e8136d9ac7`.
- App Store Connect app `6806111286` uses `com.zhushunli.homeypaw`, version `1.0.0`, SKU `HOMEYPAW-IOS-001`, and Traditional Chinese as its primary language.
- EAS Managed Credentials reports the Apple Distribution certificate and App Store provisioning profile active for Team `8SSF5V63H9`.
- HomeyPaw metadata, App Privacy data inventory, age-rating suggestions, Beta App Description, What to Test, and internal checklist prepared.
- Source, environment files, ignored credential formats, dependencies, debug paths, and production logging reviewed. Production logger excludes backend message/stack details.
- Linked Supabase migrations and database lint reviewed read-only; migrations align through `20260824180000`, and the database lint reports no schema errors.
- Linked TestFlight-candidate backend contains only small development/test fixtures, not the prior large fixture set. Ownership approval is required before any cleanup.

## Backend Boundary

The currently linked `pawday-dev` Supabase project is approved as the Internal TestFlight backend. The existing record does not yet contain explicit approval to use it as the public App Store production backend. Before App Review:

- confirm the project remains the intended TestFlight backend;
- keep only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the project-scoped EAS `production` environment;
- never add a service-role key, database password, Apple credential, or private signing material to an `EXPO_PUBLIC_*` variable;
- rerun the credentialed RLS regression scripts with temporary disposable accounts supplied through the shell, never committed to files;
- obtain explicit ownership approval before removing the remaining small fixtures.

## Local Verification Snapshot

Final suite completed on 2026-08-27 with the supported bundled Node `24.19.0`:

- Prettier: pass; every matched file uses the configured style.
- Locale parity: pass for `zh-HK` and `en`.
- Expo ESLint: pass.
- TypeScript `tsc --noEmit`: pass.
- Phase 5 Hong Kong date boundaries: pass.
- Phase 6 IANA time-zone date boundaries: pass.
- Phase 7 care-task recurrence: pass, including year boundaries, day 31, and DST gap/overlap.
- Phase 8 production/security verifier: pass.
- Phase 9 local identity/store-profile verifier: pass.
- Expo Doctor: `18/18` checks passed after updating only SDK 57-compatible patch versions.
- Expo production export: pass for iOS, Android, and Web with the EAS production Supabase values. Expo emits a static `chat-preview` route and physically bundles its Mock-only code, but the production navigator guard compiles to false and the route redirects away before rendering the prototype.
- Installed dependency tree: valid with no missing or extraneous top-level package.
- Source/credential scan: no committed private key, database password, Apple credential, or client service-role secret found. Server-side function references to Supabase-provided service credentials are expected and are not bundled into the Expo client.
- Direct production console scan: only the centralized `src/lib/logger.ts` adapter calls `console.error`; Phase 8 verification confirms there are no other direct source calls or test hooks.

`npm audit --omit=dev` reports 12 moderate findings inherited through Expo config/build tooling's `xcode → uuid` chain, with no high or critical finding. The suggested forced fix would downgrade `expo-splash-screen` across SDK generations and is not safe to apply. Keep the known dependency risk and re-audit when Expo SDK 57 publishes a compatible upstream resolution.

The machine's default Node `24.0.0` is below the project engine floor. Local verification therefore used the bundled supported Node `24.19.0`; EAS production remains pinned to Node `22.13.0`.

## Remaining App Store Release Work

- Confirm whether `pawday-dev` is approved to remain the public App Store backend for Build 1.
- Complete final metadata, screenshots, App Privacy, age rating, Content Rights, DSA decision, availability, export-compliance confirmation, review contact, and non-expiring demo accounts.
- Assign the already uploaded Build 1 to App Store version `1.0.0` after the human-owned fields are complete.
- Submit for App Review only after a separate explicit approval.

Phase 9 completion does not authorize external testing, any legal/compliance declaration, Add for Review, or Submit for Review.

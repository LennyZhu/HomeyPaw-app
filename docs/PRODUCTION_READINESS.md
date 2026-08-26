# Production Readiness

## Decisions

- Bundle ID: `com.zhushunli.pawday` (configured locally; not registered with Apple by Codex).
- App icon: approved “家庭環抱” candidate 2, exported at 1024×1024 without transparency.
- Chat: hidden for 1.0 until a real private-family Chat exists.
- Crash reporting: no Sentry in Phase 8. The lightweight redacting `logError()` adapter preserves an upgrade path.
- Appearance: portrait-only, forced Light, dark-content status bar.
- EAS: local profiles are prepared; no remote EAS project, credentials, Apple login, or build was created.

## Permissions matrix

| Capability            | Declared        | Purpose                               |
| --------------------- | --------------- | ------------------------------------- |
| Photo Library         | Yes             | Choose pet avatars and journal photos |
| Local Notifications   | Runtime request | User-enabled care reminders           |
| Exact alarm (Android) | Yes             | Local reminder scheduling             |
| Camera                | No              | Not implemented                       |
| Microphone            | No              | Not implemented                       |
| Location              | No              | Location name is manual text          |
| Contacts              | No              | Not implemented                       |
| Tracking / IDFA       | No              | No advertising or tracking            |
| Remote push           | No              | Local notifications only              |

## Known product boundaries

- No offline mutation queue; cached reads remain available, writes must be retried online.
- Notification changes from another device are reflected after the next foreground/mutation sync; there is no remote push or Realtime.
- Family invitations do not use Universal Links yet.
- Private family content is UGC. Owner removal/moderation exists; public-user report/block is not added because there is no public discovery or stranger messaging.

## TestFlight blockers

1. Publish Privacy Policy, Terms, and Support pages at public HTTPS URLs.
2. Confirm the existing `pawday://**` Supabase Redirect URL allow-list remains enabled, then verify confirmation and password-recovery callbacks on a real iPhone.
3. Run and record the full real-iPhone matrix using a development or local native build.
4. Run final Supabase security scripts against the intended release backend and clean large fixtures.
5. With explicit approval only: create/link an EAS project, register the Bundle ID, and configure Apple signing credentials.

As of 2026-08-27, the product owner has no public website or domain for these pages. Keep the URL blocker open; do not substitute placeholder or unreachable URLs.

## Dependency audit

- `npm audit --omit=dev` currently reports 12 moderate findings and no high or critical findings.
- The findings are inherited through Expo build/config tooling's `xcode` dependency and `uuid < 11.1.1`; they are not imported by HomeyPaw's runtime business code.
- The automated `npm audit fix --force` proposal would install an incompatible Expo splash-screen version, so it must not be applied. Re-audit when the Expo SDK 57 dependency set receives a compatible upstream fix.

## App Review risk audit

- Support, Privacy Policy, and Terms URLs are still release blockers; placeholder or unreachable URLs must not be submitted. The support email is `lenny996@163.com`.
- Local notifications are used only for user-created care reminders. HomeyPaw does not request remote push tokens.
- Photo Library permission is user-triggered and has localized purpose strings. Camera, microphone, contacts, precise location, tracking, and advertising permissions are not requested.
- Account deletion is available inside the app and deletes the user's applicable private and shared data according to the documented lifecycle.
- Family invite access remains authenticated, expiring, capacity-limited, and protected by RLS; invite codes must not be presented as public sharing links.
- The dormant Chat implementation has no release route or tab. App Store metadata must not claim real-time chat.
- Crash reporting is intentionally deferred; production logs are sanitized and must never contain passwords, tokens, signed URLs, or private user content.

## Automated verification snapshot

- TypeScript, ESLint, Prettier, i18n parity, and the Phase 8 production/security scan pass.
- Expo Doctor passes all 18 checks; the resolved native config matches the intended identity, scheme, icon, Splash, permissions, and localized photo-purpose strings.
- Production export succeeds for iOS, Android, and Web. The exported route list contains no Chat route.
- Browser smoke checks pass for Sign In, Forgot Password, and an invalid Reset Password callback, with no console errors in clean tabs.
- Supabase migrations are aligned and linked database lint reports no schema errors. Credentialed RLS regression scripts still require the temporary test accounts at final release-candidate verification.

Do not enter Phase 9 until all blockers are closed.

# Production Readiness

## Decisions

- Bundle ID: `com.zhushunli.homeypaw`, registered under Apple Team `8SSF5V63H9`.
- App icon: approved “家庭環抱” candidate 2, exported at 1024×1024 without transparency.
- Chat: hidden for 1.0 until a real private-family Chat exists.
- Crash reporting: no Sentry in Phase 8. The lightweight redacting `logError()` adapter preserves an upgrade path.
- Appearance: portrait-only, forced Light, dark-content status bar.
- EAS: `@homeypaw/homeypaw` is linked, the production environment is configured, and the verified Distribution certificate and App Store provisioning profile are active. No production build has been created yet.

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

## Phase 9 status

Phase 8 is complete. Public Privacy, Terms, Support, and Marketing pages are live at `https://homeypaw.vercel.app`, and the completed Development Build acceptance evidence remains recorded in the Phase 8 handoff.

Phase 9 remote identity and signing preparation are complete:

1. EAS project `@homeypaw/homeypaw` is linked.
2. Only the public Supabase URL and publishable key are configured in the project-scoped `production` environment.
3. Bundle ID `com.zhushunli.homeypaw` and App Store Connect app `6806111286` exist under Apple Team `8SSF5V63H9`.
4. EAS Managed Credentials reports the Distribution certificate and App Store provisioning profile active and ready to build.

The remaining authorized step is the first production build. TestFlight upload, App Store metadata submission, DSA status, and App Review remain separate user-approved steps.

The never-opened, naturally expired recovery-link case remains a documented deferred edge-case risk. It must not be described as passed.

## Dependency audit

- `npm audit --omit=dev` currently reports 12 moderate findings and no high or critical findings.
- The findings are inherited through Expo build/config tooling's `xcode` dependency and `uuid < 11.1.1`; they are not imported by HomeyPaw's runtime business code.
- The automated `npm audit fix --force` proposal would install an incompatible Expo splash-screen version, so it must not be applied. Re-audit when the Expo SDK 57 dependency set receives a compatible upstream fix.

## App Review risk audit

- Support, Privacy Policy, Terms, and Marketing URLs are published and verified. The support email is `lenny996@163.com`.
- Local notifications are used only for user-created care reminders. HomeyPaw does not request remote push tokens.
- Photo Library permission is user-triggered and has localized purpose strings. Camera, microphone, contacts, precise location, tracking, and advertising permissions are not requested.
- Account deletion is available inside the app and deletes the user's applicable private and shared data according to the documented lifecycle.
- Family invite access remains authenticated, expiring, capacity-limited, and protected by RLS; invite codes must not be presented as public sharing links.
- The Chat prototype has no production tab or reachable production screen. Its static route/code is still physically present in the export behind a compiled-false navigator guard and a page-level production redirect. App Store metadata must not claim real-time chat.
- Crash reporting is intentionally deferred; production logs are sanitized and must never contain passwords, tokens, signed URLs, or private user content.

## Automated verification snapshot

- TypeScript, ESLint, Prettier, i18n parity, and the Phase 8 production/security scan pass.
- Expo Doctor passes all 18 checks; the resolved native config matches the intended identity, scheme, icon, Splash, permissions, and localized photo-purpose strings.
- Production export succeeds for iOS, Android, and Web with the approved Supabase configuration. Expo static export still emits `chat-preview`, but the production navigator guard compiles to false and the page redirects away before rendering prototype content.
- Browser smoke checks pass for Sign In, Forgot Password, and an invalid Reset Password callback, with no console errors in clean tabs.
- Supabase migrations are aligned and linked database lint reports no schema errors. Credentialed RLS regression scripts still require the temporary test accounts at final release-candidate verification.

Phase 9 may proceed to the first EAS production build only with explicit user authorization. Upload and submission remain separately gated.

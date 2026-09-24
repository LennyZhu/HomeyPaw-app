# TestFlight Internal Testing Checklist

## Historical Result — HomeyPaw 1.1.0 Build 4

- Bundle Identifier：`com.zhushunli.homeypaw`
- Production-signed TestFlight build：`1.1.0 (4)`
- iPhone／iPad：PASS
- Two-account／two-device acceptance：PASS
- Automated release gate：PASS
- App Store Review：submitted，`Waiting for Review`
- Release mode：manual release

The completed items below record Build 4 acceptance. Reuse the same checklist for later builds, reset affected items, and attach current evidence.

## Build and Presentation

- [x] Version／build／Bundle ID match `1.1.0 (4)` and `com.zhushunli.homeypaw`.
- [x] TestFlight processing completes without blocking compliance or asset errors.
- [x] Install on clean real devices and launch without Metro、Development Build launcher or developer menu.
- [x] HomeyPaw name、icon、Splash、Light appearance and localized permission text are correct.
- [x] iPhone Dynamic Island／Home Indicator and iPad layout／navigation are unobstructed.
- [x] No old PawDay user-facing brand, mock controls, debug UI, test URL or fixture label appears.

## Authentication and Lifecycle

- [x] Register、confirm email by deep link、sign in／out and session restore.
- [x] Complete password recovery and sign in with the new password.
- [x] Cached private content is cleared at sign-out and account switch.
- [x] Offline cached reads remain available; failed writes retain input and can retry after reconnect.
- [x] In-app account deletion returns to Sign In and deleted credentials no longer authenticate.

## Pet, Journal, Care and Health

- [x] Create／edit Pet、birthday and Pet／Profile avatar.
- [x] Journal supports text and 1／3／9 photos; viewer、save photo、timeline、memory and signed-URL renewal pass.
- [x] Journal cached re-entry and background refetch keep existing content visible without a stuck spinner.
- [x] Feeding、walking、medication、grooming、play and other Care records pass.
- [x] Health、Birthday and Yearly recurrence pass applicable timezone boundaries.

## Reminder and Schedule

- [x] Once／Daily／Weekly／Monthly／Yearly Reminder create、edit、complete、undo and Care Log integration pass.
- [x] Local notification permission、Settings recovery、background／lock-screen delivery and cold-start navigation pass.
- [x] Schedule create、Owner manage、Member claim／self schedule and multiple carers per day pass.
- [x] Care Task occurrence claim、complete、cancel and canceled occurrence reschedule pass.
- [x] Schedule → Create Reminder → Return selects the newly created task.

## Chat and Remote Push

- [x] Private family Chat send、history、edit、delete and pagination pass.
- [x] Private Realtime、active Pet channel rotation、unread badge／read state and cached SWR re-entry pass.
- [x] Journal、Care、Health and Reminder Remote Push reaches other authorized devices with privacy-safe copy.
- [x] Actor self receives no activity Push; Chat creates no system Push.
- [x] Removed Member receives no future row access、Realtime event、unread count or Remote Push.
- [x] Push TTL prevents stale backlog delivery; invalid／disabled token handling passes.

## Family and Removed Member

- [x] Owner A invites Member B and both see the same authorized Family Space.
- [x] Cross-device Journal／Care／Schedule／Chat updates behave as expected.
- [x] Owner removes Member; the existing Member session immediately loses scoped access.
- [x] No-family Journal does not spin indefinitely and revoked Journal cache is hidden.
- [x] Cold restart does not restore revoked Pet from persisted active Pet state.

## Review and Privacy

- [x] Support、Privacy、Terms and Marketing HTTPS links open correctly.
- [x] Camera／Photo Library are user-triggered; microphone、contacts、GPS、tracking and advertising permissions are absent.
- [x] App Store metadata describes private Chat and Family Remote Push accurately and does not claim deferred features.
- [x] Production errors and notification copy do not reveal token、password、signed URL、email or private content body.
- [x] Result recorded as PASS with release owner evidence.

## Deferred Evidence

- [ ] Open a Password Recovery link that was never previously opened and has naturally expired on a real iPhone. Confirm a friendly expired state and retry path.

This sample remains a non-blocking accepted risk and must not be reported as PASS. Reused／invalid recovery-link handling has passed.

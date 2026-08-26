# Phase 8 Real iPhone Test Matrix

Use a development build or local native build with bundle ID `com.zhushunli.pawday`; Expo Go alone is not final acceptance. Record device model, iOS version, build number, date, result, and evidence.

## Identity and lifecycle

- [x] Fresh install shows the approved “家庭環抱” icon and warm Splash without artificial delay.
- [x] Cold start restores an authenticated session and reaches Home without flashing Sign In.
- [x] Background for 5+ minutes, foreground, and refresh do not loop requests or duplicate local notifications.
- [x] Account A sign-out cancels A’s pending reminders; Account B sign-in does not inherit them (verified with an A-only pet; shared-family tasks are correctly rescheduled for B).

## Auth and deep links

- [x] Sign Up confirmation link opens HomeyPaw on cold start and while HomeyPaw is foregrounded.
- [x] Forgot Password email opens HomeyPaw, accepts a new password, signs out the recovery session, and permits sign-in only with the new password.
- [ ] Expired and reused recovery links show a friendly error and never expose raw Supabase text (reused passed; a never-opened expired link was skipped by the user on 2026-08-27 because no unused expired sample was available).

## Photos and content

- [x] Photo permission precondition and iOS system prompt are understandable in zh-HK and English.
- [x] Limited photo access shows only iOS-authorized assets from HomeyPaw’s perspective; the system picker may display the library so the user can explicitly add selections.
- [x] Select and publish HEIC, portrait, landscape, and up to 9 photos; static output from a Live Photo asset is acceptable.
- [x] Pet avatar, Home, Journal, Post Detail, and Memory survive background/foreground and signed-URL renewal.

## Notifications

- [x] Pre-permission explanation precedes the system prompt; deny and Settings recovery paths work.
- [x] A local reminder appears on lock screen/background and opens the correct protected task.
- [x] Cold-start notification tap still passes Auth, membership, and RLS checks.

## Network boundary

- [x] Load Home, disable Wi-Fi/cellular, and confirm cached content remains visible with a non-blocking offline banner.
- [x] Post, Care, and Task writes fail clearly while offline and retain user input; none claims success.
- [x] Restore the network, observe the short reconnection notice, refresh, and retry without killing the app.

## Layout and accessibility

- [x] Sign In, Sign Up, Pet, Post, Care, Reminder, Join Family, and Profile Edit CTAs remain reachable above the keyboard.
- [x] Dynamic Island, home indicator, full-screen photo viewer, tabs, and notification detail are unobstructed.
- [x] VoiceOver order is sensible on Home, Post Detail, Care, Reminders, and bottom tabs; icon-only controls have labels.
- [x] Largest accessibility text does not overlap primary actions; long content scrolls.

## Two-account / two-device

Skipped by user on 2026-08-26 because installing the Development Build on a second iPhone was out of scope for the remaining session. These items are not passed.

- [ ] Owner A and Member B see shared Posts, Care, and Tasks after manual refresh.
- [ ] Removed Member loses fresh access without re-login.
- [ ] Member account deletion and Owner account deletion return to Sign In; deleted credentials fail; orphan checks return zero.

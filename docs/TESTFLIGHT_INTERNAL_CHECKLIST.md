# TestFlight Internal Testing Checklist

Use this only after Apple Developer Program access, the App Store Connect record, signing, and an uploaded build exist. It does not authorize creating those resources.

## Build Record

- [ ] App version is `1.0.0`; build number is `1` unless Apple requires a new immutable build number.
- [ ] Bundle ID is exactly `com.zhushunli.homeypaw`.
- [ ] TestFlight finishes processing and shows no compliance or asset warning.
- [ ] Install from TestFlight on a clean real iPhone.
- [ ] Launch without Metro, a Development Build launcher, or a developer menu.
- [ ] HomeyPaw name, icon, Splash, light appearance, and localized permission text are correct.
- [ ] Production UI has no Chat tab or reachable Chat route.

## Authentication and Lifecycle

- [ ] Register, confirm email by deep link, sign in, sign out, and sign in again.
- [ ] Request password recovery and complete the deep-link flow.
- [ ] Verify session restoration after cold start.
- [ ] Verify sign-out removes cached private content.
- [ ] Go offline, confirm cached-read behavior, reconnect, and retry a failed write.
- [ ] Delete a disposable test account in the app and confirm it cannot sign in again.

## Pet, Journal, and Family

- [ ] Create/edit a pet and choose an avatar from Photo Library.
- [ ] Create journal entries with 1, 3, and 9 photos; confirm detail images and list thumbnails.
- [ ] Owner A invites Member B and both see the same pet.
- [ ] A publishes a journal entry; B refreshes and sees it.
- [ ] B adds a Care entry; A refreshes and sees it.
- [ ] A removes B; without re-login, B refreshes and can no longer see Pet, Journal, Care, or Reminder data.

## Care and Notifications

- [ ] Create feeding, walk, medication, grooming, and other Care records.
- [ ] Create, complete, edit, and delete a care task.
- [ ] Schedule a local reminder about two minutes ahead and verify foreground/background behavior.
- [ ] Verify the reminder while the phone is locked.
- [ ] Verify tapping a reminder after a cold start opens the intended app state.
- [ ] Confirm another device does not receive the reminder; this is an intentional device-local boundary.

## Presentation and Review Risk

- [ ] No old PawDay user-facing brand text appears.
- [ ] Support, Privacy, Terms, and Marketing links open the intended public HTTPS pages.
- [ ] Support opens an email addressed to `lenny996@163.com`.
- [ ] No unexpected camera, microphone, contacts, location, tracking, or remote-notification prompt appears.
- [ ] Production errors do not reveal tokens, passwords, signed URLs, or private user content.
- [ ] Record device model, iOS version, locale, account roles, test time, and evidence for each failure.

## Deferred Risk to Re-evaluate

- [ ] A recovery link that was never previously opened is allowed to expire naturally, then opened on a real iPhone. Confirm a clear expired-link state and a successful retry path.

This deferred edge case was not claimed as passed in Phase 8. Decide explicitly whether it remains an accepted Internal Testing risk before the first upload.

## Exit Result

- [ ] No release-blocking defect remains.
- [ ] App Privacy, age rating, review notes, screenshots, and metadata match the tested build.
- [ ] Result recorded as `PASS`, `PASS WITH ACCEPTED RISKS`, or `FAIL` with owner and next action.

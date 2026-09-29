# App Privacy Data Inventory

Updated on 2026-09-29 for the HomeyPaw 1.3.0 (10) release candidate. App Store Production remains 1.2.0 (9). This is a repository review inventory; the live App Store Connect questionnaire has not been updated or verified by this change.

## Overall Answers

- Data collected: Yes
- Data used to track users: No
- Tracking domains: None
- Third-party advertising: None
- Third-party analytics SDK: None
- Data broker sharing: None

## Data Types to Declare

| App Store category                     | HomeyPaw data                                                                                                                                                           | Linked to identity | Tracking | Purpose                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------ |
| Contact Info → Email Address           | Supabase account email                                                                                                                                                  | Yes                | No       | App Functionality                          |
| Identifiers → User ID                  | Supabase user ID and profile display name                                                                                                                               | Yes                | No       | App Functionality                          |
| Identifiers → Device ID                | App installation ID and Expo push token linked to the signed-in account, platform/app version and Chat Push capability, used for family activity and Chat notifications | Yes                | No       | App Functionality                          |
| User Content → Photos or Videos        | Profile/Pet avatars, journal photos, selected journal videos (including their existing audio), and video thumbnails                                                     | Yes                | No       | App Functionality                          |
| User Content → Emails or Text Messages | Private Family Chat messages                                                                                                                                            | Yes                | No       | App Functionality                          |
| User Content → Other User Content      | Pet profiles, journal text, manually entered location name, family membership/invites, care/health records, care tasks, schedules, and completions                      | Yes                | No       | App Functionality                          |
| Usage Data → Product Interaction       | Post ID, reader user ID and first-view timestamp for post-level Journal read receipts; Chat read cursors used for unread state                                          | Yes                | No       | App Functionality                          |
| Other Data → Other Data Types          | Profile locale and IANA time-zone values stored with care records and tasks                                                                                             | Yes                | No       | App Functionality; Product Personalization |

## Data Types Not Collected by the App

- Precise or coarse device location. A journal location is manually entered text.
- Contacts, microphone capture, human health/fitness data, sensitive information, purchases, financial information, browsing/search history, advertising data, or general interaction analytics. Pet health records are user-authored pet content, not HealthKit or human medical data. Camera capture is user-triggered and produces journal photos already declared as User Content. Selected videos can retain their existing audio; there is no in-app audio/video recording or microphone permission.
- Developer-operated diagnostics or crash analytics. Apple may provide platform diagnostics under Apple's own terms, but HomeyPaw has no diagnostics SDK.

## Processing and Sharing

- Supabase provides authentication, database, private object storage, and server functions as a service processor.
- Data is linked to the signed-in account because identity is required to provide private family access.
- Family content is shared only with currently authorized members, according to canonical `family_members` roles. Journal access can include Owner, Member and Viewer; Chat and Chat Push are limited to Owner and Member. Pets and their Journal content belong to a Family; Chat belongs directly to the Family and does not change when switching Pets.
- Invite codes expire, are capacity limited, and are stored by hash rather than plaintext.
- Push installation IDs and tokens deliver Journal, Care, Health, Reminder and Family Chat notifications through Expo Push Service and platform notification services (APNs on iOS). Chat requires the new client's explicit capability registration; existing 1.2.0 devices remain ineligible. Notification data includes routing IDs; Chat copy can include the sender's display name but never the message body. Recipients are revalidated against current membership, the sender is excluded, and stale events expire. This is App Functionality, not tracking or advertising.
- Private Chat text is stored in PostgreSQL and shared only with authorized Owner/Member users in the corresponding Family.
- Journal videos and thumbnails use private Storage and authorized signed URLs, like journal photos. Selection, processing, upload, playback and user-requested Save to Photos do not create public media or a public feed.
- Journal read receipts record a member's first intentional Post Detail or photo/video viewer opening. Passive Feed visibility, thumbnails, preloading and photo swipes do not record additional views. The author is skipped; repeated openings preserve `first_read_at`. Authorized members can see current readers' existing profile name/avatar and first-view time. There is no view counter, dwell time, per-media analytics, receipt Realtime or receipt Push.
- Journal receipt rows are deleted with the Post. Account deletion removes the reader account link; removed/former/deleted users are excluded from the visible reader count/list. Shared family history can remain with its author/sender account link removed, following the existing account lifecycle.
- HomeyPaw does not sell data, use it for advertising, or combine it across companies for tracking.
- Users can delete their account in the app. The deletion flow removes data according to the published policy and in-app confirmation.

## Support Email Caveat

The app opens the user's external mail composer only after the user taps Support. A one-off support email is user-initiated and optional. If the operator later retains, profiles, or systematically analyzes support correspondence, declare `User Content → Customer Support` as linked to the user for App Functionality before submission.

## Final Confirmation Before Submission

- Manually reconcile the live ASC questionnaire with this inventory. In particular, verify `Photos or Videos` covers Journal Video, `Emails or Text Messages` covers private Chat, and `Product Interaction` covers Journal first-view receipts and Chat read state, linked to identity for App Functionality without tracking or Analytics use. These categories follow [Apple's App Privacy definitions](https://developer.apple.com/app-store/app-privacy-details/); a functionality-only purpose does not remove the disclosure requirement.
- Confirm treatment of audio already embedded in selected videos; the app does not separately record audio or request the microphone.
- Recheck the shipped dependency tree for any newly added analytics, crash, advertising, or attribution SDK.
- Recheck production permissions and network destinations against this inventory.
- Confirm in the live questionnaire whether Apple expects locale and time-zone values under `Other Data Types`; keep the conservative declaration unless Apple Support provides a narrower classification.
- Apple/TestFlight diagnostics collected only by Apple are not developer-collected by code. Reconfirm whether the release operator separately exports or retains crash reports before answering the live Diagnostics questions.
- Publish/reconcile the updated policy at `https://homeypaw.vercel.app/privacy` before submission. The bundled `about.privacyBody`/`about.privacyUpdated` summaries were aligned on 2026-09-29 for Video, photo-only Camera, first-view receipts and Chat Push. The Terms date/copy is unchanged. These repository edits do not update the website or ASC.

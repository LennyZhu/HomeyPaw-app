# App Privacy Data Inventory

Updated on 2026-09-13 for HomeyPaw 1.1.0 Build 4. This is the repository baseline used to reconcile the live App Store Connect declaration; the live questionnaire remains authoritative.

## Overall Answers

- Data collected: Yes
- Data used to track users: No
- Tracking domains: None
- Third-party advertising: None
- Third-party analytics SDK: None
- Data broker sharing: None

## Data Types to Declare

| App Store category                | HomeyPaw data                                                                                                                                                       | Linked to identity | Tracking | Purpose                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------ |
| Contact Info → Email Address      | Supabase account email                                                                                                                                              | Yes                | No       | App Functionality                          |
| Identifiers → User ID             | Supabase user ID and profile display name                                                                                                                           | Yes                | No       | App Functionality                          |
| Identifiers → Device ID           | User-scoped app installation ID and Expo push token used for family activity notifications                                                                          | Yes                | No       | App Functionality                          |
| User Content → Photos or Videos   | Pet avatars and journal photos                                                                                                                                      | Yes                | No       | App Functionality                          |
| User Content → Other User Content | Pet profiles, journal and private Chat text, manually entered location name, family membership/invites, care/health records, care tasks, schedules, and completions | Yes                | No       | App Functionality                          |
| Other Data → Other Data Types     | Profile locale and IANA time-zone values stored with care records and tasks                                                                                         | Yes                | No       | App Functionality; Product Personalization |

## Data Types Not Collected by the App

- Precise or coarse device location. A journal location is manually entered text.
- Contacts, microphone, human health/fitness data, sensitive information, purchases, financial information, browsing/search history, advertising data, or product-interaction analytics. Pet health records are user-authored pet content, not HealthKit or human medical data. Camera capture is user-triggered and produces journal photos already declared as User Content.
- Developer-operated diagnostics or crash analytics. Apple may provide platform diagnostics under Apple's own terms, but HomeyPaw has no diagnostics SDK.

## Processing and Sharing

- Supabase provides authentication, database, private object storage, and server functions as a service processor.
- Data is linked to the signed-in account because identity is required to provide private family access.
- Pet-family content is shared only with authenticated members who joined through an invite and remain authorized by database policies.
- Invite codes expire, are capacity limited, and are stored by hash rather than plaintext.
- Push installation IDs and tokens are used only to deliver Journal, Care, Health, and Reminder family activity to currently authorized recipients. They are not used for tracking, advertising, or Chat notifications.
- Private Chat content is stored as canonical PostgreSQL data and is shared only inside the corresponding Pet Family Space.
- HomeyPaw does not sell data, use it for advertising, or combine it across companies for tracking.
- Users can delete their account in the app. The deletion flow removes data according to the published policy and in-app confirmation.

## Support Email Caveat

The app opens the user's external mail composer only after the user taps Support. A one-off support email is user-initiated and optional. If the operator later retains, profiles, or systematically analyzes support correspondence, declare `User Content → Customer Support` as linked to the user for App Functionality before submission.

## Final Confirmation Before Submission

- Recheck the shipped dependency tree for any newly added analytics, crash, advertising, or attribution SDK.
- Recheck production permissions and network destinations against this inventory.
- Confirm in the live questionnaire whether Apple expects locale and time-zone values under `Other Data Types`; keep the conservative declaration unless Apple Support provides a narrower classification.
- Apple/TestFlight diagnostics collected only by Apple are not developer-collected by code. Reconfirm whether the release operator separately exports or retains crash reports before answering the live Diagnostics questions.
- Ensure App Store Connect answers match the current privacy policy at `https://homeypaw.vercel.app/privacy`.

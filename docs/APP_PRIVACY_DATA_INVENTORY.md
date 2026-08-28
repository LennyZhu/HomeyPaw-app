# App Privacy Data Inventory

Prepared on 2026-08-27 for App Store Connect. This is a local answer sheet, not a submitted declaration.

## Overall Answers

- Data collected: Yes
- Data used to track users: No
- Tracking domains: None
- Third-party advertising: None
- Third-party analytics SDK: None
- Data broker sharing: None

## Data Types to Declare

| App Store category                | HomeyPaw data                                                                                                                    | Linked to identity | Tracking | Purpose                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------ |
| Contact Info → Email Address      | Supabase account email                                                                                                           | Yes                | No       | App Functionality                          |
| Identifiers → User ID             | Supabase user ID, profile display name, language                                                                                 | Yes                | No       | App Functionality; Product Personalization |
| User Content → Photos or Videos   | Pet avatars and journal photos                                                                                                   | Yes                | No       | App Functionality                          |
| User Content → Other User Content | Pet profiles, journal text, manually entered location name, household membership/invites, care logs, care tasks, and completions | Yes                | No       | App Functionality                          |

## Data Types Not Collected by the App

- Precise or coarse device location. A journal location is manually entered text.
- Contacts, microphone, camera capture, health, fitness, sensitive information, purchases, financial information, browsing/search history, device ID, advertising data, or product-interaction analytics.
- Remote push tokens. Notifications are scheduled locally on the device.
- Developer-operated diagnostics or crash analytics. Apple may provide platform diagnostics under Apple's own terms, but HomeyPaw has no diagnostics SDK.

## Processing and Sharing

- Supabase provides authentication, database, private object storage, and server functions as a service processor.
- Data is linked to the signed-in account because identity is required to provide private family access.
- Pet-family content is shared only with authenticated members who joined through an invite and remain authorized by database policies.
- Invite codes expire, are capacity limited, and are stored by hash rather than plaintext.
- HomeyPaw does not sell data, use it for advertising, or combine it across companies for tracking.
- Users can delete their account in the app. The deletion flow removes data according to the published policy and in-app confirmation.

## Support Email Caveat

The app opens the user's external mail composer only after the user taps Support. A one-off support email is user-initiated and optional. If the operator later retains, profiles, or systematically analyzes support correspondence, declare `User Content → Customer Support` as linked to the user for App Functionality before submission.

## Final Confirmation Before Submission

- Recheck the shipped dependency tree for any newly added analytics, crash, advertising, or attribution SDK.
- Recheck production permissions and network destinations against this inventory.
- Ensure App Store Connect answers match the current privacy policy at `https://homeypaw.vercel.app/privacy`.

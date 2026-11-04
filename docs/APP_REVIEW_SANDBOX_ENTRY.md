# HomeyPaw 1.4.1 — isolated Family Plus review entry

Local implementation and review-notes draft only. No build, submission, cloud
configuration, credential or review-admission change is performed by this file.

## Entry and safety boundary

- Normal sign-in displays the existing Production login, Forgot Password and
  Sign Up actions. It does not display the Test Account Login button.
- On the initial sign-in page, tap the **HomeyPaw wordmark at the top seven times
  within five seconds**. The wordmark is an accessible button with the same
  appearance; other authentication pages do not receive this action.
- A native confirmation explains the existing isolated Sandbox flow. Choose
  **Continue / 繼續** to open the existing **Test Account Login / 測試帳戶登入** page.
  Cancel or dismiss to stay on normal sign-in. Tapping alone never authenticates.
- The count resets after the five-second window and whenever sign-in loses
  focus. It is never persisted. An open prompt cannot be duplicated, and a
  confirmation from a previous screen-focus generation cannot navigate.
- The existing production-build review configuration and protected route remain
  in place. This change does not remove the review path from production builds.
- The gesture is a discovery/accidental-navigation guard, **not authorization**.
  Existing Sandbox credentials, verified Auth user and server-approved,
  unexpired Family binding remain mandatory. Knowing a route/gesture grants no
  account or Family access. The isolated in-memory client and private query scope
  remain unchanged; the main Production Auth client is not switched or signed in.

## App Review Notes — English draft

For the isolated Family Plus review account, start on the sign-in screen. Tap
the **HomeyPaw wordmark at the top seven times within five seconds**, then choose
**Continue** in the **Test Account Login** confirmation. This opens the isolated
Sandbox login page. Use the review credentials supplied in App Review Information.
Please do not enter those credentials in the ordinary sign-in form.

This account and its Family Plus purchase flow are isolated from Production
family data. It provides access to the existing Family Plus review experience;
the entry gesture changes no account permissions or subscription verification.
The normal sign-in, Forgot Password and Sign Up paths remain available to users.

## Before a future submission

Disclose the complete gesture, confirmation and purpose in App Review Notes;
do not retain the old instruction that the login button is visible immediately.
Apple requires specific disclosure of features/product changes and review access:
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
This entry must not be used to conceal production functionality from App Review.

Separately confirm that the existing review account's server admission is valid
for that review period; this UI change does not extend or reactivate it. Keep
credentials in App Review Information only, never in Git. No shared Apple Sandbox
Tester setting/history, OrderMori configuration, Production or Sandbox database,
Billing flag or other cloud setting is changed by this work.

# App Store Metadata — HomeyPaw 1.3.0 Draft

Updated 2026-09-29. Release candidate: **1.3.0 (10)**. App Store Production remains **1.2.0 (9)**. This is a repository draft; no 1.3.0 build, upload, submission, questionnaire change or release is claimed.

## App Record

- App Name: HomeyPaw
- Primary Language: Traditional Chinese (Hong Kong), if offered; otherwise Traditional Chinese
- Bundle ID: com.zhushunli.homeypaw
- SKU: HOMEYPAW-IOS-001
- Version / build: 1.3.0 (10), assuming Build 10 is unused; confirm in App Store Connect before building
- Price: Free
- Primary Category: Lifestyle
- Secondary Category: Utilities
- Support Email: lenny996@163.com
- Support URL: https://homeypaw.vercel.app/support
- Privacy Policy URL: https://homeypaw.vercel.app/privacy
- Marketing URL: https://homeypaw.vercel.app/
- Terms URL: https://homeypaw.vercel.app/terms

## Release Config Audit — 2026-09-29

- Native version authority is `app.json` (`expo.version=1.3.0`, `ios.buildNumber=10`), with EAS `appVersionSource=local` and Production `autoIncrement=false`. Root package/lock versions are aligned; dependencies are unchanged.
- Native directories are untracked and excluded by `.gitignore`, with no `.easignore` override. EAS uses CNG to generate native projects. The existing ignored local iOS project is a stale Dev Client artifact (1.0.0 / 1); it was not regenerated or changed in this stage and must not be used directly as the release archive.
- EAS CLI 24.8.0 read-only audit confirmed the project `production` environment URL matches `https://tknaobmlwmodsqtpqwkr.supabase.co` and uses `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` with a publishable key. The account-wide production environment has no variables. No key values are recorded; no Supabase DB connection was made for this config audit.
- Production profile remains store distribution, environment `production`, no Development Client and no Simulator. Ignored local `.env` files are not release upload inputs.
- Release Video is enabled by the binary capability. Current device registration sends five arguments with `device_chat_push_v1=true`; startup/session/foreground/token refresh retry it, and installation-based upsert plus concurrent client dedupe avoid upgrade duplication. The legacy four-argument API keeps capability false.
- Recurrence V2 and Post-level receipts have no DEV-only gate. The actual release startup gate still blocks unsupported binaries; its DEV UI bypass does not alter native version headers or server mutation gates.
- Existing localized Photos/video/save and photo-only Camera purposes remain unchanged. Read-only SDK 57 introspection generates the correct version/build, purposes and APNs entitlement. Expo's generation value is `development`; the signed store archive must be separately confirmed as `production`, following [Expo's notification configuration](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#app-config). No new system permission or background notification mode is needed.
- `verify:release-config`, `verify:phase9-local`, feature client verifiers, TypeScript, targeted ESLint, Prettier, i18n parity and navigation/UI checks passed. This is config evidence, not a build/device acceptance result.

## Traditional Chinese (Hong Kong)

- Subtitle: 一家人的毛孩照顧與回憶
- Promotional Text: 把相片與影片日記、家庭照顧、提醒、排班與私人聊天，放在一個只屬於你和家人的毛孩空間。
- Keywords: 寵物日記,毛孩照顧,家庭共享,相片回憶,照顧提醒,家庭排班

### Description

HomeyPaw 是一家人共同照顧毛孩、保存生活回憶的私人空間。

建立毛孩檔案，以文字、相片或短影片記下生活片段；記錄餵食、散步、用藥、梳洗及其他日常照顧；建立共享提醒與家庭排班；並在只限家庭成員的私人聊天室保持聯絡。

透過限時私人邀請，讓信任的家人加入同一家庭。每個帳戶最多加入一個家庭，一個家庭可有多隻毛孩。家庭內容依 Owner／Member／Viewer 角色限制存取；Owner 可管理成員與邀請。私人 Chat 只限有效 Owner／Member，切換毛孩不會切換聊天室。

主要功能：

- 毛孩檔案、生日與頭像
- 文字、最多九張相片或一段短影片的日記、時間線與媒體瀏覽
- 日記詳情中的家庭成員已查看狀態
- 餵食、散步、用藥、梳洗及其他照顧記錄
- 單次、每日、每週、每月、每年提醒；每週可選多個星期，重複提醒可設結束日期
- 家庭照顧排班、認領、完成、取消與重新安排
- 私人家庭文字聊天、未讀狀態與聊天訊息通知
- Journal、Care、Health、Reminder 家庭活動通知
- 私人家庭邀請、角色權限與 App 內永久刪除帳戶

HomeyPaw 不提供醫療、獸醫或緊急照護建議；重要照護請諮詢合資格專業人士並準備可靠的備援提醒。

### What’s New

- 日記支援影片，保存更多毛孩生活片段。
- 新增家庭聊天訊息通知。
- 提醒可選擇多個星期及設定結束日期。
- 日記可查看家庭成員已閱狀態。
- 改善排班、相片瀏覽及其他使用體驗。

## English

- Subtitle: Family pet care & memories
- Promotional Text: Keep photo and video journals, shared care, reminders, schedules, and private family chat together in one space for your pets.
- Keywords: pet care,journal,photo memories,family sharing,care reminders,schedule

### Description

HomeyPaw is a private place for families to care for their pets together and keep everyday memories.

Create pet profiles, capture moments in text, photos or short videos, record feeding, walks, medication, grooming and other daily care, create shared reminders and family schedules, and stay connected in a private family chat.

Invite trusted family members through time-limited private invitations. Each account can join one Family, which can have multiple Pets. Access follows Owner, Member and Viewer roles; the Owner manages members and invites. Private Chat is for active Owners and Members, and switching Pets keeps the same Family Chat.

Key features:

- Pet profiles, birthdays and avatars
- Journal entries with text, up to nine photos or one short video, timelines and media viewing
- Family member viewing status in Journal Post Detail
- Feeding, walks, medication, grooming and other care records
- Once, daily, weekly, monthly and yearly reminders; multiple weekly days and optional end dates for repeating reminders
- Family care schedules with claim, complete, cancel and reschedule flows
- Private family text chat, unread state and chat message notifications
- Family activity notifications for Journal, Care, Health and Reminder updates
- Private invitations, role-based access and permanent in-app account deletion

HomeyPaw does not provide medical, veterinary or emergency advice; consult a qualified professional and use reliable backup reminders for important care.

### What’s New

- Add videos to your journal to capture more of your pet’s everyday moments.
- Get notifications for new family chat messages.
- Choose multiple weekdays and an end date for repeating reminders.
- See which family members have viewed a journal entry.
- Improvements to schedules, photo viewing and the overall experience.

## TestFlight Draft

### Beta App Description

HomeyPaw is a private family pet journal and care app. This release adds Journal Video, Family Chat notifications, flexible repeating reminders and Journal read receipts, with Schedule and Photo Viewer improvements.

### What to Test

Use the pending 1.3.0 checklist in TESTFLIGHT_INTERNAL_CHECKLIST.md. Prioritize Video create/play/save, two-device capable Chat Push, multi-weekday/end-date Reminder editing, intentional-view receipts, upgrade registration, permissions and iPhone/iPad navigation.

## App Review Notes — 1.3.0 Draft

HomeyPaw is a private, invite-only family pet care app. There is no public feed, public discovery, stranger messaging, advertising or tracking SDK. Each account joins one Family; multiple Pets share one Family Chat.

The release operator must supply working review credentials in App Store Connect Review Information, not in this repository. Prepare two authorized accounts in the same review Family (A: Owner, B: Member), with a Pet and sample Journal entries. Confirm sign-in and samples before submission. These notes do not claim that review accounts or sample receipts have already been prepared.

1. **Family:** Sign in with account A, open Me → Manage Family and view members/Pets. Account B sees the same authorized Family content. Invitation management is Owner-only.
2. **Journal Video:** Tap the middle + to open the existing Journal composer. Choose a video from Photos (up to 15 seconds; processed upload up to 25 MiB), publish, then open the video thumbnail to play it. Photo and text entries remain available. Video is selected from the library; the app does not record video or request the microphone.
3. **Chat notification:** Use both review accounts on two devices with 1.3.0 and notification permission granted. Put B in the background or on another screen; send from A in Family Chat. B receives a notification and tapping it opens the authorized Family Chat. Copy may name the sender but does not include the message body. The sender and unauthorized/removed members receive no Chat Push. While B is actively viewing that Chat, the foreground system alert is suppressed. Existing 1.2.0 devices do not receive Chat Push.
4. **Reminder recurrence:** Create a weekly reminder, select multiple days or use Select weekdays, adjust individual days, and choose an end date. Save, reopen/edit, and check the recurrence summary and occurrences. The end date is inclusive.
5. **Read Receipts:** Have B intentionally open A's Post Detail, photo viewer or video viewer, then return A to that Post Detail. A's date/time metadata includes Viewed by N family members; tap that text for the compact reader list. Passive Feed scrolling does not count. Reopening keeps one receipt and its first-view time; authors are not counted as their own readers. Legacy clients and failed offline writes can leave missing receipts, which are not proof of unread.
6. **Permissions:** Declining notifications does not block Journal, Chat, Care, Reminder or Schedule use. Local care reminders require notification permission. Photos and Camera are requested only after an explicit selection/capture/save action. Camera capture is photo-only. No contacts, GPS, tracking or microphone permission is requested.
7. **Account lifecycle:** Account deletion is under Me → Account and security. A Family Owner must transfer ownership or delete the Family first. Shared family history can remain without its author account link after deletion; removed/deleted users are excluded from the reader list.

Medication entries are user-authored pet care information, not medical advice. Notification delivery depends on OS permissions, network and device settings; important care needs reliable backup reminders.

## Before Build / Submission — Manual Checks

- Confirm Build 10 is unused in App Store Connect; use an unused build number if necessary and rerun config verification.
- Confirm review account credentials and the shared review Family, Pet, media and read-receipt examples in Review Information.
- Reconcile the live ASC privacy questionnaire with APP_PRIVACY_DATA_INVENTORY.md, including Photos or Videos, private messages and Product Interaction for App Functionality. No live questionnaire update is claimed here.
- Reconcile/publish the current privacy policy on the website before submission. The bundled bilingual privacy summary was aligned on 2026-09-29; Terms copy/date remains unchanged. No website or ASC update is claimed.
- Build only after separate authorization; check the resulting archive version/build, Production APNs entitlement, signing, permissions and Production backend. Then run the updated TestFlight checklist with actual release devices.
- Keep minimum iOS at 1.2.0 (9) during config preparation. Include the mixed-client/minimum-version strategy in release approval only after the new version is available and Production smoke passes; old clients cannot fully edit advanced recurrence and may underreport Journal views.

## Historical Submission Record

HomeyPaw 1.1.0 (4) previously passed its automated/TestFlight/two-device checks and was submitted with manual release selected. That historical evidence does not certify 1.3.0. Current approved Production baseline for this preparation is 1.2.0 (9); no 1.3.0 build or submission has been performed in this stage.

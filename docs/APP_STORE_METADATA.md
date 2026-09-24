# App Store Metadata — HomeyPaw 1.1.0

> Historical 1.1.0 (4) submission record. Current App Store Production is **1.1.1 (5)**; the submission status below is retained as historical context.

Historical release record for HomeyPaw `1.1.0` Build 4. The build has been submitted to App Store Review and is `Waiting for Review`. Release mode is manual; this document does not claim approval or release.

## App Record

- App Name: `HomeyPaw`
- Primary Language: Traditional Chinese (Hong Kong), if offered; otherwise Traditional Chinese
- Bundle ID: `com.zhushunli.homeypaw`
- SKU: `HOMEYPAW-IOS-001`
- Version／build: `1.1.0 (4)`
- Price: Free
- Primary Category: Lifestyle
- Secondary Category: Utilities
- Support Email: `lenny996@163.com`
- Support URL: `https://homeypaw.vercel.app/support`
- Privacy Policy URL: `https://homeypaw.vercel.app/privacy`
- Marketing URL: `https://homeypaw.vercel.app/`
- Terms URL: `https://homeypaw.vercel.app/terms`

## Traditional Chinese (Hong Kong)

- Subtitle: `一家人的毛孩照顧與回憶`
- Promotional Text: `把相片日記、家庭照顧、提醒、排班與私人聊天，放在一個只屬於你和家人的毛孩空間。`
- Keywords: `寵物日記,毛孩照顧,家庭共享,相片回憶,照顧提醒,家庭排班`

### Description

HomeyPaw 是一家人共同照顧毛孩、保存生活回憶的私人空間。

你可以建立毛孩檔案，透過相片日記記下生活片段；記錄餵食、散步、用藥、梳洗及其他日常照顧；建立共享提醒與家庭排班；並在只限家庭成員的私人聊天室保持聯絡。

透過限時私人邀請，你可以讓信任的家人加入同一個毛孩家庭。家庭內容只供仍獲授權的 Owner／Member 查看；Owner 可管理成員並移除存取權限。

主要功能：

- 毛孩檔案、生日與頭像
- 一至九張相片的日記、時間線與相片瀏覽
- 餵食、散步、用藥、梳洗及其他照顧記錄
- Once、Daily、Weekly、Monthly、Yearly 提醒與本機通知
- 家庭照顧排班、認領、完成、取消與重新安排
- 私人家庭文字聊天與未讀狀態
- Journal、Care、Health、Reminder 的家庭活動通知
- 私人家庭邀請、Owner／Member 權限與 App 內永久刪除帳戶

Chat 不發送系統 Push Notifications。HomeyPaw 不提供醫療、獸醫或緊急照護建議；重要照護請諮詢合資格專業人士並準備可靠的備援提醒。

## English

- Subtitle: `Family pet care & memories`
- Promotional Text: `Keep photo journals, shared care, reminders, schedules, and private family chat together in one space for your pet.`
- Keywords: `pet care,journal,photo memories,family sharing,care reminders,schedule`

### Description

HomeyPaw is a private place for families to care for a pet together and keep everyday memories.

Create a pet profile, capture moments in a photo journal, record feeding, walks, medication, grooming, and other daily care, create shared reminders and family schedules, and stay connected in a private family chat.

Invite trusted family members through a time-limited private invitation. Family content is available only to authorized Owners and Members, and the Owner can manage members and remove access.

Key features:

- Pet profiles, birthdays, and avatars
- Photo journals with one to nine photos, timelines, and photo viewing
- Feeding, walk, medication, grooming, and other care records
- Once, daily, weekly, monthly, and yearly reminders with local notifications
- Family care schedules with claim, complete, cancel, and reschedule flows
- Private family text chat and unread state
- Family activity notifications for Journal, Care, Health, and Reminder updates
- Private invitations, Owner/Member roles, and permanent in-app account deletion

Chat does not send system push notifications. HomeyPaw does not provide medical, veterinary, or emergency advice; consult a qualified professional and use reliable backup reminders for important care.

## TestFlight Result — Build 4

- Production-signed TestFlight build `1.1.0 (4)`: PASS.
- iPhone／iPad、雙裝置家庭協作、Remote Push、Schedule、Chat Realtime／unread／cache、Removed Member 與 account lifecycle：PASS。
- Full automated release gate：PASS。

## App Review Notes

- HomeyPaw is a private, invite-only family app. It has no public discovery, public feed, stranger messaging, advertising, or tracking SDK.
- The Chat tab is a real private-family text feature backed by PostgreSQL and authenticated private Realtime. Chat does not generate system push notifications.
- Remote push is limited to privacy-safe family Journal, Care, Health, and Reminder activity. The actor does not receive their own push, and removed members receive no future push.
- Local notifications are created for user-enabled care reminders. Notification navigation still passes Auth, membership, and RLS checks.
- Camera and Photo Library access are requested only after the user chooses to take or select a photo. Camera capture does not request microphone access.
- “Location” in a journal is manually entered text; the app does not request device location.
- Account deletion is available at `Me → Account and security → Delete account`.
- Medication entries are user-authored pet care records and reminders, not medical advice.
- Version `1.1.0` uses manual release and is not yet available until review is approved and the release operator publishes it.

## Submission Status

- Metadata, App Privacy, age rating, screenshots and review information were prepared for Build 4.
- Build 4 has been submitted to App Store Review.
- Current state: `Waiting for Review`.
- App Store Review: submitted, not approved.
- App Store Release: not released; manual release remains pending.

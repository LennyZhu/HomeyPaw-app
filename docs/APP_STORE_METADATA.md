# App Store Metadata — Final Local Draft

Prepared on 2026-08-27. Nothing in this file has been submitted to App Store Connect.

## App Record

- App Name: `HomeyPaw`
- Primary Language: Traditional Chinese (Hong Kong), if offered; otherwise Traditional Chinese
- Bundle ID: `com.zhushunli.homeypaw`
- SKU: `HOMEYPAW-IOS-001`
- Version: `1.0.0`
- Initial build: `1`
- Price recommendation: Free
- Primary Category: Lifestyle
- Secondary Category: Utilities
- Copyright: `2026 [Apple Developer Program seller/legal name]` (replace only after enrollment is active)
- Support Email: `lenny996@163.com`
- Support URL: `https://homeypaw.vercel.app/support`
- Privacy Policy URL: `https://homeypaw.vercel.app/privacy`
- Marketing URL: `https://homeypaw.vercel.app/`
- Terms URL: `https://homeypaw.vercel.app/terms`

## Traditional Chinese (Hong Kong)

- Subtitle: `一家人的毛孩照顧與回憶`
- Promotional Text: `把相片日記、今日照顧與家庭提醒，放在一個只屬於你和家人的毛孩空間。`
- Keywords: `寵物日記,毛孩照顧,家庭共享,相片回憶,照顧提醒,成長記錄`

### Description

HomeyPaw 是一家人共同照顧毛孩、保存生活回憶的私人空間。

你可以建立毛孩檔案，透過相片日記記下生活片段和成長時間線；記錄餵食、散步、用藥、梳洗等日常照顧；並在自己的裝置上設定本機提醒，協助家人掌握待辦事項。

透過限時私人邀請，你可以讓信任的家人加入同一個毛孩家庭。家庭內容只供已獲授權的成員查看，Owner 亦可管理成員和移除存取權限。

主要功能：

- 毛孩檔案與頭像
- 一至九張相片的日記與時間線
- 餵食、散步、用藥、梳洗及其他照顧記錄
- 家庭照顧任務與本機提醒
- 私人家庭邀請與角色權限
- App 內帳戶永久刪除

HomeyPaw 不提供醫療、獸醫或緊急照護建議。重要照護請諮詢合資格專業人士，並準備其他可靠提醒方式。

## English

- Subtitle: `Family pet care & memories`
- Promotional Text: `Keep photo journals, daily care, and family reminders together in one private place for your pet.`
- Keywords: `pet care,journal,photo memories,family sharing,care reminders,pets`

### Description

HomeyPaw is a private place for families to care for a pet together and keep everyday memories.

Create a pet profile, capture life moments in a photo journal and timeline, record feeding, walks, medication, grooming, and other daily care, and schedule local reminders on your own device.

Invite trusted family members through a time-limited private invitation. Shared family content is available only to authorized members, and the Owner can manage members and remove access.

Key features:

- Pet profiles and avatars
- Photo journals with one to nine photos and a timeline
- Feeding, walk, medication, grooming, and other care records
- Family care tasks and local reminders
- Private family invitations and role-based access
- Permanent in-app account deletion

HomeyPaw does not provide medical, veterinary, or emergency advice. Consult a qualified professional and use reliable backup reminders for important care.

## TestFlight Test Information

### Beta App Description — Traditional Chinese (Hong Kong)

HomeyPaw 是私人、只限邀請家庭使用的毛孩日記與照顧工具。此首個 Internal Testing build 用於驗證登入、相片日記、家庭共享、照顧記錄、本機提醒、離線恢復及帳戶刪除。此版本沒有 Chat、Realtime 或遠端推送；提醒只會排程在設定提醒的裝置上。

### What to Test — Traditional Chinese (Hong Kong)

請重點測試：註冊、登入、確認電郵及重設密碼 Deep Link；建立毛孩；新增 1、3、9 張相片日記及查看縮圖；兩個帳戶加入同一家庭後互相查看 Journal/Care，並驗證 Owner 移除 Member 後立即失去權限；建立餵食、散步及其他 Care；設定約兩分鐘後的本機提醒，測試背景、鎖屏及冷啟動；離線後恢復、重試和重新登入；登出資料清理；App 內永久刪除帳戶。

已知限制：提醒只屬本機，不會跨裝置同步推送。從未在 App 開啟過、已自然過期的 Recovery Link 端到端案例仍列為延後風險；其他 Password Recovery 流程已完成真機驗收。

### Beta App Description — English

HomeyPaw is a private, invite-only pet journal and family care tool. This first internal build validates authentication, photo journals, family sharing, care records, local reminders, offline recovery, and account deletion. This version has no Chat, Realtime, or remote push; reminders are scheduled only on the device where they are enabled.

### What to Test — English

Please focus on sign-up, sign-in, email confirmation, and password-recovery deep links; creating a pet; 1-, 3-, and 9-photo journal entries and thumbnails; two-account family visibility and immediate access loss after the Owner removes a Member; feeding, walk, and other care records; a local reminder scheduled about two minutes ahead while backgrounded, locked, and cold-started; offline recovery, retry, and session restoration; sign-out cleanup; and permanent in-app account deletion.

Known limitation: reminders are device-local and are not delivered across devices. The end-to-end case for a naturally expired recovery link that was never opened remains a deferred risk; the rest of password recovery has passed real-device acceptance.

## App Review Notes Draft

- HomeyPaw is a private, invite-only family app; there is no public discovery or stranger messaging.
- Local notifications are created only after a user enables a care reminder. No remote push token is requested.
- “Location” in a journal is manually entered text; the app does not request device location.
- Camera access is not requested. Users choose existing images through the Photo Library picker.
- Account deletion is available at `Me → Account and security → Delete account`.
- Medication entries are user-authored pet care records and reminders, not medical advice.
- The production release has no Chat tab or reachable Chat screen, Realtime feature, advertising, tracking, or analytics SDK. Expo's static export may physically include the guarded Mock-only preview code, but it is not a production feature.

## Submission-Time Fields Still Requiring Account Access

- Confirm the seller/legal name and replace the copyright placeholder.
- Keep the existing App Store Connect identity: numeric app ID `6806111286`, Bundle ID `com.zhushunli.homeypaw`, and SKU `HOMEYPAW-IOS-001`.
- Enter App Privacy and Age Rating answers using the companion inventories.
- Add review contact details and, if Apple requests them, a valid review account and review instructions.
- Upload final screenshots captured from the production-signed/TestFlight build.
- Select the uploaded build and complete export-compliance prompts.

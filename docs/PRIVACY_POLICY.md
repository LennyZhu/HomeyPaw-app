# HomeyPaw Privacy Policy / HomeyPaw 私隱政策

Updated / 更新日期：2026-09-13

Published at `https://homeypaw.vercel.app/privacy`.

公開網址：`https://homeypaw.vercel.app/privacy`。

## 繁體中文（香港）

HomeyPaw 是私人、只限邀請家庭使用的毛孩日記與照顧空間。為提供服務，HomeyPaw 會處理你主動提供的帳戶電郵、Profile 暱稱與語言、毛孩檔案與頭像、家庭成員與邀請、日記文字與相片、照顧及健康記錄、照顧任務、排班、完成記錄，以及私人家庭 Chat 文字。

資料儲存在 Supabase。登入、Row Level Security、受限制 RPC、Edge Functions 及私人 Storage policies 共同限制存取。家庭 Owner 與 Member 只會依產品角色看到獲授權的共享資料。邀請碼只供加入私人家庭使用，資料庫只保存其 hash。

HomeyPaw 只在你主動選擇從相片庫選相片時要求 Photo Library 權限，或在你選擇拍照時要求相機權限。選擇或拍攝的相片會經 App 壓縮後上載至私人 Storage。通知權限用於你在裝置上啟用的本機照顧提醒，以及 Journal、Care、Health 與 Reminder 的家庭活動通知。為傳送家庭活動通知，HomeyPaw 會保存與登入帳戶及 App installation 關聯的 Push token；收件人會在伺服器端按當前家庭權限重新驗證，發起活動的使用者與已被移除的 Member 不會收到該活動的通知，過期事件亦不會延遲補送。Chat 不發送系統 Push Notifications。

HomeyPaw 目前不使用麥克風、聯絡人、GPS、廣告追蹤、IDFA、分析 SaaS 或公開社群。私人 Chat 只限同一 Pet Family Space 的有效 Owner／Member，並受 RLS 與 private Realtime authorization 保護。

你可以在 App 的「我的 → 帳戶與安全」永久刪除帳戶。刪除會按 App 內確認文案移除 Profile、你擁有的毛孩及相關家庭資料，並刪除你在共享毛孩中發佈的日記、相片與照顧記錄。刪除是不可復原操作。

支援聯絡方式：[lenny996@163.com](mailto:lenny996@163.com)

## English

HomeyPaw is a private, invite-only pet journal and care space for families. To provide the service, HomeyPaw processes information you choose to provide: account email, profile display name and language, pet profiles and avatars, family membership and invites, journal text and photos, care and pet-health records, care tasks, schedules, completions, and private family Chat text.

Data is stored in Supabase. Authentication, Row Level Security, restricted RPCs, Edge Functions, and private Storage policies work together to limit access. Family Owners and Members see only shared data allowed by their product role. Invite codes are used only to join private families; the database stores only their hash.

HomeyPaw requests Photo Library permission only when you choose an existing image, or Camera permission when you choose to take a photo. Selected or captured images are compressed in the app and uploaded to private Storage. Notification permission is used for local care reminders enabled on your device and for family activity notifications about Journal, Care, Health, and Reminder updates. To deliver family activity notifications, HomeyPaw stores a push token associated with the signed-in account and app installation. Recipients are revalidated on the server against current family access; the actor and removed Members do not receive that activity notification, and expired events are not delivered later. Chat does not send system push notifications.

HomeyPaw currently does not use the microphone, contacts, GPS, advertising tracking, IDFA, analytics SaaS, or a public social network. Private Chat is limited to active Owners and Members of the same Pet Family Space and is protected by RLS and private Realtime authorization.

You can permanently delete your account from “Me → Account and security.” Deletion removes your Profile, pets you own and their related family data, and journal entries, photos, and care records you published in shared pet families, as described in the in-app confirmation. Deletion cannot be undone.

Support contact: [lenny996@163.com](mailto:lenny996@163.com)

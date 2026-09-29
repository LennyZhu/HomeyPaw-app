# HomeyPaw Privacy Policy / HomeyPaw 私隱政策

Updated / 更新日期：2026-09-29

Repository draft for HomeyPaw 1.3.0. Public policy URL: `https://homeypaw.vercel.app/privacy`. The bundled bilingual privacy summary was aligned on 2026-09-29. These edits do not publish the website or update App Store Connect.

HomeyPaw 1.3.0 倉庫審閱草稿。公開網址：`https://homeypaw.vercel.app/privacy`。App 內雙語私隱摘要已於 2026-09-29 對齊；本次未更新公開網站或 App Store Connect。

## 繁體中文（香港）

HomeyPaw 是私人、只限邀請家庭使用的毛孩日記與照顧空間。為提供服務，HomeyPaw 會處理你主動提供的帳戶電郵、Profile 暱稱、頭像與語言、毛孩檔案與頭像、家庭成員與邀請、日記文字、相片、影片及影片縮圖、照顧及健康記錄、照顧任務、排班、完成記錄，以及私人家庭 Chat 文字。

資料儲存在 Supabase。登入、Row Level Security、受限制 RPC、Edge Functions 及私人 Storage policies 共同限制存取。家庭 Owner、Member 與 Viewer 只會依產品角色看到獲授權的共享資料；私人 Chat 只供有效 Owner／Member 使用，屬於整個家庭，不因切換毛孩而改變。邀請碼只供加入私人家庭使用，資料庫只保存其 hash。

HomeyPaw 只在你主動選擇從相片庫選相片或影片時要求 Photo Library 權限，或在你選擇拍照時要求相機權限。相片及影片會經 App 處理後上載至私人 Storage；選擇的影片可保留原有聲音，但 App 不錄製影片或音訊。只有你選擇「儲存到相片」時，App 才要求所需的儲存權限並把目前的相片或影片加入裝置相片庫。

通知權限用於你啟用的本機照顧提醒，以及 Journal、Care、Health、Reminder 與家庭 Chat 通知。為傳送通知，HomeyPaw 保存與登入帳戶及 App installation 關聯的 Push token、平台、App 版本及聊天通知支援狀態，並透過 Expo Push Service 及裝置通知服務傳送。Chat 通知只傳送至已登記支援此功能的新版本裝置；通知可包含發訊者暱稱及導向該聊天室的識別資料，但不包含聊天正文。收件人會按當前家庭權限重新驗證，發起活動的使用者與已被移除的成員不會收到該活動的通知，過期事件不會延遲補送。拒絕通知權限不會阻止使用核心功能。

當你主動打開其他成員的日記詳情、相片或影片檢視器，HomeyPaw 會記錄該日記、查看者帳戶及首次查看時間，供獲授權家庭成員查看已閱狀態。只在 Feed 看到日記、載入縮圖、預載媒體或在同篇日記內切換相片不會新增查看記錄；重複打開亦不會改變首次查看時間，作者不會被記為自己的查看者。這是日記層級的功能狀態，不記錄觀看時長或逐張媒體瀏覽分析，也不發送已閱通知。Chat 亦保存已讀位置以提供未讀狀態。這些互動資料只用於 App 功能，不用於廣告、追蹤或使用行為分析。

HomeyPaw 目前不使用麥克風錄音、聯絡人、GPS、廣告追蹤、IDFA、分析 SaaS 或公開社群。私人 Chat 受 RLS 與 private Realtime authorization 保護。

你可以在 App 的「我的 → 帳戶與安全」永久刪除帳戶。Family Owner 必須先轉移 Owner 或刪除家庭，才可刪除帳戶。刪除會移除個人 Profile、家庭成員資格及推送裝置資料；共享家庭歷史可按既有生命週期保留，但作者／發訊者的帳戶連結會被移除。日記刪除時，該篇查看記錄會一併刪除；查看者帳戶刪除後，記錄的帳戶連結會被移除，已移除或已刪除帳戶不會出現在已查看名單。刪除帳戶是不可復原操作。

支援聯絡方式：[lenny996@163.com](mailto:lenny996@163.com)

## English

HomeyPaw is a private, invite-only pet journal and care space for families. To provide the service, HomeyPaw processes information you choose to provide: account email, profile display name, avatar and language, pet profiles and avatars, family membership and invites, journal text, photos, videos and video thumbnails, care and pet-health records, care tasks, schedules, completions, and private family Chat text.

Data is stored in Supabase. Authentication, Row Level Security, restricted RPCs, Edge Functions, and private Storage policies work together to limit access. Family Owners, Members and Viewers see only shared data allowed by their role. Private Chat is limited to active Owners and Members and belongs to the whole Family, regardless of the selected Pet. Invite codes are used only to join private families; the database stores only their hash.

HomeyPaw requests Photo Library permission only when you choose an existing photo or video, or Camera permission when you choose to take a photo. Photos and videos are processed in the app and uploaded to private Storage. Selected videos may retain their existing audio; the app does not record video or audio. Only when you choose Save to Photos does the app request the necessary save permission and add the current photo or video to your device library.

Notification permission is used for local care reminders you enable and family Journal, Care, Health, Reminder and Chat notifications. HomeyPaw stores the account-linked app installation ID, push token, platform, app version and Chat notification capability, and uses Expo Push Service and platform notification services to deliver notifications. Chat notifications require a newly registered capable client; their copy can include the sender's display name and routing identifiers but never the message body. Recipients are revalidated against current family access; the actor and removed members do not receive that activity notification, and expired events are not delivered later. Declining notification permission does not block core functionality.

When you intentionally open another member's Journal Post Detail, photo viewer or video viewer, HomeyPaw records the Post, reader account and first-view time so authorized family members can see who has viewed it. Passive Feed visibility, thumbnails, preloading and swiping between photos within a Post do not create additional receipts. Reopening keeps the original first-view time, and authors are not recorded as their own readers. This is post-level feature state, with no dwell-time or per-media viewing analytics and no read-receipt notifications. Chat also stores read positions to provide unread state. This interaction data is used only for App Functionality, not advertising, tracking or behavioral analytics.

HomeyPaw currently does not record through the microphone or use contacts, GPS, advertising tracking, IDFA, analytics SaaS, or a public social network. Private Chat is protected by RLS and private Realtime authorization.

You can permanently delete your account from “Me → Account and security.” A Family Owner must first transfer ownership or delete the Family. Account deletion removes the personal Profile, family membership and push devices. Shared family history may remain under the existing lifecycle, with its author/sender account link removed. Deleting a Post also deletes its receipts; deleting a reader account removes its receipt account link. Removed or deleted accounts are not shown in the reader list. Account deletion cannot be undone.

Support contact: [lenny996@163.com](mailto:lenny996@163.com)

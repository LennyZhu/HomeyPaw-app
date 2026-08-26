# Architecture

## 目標

HomeyPaw 是真實上架產品。架構優先考慮可維護、可驗證與漸進演進，不為尚未實作的功能預先增加抽象層。

## 應用邊界

- `src/app`：只負責 Expo Router 路由組合、頁面入口與 layout。
- `src/features`：業務主體。後續按 `auth`、`pets`、`posts`、`health`、`reminders` 分區，各 feature 自己擁有畫面、元件、hooks、schema 與 query。
- `src/components`：只有確定被多個 feature 使用的視覺元件才提升到此處。
- `src/lib`：Supabase、TanStack Query、i18next 等第三方工具的初始化。
- `src/services`：相片、通知、位置等裝置能力與外部服務的邊界。
- `src/stores`：Zustand 管理少量純客戶端全域狀態；伺服器狀態由 TanStack Query 管理。
- `src/i18n`：預設 `zh-HK`，從 Phase 1 起同步保留英文 key。
- `src/theme`：色彩、間距、圓角與字體 token；Phase 1 建立。

## 資料流原則

畫面透過 feature hooks 讀寫資料；hooks 協調 TanStack Query 與服務層。遠端資料不複製到 Zustand。表單以 React Hook Form + Zod 在客戶端驗證，資料庫仍保留約束與 RLS 作為最終安全邊界。

## Supabase 與安全（Phase 2 起）

- 客戶端只使用 publishable key，永不包含 secret、`service_role` key 或資料庫密碼。
- 所有私人資料表及 Storage bucket 啟用 RLS。
- 寵物權限以 `pets` + `pet_members` 建模；Phase 4.5 正式啟用 owner／member，資料庫是角色唯一事實來源。
- 私人相片使用非公開 bucket 與受權限控制的 object path；顯示時使用短期 signed URL。
- schema 與 policy 變更全部以 migration 納入版本控制。
- 刪除帳戶由受信任的伺服器端流程刪除 Auth 帳戶與關聯資料，客戶端不持有管理密鑰。

## Authentication

- Supabase Session 是登入狀態的唯一來源，由 React Context 暴露給 Router；不把 session、user 或 token 複製到 Zustand。
- Expo Router `Stack.Protected` 在根 layout 分隔 `(auth)` 與私人 routes。`INITIAL_SESSION` 完成前保持 Splash／Loading，避免先顯示登入頁再跳回 App。
- Supabase Client 使用 Expo 官方 React Native URL polyfill、Expo SQLite `localStorage` persistence、`processLock`、auto refresh 和 AppState 前後台控制。
- `profiles` 是遠端資料，只在 feature hook 中查詢與更新；語言設定成功寫入 `profiles.locale` 後才同步 i18next。
- Email confirmation 開啟時，Sign Up 不假設存在 session；只有 Supabase 回傳 session 才視為登入成功。
- Phase 8 以 `pawday://check-email` 和 `pawday://reset-password` 接收 Supabase implicit／PKCE callback。URL 只在記憶體中交給 Supabase，禁止記錄 token；Password Recovery session 完成更新後立即本機登出，要求使用新密碼重新登入。

## Account Data Lifecycle

1. `auth.users` 是帳戶身份的生命週期根節點；`public.profiles.id` 以 `ON DELETE CASCADE` 外鍵指向它。
2. 新帳戶由資料庫 trigger 建立 Profile，避免「Auth 成功但客戶端 insert 失敗」造成不一致。
3. App 只能使用 publishable／anon key。Profile 由 RLS、明確 grants 與欄位約束共同保護；客戶端不能自行 insert 或 delete Profile。
4. 刪除帳戶必須呼叫受 JWT 保護的 `delete-account` Edge Function。函數從已驗證 session 取得使用者 ID，並只在伺服器環境使用 secret／legacy service-role key 呼叫 Admin API。
5. Phase 4 起，帳戶刪除函數先清理使用者的 `post-media` prefix、所有 owner pets 的日記媒體與 `pet-avatars` prefix，再刪除 owner pets 和 Auth User；Profile、作者 Posts 與剩餘 membership 由外鍵 cascade 清理。任何必要步驟失敗都不會在客戶端偽裝成功。
6. 帳戶刪除失敗時不偽裝成功，也不先移除本機 session；使用者可重試。
7. Deferred Pet-owner 與 Post-content invariant triggers 使用空 `search_path`、禁止 client execute 的 `SECURITY DEFINER`，使 Supabase Auth 內部角色執行外鍵 cascade 時可安全讀取受保護資料表。

## Pet Profile（Phase 3）

- `pets` 不包含單一 `owner_id`；授權以 `pet_members (pet_id, user_id, role)` 建模。每隻 Pet 只有一位 owner，可有多位 member；viewer 暫不使用。
- `create_pet` RPC 從 `auth.uid()` 取得 owner，並在同一 PostgreSQL transaction 建立 Pet 與 owner membership。客戶端不能直接 INSERT `pets` 或 `pet_members`。
- `private.is_pet_member`／`private.is_pet_owner` 是固定空 `search_path` 的最小 SECURITY DEFINER helper，放在非暴露 schema，避免 `pet_members` policy 自我遞迴。
- `pet-avatars` 是 private bucket。物件路徑為 `{uploaderUserId}/{petId}/{uuid}.jpg`；真正存取權由 Storage RLS 根據路徑 Pet ID 查詢 membership 決定。
- Avatar 在裝置上居中裁切、縮放成 1024×1024 JPEG，再以 ArrayBuffer 上傳；顯示使用一小時 signed URL，由 TanStack Query 在有效期內快取。
- Pet 刪除由受 JWT 保護的 `delete-pet` Edge Function重新驗證 owner。Phase 4 後會先清理所有 Post 媒體與 Pet Avatar，再刪除 Pet；資料庫 cascade 只處理 row，不被誤當成 Storage 清理機制。
- Pet server state 只存在 TanStack Query cache；Zustand 只持久化 `currentPetId`。若持久化 ID 不屬於當前使用者，會自動回退到第一隻 Pet 或空值。

## Pet Journal（Phase 4）

- `posts.event_date` 是 date-only 的生活日期；排序固定為 `event_date DESC, created_at DESC, id DESC`，列表以相同三欄組合游標分頁。
- App 以裝置本地 `YYYY-MM-DD` 嚴格阻止未來日期。Supabase 保持官方建議的 UTC；database constraint 允許到 `UTC date + 1`，覆蓋全球 UTC+14 至 UTC−12 的本地「今天」，仍阻止更遠日期。Pet birthday／adoption date 採相同 server bound。
- `posts` 與 `post_media` 的客戶端角色只有 SELECT grant。建立與編輯必須經 RPC；RPC 從 `auth.uid()` 注入作者並在同一 transaction 寫入 Post 及全部有序 Media metadata。
- 發布前先在裝置上按原比例把長邊縮至最多 2048px，輸出 JPEG 0.85；不要求裁切、不讀取 EXIF/GPS。每篇可有 1–9 張圖，也可只有 4,000 字以內文字。
- `post-media` 是 private bucket，path 固定為 `{userId}/{petId}/{postId}/{mediaId}.jpg`。路徑只是結構約束；實際讀寫仍以 `pet_members` owner/member policy 判斷。
- 新增流程先上傳唯一 object paths，再以 `create_post` RPC 原子建立 rows；RPC 失敗會刪除本次上傳。編輯只處理新增圖，保留圖不重新上傳；`update_post` 成功後才清理移除圖，避免失敗破壞原記錄。
- Post 刪除由受 JWT 保護的 `delete-post` Edge Function重新驗證 active membership；作者可刪自己的 Post，Owner 可治理該 Pet 的任意 Post。Owner 仍不能修改他人內容。
- 日記與 signed URL 都是 TanStack Query server state；signed URL 以完整 path 集合批次建立並在有效期內快取，不寫入資料庫或 Zustand。

## Family Sharing（Phase 4.5）

- `pet_invites` 只保存 SHA-256 code hash。八位 Invite Code 由 PostgreSQL `pgcrypto` 產生，固定七日、五次，Join 以 row lock 原子消耗名額。
- Preview 只透過受 JWT 保護的最小白名單 RPC／Edge Function提供 Pet 摘要與短期 Avatar URL，不放寬 Stranger 的 Pet／Storage RLS。
- `get_pet_members` 與 `get_pet_post_authors` 以 batch RPC 提供 display name，避免 Profile policy 放寬及 Post N+1 query。歷史作者名稱同步顯示最新 Profile 名稱。
- Member 可讀共享 Pet/Avatar/Journal，並發布、編輯、刪除自己的 Post；Pet Profile/Avatar、Invite 和 Membership mutation 仍由 Owner 控制。
- 移除 Member 不刪歷史 Post，但撤銷目前 Invite 並即時阻止新 Pet/Post/Media/signed URL access。
- 帳戶刪除採方案 A：作者帳戶刪除時，其 Shared Posts 和 Media 依現有 `ON DELETE CASCADE` 與 Storage cleanup 一併刪除；不改 `posts.author_id`。

## 日期與「那年今日」

日記的生活日期與建立時間分開儲存。生活日期使用可索引的日期／時間欄位，不藏在 JSON 或格式化字串中，使時間線、分頁和未來按月日查詢歷史記錄保持可行。

## Home、Timeline 與 Memories（Phase 5）

- Home 只組合既有 current Pet、Posts、batch authors、Members 與一個最小 Memory candidate RPC；不建立 activity feed table，也不把衍生資料複製到 Zustand。
- `get_pet_memory(pet_id, local_today)` 是 `SECURITY INVOKER`。它先驗證 active membership，再依本地 month/day 找最近歷史 Post；若沒有，才回傳 30 日以前最新 Post。RPC 只回傳 Post ID、種類和相隔年數，完整 Post/Media 仍走既有 RLS query。
- Home pull-to-refresh 只更新 current Pet、current Pet Posts、authors、Members 與 Memory；不刷新 Auth session 或所有無關 Pet。
- Journal 繼續使用 `FlatList`、TanStack Infinite Query 與 `event_date / created_at / id` 組合游標。Year／Month／Day header 是已載入 pages 的輕量衍生 item，不會把全量 Posts 放進 `ScrollView`。
- Timeline 每篇最多簽發前四張 preview signed URLs；五至九張以 `+N` 顯示。Post Detail 才為完整 gallery 建立 URL。
- 切換 Pet 會更換 query key 並 remount `FlatList`，重設 scroll position，避免上一隻 Pet 的內容閃現。
- Chat 在 Phase 5 只有真實定位的 UI placeholder：未建立訊息表、Realtime subscription、輸入框或假訊息。未來邊界是一隻 Pet 一個私密空間，只限 active Owner／Member。

## Family Care Logs（Phase 6）

- `care_logs` 是已完成照顧的獨立事實表，不使用 `posts`、`post_media`、Storage，也不預先建立 Reminder／Task／Chat 模型。
- `occurred_at` 保存真實時間點，`time_zone` 保存當時有效的 IANA 時區，`local_date` 由受信任 RPC 在 server 端衍生，支援 Today 查詢與跨午夜分組。
- authenticated client 只有 SELECT／DELETE table grants。建立與編輯必須經 RPC；`performed_by` 永遠由 `auth.uid()` 注入，Pet、Type、執行者不可在 edit 時變更。
- Active Owner／Member 可讀並建立；只有執行者可編輯自己的記錄。執行者或 Owner 可刪除，Owner 不可改寫 Member 原始內容。
- 移除 Member 會立即阻止新存取但保留歷史 Care；刪除 Member 帳戶會 cascade 其記錄，刪除 Pet 會 cascade 全部 Care。
- Home Today Care 與 Care History 都以 current Pet 的 TanStack Query key 隔離。History 使用 `occurred_at / id` 組合游標與 `FlatList`，執行者名稱以 batch RPC 載入，避免 N+1。

## Family Reminders + Care Tasks（Phase 7）

- `care_tasks` 是家庭共享的未來行動；`care_task_completions` 是某次 occurrence 的完成證據；既有 `care_logs` 繼續只保存已完成的照顧事實。Task 狀態不塞入 Care Log。
- 排程支援 once／daily／weekly／monthly，保存固定 IANA 時區與 wall-clock 欄位。Occurrence 由有界 RPC 計算，不預先無限展開 rows；每月不存在的日期跳過，DST gap 不產生虛假 occurrence。
- Task／Completion 表對 authenticated 只有 SELECT。建立、編輯、停用、完成和 Undo 全經 server-bound RPC；Creator／Owner mutation、active family read／complete 與 Stranger isolation 都由資料庫重新驗證。
- 完成 RPC 鎖定 Task，以 `(task_id, scheduled_for)` unique constraint 保證並發冪等，並在同一 transaction 建立一個 Completion 與一個 Care Log。Undo transaction 刪除 linked Care Log 及 cascade Completion。
- 遠端 Task 是唯一事實來源；`expo-notifications` 只建立 best-effort 裝置本地通知。未建立 Push Token、APNs／FCM、Expo Push Service、Realtime 或背景 remote notification。
- 本機 SQLite 保存 notification identifier mapping。登入、foreground、Task／membership／Pet mutation 會同步未來 30 天、最多 48 個 occurrence；登出清空該帳戶本機排程。通知失敗永不回滾遠端 Task。
- Notification payload 只含最小 route IDs，點擊後仍經 Auth guard、Pet membership 與 RLS 授權。其他裝置變更要等本機下一次 sync 才取消舊通知，這是純 local 架構的已知限制。

## Production Readiness（Phase 8）

- 根 route 匯出 Expo Router Error Boundary。Production 顯示無 stack 的品牌錯誤頁；`logError()` 只保留經截斷／遮罩的 context、錯誤名稱、code 和 status，不記錄 URL、email、user ID、token、密碼或 request payload。
- NetInfo 直接驅動 TanStack `onlineManager`。離線只顯示輕量 banner，已載入 query cache 可繼續閱讀；mutation 不排離線 queue，失敗內容由各表單保留以供重試。
- Query 預設 `staleTime` 30 秒、`gcTime` 5 分鐘、一次 retry、重新連線 refetch；相片 signed URL query 使用 50 分鐘 stale time／1 小時 GC。`expo-image` 使用 memory-disk cache，403／過期顯示時以每分鐘最多一次重新簽發避免 retry loop。
- Journal 與 Care History 使用 Infinite Query、組合游標及 `FlatList` window/batch 控制；Home 只渲染近期小集合。
- 正常成功使用非阻塞 feedback；破壞性操作仍使用確認 Alert。表單 mutation 維持 loading／disabled／錯誤內容保留。
- App 強制 Light、Portrait，正式 identity 是 HomeyPaw／`com.zhushunli.pawday`／1.0.0 (1)。Chat 在 1.0 隱藏；沒有 Realtime、remote push、analytics、tracking 或 crash SaaS。

## 原生工程

專案採 Expo Continuous Native Generation。`ios/` 與 `android/` 由 app config 生成且不提交；原生權限說明、bundle identifier、版本、build number、正式 Icon／Splash 和 Android Adaptive Icon 均由 `app.json` 集中配置。`eas.json` 只準備本機 profiles，不代表已建立遠端 EAS project 或 Apple 資源。

## 品質門檻

每個 Phase 至少通過：

```bash
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
```

涉及互動或原生能力時，再加入對應測試及 iOS Simulator／真機驗證。

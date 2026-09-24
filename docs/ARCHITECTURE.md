# HomeyPaw Architecture

## Product and Release Boundary

HomeyPaw 是以家庭協作為核心的私人寵物照顧 App。資料模型的主要邊界是 **1 Pet = 1 Family Space**：一隻 Pet 與其 `pet_members` 共同界定 Journal、Care、Reminder、Schedule、Chat、Health 與 Remote Push 的存取範圍。

目前正式 identity：

- App：HomeyPaw
- Bundle Identifier：`com.zhushunli.homeypaw`
- Deep Link Scheme：`pawday://`
- App Store Production：`1.1.1 (5)` 已發布（圖片快取修復）
- iOS：iPhone／iPad，Light appearance、portrait

`pawday://` 與少量 `PAWDAY_*` 測試環境變數名稱屬歷史相容識別，不是使用者可見品牌。

## Application Boundaries

- `src/app`：Expo Router routes、protected navigation 與 layouts。
- `src/features`：Auth、Pets、Family、Journal、Care、Reminder、Schedule、Chat、Health 等業務功能。
- `src/components`：跨 feature 的共用 UI。
- `src/hooks`：跨 feature hooks。
- `src/lib`：Supabase、TanStack Query、i18next 等初始化與薄封裝。
- `src/services`：相片、通知和外部服務邊界。
- `src/stores`：少量 user-scoped client state；不複製 server state。
- `src/i18n`：`zh-HK` 預設並同步維護 English keys。
- `src/theme`：色彩、間距、圓角與字體 tokens。

表單使用 React Hook Form + Zod。資料庫 constraints、RLS 與受限制 RPC 是最終資料與授權邊界。

## Client State and SWR

TanStack Query 管理所有 server state，並以 user／Pet／feature 組成 query key。已快取內容可在背景 refetch、短暫離線或 Realtime reconnect 時繼續顯示；錯誤與 refresh state 不應把既有內容替換成永久 spinner。

Zustand 只保存少量 UI state。Active Pet 按 user scope 持久化；登入帳戶改變、Pet 不再可見或 Member 被移除時，会清除失效 selection、撤銷相關 query cache／本機通知，並回退至另一個可用 Pet 或 no-family state。冷啟動不得恢復 revoked Pet。

## Authentication and Account Lifecycle

- Supabase Session 是登入狀態唯一來源，不複製 token 到 Zustand。
- Expo Router protected routes 在 session restore 前維持 loading，避免私人畫面或 Sign In 閃現。
- Email confirmation 與 Password recovery 使用 `pawday://check-email`、`pawday://reset-password`；callback URL／token 不寫入 log。
- Profile 保存 display name、locale 與私人 avatar reference。
- App 內刪除帳戶呼叫 JWT-protected `delete-account` Edge Function。管理密鑰只存在伺服器端；客戶端失敗時不假裝刪除成功。

## Security Model

- Private by default：只有 active Owner／Member 可存取 Family Space。
- 所有私人 public tables、RPC 與 Storage paths 都受 RLS／grants 約束；`private` schema 的 queue、topic 與 device tables不向 client 暴露。
- Owner 管理 Pet、邀請與 Member；Member 只在產品允許的範圍貢獻內容。
- Removed Member 是跨資料、Storage、Realtime、Push、active Pet 與 cache 的安全邊界。
- 私人相片存放於 non-public buckets，使用短期 signed URL 顯示。
- Client 只使用 Supabase publishable key；`service_role`／secret、資料庫密碼與第三方 credentials 只存在受信任的 server environment。
- 所有 schema、policy、trigger 與 RPC 變更都必須由 versioned migration 管理。

## Pet and Family Space

- `pets` + `pet_members` 是家庭權限的 canonical model；每隻 Pet 一位 Owner，可有受全域上限限制的 Members。
- `create_pet`、邀請、加入家庭、移除 Member 與 Pet deletion 都在 server boundary 重新驗證 caller。
- 邀請碼有期限和使用上限，資料庫只保存 hash。
- Removed Member 的歷史內容可留給仍有權限的家庭，但被移除帳戶不能继续讀取或写入该 Pet 的任何資料。

## Journal and Private Storage

- `posts` 與 `post_media` 保存文字／1–9 張相片日記；排序與分頁使用穩定組合 cursor。
- 相片先在裝置壓縮，再寫入 private Storage；object path 只提供結構，真正權限仍由 membership RLS 判斷。
- Full-screen Photo Viewer 和儲存相片只使用當前授權取得的短期 signed URL。
- Home／Journal／Memories 使用 TanStack Query；Pet rotation 或 revoke 時不顯示上一個 Pet 的 cache。

## Care, Health and Reminder

- `care_logs` 是已完成照顧的事實記錄，支援 feeding、walking、medication、grooming、play 與 other。
- `care_tasks` 是家庭共享的未來行動；`care_task_completions` 保存 occurrence completion，並可原子建立對應 Care Log。
- Reminder 支援 once／daily／weekly／monthly／yearly、固定 IANA time zone 與本機 notification mapping。
- Birthday 使用 Health/Birthday semantics 與 yearly recurrence；DST gap／overlap 和不存在的日期由受限 occurrence 計算處理。
- Complete／Undo、Care Log integration 與 local notification sync 都以 remote task 作為 canonical source。

## Family Care Schedule

- `care_shifts` 表示某 Pet 在某日的照顧者安排；同一天可有多位照顧者。
- `care_shift_tasks` 將排班與具體 Care Task occurrence 連結，不另外複製 Task 定義。
- Owner 可管理全家庭排班；Member 只可 claim 或安排自己。
- Claim、complete、cancel 與 canceled occurrence rescheduling 都經 server-bound RPC／transaction 驗證。
- Occurrence identity 保留原排程語義；重新安排已取消 occurrence 时不把舊 completion 或 cancellation 誤套到新 occurrence。

## Secure Family Chat

- `chat_messages` 是 PostgreSQL canonical source；訊息、編輯、刪除和 read state 由 RLS／RPC 控制。
- Supabase Realtime 使用 authenticated private Broadcast，只傳送最小 invalidation hint。Client 收到事件後仍經 RLS 重新讀取資料，再合併至 TanStack Query cache。
- 每個 Pet 有可旋轉的 private topic version。Membership 改變會旋轉 topic；client 同時維護 user-scoped control channel，並在 active Pet、session 或 access 改變時 unsubscribe／remove channel。
- Unread badge 以 server read state 與可見訊息 cursor 計算；cached Chat 可在 SWR reconnect 中繼續顯示。
- Removed Member 的舊 socket、重新連線與後續訊息讀取都必须失敗。
- Chat 現階段只支援文字，不發送系統 Push Notifications。

## Family Remote Push

- Journal、Care、Health 與 Reminder mutation 產生 private outbox event；Chat 不進入 Push pipeline。
- `private.push_devices` 保存 user-scoped installation／Expo push token；outbox 與 delivery rows 不向 client 開放。
- Worker claim event 後在伺服器端重新計算有效收件人：actor self 不收、Removed Member 不收、disabled／invalid token 不收。
- Notification copy 不包含 Journal／Chat／Health 私人正文。
- Delivery 支援 lease、retry、ticket／receipt lifecycle、invalid-token disable 與 TTL。過期 backlog 會標記 expired，不補送陳舊家庭活動。
- `family-push` Edge Function 與資料庫 RPC 的 service-role 權限保持 server-only。

## Native and Release Configuration

專案使用 Expo Continuous Native Generation；`ios/` 與 `android/` 由 app config 產生且不提交。`app.json` 保存正式名稱、Bundle Identifier、scheme、version/build、Icon、Splash、permissions 與 tablet support；`eas.json` 定義 development、development-simulator、preview 和 production profiles。

Production backend override 的 client gate 必須同時满足 `__DEV__` 與 loopback hostname（`localhost`／`127.0.0.1`），確保 production build 不會被導向本機 backend。

## Quality Gate

每個 release candidate 至少通過：

```bash
npm run typecheck
npm run lint
npm run format:check
npm run verify:i18n
git diff --check
```

再按变更范围执行 feature verifier、RLS／Edge lifecycle regression、credential scan、iPhone／iPad 和多帳戶真機驗收。Production migration、Edge deployment、EAS build、TestFlight upload 與 App Store Review 均是獨立且顯式的 release operation。

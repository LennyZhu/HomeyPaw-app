# Supabase Setup and Operations

HomeyPaw 的 Production Supabase 已上線。本文同時記錄可重複的 local setup、versioned migration／Edge Function workflow，以及 Production 操作邊界；「已上線」不代表任何本機指令可以自動修改 Production。

## Security Boundary

Expo client 只能使用：

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SB_PUBLISHABLE_KEY
```

所有 `EXPO_PUBLIC_*` 都會進入 client bundle。不得放入 secret／legacy `service_role` key、資料庫密碼、Vault secret、Expo Access Token 或 Apple credential。

`.env.local` 必須保持 Git ignored。任何實際 Project URL／key 都不得寫入本文或 commit。

## Local Development

安裝依賴並建立本機環境：

```bash
npm install
cp .env.example .env.local
npx supabase start
npx supabase status
```

停止本機 stack：

```bash
npx supabase stop
```

`npx supabase start`／`status`／`stop` 只管理 local Supabase。Verifier 的 local backend override 必須同时满足：

1. `__DEV__` 為 true；
2. hostname 是 `localhost` 或 `127.0.0.1`。

Production build 不得接受任意 LAN／remote URL 作為 local backend。本機測試不會自動指向 Production。

## Email Auth and Redirect URLs

在 **Authentication → Providers → Email** 啟用 Email provider，按環境決定是否要求 confirmation。Production redirect allow-list 的目前基線包含：

```text
pawday://check-email
pawday://reset-password
```

App 支援 PKCE／implicit callback、Email confirmation、Password recovery、設定新密碼與完成後 session cleanup。Callback URL、access token、refresh token 和原始 Supabase error 不得寫入 log。

## Versioned Migrations

`supabase/migrations/` 是 schema、RLS、grants、trigger 與 RPC 的唯一版本來源。目前 repository migration baseline 由 profiles 开始，並涵蓋：

- Pet／Family Space、Journal、private Storage policy 與 Care。
- Reminder／Care Task recurrence。
- Secure Family Chat 與 private Realtime policy。
- Family Care Schedule。
- Profile avatar、家庭成員上限。
- Health／Birthday／Yearly recurrence。
- Family Remote Push、server-only Edge ACL、Schedule rescheduling 與 Push TTL。

Production release record 已確認 migrations 部署完成。後續變更必须先在 local stack 驗證，再由 release operator 顯式執行：

```bash
npx supabase db reset
npx supabase db lint
npx supabase migration list --local
```

Production dry run／deploy 是獨立操作，不得由一般 test script 呼叫：

```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run
npx supabase db push
```

執行前必須核對 linked project、migration list、reviewed SQL、備份／rollback plan 與 release 授權。不要在 Table Editor 手動建立替代 schema；所有變更必须回到 versioned migration。

## Edge Functions

目前 repository 包含：

- `delete-account`
- `delete-pet`
- `delete-post`
- `preview-pet-invite`
- `family-push`

本機 serve／驗證：

```bash
npx supabase functions serve <FUNCTION_NAME>
```

Production deployment 必須显式執行：

```bash
npx supabase functions deploy <FUNCTION_NAME>
```

Functions 從受信任的 server environment 取得 Supabase secret／service-role credential。Client 不得傳入要冒充的 user ID，也不得取得管理 key。JWT、caller membership、Pet ownership 和 source row 必須在 server boundary 重新驗證。

## Storage

- `pet-avatars`、`post-media` 與 Profile avatar storage 都是 private。
- Object path 只是結構限制；真正讀寫權限由 Storage RLS 及 active membership 驗證。
- Client 顯示媒體時使用短期 signed URL，不把 signed URL 寫入資料庫或持久 client store。
- Pet／Post／Account deletion 的 Edge Function 先完成必要 object cleanup，再刪除 canonical rows。

Production bucket 与 policy 已作为当前 release baseline 配置完成。新增 bucket、改 public/private 狀態或修改 policy 仍需獨立 review 和 deployment。

## Private Realtime

Chat 使用 authenticated private Broadcast，不使用 public channel。Production Realtime private mode 已納入当前 baseline：

- `chat_messages` 仍是 PostgreSQL canonical source。
- Broadcast payload 只包含最小 invalidation identifiers。
- Client 收到事件後必須透過 RLS 重新讀取 canonical row。
- Membership 變更旋轉 Pet topic；Removed Member 的舊 channel 和 reconnect 都不得收到後續事件。

## Family Remote Push

Push device、outbox 和 delivery tables 位於 private schema。Client 只能透過受限 RPC 註冊／停用自己的 installation；收件人、membership、self-exclusion、TTL 和 delivery lifecycle 由 server-side workflow 決定。

Production baseline 已包含 `family-push` worker 与 APNs／Expo Push configuration。本文件不記錄 token、Vault secret 或 provider credential。

## RLS and Lifecycle Verification

在 disposable local／test users 上驗證：

- Owner／Member／Stranger 的 Pet、Journal、Care、Reminder、Schedule、Chat、Health 隔離。
- Member 不能執行 Owner-only mutation。
- Removed Member 立即失去 row、Storage、Realtime 和後續 Push 存取權。
- Direct table writes、sender spoof、cross-Pet IDs 和 service-only RPC 都被拒絕。
- Pet／Post／Account deletion 不留下 orphan rows 或 private Storage objects。
- Push actor self、Removed Member、disabled token 與 expired backlog 不產生 delivery。

Repository 的 `scripts/verify-*.mjs` 是 verifier 入口。Credentialed tests 只從 shell 讀取臨時帳戶，完成後立即清理；不得把 fixtures、密碼或 token 寫入 Git。

## Production Checklist

任何 Production migration／deploy 前必须確認：

1. 当前 Git commit 与 migration list 已审阅。
2. Local reset、lint、feature verifier 与 RLS regression PASS。
3. Linked project 明確是預期 Production project。
4. 不包含 destructive SQL、secret 或測試 fixture。
5. 已取得本次 Production 操作授權。
6. 執行後以 read-only 查询确认 migration／function version 与 health。

文件更新、一般 lint、Expo test 或 local Supabase test 都不得隐式触发任何 Production mutation。

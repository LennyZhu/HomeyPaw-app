# Supabase Setup and Phase 2 Verification

本文件的 Expo 客戶端只使用 Supabase Project URL 和 publishable key。secret／`service_role` key 與資料庫密碼絕不可寫入 Expo `.env`、程式碼或 Git。

## 1. 建立 Supabase Project

1. 打開 [Supabase Dashboard](https://supabase.com/dashboard)，建立一個開發／測試 Project。
2. 等待 Project provisioning 完成。
3. 打開 **Connect** 或 **Project Settings → API**。
4. 複製 **Project URL**。
5. 複製 **Publishable key**（`sb_publishable_...`）。不要複製 Secret key、legacy `service_role` key 或資料庫密碼。

## 2. 設定本機環境

在專案根目錄執行：

```bash
cp .env.example .env.local
```

填寫：

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SB_PUBLISHABLE_KEY
```

儲存後完全停止並重新啟動 Expo。`.env.local` 已被 `.gitignore` 排除；仍應在 commit 前執行密鑰掃描。

## 3. Email Auth 設定

1. Dashboard 打開 **Authentication → Providers → Email**。
2. 保持 Email provider 啟用。
3. 決定是否要求 Email confirmation：
   - 啟用：註冊後 App 顯示「檢查你的電郵」，不假設使用者已登入。
   - 停用：Supabase 可在註冊後直接回傳 session，Router 會進入私人 Tabs。
4. 開發階段確認 email rate limit 足以完成測試，但不要把 production rate limit 設成無限制。
5. Dashboard 的 **URL Configuration** 設定真實可控的 Site URL，並保留 `pawday://**`（或分別加入 `pawday://check-email`、`pawday://reset-password`）作為 mobile callback allow-list。App 已支援 PKCE／implicit callback、token exchange 與設定新密碼畫面；正式發佈前仍須在真機完成寄信、回跳、改密碼和舊密碼失效驗收。

## 4. 部署 Migration

Schema 唯一來源是：

```text
supabase/migrations/20260822150000_create_profiles.sql
```

推薦使用專案範圍的 Supabase CLI，不需全域安裝：

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push --dry-run
npx supabase@latest db push
```

如果 npm 的 CLI 二進制套件暫時無法取得，可依 Supabase 官方指引使用 Homebrew CLI，再執行相同的 `link`、`db push --dry-run` 和 `db push`。不要改成只在 Table Editor 手動建表；migration 必須繼續留在 Git。

部署後在 Dashboard 確認：

- `public.profiles` 已存在。
- `id` 是指向 `auth.users.id`、`ON DELETE CASCADE` 的 primary key。
- RLS 已啟用。
- 只有「本人 SELECT」和「本人 UPDATE」兩條 policy；沒有 `using (true)`。
- `anon` 沒有 table 權限；`authenticated` 只有 SELECT 和指定 Profile 欄位的 UPDATE 權限。
- `on_auth_user_created` trigger 已存在。

## 5. 部署 Account Deletion Edge Function

函數來源：

```text
supabase/functions/delete-account/index.ts
```

部署：

```bash
npx supabase@latest functions deploy delete-account
```

`supabase/config.toml` 保持 `verify_jwt = true`。Supabase hosted functions 自動提供 `SUPABASE_SECRET_KEYS`／legacy `SUPABASE_SERVICE_ROLE_KEY`；不要把它們複製到 App。函數會再次驗證 caller JWT，從 JWT 取得 user ID，並只刪除該使用者。

## 6. 啟動 App

```bash
nvm use 22.13.0
npm install
npm start
```

修改 `.env.local` 後必須重啟 Metro，Hot Reload 不足以重新載入環境變數。

## 7. Manual Test Checklist

### Sign Up

- [ ] 暱稱空白會顯示本地化錯誤。
- [ ] Invalid email 不會提交。
- [ ] 少於 8 個字元的密碼不會提交。
- [ ] Password confirmation 不一致不會提交。
- [ ] 連續點擊只產生一次請求，送出期間按鈕 disabled/loading。
- [ ] Email confirmation 開啟時顯示「檢查你的電郵」，沒有 session，也無法進 Tabs。
- [ ] Email confirmation 關閉時，成功註冊後直接進 Tabs。
- [ ] `auth.users` 新增使用者後，自動存在相同 ID 的 `public.profiles` row。

### Login and Errors

- [ ] 正確電郵和密碼可登入。
- [ ] 錯誤密碼只顯示安全、泛化的本地化訊息，不暴露原始後端內容。
- [ ] 中斷網絡後顯示 network／generic error，App 不崩潰。
- [ ] 「忘記密碼」可發送 email，成功提示不洩漏該 email 是否已註冊。

### Session

- [ ] 登入後 kill App。
- [ ] 重新開啟 App 時保持登入。
- [ ] Session restore 期間只見 Splash／Loading，不會先閃出登入頁。
- [ ] App 從 background 回 foreground 後 token refresh 正常。
- [ ] 登出確認後 session 清除，無法透過 back gesture 或 deep link 回到 Tabs。

### Profile

- [ ] 「我的」顯示真實 display name 和 Auth email，不再顯示 Mock Lenny。
- [ ] 修改 display name 後重新開啟 App 仍保留。
- [ ] 切換 `zh-HK`／`en` 後 UI 立即更新，重新登入後從 `profiles.locale` 恢復。
- [ ] 未連線或 query 失敗時顯示 loading/error/retry。

### Authorization — 必須使用 User A 和 User B

1. 建立 User A、User B，記下兩者 UUID。
2. 以 User A 登入 App。
3. 使用同一個 User A session 執行對 `profiles` 的查詢，條件指定 User B UUID；結果必須是空集合。
4. 使用 User A session 嘗試 update User B Profile；受影響 row 必須為 0，User B 資料不可改變。
5. User A 必須仍可 SELECT 和 UPDATE 自己的 Profile。
6. 未登入 client 查詢 `profiles` 必須收到 permission/RLS failure，不能取得任何 row。

也可以在測試 Project 的 SQL Editor 以 transaction 模擬 User A；完成後必須 rollback：

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'USER_A_UUID', 'role', 'authenticated')::text,
  true
);

select * from public.profiles where id = 'USER_B_UUID';
update public.profiles
set display_name = 'must not change'
where id = 'USER_B_UUID';
rollback;
```

第一個查詢必須回傳 0 rows，UPDATE 必須影響 0 rows。

### Account Deletion

- [ ] 「設定／帳戶與安全／刪除帳戶」清楚標示不可復原。
- [ ] 取消第一或第二次確認不會發送請求。
- [ ] 成功後 Auth user 已刪除。
- [ ] 對應 Profile 因 `ON DELETE CASCADE` 已刪除。
- [ ] 本機 session 已清除，不能返回 Tabs。
- [ ] 使用舊 access/refresh token 不能重新取得私人資料。
- [ ] User A 呼叫函數永遠不能指定或刪除 User B；request body 不接受 user ID。

## 8. Release Blockers

- Password reset 已包含 `pawday://reset-password` callback、PKCE／implicit token exchange、設定新密碼 UI，以及完成後本機登出。真機端到端測試仍是 TestFlight 前的必要門檻。
- Phase 3 加入 Storage 前，帳戶刪除函數必須先刪除該使用者擁有的 Storage objects，因為擁有 Storage objects 的 Auth User 可能無法直接刪除。

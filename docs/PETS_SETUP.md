# Phase 3 Pet Profile Setup and Verification

Phase 3 使用 `pets`、`pet_members`、private `pet-avatars` bucket、Postgres RLS 和受 JWT 保護的 `delete-pet` Edge Function。Expo 客戶端仍只使用 Project URL 與 Publishable Key。

## Schema and deployment

Schema 唯一來源：

```text
supabase/migrations/20260823090000_create_pets.sql
```

部署順序：

```bash
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy delete-pet
npx supabase functions deploy delete-account
npx supabase functions deploy delete-post
npx supabase db lint --linked --level warning
```

`delete-account` 需要在 Auth User 刪除前清理 private pet avatars 和 owner pets。兩個 Edge Functions 都必須保持 `verify_jwt = true`。

## Security invariants

- `pets`、`pet_members` 均啟用 RLS。
- `anon` 沒有 table grants。
- `authenticated` 不能直接 INSERT `pets` 或 INSERT／UPDATE／DELETE `pet_members`。
- `create_pet` RPC 不接受 owner ID，只使用 `auth.uid()`，並原子建立 Pet 與 owner membership。
- Owner 可 SELECT／UPDATE／DELETE 自己的 Pet；非 member 不可看見 row。
- `pet-avatars` 必須保持 private；bucket private 不取代 Storage RLS。
- Storage path 必須為 `{userId}/{petId}/{uuid}.{ext}`；INSERT 同時驗證第一段為 caller user ID，以及第二段 Pet ID 屬於 caller owner。
- 讀取 private avatar 使用短期 signed URL，不使用 public URL。

## Real two-user verification

先建立並確認兩個真實測試帳戶，然後只在目前 Terminal session 設定臨時 credentials：

```bash
export PAWDAY_RLS_USER_A_EMAIL='...'
export PAWDAY_RLS_USER_A_PASSWORD='...'
export PAWDAY_RLS_USER_B_EMAIL='...'
export PAWDAY_RLS_USER_B_PASSWORD='...'
node scripts/verify-pets-rls.mjs
unset PAWDAY_RLS_USER_A_EMAIL PAWDAY_RLS_USER_A_PASSWORD
unset PAWDAY_RLS_USER_B_EMAIL PAWDAY_RLS_USER_B_PASSWORD
```

腳本不輸出 email、password、UUID 或 token，會建立並清理一隻臨時 Pet 與一個 1×1 PNG，驗證：

- User A 原子建立、讀取、更新自己的 Pet。
- User B 不能讀取、更新或刪除 User A Pet。
- User B 不能偽造 `pet_members`。
- User A 可上傳、讀取 Avatar。
- User B 不能讀取、覆蓋或刪除 User A Avatar。
- `delete-pet` 後 Pet、membership 與 Avatar 均不可再存取。

## Manual product verification

- 無 Pet：首頁與「我的毛孩」顯示 Empty State，不顯示 Mock Pet。
- 建立豆豆：狗狗／柴犬／女生，填寫生日、到家日與體重，選擇 Avatar。
- 首頁：顯示真實資料、正確年齡與從到家日開始（到家當天為第 1 天）的陪伴日數。
- 建立第二隻 Pet，從首頁完整 Pet row 開啟 switcher 並切換。
- 編輯 name、breed、weight、avatar；重新整理與重新開啟 App 後仍保留。
- 刪除第二隻 Pet；確認列表、首頁選擇與 Storage 均更新。
- iOS Simulator 拒絕相片權限時顯示本地化錯誤；允許後可重新選擇。

Phase 4 起，`delete-pet` 會在刪除 Pet 前一併清理它的 Journal media；相關部署與驗證見 `docs/POSTS_SETUP.md`。

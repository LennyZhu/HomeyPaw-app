# Phase 4 Pet Journal Setup and Verification

Phase 4 使用 `posts`、`post_media`、private `post-media` bucket、Postgres RLS/RPC，以及受 JWT 保護的 `delete-post` Edge Function。Expo 客戶端仍只使用 Project URL 與 Publishable Key。

## Schema and deployment

基礎 schema migration：

```text
supabase/migrations/20260823150000_create_posts.sql
```

Family Sharing 會在後續 migration 擴充 author/member policy；`20260824001000_fix_local_today_date_constraints.sql` 使 date-only 欄位支援全球本地「今天」，不改變資料庫 UTC 設定。

部署順序：

```bash
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy delete-post
npx supabase functions deploy delete-pet
npx supabase functions deploy delete-account
npx supabase db lint --linked --level warning
```

三個 Edge Functions 都必須維持 `verify_jwt = true`。

## Security invariants

- `posts`、`post_media` 啟用 RLS；`anon` 無 grants，`authenticated` 只有 SELECT。
- `create_post`／`update_post` 不接受 author ID，並以 `auth.uid()` 與 active owner／member membership 驗證 mutation；只有作者可以更新內容。
- Post 必須含非空文字或至少一張圖；內容最多 4,000 字，每篇最多九張圖且 position 唯一。
- `post-media` 保持 private。固定四段 path 不取代 membership policy；作者可以管理自己的 object，Owner 可在刪除 Member Post 時清理媒體，其他 Member 不可修改；沒有 UPDATE policy。
- 刪除 Post、Pet、Account 都先清理相應 Storage objects，再刪除生命週期根 row。

## Real two-user verification

只在目前 Terminal session 設定臨時 credentials：

```bash
export PAWDAY_RLS_USER_A_EMAIL='...'
export PAWDAY_RLS_USER_A_PASSWORD='...'
export PAWDAY_RLS_USER_B_EMAIL='...'
export PAWDAY_RLS_USER_B_PASSWORD='...'
node scripts/verify-posts-rls.mjs
unset PAWDAY_RLS_USER_A_EMAIL PAWDAY_RLS_USER_A_PASSWORD
unset PAWDAY_RLS_USER_B_EMAIL PAWDAY_RLS_USER_B_PASSWORD
```

腳本不輸出 email、password、UUID 或 token；它驗證 owner RPC、作者防偽造、跨使用者 DB/Storage 隔離、受控發布失敗 cleanup、Post/Media/Object 刪除，並在 `finally` 清理臨時資料。

## Manual product verification

- 分別發布 1、2、5、9 張真實相片；確認比例、順序、文字、日期、單一 tag 和可選地點。
- 模擬拒絕及 limited Photos permission；確認可重試與開啟設定。
- 編輯文字、增加／移除圖片及用左右按鈕 reorder；未更改圖片不重新上傳。
- Kill/reopen App，切換 Pet，確認 current-pet Journal 隔離與 session restore。
- 全螢幕看圖，刪除 Post，確認 Post、Media row 和 object 全部消失。
- 建立帶 Post 的臨時 Pet 與臨時帳戶，分別驗證 Pet delete 及 Account delete 不留下 Storage orphan。

Phase 4 不包含公開社群、留言、按讚、追蹤、影片、GPS／地圖或 Phase 5 首頁時間線。

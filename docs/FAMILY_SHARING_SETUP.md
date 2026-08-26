# Phase 4.5 Family Sharing Setup and Verification

Phase 4.5 以既有 `pet_members` 作為唯一共享邊界，正式啟用 `owner`／`member`。沒有新增 Household，也沒有把角色放進 JWT、Profile metadata 或 Zustand。

## Deployment

```bash
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy preview-pet-invite
npx supabase functions deploy delete-post
npx supabase functions deploy delete-account
npx supabase db lint --linked --level warning
npx supabase migration list
```

`preview-pet-invite`、`delete-post`、`delete-pet`、`delete-account` 必須保持 `verify_jwt = true`。

## Invite security

- PostgreSQL 以 `pgcrypto` 產生八位、40-bit 有效 entropy 的不易混淆代碼；不使用 `Math.random()`。
- `pet_invites` 只保存正規化代碼的 SHA-256 hash，不保存明文。
- 每個 Pet 同時最多一個未撤銷 Invite；重新產生會撤銷舊 Invite，建立操作有 10 秒基本 rate limit。
- 固定七日過期、最多使用五次。Join RPC 對 Invite row 加鎖，在同一 transaction 建立 member 並遞增 `used_count`。
- 無效、過期、撤銷和已滿 Invite 對外統一為「無效或已失效」，避免 enumeration。
- Preview Edge Function 只回傳 Pet name/species/breed、Inviter display name 和五分鐘 Avatar signed URL，不回傳 Pet ID、Owner ID 或 email。
- Invite hash 欄位沒有 client SELECT grant；所有 table mutation 只經受控 RPC。

## Permission model

- Owner：管理 Pet、Invite、Member；可刪除該 Pet 的任意 Post，但只能編輯自己的 Post。
- Member：讀取 Pet、Member list、Avatar、全部 Journal；可建立、編輯及刪除自己的 Post/Media。
- Stranger：除持有有效 Invite 時的最小 Preview 外，不能讀取 Pet、Members、Posts、Media 或建立 Membership。
- Owner 移除 Member 時會同時撤銷目前 Invite，避免被移除者立即重用舊碼；歷史 Post 保留。
- 被移除 Member 不能重新取得 signed URL。已簽發 URL 在最多一小時 TTL 內仍可能有效，屬 signed URL 的預期特性。

## Account deletion decision

採用方案 A，保持 `posts.author_id NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`：

- 移除 Member：保留歷史 Shared Posts。
- Member 主動刪除 Account：刪除其 Shared Posts、Post Media rows 和 Storage objects。
- Owner 刪除 Account：刪除 owned Pets 及其 Members、Invites、Posts、Media、Avatars 和 Storage data。
- `validate_pet_keeps_owner` 與 `validate_post_has_content_or_media` 以固定空 `search_path` 的受限 `SECURITY DEFINER` constraint trigger 執行，讓 Supabase Auth 的 `ON DELETE CASCADE` 能檢查 invariant；client roles 沒有直接 execute grant。

## Three-user verification

使用三個已確認 email 的臨時帳戶，只在目前 Terminal session 輸入 credentials：

```bash
export PAWDAY_FAMILY_OWNER_EMAIL='...'
export PAWDAY_FAMILY_OWNER_PASSWORD='...'
export PAWDAY_FAMILY_MEMBER_EMAIL='...'
export PAWDAY_FAMILY_MEMBER_PASSWORD='...'
export PAWDAY_FAMILY_STRANGER_EMAIL='...'
export PAWDAY_FAMILY_STRANGER_PASSWORD='...'
node scripts/verify-family-sharing-rls.mjs
unset PAWDAY_FAMILY_OWNER_EMAIL PAWDAY_FAMILY_OWNER_PASSWORD
unset PAWDAY_FAMILY_MEMBER_EMAIL PAWDAY_FAMILY_MEMBER_PASSWORD
unset PAWDAY_FAMILY_STRANGER_EMAIL PAWDAY_FAMILY_STRANGER_PASSWORD
```

腳本不輸出 email、password、user ID、token 或 Invite Code，並在 `finally` 清理臨時 Pet。

過期、滿額與最後名額並發使用受獨立腳本驗證：

```bash
node scripts/verify-family-invite-lifecycle.mjs
```

腳本把明文 Invite Code 只保留在目前 Node process 記憶體，等待 SQL Editor 將兩筆有明確名稱的臨時 fixture 設為 expired／`max_uses = 1`，再同時發出 Member／Stranger Join。完成或失敗都會嘗試刪除臨時 Pets；不列印 code、身份或 token。

## Manual lifecycle checks

- 由 lifecycle 腳本建立具明確名稱的 fixture，在 SQL Editor 只修改這兩筆臨時 Invite 的 expiry／max uses；驗證完成後腳本刪除臨時 Pet，Invite 應 cascade 清除。
- Owner 產生、複製、分享與撤銷 Invite；Owner 重用回傳 `already_member`。
- Member Preview、Join、Pet switch、共享 Journal 發布／編輯／刪除和 Avatar read。
- Owner 查看 Member 作者、刪除 Member Post、移除 Member。
- Member 不重新登入，刷新後立即失去 Pet/Posts/新 signed URL/Create Post 權限。
- Stranger 即使知道 Pet ID、Post ID 和 Storage path，也沒有資料存取權。

Phase 4.5 不包含 Household、ownership transfer、Deep Link、Push Notification、照顧打卡、健康記錄或公共社群。

# Phase 6 — Family Care Logs Setup

Phase 6 建立獨立的「已完成照顧」資料流。Care Logs 不是 Journal Posts，也不是未來的 Reminder／Task；不包含相片或 Storage 物件。

## Migration

本階段只有一個 migration：

```text
20260824120000_create_care_logs.sql
```

先只做 dry run：

```bash
npx supabase db push --dry-run
```

確認只列出上述 migration 後，才執行真實 push。Push 完成後執行：

```bash
npx supabase db lint --linked --level warning
npx supabase migration list
```

## Security model

- `care_logs` 對 authenticated 只授予 `SELECT`、`DELETE`；沒有直接 `INSERT`／`UPDATE`。
- `create_care_log` 固定從 `auth.uid()` 寫入 `performed_by`，客戶端不能指定或冒充執行者。
- `local_date` 由 RPC 使用已驗證的 IANA `time_zone` 從 `occurred_at` 計算，客戶端不能直接寫入。
- Active Owner／Member 可讀家庭 Care Logs；移除 Member 後新請求立即失去存取權。
- 只有原執行者可編輯；原執行者或 Owner 可刪除。Owner 不能修改 Member 的原始內容。
- Member 被移除時歷史 Care Logs 保留；Member 帳戶刪除時其 Care Logs 因 `performed_by ON DELETE CASCADE` 刪除；Pet 刪除時全部 Care Logs 因 `pet_id ON DELETE CASCADE` 刪除。

## Read-only SQL verification

在 Supabase SQL Editor 執行：

```sql
select relrowsecurity
from pg_class
where oid = 'public.care_logs'::regclass;

select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'care_logs'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'care_logs'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

select p.proname,
       p.prosecdef as security_definer,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_care_log', 'update_care_log', 'get_pet_care_performers')
order by p.proname;
```

預期：RLS 為 `true`；只有 SELECT／DELETE policies；authenticated table grants 只有 SELECT／DELETE；三個公開 RPC 都固定空 `search_path`，anon 不可執行、authenticated 可執行。

## Three-user verification

使用已確認 Email 的 Owner、Member、Stranger 三個臨時測試帳戶。密碼只放在目前 shell process，不要寫入檔案：

```zsh
read "PAWDAY_FAMILY_OWNER_EMAIL?Owner email: "
read -s "PAWDAY_FAMILY_OWNER_PASSWORD?Owner password: "; echo
read "PAWDAY_FAMILY_MEMBER_EMAIL?Member email: "
read -s "PAWDAY_FAMILY_MEMBER_PASSWORD?Member password: "; echo
read "PAWDAY_FAMILY_STRANGER_EMAIL?Stranger email: "
read -s "PAWDAY_FAMILY_STRANGER_PASSWORD?Stranger password: "; echo
export PAWDAY_FAMILY_OWNER_EMAIL PAWDAY_FAMILY_OWNER_PASSWORD
export PAWDAY_FAMILY_MEMBER_EMAIL PAWDAY_FAMILY_MEMBER_PASSWORD
export PAWDAY_FAMILY_STRANGER_EMAIL PAWDAY_FAMILY_STRANGER_PASSWORD
node scripts/verify-care-logs-rls.mjs
unset PAWDAY_FAMILY_OWNER_EMAIL PAWDAY_FAMILY_OWNER_PASSWORD
unset PAWDAY_FAMILY_MEMBER_EMAIL PAWDAY_FAMILY_MEMBER_PASSWORD
unset PAWDAY_FAMILY_STRANGER_EMAIL PAWDAY_FAMILY_STRANGER_PASSWORD
```

腳本只使用 `.env.local` 的 public URL／publishable key，不使用 service role、secret 或 database password。它建立並清理暫時 Pet、Membership 與 60+ Care Logs。

## Manual App verification

- 中央 `+` 顯示 Photo Journal 與六種 Care Type；Home「記錄照顧」只顯示六種 Care Type。
- Feeding／Walk／Medicine／Bath／Grooming／Other 均可建立；Other 沒有 Note 時不能送出。
- Walk 可用 15／30／45／60 分鐘快捷值，也可輸入 1–1440 整數。
- 今天、昨天、跨午夜、不同時區建立後，Home Today 與 Care History 分組正確。
- Home 最多展示最新三項今日照顧，包含執行者與時間；Journal 不出現 Care Logs。
- 作者可編輯自己的時間、Note、Walk duration，但不可改 Pet、Type、performed_by。
- Owner 可刪除 Member Care；Owner 不能編輯 Member Care；Member 不能改刪 Owner Care。
- 切換 Pet、pull-to-refresh、冷啟動、離線／失敗重試不串資料。
- iPhone 小螢幕、標準尺寸、Pro Max、Dynamic Type 下表單和時間軸可完整滾動與操作。

Phase 6 完成前不要進入 Phase 7，也不要建立 Reminder、Notification 或 Chat 資料流。

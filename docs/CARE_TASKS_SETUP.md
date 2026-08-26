# Phase 7 — Family Reminders + Care Tasks + Local Notifications

Phase 7 將「未來要做的家庭照顧」放在 `care_tasks`，完成後才以同一個資料庫 transaction 建立 `care_task_completions` 與既有 `care_logs`。`care_logs` 繼續只代表已發生的照顧事實，不承載待辦、排程或通知狀態。

## Migration

本階段只有一個 migration：

```text
20260824180000_create_care_tasks.sql
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

## Data and security model

- `care_tasks` 是共享的未來行動；`care_task_completions` 是某次排程已完成的唯一證據；`care_logs` 是實際完成時間的歷史事實。
- 支援 once、daily、weekly、monthly。排程保存固定 IANA 時區；裝置旅行不會改變家庭約定的牆鐘時間。每月 29–31 號在沒有該日期的月份直接跳過。
- authenticated client 對兩張新表都只有 `SELECT`，沒有直接 `INSERT`／`UPDATE`／`DELETE`。所有 mutation 都經固定空 `search_path` 的 `SECURITY DEFINER` RPC。
- Active Owner／Member 可建立和完成任務。Creator 可編輯／停用自己的任務；Owner 可治理該 Pet 的任何任務；Member 不可修改其他人的任務。
- 完成 RPC 從 `auth.uid()` 注入執行者、鎖定 Task row，並以 `(task_id, scheduled_for)` unique constraint 防止並發重複。成功時同一 transaction 只建立一個 Completion 和一個 Care Log；重複請求回傳 `already_completed`。
- Undo 在同一 transaction 刪除 linked Care Log，Completion 由外鍵 cascade 刪除。只有原完成者或 Owner 可 Undo。
- Member 被移除後新請求立即失去 Task／Completion access，但既有 Task 仍保留。非 Owner creator 刪除帳戶時 `created_by` 變成 `NULL`；其 Completion 與 linked Care Log 依外鍵 cascade 刪除。Owner／Pet 刪除時 Task、Completion、Care Log 全部跟隨既有 Pet lifecycle 清理。

## Local notification model

- 只使用 `expo-notifications` 的裝置本地通知；不建立 Push Token、不呼叫 Expo Push Service、不接 APNs／FCM，也不使用 Supabase Realtime 或遠端背景推播。
- Database Task 永遠是事實來源。通知排程失敗、權限拒絕或 OS 未交付都不回滾已儲存 Task。
- 第一次建立 Task 成功後才顯示 HomeyPaw pre-prompt；使用者選擇允許後才呼叫系統權限。拒絕時 App 顯示設定入口，Task 仍可正常共享與完成。
- 每次登入、App 回到 foreground、Task mutation、家庭 membership 變更或 Pet mutation 後，重新查詢未來 30 天 occurrence。每個帳戶／裝置最多保留最近 48 個 HomeyPaw 排程，為 OS 與其他通知保留餘量。
- 本機 SQLite `pawday-notifications.db` 保存 `(user, task, scheduled_for) -> notification identifier` mapping；不使用 AsyncStorage。登出會取消該使用者所有已追蹤通知並清除 mapping。
- Notification payload 只包含 Pet ID、Task ID、排程時間與受控 route，不包含 Email、token、secret 或私人 Note。點擊後仍由 Auth guard、Pet membership 與 RLS 重新授權。
- 本地通知是 best-effort：若另一台裝置完成／修改任務，本機要到下次 foreground 或其他 sync trigger 才能取消舊通知。這是純 local-notification 架構的刻意限制；跨裝置即時取消需要未來獨立設計 remote push。

## Read-only SQL verification

Migration push 後，在 Supabase SQL Editor 執行：

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('care_tasks', 'care_task_completions')
order by tablename;

select tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('care_tasks', 'care_task_completions')
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('care_tasks', 'care_task_completions')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select p.proname,
       p.prosecdef as security_definer,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_care_task',
    'update_care_task',
    'deactivate_care_task',
    'get_care_task_occurrences',
    'complete_care_task',
    'undo_care_task_completion'
  )
order by p.proname;
```

預期：兩表 RLS 都是 `true`；兩表只有 active family 的 SELECT policy；authenticated table grant 只有 SELECT；六個公開 RPC 都是 `security_definer = true`、空 `search_path`、anon 不可執行、authenticated 可執行。

## Automated verification

純 recurrence 測試不需要遠端憑據：

```bash
npm run verify:phase7-recurrence
```

上述 command 執行 `scripts/verify-care-task-recurrence.mjs`，覆蓋 once／daily／weekly／monthly、香港跨年、每月 31 號和 Los Angeles DST gap／overlap。

三使用者 RLS／transaction 驗證使用已確認 Email 的 Owner、Member、Stranger。密碼只放在目前 zsh process：

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
npm run verify:phase7-rls
unset PAWDAY_FAMILY_OWNER_EMAIL PAWDAY_FAMILY_OWNER_PASSWORD
unset PAWDAY_FAMILY_MEMBER_EMAIL PAWDAY_FAMILY_MEMBER_PASSWORD
unset PAWDAY_FAMILY_STRANGER_EMAIL PAWDAY_FAMILY_STRANGER_PASSWORD
```

腳本只讀取 `.env.local` 的 public URL／publishable key，不使用 `service_role`、`sb_secret_` 或 database password。它驗證身份綁定、Owner／Member／Stranger 權限、錯誤 occurrence、並發完成、Undo、移除 Member 和 Pet cascade，最後清理 fixtures。

Task creator 帳戶刪除需要一個可永久刪除的專用 Member 測試帳戶，因此刻意拆成逐步 lifecycle 驗證，不會在一般 RLS script 中刪除你的共用測試帳戶。到該驗收步驟時，以目前 shell 暫存 Owner 與專用 Member credentials，執行 `npm run prepare:phase7-account-delete`；依提示在 App 永久刪除該 Member 後，執行 `npm run verify:phase7-account-delete`。Fixture IDs 只寫入已被 Git ignore、權限為 `0600` 的本機暫存檔；兩個 script 都不輸出 Email、User ID、token 或 Invite Code。

## Manual App verification

- Home bell 進入 Reminder 頁；badge 只計算 current Pet 今天到期且未完成的 occurrence。Home「今日照顧」仍只顯示已完成 Care Logs。
- Owner／Member 可建立 once、daily、weekly、monthly；每月 31 號跳過沒有 31 號的月份。Creator／Owner 可編輯或停用，其他 Member 不可。
- 第一次建立時選擇「稍後」與系統拒絕都不影響 Task；拒絕 banner 可開啟系統設定。授權後可在系統 pending notifications 與 SQLite mapping 中找到一致排程。
- 前景收到通知可正常顯示；background／terminated 點擊會先恢復 session，再安全導航到正確 Pet Task。未登入或已移除 Member 不能藉 notification route 繞過 RLS。
- 到期後任何 active family member 都可完成；並發點擊只產生一個 Completion／Care Log。Completed item 今天內保留；完成者或 Owner 可 Undo，其他 Member 不可。
- Task 修改／停用／完成／Undo、Member 移除、Pet 刪除、App foreground 後，本機舊排程會被取消或重建；登出後該帳戶本機排程清空。
- 在不同 IANA 時區、跨年、DST gap／overlap，以及 iPhone 小螢幕、Pro Max、Dynamic Type 下驗證日期、滾動、按鈕與提示。

Phase 7 完整遠端與真機／Simulator 驗收前不要進入 Phase 8。

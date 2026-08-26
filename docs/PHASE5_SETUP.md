# Phase 5 Home, Timeline and Memories Verification

Phase 5 重組主要產品體驗，但不新增 Activity、Memory 或 Chat message table。Recent Family Activity 直接來自既有 Posts；Memories 只新增一個受 membership 與 Posts RLS 保護的 candidate RPC。

## Deployment

本階段唯一 database migration：

```text
supabase/migrations/20260824090000_get_pet_memory.sql
```

依序執行：

```bash
npx supabase db push --dry-run
npx supabase db push
npx supabase db lint --linked --level warning
npx supabase migration list
```

本階段不新增或重新部署 Edge Function。

## Query and security model

- `get_pet_memory(target_pet_id, local_today)` 只授權 `authenticated`，`anon`／`public` 沒有 execute grant。
- RPC 使用 `SECURITY INVOKER`，先以 `private.is_pet_member` 拒絕 Stranger／removed Member，再查詢受 Posts RLS 保護的 row。
- `local_today` 只接受 UTC date 前後一日，覆蓋全球合法本地日期，但不允許客戶端任意掃描歷史日期。
- On This Day 優先選同月同日的歷史 Post；沒有結果時才選 30 日以前最新 Post，並在 UI 明確標示「最近回憶」。
- RPC 不回傳 Pet、Post 或 Profile 全量資料；只有 Post ID、memory kind 和 years ago。完整內容仍走既有 Posts/Post Media policy。

## Automated three-user verification

使用已確認 email 的 Owner、Member、Stranger 測試帳戶，只在目前 Terminal session 輸入臨時 credentials：

```bash
export PAWDAY_FAMILY_OWNER_EMAIL='...'
export PAWDAY_FAMILY_OWNER_PASSWORD='...'
export PAWDAY_FAMILY_MEMBER_EMAIL='...'
export PAWDAY_FAMILY_MEMBER_PASSWORD='...'
export PAWDAY_FAMILY_STRANGER_EMAIL='...'
export PAWDAY_FAMILY_STRANGER_PASSWORD='...'
node scripts/verify-phase5-memory-rls.mjs
unset PAWDAY_FAMILY_OWNER_EMAIL PAWDAY_FAMILY_OWNER_PASSWORD
unset PAWDAY_FAMILY_MEMBER_EMAIL PAWDAY_FAMILY_MEMBER_PASSWORD
unset PAWDAY_FAMILY_STRANGER_EMAIL PAWDAY_FAMILY_STRANGER_PASSWORD
```

腳本會建立臨時 Pet、Owner/Member membership、On This Day、recent fallback 和 23 篇 cursor fixtures；驗證 Owner/Member、Stranger、removed Member、fallback 與跨多頁不重複／不漏項，最後刪除臨時 Pet。腳本不輸出 email、password、token、Invite Code 或 UUID。

## Manual iOS verification

- 小螢幕 375×667 與 Pro Max：底部順序為 Home、Journal、New、Chat、Me；中央 New 可用，沒有 Reminder tab。
- Home bell 進入 `/reminders`，返回不出現 `GO_BACK` warning；頁面沒有假 badge 或假 reminder data。
- Chat 顯示 current Pet 與 future private-family 說明；沒有訊息、輸入框或虛構互動。No-pet 狀態可 Add Pet 或 Join Family。
- Home current Pet、陪伴日數、快速記錄、最近三篇家庭日記、作者、Memory 和 Members 全部正確；下拉刷新不改變 session。
- On This Day 有結果時顯示相隔年數；沒有時只顯示 30 日以前的「最近回憶」；兩者都能進入原 Post Detail。
- Journal 以 Year → Month → Day 分組；本地今天／昨天文案在香港 23:30、00:10、01:00 邊界正確。
- 建立至少 23 篇測試日記，滾動越過三頁；沒有重複、漏項或整頁 spinner，載入下一頁不跳位。
- 1、2、3、4、5、9 張相片分別驗證 adaptive layout；單圖保留原比例且不過高，五至九張第四格顯示 `+N`，Detail 可查看全部原圖。
- 切換 Pet 兩次：時間軸回到頂部，不閃現上一隻 Pet；refresh/kill/reopen 後 current Pet 正確。
- 日記 `•••`：作者可 Edit/Delete；Owner 查看 Member Post 只有 Delete；普通 Member 不能操作他人 Post。
- Dynamic Type 與 VoiceOver：44pt 目標、tab/bell/switcher/read-more/gallery action 均有可理解標籤，重要文字不被固定高度截斷。

Phase 5 不包含 Care Logs、真正 Reminder CRUD/notification、Chat database/Realtime、公開社群或 AI。真實 migration、三使用者 RLS、25 篇游標分頁、香港日期邊界、小屏／Pro Max／Dynamic Type、production bundle 與 orphan cleanup 已完成驗收；本階段停止，不進入 Phase 6。

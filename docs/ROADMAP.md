# HomeyPaw Roadmap

本文件保留 Phase 歷史，同時以 `COMPLETED`、`CURRENT`、`DEFERRED` 區分已交付、目前發布狀態與尚未承諾的後續工作。

## CURRENT — App Store Production 1.1.1 (5)

- Current App Store Production is `1.1.1 (5)`; the image-cache fix is already in the development branch.
- Multi-Pet is not yet released; its compatible binary needs a new version/build before C4I rollout.

## HISTORICAL — 1.1.0 App Store Review

- App Store `1.0.0` 已正式發布。
- `1.1.0` Build 4 已完成 automated release gate、TestFlight、雙裝置真機驗收、iPhone 與 iPad 驗證。
- Build 4 已提交 App Store Review，目前為 `Waiting for Review`。
- `1.1.0` 採 manual release；審核通過不等於已發布。
- Production Supabase 已上線。本次文件同步沒有修改 Production。
- `main` 是目前唯一開發分支，不再使用 Phase feature branch／worktree workflow。

## COMPLETED — Product History

### Phase 0 — 工程基線

Expo、Expo Router、TypeScript strict、ESLint、Prettier、基礎目錄、環境變數範例與架構文件。

### Phase 1 — Design System、Navigation、i18n

設計 token、共用頁面骨架、正式導航，以及 `zh-HK`／English 語言資源。

### Phase 2 — Supabase、Auth

Supabase Auth、session persistence、註冊／登入／登出、Profile、Email confirmation、Password recovery deep link，以及 App 內帳戶刪除。

### Phase 3 — Pet Profile

Pet CRUD、生日、私人頭像、Owner membership 與 RLS 基線。

### Phase 4 — Journal

文字及 1–9 張相片日記、私人 Storage、時間線、Photo Viewer、signed URL 與儲存相片。

### Phase 4.5 — Family Sharing

1 Pet = 1 Family Space、Owner／Member、限時私人邀請、家庭成員上限、RLS／Storage 隔離、Removed Member revoke 與資料生命週期。

### Phase 5 — Home、Timeline、Memories

Pet 切換、Today Care、家庭近況、回憶查詢，以及虛擬化的 Year → Month → Day Journal timeline。

### Phase 6 — Family Care Logs

餵食、散步、用藥、梳洗、玩耍與其他照顧記錄；包含時區、本地日期、Today Care 和歷史分頁。

### Phase 7 — Family Reminders + Care Tasks

Once／Daily／Weekly／Monthly recurrence、本機通知、家庭任務、Complete／Undo 與 Care Log integration。

### Phase 8 — Product Polish + App Store Readiness

正式品牌、Icon／Splash、Error Boundary、網絡狀態、Auth deep link、效能、無障礙、公開 Privacy／Terms／Support 網站及 release checks。

### Phase 9 — EAS、Apple、TestFlight

EAS project、Bundle ID、Apple signing、production build、TestFlight upload 與 Internal Testing 已建立並完成。`1.0.0` 已正式發布；後續 release 沿用相同正式身份與 credentials。

### Phase 10A — Secure Family Chat

以 PostgreSQL 為 canonical source 的私人家庭文字 Chat、private Supabase Realtime Broadcast、read state／unread badge、edit／delete、active Pet channel rotation，以及 Removed Member 零後續事件。

Chat 不發送系統 Push Notifications。

### Phase 11A — Family Care Schedule

`care_shifts`／`care_shift_tasks`、Owner 管理、Member 認領／self schedule、多照顧者、具體 Care Task occurrence、claim／complete／cancel，以及 canceled occurrence rescheduling。

### 1.1.0 Follow-ups

- Family Remote Push：Journal、Care、Health、Reminder；server-side recipient validation、privacy-safe copy、actor self exclusion、Removed Member exclusion、delivery lifecycle 與 TTL。
- Profile avatar。
- Health、Birthday 與 Yearly recurrence。
- iPad layout／navigation／真機驗證。
- Schedule → Reminder return flow。
- Chat unread、cached re-entry／SWR，以及 Journal background refetch hardening。
- Removed Member active Pet persistence 與 revoked cache cleanup。
- Production migrations、Edge Functions、Realtime private mode、APNs、TestFlight 與 release hardening。

## DEFERRED

以下項目尚未實作或承諾，不應出現在當前產品描述中：

- Journal comments、likes、reactions。
- Journal gallery。
- Chat images。
- Schedule advanced recurrence／series。
- Notification history center。
- 從未開啟、自然過期的 Password Recovery link 端到端真機樣本；已使用／失效連結的安全錯誤流程已覆蓋。

新增 deferred scope 前必須先更新產品、安全、資料與測試設計，不以文件條目視為已排程功能。

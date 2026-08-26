# Roadmap

每個 Phase 必須保持可運行、完成檢查並經人工驗證後才進入下一階段。

## Phase 0 — 工程基線（已完成）

Expo SDK 57、Expo Router、TypeScript strict、ESLint、Prettier、基礎目錄、環境變數範例及架構文件。

## Phase 1 — Design System、Navigation、i18n（已完成）

建立設計 token、共用頁面骨架、正式導航和 `zh-HK`／英文語言資源。不建立業務資料流。

## Phase 2 — Supabase、Auth（已完成）

接入 Supabase Auth、session 持久化、註冊／登入／登出、個人資料、帳戶及資料刪除流程；建立 migrations 與 RLS 基線。

Follow-up 已於 Phase 8 完成：Password Recovery／Email Confirmation deep link、設定新密碼畫面與 callback exchange。真實 Supabase redirect allow-list 與真機流程仍須在 Phase 8 驗收。

## Phase 3 — 寵物檔案（已完成）

寵物 CRUD、私人頭像上傳、年齡與陪伴日數；以 `pet_members` 支援權限，V1 只開 owner。

## Phase 4 — 相片日記（已完成）

1–9 張相片的選擇、壓縮、私人 Storage 上傳、重試與刪除；日記 CRUD、標籤、可選位置及圖片預覽。

## Phase 4.5 — Family Sharing（已完成）

以 Pet 為共享邊界的安全 Invite、Owner／Member 權限、家庭成員列表、共享 Journal 作者與三使用者 RLS／Storage 隔離；已完成有效／錯誤／過期／撤銷／滿額／並發 Invite、移除 Member、方案 A 帳戶刪除與無 orphan 資料的真實驗收。

## Phase 5 — 首頁、時間線（已完成）

多寵物切換、陪伴資訊、快速記錄、家庭近況、那年今日／最近回憶，以及具游標分頁、刷新、空白／skeleton／錯誤狀態的 Year → Month → Day 倒序生命時間軸。底部導航加入私密家庭 Chat 的誠實佔位；Reminder 改由 Home bell 進入普通受保護 route。

## Phase 6 — Family Care Logs（已完成）

建立與 Journal 完全分離的家庭照顧記錄：餵食、散步、用藥、洗澡、梳毛美容與其他；包含 server-derived 本地日期、Owner／Member 權限、Home Today Care、快速新增與游標分頁歷史。已完成真實 migration、三使用者 RLS、65 條 UI 分頁、帳戶／毛孩 cascade、多裝置與 Dynamic Type 驗收。Reminder／Task 仍留在 Phase 7。

## Phase 7 — Family Reminders + Care Tasks（已完成）

建立共享 Care Task／Completion 與原子 Care Log 流程；支援 once／daily／weekly／monthly 固定時區 recurrence、Creator／Owner 權限、並發完成與 Undo。本機以 SQLite 映射未來 30 天 local notifications，包含首建 pre-prompt、拒絕／設定狀態、foreground／mutation／登出同步與安全 deep link。不建立 remote push、token 或 Realtime；完成真實 migration、三使用者 RLS、通知 lifecycle 與多尺寸驗收後才標記完成。

## Phase 8 — Product Polish + App Store Readiness（進行中）

正式 App identity／Icon／Splash、Error Boundary、網絡狀態、統一 feedback、Password Recovery deep link、圖片與長列表效能、可存取性、權限文案、Privacy／Terms／商店文案及 EAS profiles。完成公開 Support／政策網址、真實 iPhone development build、security regression 與 release export 後才可結束。

## Phase 9 — TestFlight

在使用者明確批准後建立／連接遠端 EAS project、Apple Bundle ID 與簽署，建立 TestFlight build，進行內部測試及回歸。不得在 Phase 8 提前執行。

## Phase 10 — App Store 準備

完成 App Privacy、正式公開 Support／Privacy／Terms URL、最終商店素材與 App Review 提交清單。

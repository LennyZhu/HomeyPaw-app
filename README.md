# HomeyPaw

HomeyPaw 是一款以家庭協作為核心的私人寵物照顧 App。

以「1 Pet = 1 Family Space」為主要模型，讓家人共同記錄毛孩生活、安排日常照顧、建立提醒與排班，並透過私人家庭聊天室保持聯絡。

預設語言為繁體中文（`zh-HK`），同時支援英文。iOS 為首要平台，並支援 iPhone 與 iPad；Android 與 Web 保留基礎支援，暫非主要發布平台。

## 發布狀態

- App Store `1.0.0`：已正式發布。
- HomeyPaw `1.1.0` Build 4：已完成 TestFlight、雙裝置真機驗收、iPhone 與 iPad 驗證，並已提交 App Store Review。
- App Store Connect：`Waiting for Review`；`1.1.0` 採 manual release，尚未批准或發布。
- Production Supabase：已上線；本輪文件同步不變更任何 Production 資源。
- Git：`main` 是目前唯一開發分支，不再使用 Phase feature branch／worktree workflow。

## 核心功能

### Pet 與 Family Space

- 毛孩檔案、生日、頭像與家庭成員。
- 一隻 Pet 對應一個私人 Family Space。
- Owner／Member 角色、限時私人邀請、成員管理與家庭人數上限。
- RLS 隔離所有 Pet、家庭與私人內容；Removed Member 立即失去後續存取權。

### Journal

- 文字或相片日記，每篇支援 1–9 張相片。
- 私人家庭時間線、回憶瀏覽、全屏 Photo Viewer 與儲存相片。

### Care、Health 與 Reminder

- 餵食、散步、用藥、梳洗、玩耍及其他照顧記錄。
- Home 顯示 Today Care，並提供照顧歷史。
- Health 記錄、Birthday、Yearly recurrence 與時區處理。
- Reminder 支援 Once、Daily、Weekly、Monthly、Yearly、本機通知、共享家庭任務、Complete／Undo，以及完成後建立 Care Log。

### Schedule

- 家庭照顧排班；Owner 可管理，Member 可認領或安排自己。
- 同一天可有多位照顧者。
- 排班可建立具體 Care Task occurrence，支援 claim、complete、cancel，以及 canceled occurrence rescheduling。

### Chat

- 每個 Family Space 的私人文字聊天室。
- PostgreSQL 是 canonical source；Supabase Realtime 只透過 private Broadcast 傳送失效提示。
- 支援未讀 badge／read state、編輯、刪除、active Pet channel rotation，以及 Removed Member 即時撤權。
- Chat 目前不發送系統 Push Notifications。

### Family Remote Push

- Journal、Care、Health 與 Reminder 家庭活動可通知其他有效家庭成員。
- Actor 自己不收 Push；Removed Member 不再收到後續 Push。
- 通知文案避免包含私人正文，收件人由伺服器端重新驗證，並受 Push TTL 限制。

### Auth 與 Profile

- Email／password、Email confirmation、Password recovery、session restore。
- Profile、Profile avatar、語言設定與 App 內永久刪除帳戶。

## 技術基線

版本以 repository 当前配置為準：

- Expo SDK `57.0.22`
- React Native `0.86.3`
- React `19.2.3`
- Expo Router `57.0.21`
- TypeScript `6.0.3` strict mode
- ESLint 9、Prettier 3
- TanStack Query 5、Zustand 5
- React Hook Form 7、Zod 4
- i18next／react-i18next
- Expo Image、Expo Notifications、Expo SQLite
- Supabase Auth、Postgres、RLS、private Storage、Realtime、Edge Functions

## Security Model

HomeyPaw 採 private-by-default：

- 只有有效 Owner／Member 可以讀寫其 Pet Family Space。
- Postgres RLS、受限制 RPC 與 server-side Edge Functions 是授權邊界。
- Realtime channel 為 private；訊息仍須經 RLS 重新讀取後才合併至 client cache。
- Removed Member 會失去資料、Realtime 與後續 Push 存取權；active Pet 和 cache 會清理。
- 相片保存在 private Storage，顯示時使用短期 signed URL。
- `service_role`／secret 只存在伺服器環境；Expo client 永不保存 service-role secret。
- Push recipient 在伺服器端重新驗證，並使用 TTL 避免過期 backlog 被送出。

不要在 Issue、文件或 commit 中加入 Production URL、service-role key、Expo Access Token、Vault secret、Apple credential 或測試帳戶密碼。

## 本機開發

需求：Node.js `22.13+`（建議使用 `.nvmrc`）、npm；iOS 開發另需 macOS 與 Xcode。

```bash
nvm install
nvm use
npm install
cp .env.example .env.local
npm start
```

常用指令：

```bash
npm run ios
npm run android
npm run web
npm run typecheck
npm run lint
npm run format:check
npm run verify:i18n
```

`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 只能使用 publishable key。所有 `EXPO_PUBLIC_*` 都會進入 client bundle，不得放入 secret、`service_role` key 或資料庫密碼。

本機 backend override 只在以下兩項同時成立時允許：

1. `__DEV__` 為 true；
2. hostname 是 `localhost` 或 `127.0.0.1`。

## Supabase

本地服務：

```bash
npx supabase start
npx supabase status
npx supabase stop
```

本地測試不會自動連接或修改 Production。Production migration 與 Edge Function deployment 必須由 release operator 明確執行。完整流程見 [Supabase Setup](docs/SUPABASE_SETUP.md)。

## EAS 與 Apple

- Bundle Identifier：`com.zhushunli.homeypaw`
- Deep Link Scheme：`pawday://`
- EAS profiles：`development`、`development-simulator`、`preview`、`production`
- iOS `1.1.0` Build 4 支援 iPhone、iPad 與 Production Push entitlement。

通用 production build：

```bash
npx --yes eas-cli@latest build \
  --platform ios \
  --profile production
```

只上傳指定 build 到 App Store Connect／TestFlight：

```bash
npx --yes eas-cli@latest submit \
  --platform ios \
  --profile production \
  --id <BUILD_ID> \
  --no-auto-testflight-setup \
  --non-interactive
```

這些命令不會自動提交 App Store Review 或發布版本。

## 專案結構

```text
src/
  app/        Expo Router routes 與 layouts
  components/ 跨 feature UI 元件
  features/   Auth、Pets、Journal、Care、Reminder、Schedule、Chat 等功能
  hooks/      跨 feature hooks
  i18n/       zh-HK／English 語言資源
  lib/        Supabase、TanStack Query 等初始化
  services/   相片、通知與外部服務邊界
  stores/     少量 user-scoped client state
  theme/      設計 tokens
  types/      共享類型與資料庫類型
  utils/      純函式工具
supabase/
  migrations/ 版本化 schema 與 policy
  functions/  受信任的 server-side functions
scripts/      release-critical verifiers
docs/         架構、發布、測試與操作文件
```

## 品質驗證

所有 release candidate 必須通過 TypeScript、ESLint、Prettier、i18n parity、release-critical verifier、RLS／Edge lifecycle regression、`git diff --check` 與適用的真機測試。Build 4 的完整 release gate、TestFlight 與雙裝置驗收已經完成。

## 文件索引

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Supabase Setup](docs/SUPABASE_SETUP.md)
- [Real-device Test Matrix](docs/REAL_DEVICE_TEST_MATRIX.md)
- [Production Readiness](docs/PRODUCTION_READINESS.md)
- [App Store Metadata](docs/APP_STORE_METADATA.md)
- [App Privacy Data Inventory](docs/APP_PRIVACY_DATA_INVENTORY.md)
- [TestFlight Internal Checklist](docs/TESTFLIGHT_INTERNAL_CHECKLIST.md)

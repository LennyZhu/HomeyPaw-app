# HomeyPaw

HomeyPaw 是一款以 iOS 為首要平台的私人寵物日記：記錄毛孩一生的重要日常與長期回憶。

目前進度：**Phase 8 — Product Polish + App Store Readiness（實作中；正式圖示、網絡／錯誤處理、Auth deep link、商店文件與本機 EAS 設定已準備，真實 iPhone 驗收及公開支援／政策網址仍待完成）**。

## 技術基線

- Expo SDK 57 / React Native 0.86 / React 19
- Expo Router（檔案式路由）
- TypeScript strict
- ESLint flat config + Prettier
- i18next / react-i18next（`zh-HK` 預設，英文基礎架構）
- Expo Image / Expo Localization
- Supabase Auth / Postgres / Row Level Security / Edge Functions
- React Hook Form / Zod
- TanStack Query / Zustand（只保存 current pet UI state）
- Expo Image Picker / Image Manipulator / DateTimePicker
- 私人多圖日記、游標分頁與短期 signed URLs
- 家庭邀請、Owner／Member 權限與共享日記
- Home 家庭近況、資料庫 Memories 查詢與虛擬化寵物生命時間軸
- 家庭照顧記錄、今日照顧、server-derived 本地日期與游標分頁歷史
- 家庭照顧任務、週期排程與裝置本機通知
- 全局 Error Boundary、網絡狀態提示、受控圖片快取與 Password Recovery deep link
- iOS 優先，保留 Android 與 Web 的基礎支援

## 本機要求

- Node.js `22.13+`（建議使用 `.nvmrc` 的版本）或 Expo SDK 57 支援的更新版本
- npm
- iOS Simulator：macOS、Xcode 26.4+
- 真實 iPhone／Apple Developer 簽署：只在進入 Development Build 驗收時需要

```bash
nvm install
nvm use
npm install
```

## 開發指令

```bash
npm start          # 啟動 Expo 開發伺服器
npm run ios        # 在 iOS Simulator 開啟
npm run android    # 在 Android Emulator 開啟
npm run web        # 在瀏覽器開啟
npm run typecheck  # TypeScript 靜態檢查
npm run lint       # ESLint 與 Prettier 規則檢查
npm run format     # 自動格式化
npx expo start --dev-client # 已安裝 development build 後連接 Metro
```

## 環境變數

複製範例檔，但不要提交真實環境設定：

```bash
cp .env.example .env.local
```

`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 只應填入 `sb_publishable_...` key。所有 `EXPO_PUBLIC_*` 值都會包含在客戶端 bundle 中，絕不可放入 secret／`service_role` key、資料庫密碼或其他秘密。

完整的專案建立、migration、Edge Function 部署和人工驗證步驟見 [Supabase Setup](docs/SUPABASE_SETUP.md)。

Supabase Dashboard 的 Auth Redirect URLs 在 Phase 8 還需包含：

```text
pawday://check-email
pawday://reset-password
```

本機已準備 `eas.json` 的 development、simulator、preview 和 production profiles，但尚未執行 `eas init`、建立遠端 Expo project、登入 Apple 或註冊 Bundle ID。這些外部操作必須得到明確批准。

## 目錄

```text
src/
  app/        Expo Router 路由與 layout
  components/ 可跨 feature 使用的 UI 元件
  features/   按 auth、pets、posts 等業務能力組織
  hooks/      跨 feature hooks
  i18n/       語言資源與 i18n 設定
  lib/        第三方套件的薄封裝與初始化
  services/   裝置或外部服務邊界
  stores/     少量客戶端全域狀態
  theme/      設計 token 與主題
  types/      真正跨 feature 的型別
  utils/      純函式工具
```

詳細決策見 [架構文件](docs/ARCHITECTURE.md)，分階段範圍見 [Roadmap](docs/ROADMAP.md)。TestFlight 前請逐項執行 [真機矩陣](docs/REAL_DEVICE_TEST_MATRIX.md) 與 [Production Readiness](docs/PRODUCTION_READINESS.md)。

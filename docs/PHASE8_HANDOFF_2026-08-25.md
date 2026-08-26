# HomeyPaw Phase 8 工作记录与交接代办

更新时间：2026-08-27（Asia/Hong_Kong）

## 当前目标与边界

- 当前阶段：Phase 8 — Product Polish + Real Device + App Store Readiness。
- 完成真机验收后停止，不进入 Phase 9。
- 仅允许本地 iOS Development Build 和真实 iPhone 验收。
- 不上传 TestFlight、不提交 App Store、不创建 Distribution 证书或生产 Provisioning Profile。
- 固定 Bundle Identifier：`com.zhushunli.pawday`。
- Support Email 已确定为 `lenny996@163.com`，并已接入 App 内支援入口、政策与 metadata。
- HomeyPaw 官方静态网站已部署到 Vercel Project `homeypaw`，正式公开地址为 `https://homeypaw.vercel.app/`。
- Privacy Policy、Terms 与 Support 的公开 HTTPS 地址已完成无登录直达验证，三个公开页面 blocker 已解除：
  - `https://homeypaw.vercel.app/privacy`
  - `https://homeypaw.vercel.app/terms`
  - `https://homeypaw.vercel.app/support`

## 已确认的产品决策

- App Icon：候选 2「家庭环抱」。
- 正式品牌名称：`HomeyPaw`；App 内文案、Splash、App Store metadata 与原生工程显示名称已统一。
- Chat：1.0 隐藏 Chat Tab，不实现真实 Chat/Realtime。
- Crash Reporting：1.0 暂不接入 Sentry，使用现有 Error Boundary 和脱敏日志。
- App 版本：`1.0.0`，iOS build `1`，Android versionCode `1`。

## Phase 8 已完成实现

- 正式 App Icon、Splash、Android Adaptive Icon、favicon 已生成并接入。
- Chat Tab 已从正式路由移除。
- 全局 Error Boundary、普通操作反馈、离线状态与 TanStack Query 网络联动已完成。
- Auth 文案、Forgot Password、Password Recovery Deep Link、重设密码页面已完成。
- About、Privacy Policy、Terms、App Store metadata、截图规划、生产检查文档已完成。
- 图片缓存、Signed URL 重试节流、列表窗口、Safe Area、键盘处理等已完善。
- 本地 `ios/` 原生工程已成功生成，CocoaPods 已安装完成。

## 关键文件

- `app.json`
- `eas.json`
- `plugins/with-local-notifications-only.js`
- `ios/HomeyPaw/HomeyPaw.entitlements`
- `src/app/_layout.tsx`
- `src/features/auth/auth-context.tsx`
- `src/features/auth/auth-callback.ts`
- `src/features/auth/auth-deep-link-coordinator.tsx`
- `src/features/auth/reset-password-screen.tsx`
- `docs/PRODUCTION_READINESS.md`
- `docs/REAL_DEVICE_TEST_MATRIX.md`
- `docs/IOS_LOCAL_DEVELOPMENT_BUILD.md`
- `website/`

## 自动检查状态

以下检查在 Phase 8 已通过：

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run verify:i18n`
- `npm run verify:phase8-production`
- `npx expo-doctor`（18/18）
- Expo iOS / Android / Web export
- Supabase migration alignment 与 DB lint

已知依赖审计结果：12 个 moderate，均来自 Expo 工具链间接依赖；无 high 或 critical，不执行破坏性 force fix。

## iOS 签名与安装状态

- 真实设备：iPhone 17，Developer Mode 已开启并完成开发者信任。
- Xcode Apple Account 已登录。
- Apple Development 证书已创建。
- Xcode Automatic Signing 使用 Personal Team。
- Bundle ID：`com.zhushunli.pawday`。
- `ios/` 已成功生成。
- 原生构建结果：`Build Succeeded`，0 errors。
- HomeyPaw 已成功安装并启动到真实 iPhone。

### 已修复的 Personal Team Push 阻塞

`expo-notifications` 默认加入远程推送用的 `aps-environment`，Personal Team 无法签署 Push Notifications。HomeyPaw 1.0 只使用本地通知，因此已：

- 新增 `plugins/with-local-notifications-only.js`；
- 在 `app.json` 中把该插件放在 `expo-notifications` 前，确保 modifier 最后移除 entitlement；
- 清空 `ios/HomeyPaw/HomeyPaw.entitlements`；
- Expo introspection 已确认不存在 `aps-environment`。

本地通知功能不依赖该远程推送 entitlement，真机通知已通过。

### 本次 Xcode 26.6 本地构建异常

第一次命令行构建没有给四个嵌入 Framework 签名，iPhone 安装时报 `ApplicationVerificationFailed`。已使用现有 Apple Development 身份为 Framework 补签并重新签主 App，随后安装成功。没有创建 Distribution 资源。

可重复流程已记录在 `docs/IOS_LOCAL_DEVELOPMENT_BUILD.md`：首选 `npx expo run:ios --device --configuration Debug` 或 Xcode Debug Build & Run；安装前检查四个 Framework 的签名。只有异常重现时才允许对明确的 Debug `.app` 由内到外补签，且不得修改 Release／Distribution 配置。

## 已完成的真实 iPhone 验收

- App 安装与启动：通过。
- 改名后的正式「家庭环抱」主屏幕图标与带 `HomeyPaw` 字标的 Splash：通过；冷启动无明显人为停顿。
- Session Restore：通过。
- Photo Library 权限、选择照片、保存头像、首页和详情显示：通过。
- 相片权限前置说明与 iOS 系统提示已在繁体中文及英文下验收；Limited Access 会显示受限说明，系统选择器可供用户主动追加授权，但 HomeyPaw 只取得用户交回的选择结果：通过。
- About 页显示 `lenny996@163.com`；点击可打开邮件撰写页且收件人正确：通过。
- 本地通知权限、定时通知、后台/锁屏通知、点击通知打开 App：通过。
- 通知权限关闭后的说明与“设置”恢复路径：通过；已修复从系统设置直接返回时权限状态不刷新的问题。
- HomeyPaw 被彻底划掉后，本地提醒仍在锁屏准时出现；点击通知可冷启动 App，通过 Auth／membership／RLS 后进入正确毛孩与任务：通过。
- Password Recovery 邮件链接可冷启动 HomeyPaw 并打开“设置新密码”：通过。
- Sign Up 确认邮件链接在冷启动与 App 未关闭状态下均可打开 HomeyPaw 并进入新账号首页：通过；测试账号已永久删除。
- 新密码已实际生效，可以成功认证：通过。

## 已关闭问题：旧 Password Recovery 路由残留

### 实际现象

新密码认证成功后，App 仍会进入“设置新密码”页面；点击“返回登录”后进入首页。此前一度因为 iPhone 数据线拔掉，真机运行的是 Metro 缓存旧 Bundle。重新插线后已确认设备连接，Metro 已连续收到最新 iOS Bundle。

### 已完成的三层修复

1. `reset-password-screen.tsx`
   - 不再先关闭 Recovery 状态再等待登出。
   - 改为先完成本地 Session 清理，再跳转登录页，消除“session 存在但 recovery 已关闭”的竞态。

2. `auth-deep-link-coordinator.tsx`
   - 对已消费回调保存 SHA-256 指纹，最多 8 条。
   - 不保存 token 或完整 URL。
   - 已消费链接在存在正常 Session 时返回首页。

3. `src/app/_layout.tsx`
   - `reset-password` 已放入 `Stack.Protected`。
   - 只有未登录、正在处理 Auth Callback 或确实处于 Password Recovery 时才允许该路由存在。
   - 正常登录 Session 不应再停留在重设密码页。

### 2026-08-26 真机结论

- 正常登录后进入首页，彻底划掉 App 冷启动仍进入首页。
- 诊断确认普通登出时旧重设页残留的状态为 `session=none`、`isPasswordRecovery=false`、`isProcessingAuthCallback=false`、`pathname=/reset-password`。
- 根路由已改为只在处理中、有效 Recovery 或明确 Recovery 错误时开放 `reset-password`；普通未登录只开放 Auth 路由。
- 已消费回调在未登录状态下会显示无输入框的友好错误页；登录状态下安全返回首页。
- 所有 Development 临时诊断 UI 已移除。
- 修复后 TypeScript 与相关文件 Lint 通过。

## 2026-08-26 继续验收与修复

- 全新恢复邮件完成有效 token、修改密码、自动返回登录、新密码重新登录。
- 已登录用户打开有效 Recovery Link 会进入重设页；选择返回登录后可正常重新登录。
- 已使用链接显示“无效、已过期或已使用”友好错误，不显示密码输入框或原始 Supabase 错误。
- 纯过期且从未打开的链接没有可用测试样本，用户选择跳过；不记为通过。
- 离线缓存、断线提示、Post／Care／Task 写入失败保留输入、恢复网络后原页面重试均通过。
- 最大辅助功能字号、VoiceOver、Dynamic Island、Home Indicator、全屏照片、键盘与 Safe Area 真机检查通过。
- 毛孩长表单键盘遮挡已通过通用 `Screen` 的 `KeyboardAvoidingView` 修复并真机复测。
- Sign In、Sign Up、Pet、Post、Care、Reminder、Join Family 与 Profile Edit 的键盘弹出及主要 CTA 可达性已完成真机复测：通过。
- 冷启动 Session Restore、后台 5 分钟恢复、刷新与任务完成 Haptics 通过。
- Notification User Switch 使用 A 私人毛孩复测通过；共享家庭提醒会由 B 按自身权限重新排程，属于预期行为。
- Reminders 页面会在 App 从系统设置回到前台时重新读取通知权限；关闭权限会显示恢复入口，重新开启后提示会自动消失。
- 锁屏本地提醒与冷启动通知点击已用新建单次任务复测，正确进入对应提醒内容。
- 9 图日记（含横图、竖图、HEIC、Live Photo 静态输出）发布、详情、Memory、前后台与全屏切换通过。
- Journal `FlatList` 缩略图异步 URL 更新与绘制问题已通过 `extraData` 和非绝对定位图片布局修复并真机复测。
- 家庭双端真机同步因第二部 iPhone 未安装 Development Build，由用户选择跳过，不能记为通过。

## 2026-08-26 品牌统一

- App 内英文与繁体中文品牌文字已统一为 `HomeyPaw`。
- Expo app name、iOS localized display name、相片权限说明、About、错误页、分享与通知文案已统一。
- Splash 继续使用正式「家庭环抱」标志，并加入 `HomeyPaw` 字标；原生 Splash asset catalog 已由 Expo 57 config plugin 重新生成。
- iOS project、workspace、target、scheme、product、source folder、bridging header 与 entitlements 文件均已改为 `HomeyPaw`。
- 品牌资源文件名与 npm package name 已统一为 `homeypaw`。
- README、架构、政策、条款、App Store metadata、生产检查及所有阶段文档中的品牌文字已统一。
- 为避免现有登录回调、已发送邮件链接、本机资料与 Apple App 身份失效，以下兼容标识刻意保留：`com.zhushunli.pawday`、`pawday://`、Expo slug `pawday`、通知 channel/database key、storage key 与 `PAWDAY_*` 测试环境变量。
- 新 `HomeyPaw` Development Build 已在真实 iPhone 完成编译及安装；没有建立或使用 Distribution 资源。

### 新任务第一步

先询问用户当前真机页面：

- 如果已经进入首页：彻底划掉 App 再从主屏幕打开一次，确认不再进入重设页；然后重新申请一封全新的恢复邮件，完成一次完整 Password Recovery 回归。
- 如果仍进入重设页：不要继续猜测 URL。先增加仅 Development 可见、且不含 token 的状态诊断，确认 `session`、`isPasswordRecovery`、`isProcessingAuthCallback` 和当前 pathname，再修正状态来源；诊断完成后移除临时日志。

## 剩余真机代办

- [x] 关闭旧 Password Recovery 路由残留问题。
- [x] 使用全新恢复邮件验证：有效 token、成功重设、自动登出、成功提示、新密码重新登录。
- [ ] 验证已使用链接与过期链接的友好错误（已使用通过；纯过期因无可用样本由用户跳过，不记为通过）。
- [x] 验证 logged-in user 打开有效 recovery link。
- [x] 验证冷启动与前台状态下 Password Recovery Deep Link。
- [x] 验证冷启动与前台状态下 Sign Up confirmation link。
- [x] 真机网络切换：Wi-Fi／蜂窝关闭、离线提示、Post／Care／Task 写入失败保留输入、恢复网络后原页重试。
- [x] 真机键盘、Safe Area、Haptics、前后台切换与 cold start 检查。
- [x] 真机 Notification User Switch，确认 A 私人毛孩的 pending notification 不残留给 B。
- [ ] 视 Phase 8 清单完成家庭双端或真机 + Simulator 回归。
- [x] 记录 Framework 补签问题与可重复 Development 构建方案。
- [x] 用户提供 Support Email：`lenny996@163.com`。
- [x] 发布并验证公开 Privacy Policy、Terms、Support URL（Vercel Project `homeypaw`；公开地址 `https://homeypaw.vercel.app/`；无登录 HTTPS、直达路由、双语切换、站内链接与 `mailto:lenny996@163.com` 已验证）。
- [ ] 全部完成后输出 `## Phase 8 Result`，并停止，不进入 Phase 9。

## Phase 8 当前结论（2026-08-27）

- 本地 Development Build 的单机真机功能、权限、离线、通知、Auth Deep Link、图片、布局、无障碍、品牌与 Support Email 验收已完成。
- 自动检查保持通过；本轮新增的通知权限前台刷新与 Support Email 入口也已通过 TypeScript、ESLint、Prettier 与 i18n parity 检查。
- 网站部署后的回归已通过：App `lint`、TypeScript、Phase 8 production verify、Prettier、iOS `expo export`，以及 Website TypeScript、ESLint 与 Vite production build；未执行 TestFlight、App Store 或 Distribution 流程。
- 以下项目没有通过，不能标记为完成：从未打开的纯过期 Recovery Link（无样本，用户跳过）、家庭双端回归（用户跳过）。
- 官方网站本地构建与 Vercel Production 部署已通过；`https://homeypaw.vercel.app/` 及 Privacy／Terms／Support 直达地址均已完成无登录 HTTPS 验证，公开 URL blocker 已解除并写入 metadata。
- Phase 8 状态：**本地单机 Development 验收通过，三个公开 HTTPS 页面阻塞已解除；Phase 8 仍保留上述两项跳过记录，不进入 Phase 9。**
- 停止在 Phase 8；不得进入 Phase 9、TestFlight、App Store、Distribution 或生产签名流程。

## 安全提醒

- Expo 客户端环境变量只能包含：
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- 不得加入 `service_role`、`sb_secret_` 或数据库密码。
- `.env.local` 必须保持 Git Ignore。
- 工作记录中不保存测试账户密码、Auth token、证书私钥或完整设备标识。

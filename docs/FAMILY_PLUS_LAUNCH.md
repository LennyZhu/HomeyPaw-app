# Family Plus 1.4.0 release execution plan — 2026-10-25

## 当前发布决定与执行顺序

1.4.0 **公开上架当天同时开放月付、年付**，App Store 选择手动发布，
不采用上架后再开放收费。当前组织先保持 Free；Apple 审核通过后、公开发布前，
升级 **Production 所属组织**至 Pro 并确认容量服务可用。
用户已选择有条件接受 TUS 残余风险 A，**尚未授权写入第 54 条风险确认开关**。
这份计划不授权连接 Production、启用开关、部署、构建或提交。

现有验收直接复用：真实 Sandbox 月付、TestFlight 11 年付、家庭共享与隔离、
Chat、最终对象容量、15 天规则以及真实 Cron Recovery 均已通过。
根据已接受的部署记录，Sandbox 为 **56/56**，测试 Cron 已停用，
Billing/Functions/客户端购买 OFF、Quota OFF、Release Lock ON。
本次只核对本地文件，未重新读取任何云端状态。下方旧阶段结果均为历史快照。

| 顺序 | 执行动作（实际操作另行授权）                                         | 通过门槛 / 停止条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Production 只读身份、History、文件哈希和最新备份                     | 同一显式连接确认 ref `tknaobmlwmodsqtpqwkr`；记录实际已应用版本，不假定为 43 或 56。仓库外 0700 目录、0600 凭据/备份，PostgreSQL custom dump 非空且 `pg_restore --list` 成功；记录时间、大小、SHA-256、退出码及关键对象清单。缺凭据只索取文件路径。此备份不含 Storage 二进制，不删除或改写原媒体。失败不迁移。                                                                                                                                                                                                                                  |
| 2    | 仅按实际 pending 顺序部署已审核 forward 至 56；部署 Billing/Recovery | 先比较已应用版本/语句与仓库，任何未知 drift 停止；不得 reset/repair/改历史。保留现有用户、家庭、媒体、Chat/Care 数据。新增 Billing、Quota、Transition、风险确认均不启用，`release_ready=false`。受支持的锁保护事务须先审核，不能为部署持久关闭 Release Lock。                                                                                                                                                                                                                                                                                   |
| 3    | Production 专属配置、Webhook、Recovery 就绪                          | 核对 `PRODUCTION` / `target_mode=production`、明确 ref/URL、同项目凭据及 RevenueCat 映射；部署匹配的 `family-billing-webhook` 与 `family-billing-reconcile`。API、Webhook、Recovery 三类 Secret 独立，Vault 参数化写入。RevenueCat 单独创建仅 HomeyPaw Apple App、**Production purchases only** 的认证 Webhook；Sandbox Webhook 保持独立。Production Cron 安装必须适配并复核实际目标，**不能直接运行固定 Sandbox URL/环境的现有模板**。初始 Cron 停用；启用后的验收同时看 Cron、HTTP 响应、健康 RPC 和积压，不以 SQL enqueue 成功代替处理成功。 |
| 4    | 最终 Production 签名包 → TestFlight → 同一 IPA 提审                  | 使用 `production` profile，计划 1.4.0 **Build 12**，先另行只读核对 EAS/ASC 未占用；若已占用先调整并复核，不复用 11。编译时设置 `EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED=true`，否则正式会员入口不可用；配置 Production public key、Apple `appl_` key、隔离审核页所需 Sandbox public key，禁止任何服务端 Secret。不再为此构建另一个 Sandbox RC。验收仅补尚未验证的最终包审核路径和修复后的恢复入口，不重复既有首次购买矩阵。                                                                                                                     |
| 5    | 配齐首次订阅审核资料，提交 1.4.0 + 两个订阅 + 订阅组                 | 见下方 Apple 清单。选择 **Manually release this version**；版本、月付、年付和订阅组全部审核通过才进入发布窗口。审核期间 Production 新订单保持关闭，Pro 尚不升级，容量政策/Transition 不启动。                                                                                                                                                                                                                                                                                                                                                   |
| 6    | 审核通过、Pending Developer Release 后，升级组织 Pro                 | 用户操作 Organization → Billing/Subscription，确认 Production 项目确实属于已升级组织。若 Sandbox 同组织，也会受组织套餐和各项目 Compute 计费影响。核对 Storage 总可用空间、现有占用和增长余量，确保可兑现 5 GiB/家庭；Pro 是组织共享额度，**不自动为每家庭预留 5 GiB**。确认全局 25 MiB 建议值、既有 Bucket 上限、Usage/账单监控责任人及 Spend Cap 范围。未生效或容量不足，不启用收费。                                                                                                                                                         |
| 7    | 单独授权正式开关，验证后立即手动发布                                 | 按下方开关顺序执行；第 54 条写入必须再次明确授权。任一门槛失败，不点击 Release This Version。发布前仍未验证的真实 Production 付款不能标为 PASS，也不伪造交易作验收。                                                                                                                                                                                                                                                                                                                                                                            |

### 审核期间：可以买测试商品，不能产生普通用户正式新订单

- 最终包正常主会话只连接 Production；保持 Production `release_ready=false`，
  Billing/Quota 初始关闭，不能因二进制带了购买能力就开放正式订单。
- 审核使用已实现的可见 **Test account sign-in** 入口：独立 Sandbox Auth、
  内存缓存、合成账号，服务端第 55 条准入绑定真实测试 Auth UUID/Family ID，
  设置覆盖 TestFlight 与 App Review 的明确到期日。准入写入和 Sandbox 窗口需单独批准；
  不给真实 Production 用户添加审核例外，也不硬编码测试密码或 Plus。
- 在这份 **Production-target IPA** 的 TestFlight 中验证：可进入审核页、读取正确家庭、
  本地化月/年商品可见、修复后的原付款人恢复可观察且结果与服务端一致。
  每次先核对订阅实时有效期；过期恢复不能当作有效 Plus。退出审核页清理独立会话。
  正常主会话不切换后端，Sandbox 交易不写入 Production；这条路径仍需人工验收，
  Build 11 的 Sandbox RC 购买 PASS 不替代它。
- 审核窗口只开启 Sandbox Billing/Functions、Lock OFF，Quota 保持 OFF；
  原有服务端 Owner、付款 UUID、交易链和环境校验全部保留。
  在 App Review Notes 明确入口、合成 Owner/Member 账号和操作步骤，凭据仅安全填写到 ASC。
  审核期间保持该受控路径及后台处理可用；延期须更新准入期限，不能送审后立即关闭使购买失效。
  审核结束再按已验证流程关闭 Sandbox，不影响 Production。

### 月付、年付首次审核清单

- App Store Connect → Business：Paid Apps Agreement 生效，银行/税务资料完整。
- Monetization → Subscriptions：同一订阅组、相同权益等级，月付
  `homeypaw.familyplus.monthly`、年付 `homeypaw.familyplus.yearly`；
  周期、各地区价格/可售范围、组及商品本地化、审核截图/备注齐全，达到可提交状态。
  两个商品和新订阅组随 **1.4.0 同一份提交**送审，不单独漏交年付或订阅组。
- RevenueCat：Apple App、两个商品 → `family_plus`，`default` offering 的
  `$rc_monthly` / `$rc_annual` 对应正确；Keep with original App User ID 保持不变。
  App 使用 StoreKit 本地化价格，不把 USD 方案价作为香港等地区结算价。
- Paywall/审核说明：Free 300 MiB、Plus 5 GiB、家庭共享、自动续订与取消、
  年费按年一次扣款、恢复/管理入口及已公开可访问的条款/隐私链接；
  不承诺本轮未上线的月度视频次数或无限视频。
  核对 App Privacy 的购买记录/关联身份披露与真实实现一致。

### 审核通过后的开关与手动发布门槛

1. **先 Pro、后收费**。明确授权并启用 Production 生命周期处理：DB Billing、
   `FAMILY_BILLING_ENABLED`、`FAMILY_BILLING_RELEASE_APPROVED` 为 true，
   正常写入不被 Release Lock 阻断，启用 Production Recovery Cron。
   仍保持 `release_ready=false`，先确认认证、环境隔离、HTTP/健康监测就绪。
2. 在紧邻手动发布的同一操作窗口，授权第 54 条风险确认写入，保持
   `legacy_tus_admission_verified` 的事实不变；权威历史用量全部可信后才启用 Quota。
   第一次 Production Quota OFF → ON 自动记录统一服务端 **T0**，
   仅既有超 300 MiB Free 家庭获一次性 1 GiB / **360 小时**；
   Plus 优先，未知用量使启用失败，不得补假零或预先开启倒计时。
3. 独立读取验证 56/56、容量触发器、用量、过渡资格/截止时间、5 GiB 权益计算、
   PRODUCTION 映射、Webhook/Cron/监测和两项获批可售商品；随后打开
   `release_ready=true` 并验证新订单准入。完成后立即在 ASC **Release This Version**，
   不留“已上架但收费未开”的安排。不启用分阶段自动发布来代替此手动窗口。
4. Apple 分发可能延迟最多 24 小时，不能承诺 T0 与每个地区可下载时刻精确相同；
   T0 来自实际服务端政策启用，不从审核批准或部署日开始。
   若发布受阻，停止新订单并报告已生效 T0，不能修改/重启过渡期掩盖延迟。
   上架后核对实际可下载版本、两种本地化价格；首笔获授权的真实订单再核对
   APP_STORE/PRODUCTION → 后端 → 同家庭权益，不把 Sandbox 证据冒充正式付款结果。

### 暂停新订单，继续服务已购用户

使用 `private.family_billing_config.release_ready=false` 暂停新 checkout；
保留在途已付款 intent 的验证、DB Billing、运行时及 Release Approval 开关、
Webhook、Recovery Cron 和必要写权限，持续处理续订、退款、撤销和到期。
**全局 Billing OFF / Release Lock ON 不是已收费服务的常规业务回滚。**
若需因安全事故暂停底层处理，须单独作为中断事故审批，记录积压并恢复后补偿。
不删除订阅、权益审计或历史媒体，不重置已启动的 15 天时钟。
Quota OFF 仅放宽容量，并不能停止 TUS 临时成本；如确需暂停新增媒体，
另行授权只限制媒体新写入并保留读取、下载、删除，不用全局锁破坏家庭协作或订阅处理。

**可以立即开始的第一步（本地，无云端权限）：**审核本节后锁定本地 RC 文件及
56 条 Migration 哈希清单；随后单独申请“Production 只读 preflight + 最新 logical
backup”授权，凭据只通过仓库外文件路径提供。未获授权不执行上表第 1 项。

依据：[Apple 首次 IAP 提交](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/)、
[手动发布](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/)、
[同权益订阅等级](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/)、
[Supabase 组织计费](https://supabase.com/docs/guides/platform/billing-on-supabase)、
[RevenueCat 环境隔离 Webhook](https://www.revenuecat.com/docs/integrations/webhooks)。

签名包/审核页细节见 [FAMILY_PLUS_SIGNED_RC.md](FAMILY_PLUS_SIGNED_RC.md)，
Recovery 机制见 [BILLING_RECOVERY.md](BILLING_RECOVERY.md)。

## Historical implementation and capacity evidence — 2026-10-24

## 1.4 saved-media capacity release contract

The user has accepted the real Apple Sandbox monthly purchase, Family A sharing,
Family B isolation and the subsequent Chat fix. These are not rerun here. The
Sandbox purchase window is closed. The older task/deployment statements below
are historical implementation notes, not instructions to activate a project.

The 1.4 storage promise is **saved Journal media**: Free 300 MiB, Plus 5 GiB,
including photos, videos, thumbnails and completed unpublished objects. Avatars
remain excluded. The final Storage commit gate is authoritative for legacy
direct uploads, TUS completion and quota-aware sessions. Monthly video counts
are not a launch restriction or a paid benefit. Historical media stays readable,
downloadable and deletable after expiry or downgrade.

`20261024114459_family_media_capacity_release_readiness.sql` adds one private
default-false operator acknowledgement, `legacy_tus_residual_risk_accepted`.
Production checkout still requires Billing enabled, `release_ready`, active
capacity enforcement, its installed/enabled commit trigger and the capacity
epoch checks; each purchase also checks trusted Family metering. In addition,
it requires either actual `legacy_tus_admission_verified` evidence **or** explicit
acceptance of the residual temporary-upload cost described here. Installing the
forward accepts nothing and enables nothing. There is no client setter or new
public approval RPC. Never set the strict-admission fact true merely to approve
the residual risk. No existing migration, upload protocol, policy, settlement,
subscription entitlement or Transition definition is changed.

Before a separately authorized activation, verify these platform controls:

- Use a project global upload limit of **26,214,400 bytes (25 MiB)**, alongside
  the existing bucket limits: photos 8 MiB, videos 25 MiB, thumbnails 2 MiB.
  The tested Storage version consults the global limit during TUS creation, so
  bucket limits alone are not proof of the creation-request bound. The isolated
  HTTP test verifies that declaring 25 MiB + 1 is rejected before a URL/parts are
  issued under the proposed global setting. No cloud/global setting is changed
  by this task; the matching setting must be checked at deployment preparation.
- Retain authenticated membership/path RLS, current resumable-upload expiry and
  explicit TUS termination on cancellation. The existing client already calls
  `abort(true)`; no change to the 1.3 upload protocol is required.
- Confirm the hosted backend's abandoned multipart **physical cleanup** timing
  and cost/abuse monitoring with Supabase. A URL valid for up to 24 hours is not
  evidence that bytes are reclaimed within 24 hours. A File backend test is not
  proof of the hosted S3 lifecycle. Do not use the final-object usage ledger as
  a measure of unfinished-part costs.

**Residual risk is not a strict temporary-storage quota.** With `N` unfinished
sessions and an effective global upload limit `L`, payload exposure is on the
order of `N × L`, plus backend bookkeeping and transfer overhead. At 25 MiB,
10 near-complete abandoned sessions approach 250 MiB; 1,000 approach 24.4 GiB.
There is no verified per-Family bound on `N`, so there is no defensible fixed
per-Family worst-case byte total. Supabase's `TUS_MAX_CONCURRENT_UPLOADS` maps to
concurrent part uploads, not to the number of retained Family sessions. Normal
failed/cancelled uploads have the existing cleanup/termination path; deliberate
repeated abandonment remains a platform cost/abuse risk. Approval must explicitly
accept that residual exposure after reviewing the actual platform settings,
cleanup and operating budget. Otherwise keep checkout closed. This does not
weaken or waive the 300 MiB / 5 GiB limit on saved media.

The 53rd forward remains compatible: first authorized Production capacity
activation snapshots existing over-300-MiB Free Families once, grants 1 GiB for
360 server hours, and leaves Plus higher priority. Expiry denies only new media;
it deletes nothing. New Families, login changes and Pet changes cannot reset it.

Targeted capacity HTTP/SQL and fifteen-day Transition tests cover these forwards
in disposable local databases. There is no Production/Sandbox deployment, no
persistent Local migration, no approval acknowledgement and no switch activation
in this task. RC organization/deployment preparation can proceed; charging is
still gated on the separately reviewed deployment and explicit risk decision.

This records implemented code and remaining release work. It does not authorize a deployment or activate billing. Production is still 1.3.0 (10). No cloud or persistent Local migrations were applied in this task. The capacity release-readiness forward was the 54th migration; the existing 53 files were unchanged by it. The subsequent signed-RC work adds the 55th forward described above.

## Implemented flow (historical deployment snapshot)

The existing `/family-plus` page reads the authenticated Family Summary, canonical role, billing readiness and Release Lock. An eligible Owner sees prices from RevenueCat Offering `default`, monthly/annual packages mapped exactly to `homeypaw.familyplus.monthly` / `homeypaw.familyplus.yearly`. No hardcoded USD price is used in this flow. The old local Preview still uses explicitly labelled reference prices.

Before StoreKit, the server reconciles the payer, issues a Family-bound purchase intent, and the client marks it pending. Native purchase, restore and Apple subscription management are connected to the same screen. A client purchase result never grants Family Plus. The authenticated webhook and RevenueCat server lookup produce the Family entitlement, with transaction-chain uniqueness, environment checks and refresh generation fencing. Members read the same Family Summary. Pending/ambiguous results retain the intent; cancellation is recorded explicitly. Existing trusted chains can reconcile without event history. A new empty payer can pass preflight without a nonexistent transaction anchor. Missing anchors with pending transactions remain pending, never guessed.

RevenueCat App User ID is the authenticated Supabase UUID. Logout/account changes invalidate in-flight actions. The SDK is never configured anonymously; the next verified identity uses `logIn`. Existing random prototype payer IDs are NOT reassigned: these require review before testing. Deleted account links can become null while the payer/transaction records remain, preserving the Family binding. Owner transfer does not transfer Apple payment responsibility. Restore cannot claim another Family's transaction.

New forward migrations, not yet deployed:

- `20261023044929_family_billing_auth_identity.sql`: new payer identity uses Auth UUID; incompatible prototype identities fail closed.
- `20261023045414_family_billing_release_contract.sql`: explicit Sandbox/Production separation, default `release_ready=false`, checkout readiness, environment-scoped Summary and entitlements. A purchase intent initializes media accounting using trusted Storage metadata. Summary itself remains read-only. Provider renewals/refunds/revocations remain processable when checkout readiness is closed.

- `20261023055340_family_media_capacity_enforcement.sql`: capacity-only final commit enforcement, activation coverage, incremental settlement and no monthly video limit; remains OFF.

Billing readiness and checkout readiness are separate: existing subscribers can restore/manage Apple subscriptions while new checkout is closed, provided the reviewed billing runtime is enabled and Release Lock allows the operation. Setting the global Billing switch OFF or Release Lock ON still blocks all native billing operations.

## Run the existing app against Sandbox

No credentials are supplied by this document. The developer must copy `supabase/family-plus-client.example.json` into a repository-external directory (0700), with the JSON file 0600 and owned by the current user. Fill only the **Sandbox** public values. Never use a service role/secret key in an app.

- `projectRef`: `yhxxsawcaffxonpconaq`
- `supabaseUrl`: `https://yhxxsawcaffxonpconaq.supabase.co`
- `publishableKey`: this Sandbox's publishable key or project-attributed legacy anon JWT
- `applePublicKey`: the RevenueCat Apple App's `appl_` public SDK key, never a `test_` key
- `billingEnabled`: keep `false` until a separately approved purchase test window

Validate configuration without starting anything:

```sh
npm run start:sandbox -- --config /absolute/path/to/family-plus-client.json --check
```

When ready to open an already installed iOS Development Build, use the same command without `--check`. It starts Metro only; it does not build or open a simulator. Dotenv loading is disabled and inherited Supabase/RevenueCat/billing variables are stripped. Missing/incorrect Sandbox configuration cannot fall back to Production `.env.local`. This local validation does not authenticate the cloud project or verify opaque publishable-key ownership; confirm its Dashboard source separately. Sign in with an existing Sandbox test account, then use Me → Family plan or Manage Family → Family plan. Cloud data is shown without mock Preview controls. Unknown usage remains unknown. Release Lock ON and Billing OFF keep purchases disabled while Summary remains readable.

`eas.json` includes a separate `billing-sandbox` Development Build profile with the Sandbox target but no keys. Public keys must be supplied in its development environment, including `EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY` and `EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY`. Expo Go cannot run this native IAP integration. Development/Ad Hoc signing with Dev Launcher is supported; App Store signing is rejected on the Sandbox development path. An existing Dev Client requires rebuilding only if it lacks the installed native purchases SDK/version. No EAS Build has been run.

## Backend configuration required before real test purchases

Obtain separate approval before applying the three new migrations or deploying either `family-billing-webhook` or `family-billing-reconcile` to Sandbox. Do not use the CLI's default linked project (it may be Production). Use the existing reviewed explicit-target deployment procedure. This document intentionally does not substitute an unverified deploy command.

The runtime reads these **server-only** variables from Secret management:

- `FAMILY_BILLING_ENVIRONMENT=SANDBOX`, `FAMILY_BILLING_TARGET_MODE=cloud`
- `FAMILY_BILLING_SANDBOX_PROJECT_REF`, `FAMILY_BILLING_SUPABASE_URL`
- `FAMILY_BILLING_SERVICE_ROLE_KEY`, `FAMILY_BILLING_ANON_KEY`: legacy JWT credentials attributable to the same project; newer opaque server keys are deliberately rejected by the current guard
- `REVENUECAT_PROJECT_ID`, `REVENUECAT_SECRET_API_KEY` (API v2 access for customers/subscriptions, products, subscription entitlements/transactions, and customer event anchors)
- `REVENUECAT_WEBHOOK_AUTH_SECRET`, `FAMILY_BILLING_RECONCILE_SECRET`: independent random secrets of at least 32 characters

`DENO_DEPLOYMENT_ID` is supplied by the platform, never invented. Database config must name that same RevenueCat Project, Apple App, entitlement (`family_plus` lookup key or its verified API entitlement ID), and the exact store Product IDs. Backend and client flags remain OFF until the approved test window. RevenueCat webhook points only to the deployed Sandbox HTTPS endpoint and uses the configured `Authorization: Bearer <secret>` header. It is not an invented HMAC signature. External webhook JWT gateway behavior must follow the existing function config; the handler still authenticates Authorization. Reconciliation uses verified user JWTs or the separate internal recovery secret; Admin keys are never used as ordinary app identities.

Recovery needs a separately deployed scheduler: call the existing authenticated reconcile recovery operation periodically, with the secret in a trusted scheduler/Secret store, bounded batches and deferred retries. Alert on growing deferred counts, repeated provider failures, identity/chain mismatches and `pending_chain_anchor`. Human review must not automatically move a transaction to another Family. No scheduler or webhook has been configured in this task.

## Actual release blockers

1. **Capacity activation:** the 52nd forward supplies final-object enforcement for legacy direct and TUS uploads. The 54th explicitly separates this saved-media contract from residual unfinished-part costs. The tested >=12 MiB with four Family bytes available remains real evidence, not a fixed worst-case bound. Do not call it strict temporary-byte quota readiness. Production remains closed until reviewed activation and either verified admission or explicit operator risk acceptance; see the controls above. No client-version bypass, forced upgrade or cloud activation occurs here.
2. **No charge without usable benefits:** final capacity enforcement, the installed commit gate, trusted per-Family metering and release approval remain mandatory. Monthly video limits are excluded from 1.4 launch. Historical media and core care remain available. No Transition is started by installing these forwards.
3. **Provider integration:** deploy reviewed backend changes to the isolated Sandbox, configure its secrets, database provider identity, authenticated webhook and recovery scheduling. Test API v2 response fields/permissions and first transaction anchoring with the real RevenueCat Apple App. This task has only simulated provider events and isolated SQL tests, not real IAP.
4. **App Store / RevenueCat:** verify Paid Apps Agreement, bank/tax status, a subscription group, both auto-renewable products with metadata/localizations/availability/prices/review information, linked to the correct Bundle ID. Configure RevenueCat Apple App credentials, products, `family_plus`, `default`, `$rc_monthly` and `$rc_annual`. Keep restore behavior **Keep with original App User ID**, Sandbox restore override OFF. Handle webhook/reconcile environments separately. Apple purchase status and local prices are authoritative.
5. **Release/legal:** review and publish subscription privacy/terms additions at the existing URLs; update App Store Connect Purchases → Purchase History and linked User ID disclosure. Bundled copy and repository drafts were updated, the website and ASC were not. Prepare the 1.4.0 version/build change and submission only after the real closure passes; this task retained 1.3.0 (10).

The future Production route additionally requires `FAMILY_BILLING_ENVIRONMENT=PRODUCTION`, `FAMILY_BILLING_TARGET_MODE=production` (not `cloud`) and the explicit `FAMILY_BILLING_PROJECT_REF`. It has independent default-OFF flags (`EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED`, runtime `FAMILY_BILLING_ENABLED` + `FAMILY_BILLING_RELEASE_APPROVED`), project-bound credentials and the server checkout gate above. None is authorization to enable it now. Client flags, bundle ID and signing never replace backend Family/transaction checks. Closing checkout must not stop processing valid renewals/refunds. App Review/TestFlight purchases use Apple's test environment; an App Store review plan must respect the no-Sandbox-entitlement-in-Production boundary instead of weakening environment validation. This has not been exercised on a real device.

## Verification result

- TypeScript, Deno Edge typecheck, changed-file ESLint, Prettier, i18n parity, dependency alignment and `git diff --check`: PASS. Deno `npm:` imports use Deno resolution; targeted Edge ESLint disables only Node's `import/no-unresolved` for those imports, with Deno performing real resolution.
- Billing Client, Target Guard, grace/access boundaries, new integration hook/config tests, existing Family Plus UI/Data Adapter, Profile, Home/Schedule navigation, Family Chat, Care Completion Time, Reminder Recurrence and Journal Read Receipts client regressions: PASS.
- Billing SQL and Webhook mock verifier: PASS on independent temporary standard Supabase stacks, including all 51 forward migrations. Existing quota/recovery assertions retained. Temporary containers/volumes removed and persistent Local row fingerprints/history verified unchanged. No original 49 migration file was changed.
- Native SDK version: `react-native-purchases@10.13.0`; Expo `57.0.22`; Supabase client `2.112.3`. No app dependency upgrade.
- Whole-repository ESLint is not green: existing screenshot-script `Buffer` lint, generated temporary Edge bundles, `expo-env.d.ts` formatting and Node lint resolution of Deno `npm:` imports remain baseline issues. No unrelated fixes or lint disabling were applied to hide them. Changed-source lint and Edge typecheck pass.
- Real Apple purchases, live RevenueCat response validation, cloud deployments, persistent Local migrations, website publication, App Store Connect updates, EAS Build and simulator/device testing: NOT RUN. Production was not connected. Billing/Quota/Transition/Release Lock settings were not changed. Version/build remain 1.3.0/10; Git HEAD stays at the requested baseline with no staging, commit or push.

## Manual physical-device acceptance

Only after an approved Sandbox purchase window: confirm the device connects to the Sandbox, the native Development Build includes `react-native-purchases`, and Apple Sandbox Tester is selected. Verify localized Hong Kong prices, monthly and annual purchase separately, cancellation/failure/pending, no duplicate taps, restore, Apple subscription management, renewal/cancel-active/grace/retry/expiry/refund/revocation. Confirm Owner A receives a server-confirmed Plus Summary, Member A reads the same Family entitlement, Owner B cannot claim it, and no client success grants Plus before the server. Verify logout/account changes, Owner transfer, payer exit/deletion and relaunch without cross-Family entitlement transfer. Inspect actual provider webhook/recovery evidence. Do not call a mock PASS an Apple purchase PASS. Restore Release Lock/Billing test settings after the window, retaining provider processing as needed for existing test transactions.

Sources reviewed: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), [RevenueCat Apple App Privacy](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy), [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks).

## Historical capacity-only baseline before 2026-10-24

The strict all-bytes gate below was the earlier release baseline. The current
saved-media contract and explicit residual-cost decision at the top supersede
that launch decision; the transport evidence and unresolved strict-admission
limitation remain valid.

- Release verdict: **NO-GO for a strict all-bytes Family hard quota** until legacy TUS admission is fixed. Finalized-object capacity tests PASS; the unfinished-part counterexample is deliberately retained and Production checkout is blocked by default. A passing regression process is not a full hard-quota release approval.
- Forward migration `20261023055340_family_media_capacity_enforcement.sql`; no existing migration edits or persistent/cloud application. Billing/Enforcement defaults stay OFF. It removes the prototype-only prohibition on a future explicitly approved activation, without enabling anything.
- Storage itself supplies final `metadata.size`. A trigger writes only private accounting tables, never inserts/deletes Storage metadata itself. Existing RLS, bucket limits and public create/update Post RPCs are unchanged. Authenticated SQL callers cannot impersonate the Storage backend or its rollback-only permission probe. No client Plus/version/size assertion authorizes capacity.
- Family membership is held through commit. The same Family lock serializes actual bytes and outstanding reservations across members, direct uploads, TUS finalization, thumbnails, retries and deletes. A preauthorized TUS URL cannot bypass changed capacity, membership, session cancellation or expiry. Full-size unknown measurements fail closed. Deleted Post references do not refund storage before actual Storage API deletion/confirmed cleanup.
- An activation coverage epoch invalidates OFF-era observations. Object commits hold a shared policy lock, so an activation scan cannot overlook an in-flight OFF upload. Only a trusted full scan certifies that epoch; ordinary total refresh/cleanup acknowledgements cannot create fake ready/zero. Afterwards new writes settle incrementally instead of rewriting every historical object. Pending/uninitialized Summary remains read-only and nullable.
- Capacity means finalized Journal objects plus held quota reservations. Incomplete TUS transport parts are not published media; abandoning transport still relies on the platform's temporary-upload cleanup. Rejected final Standard/TUS uploads must remove backend data/transport, not merely disappear from the registry. Explicit TUS termination and rejected-final cleanup passed, but abandoned unfinished parts are NOT Family-budgeted; this is an unresolved launch blocker, not a generic cleanup warning.
- Supabase recommends treating Storage schema/data as read-only. This solution deliberately adds a narrow trigger (no changes to its columns/policies/functions or data by app SQL); it depends on a platform finalization contract. Local tested image: `supabase/storage-api:v1.77.5`, actual final writer `session_user=supabase_storage_admin`, role `service_role`. Unexpected final writer roles fail closed. Do not label an untested cloud Storage version production-ready.
- Current finalized-object capacity verification: PASS for real legacy Standard/TUS HTTP, Free/Plus boundaries, concurrent members, forged metadata/SQL-role denial, duplicate/upsert rejection, deletion refund, rejected backend file removal, TUS replay/termination and membership revocation, cancel/expiry, activation races/coverage, incremental registry writes, old quota/cleanup/summary assertions and switches OFF. It replayed the three new forwards over an isolated clone of the applied Local schema; it did not repeat a full blank initialization. TypeScript, changed-source ESLint, Prettier, i18n, Family Plus UI/Data Adapter and Billing Client regressions pass.
- Minimal remaining repair: a trusted TUS admission layer must atomically reserve the server-enforced upload-length upper bound under the same Family lock before accepting parts; finalize settles measured bytes and trusted termination/absence releases the reserve. Storage RLS dry-run side effects cannot provide this. First determine whether the hosted platform supports such admission hooks; this repository does not claim a nonexistent Supabase Dashboard setting. If it cannot be added to the fixed 1.3.0 direct endpoint, make only video uploads use the quota-aware protocol in the next client and enforce server-side session binding for videos. Old clients would need a video-upload-only update path; photos, historical media and core care need not be forced to upgrade. That compatibility change needs explicit product approval and is NOT enabled or silently implemented here. Cloud Storage final-write role/cleanup compatibility also remains unverified, as no cloud was touched.
- Targeted command: `npm run verify:family-media-capacity`. Uses the existing isolated media helper, independent database and file-backed Storage container. Baseline near-cap byte totals are synthetic fixtures; the final Standard/TUS requests, returned metadata, rejection, removal, membership and concurrency behavior use real HTTP. No large real household media is read/copied.

Platform references: [Supabase Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design), [tested v1.77.5 finalization implementation](https://github.com/supabase/storage/blob/v1.77.5/src/storage/uploader.ts). These describe the integration dependency; they do not replace the real HTTP evidence or authorize changing a cloud project.

## Actual changed-file manifest

- `.env.example`
- `.gitignore`
- `docs/APP_PRIVACY_DATA_INVENTORY.md`
- `docs/FAMILY_PLUS_LAUNCH.md`
- `docs/PRIVACY_POLICY.md`
- `docs/TERMS_OF_SERVICE.md`
- `eas.json`
- `package.json`
- `scripts/sql/family-billing-release.sql`
- `scripts/sql/family-plus-read-summary.sql`
- `scripts/sql/family-storage-quota-prototype.sql`
- `scripts/start-family-plus-sandbox.mjs`
- `scripts/verify-family-billing-client.mjs`
- `scripts/verify-family-billing-sql.mjs`
- `scripts/verify-family-media-capacity.mjs`
- `scripts/verify-family-plus-data-client.mjs`
- `scripts/verify-family-plus-data-sql.mjs`
- `scripts/verify-family-plus-integration.mjs`
- `scripts/verify-family-plus-ui.mjs`
- `scripts/verify-profile-ui.mjs`
- `scripts/verify-release-config.mjs`
- `src/app/_layout.tsx`
- `src/app/family-plus.tsx`
- `src/features/auth/auth-context.tsx`
- `src/features/billing/billing-client.ts`
- `src/features/billing/billing-sandbox-gate.ts`
- `src/features/billing/components/family-plus-badge.tsx`
- `src/features/billing/components/family-storage-summary.tsx`
- `src/features/billing/family-plus-api.ts`
- `src/features/billing/family-plus-data.ts`
- `src/features/billing/family-plus-environment.ts`
- `src/features/billing/family-plus-sandbox-screen.tsx`
- `src/features/billing/family-plus-screen.tsx`
- `src/features/billing/use-family-plus-preview.tsx`
- `src/features/billing/use-family-plus-purchases.ts`
- `src/features/billing/use-family-plus.ts`
- `src/features/family/family-settings-screen.tsx`
- `src/features/profile/profile-screen.tsx`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-HK.json`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/environment.ts`
- `src/types/database.ts`
- `supabase/family-plus-client.example.json`
- `supabase/functions/_shared/family-billing-runtime.ts`
- `supabase/functions/_shared/family-billing-sandbox.mjs`
- `supabase/functions/_shared/family-billing-target.mjs`
- `supabase/functions/billing-sandbox.env.example`
- `supabase/migrations/20261023044929_family_billing_auth_identity.sql`
- `supabase/migrations/20261023045414_family_billing_release_contract.sql`
- `supabase/migrations/20261023055340_family_media_capacity_enforcement.sql`

## Fifteen-day existing-Family transition (not activated)

Forward `20261023074855_family_media_transition_fifteen_days.sql` preserves the existing 1 GiB Transition tier. At the first Production OFF→ON capacity-policy activation only, a server timestamp freezes the cohort: existing Free Families whose trusted Journal media total is strictly above 300 MiB receive a single `[start, start + 360 hours)` window. Exactly 300 MiB and new Families do not qualify; unknown/unmappable bytes abort activation atomically. A policy-row lock serializes Storage commits during the one-time metadata scan. Re-enabling quotas, account/member/Pet changes cannot restart the window. Plus remains higher priority, including an upgrade during the transition. Expiry uses the existing capacity gate and deletes nothing.

The Summary adds optional server transition dates; the client uses server time plus monotonic elapsed time for remaining days and localized deadlines. Older Summary versions remain readable without invented dates; Preview has no real deadline. Existing zh-HK/en copy now says 15 days. No monthly-video rule, Apple lifecycle, Billing Grace Period, Release Lock or enforcement default is changed. Installation does not create a cohort, enable a switch or deploy anything. Targeted isolated verification: `node scripts/verify-family-media-transition.mjs`; the temporary fixture writes roll back and the helper verifies persistent Local fingerprints are unchanged.

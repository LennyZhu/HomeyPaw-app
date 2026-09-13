# HomeyPaw Production Readiness

## Current Release Status

- App Store `1.0.0`：**RELEASED**。
- HomeyPaw `1.1.0` Build 4：automated release gate、TestFlight、雙裝置真機驗收、iPhone／iPad validation 全部完成。
- App Store Review：**SUBMITTED — WAITING FOR REVIEW**。
- Release mode：**MANUAL RELEASE**。即使審核通過，也必須由 release operator 人工發布。
- Production Supabase：**LIVE**。
- 本轮 documentation sync：Production、App code、database、Edge Functions 和 EAS resources 全部 **UNCHANGED**。

不得把 `1.1.0` 描述為 approved、released 或 available on the App Store。

## Production Baseline

| Area                  | Status    | Baseline                                                                                                |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| Bundle identity       | PASS      | `com.zhushunli.homeypaw`                                                                                |
| Version／build        | PASS      | `1.1.0 (4)`                                                                                             |
| iPhone／iPad          | PASS      | Production build 與 real-device layout／navigation 已驗證                                               |
| EAS project／profiles | PASS      | development、development-simulator、preview、production                                                 |
| Apple signing         | PASS      | 既有 Distribution Certificate 與 active App Store Provisioning Profile                                  |
| Push capability       | PASS      | Production `aps-environment`; Release build `get-task-allow=false`                                      |
| Production migrations | COMPLETED | Versioned migrations 已部署至 current release baseline                                                  |
| Edge Functions        | COMPLETED | Account／Pet／Post lifecycle、invite preview 與 `family-push`                                           |
| Private Storage       | COMPLETED | Pet、Journal、Profile avatar buckets 与 RLS／signed URL                                                 |
| Private Realtime      | COMPLETED | Authenticated private Broadcast；public access 不作为 Chat transport                                    |
| Push worker／TTL      | COMPLETED | Server-side recipient validation、delivery lifecycle、invalid token handling 與 expired backlog cleanup |
| TestFlight            | PASS      | Build 4 processing、installation 与 acceptance 完成                                                     |
| Two-device acceptance | PASS      | Family sharing、Chat、Remote Push、Removed Member 與 Schedule flows                                     |
| iPad validation       | PASS      | iPad layout、navigation 與 release-critical flows                                                       |
| App Store Review      | WAITING   | Build 4 已提交，尚未批准                                                                                |
| App Store release     | NOT RUN   | Manual release，等待审核完成                                                                            |

## Permissions and Platform Capabilities

| Capability            | Declared／runtime | Purpose                                          |
| --------------------- | ----------------- | ------------------------------------------------ |
| Photo Library         | Runtime request   | Pet／Profile avatar、Journal photos、save photo  |
| Camera                | Runtime request   | User-triggered Journal photo                     |
| Local Notifications   | Runtime request   | Device-local Care／Reminder scheduling           |
| Remote Notifications  | Production        | Family Journal、Care、Health、Reminder activity  |
| Exact alarm (Android) | Declared          | Android local reminder scheduling                |
| Microphone            | No                | Not implemented                                  |
| Device location       | No                | Journal location is user-entered text            |
| Contacts              | No                | Not implemented                                  |
| Tracking／IDFA        | No                | No advertising or cross-app tracking             |
| Chat Push             | No                | Chat does not generate system Push Notifications |

## Security and Privacy Gate

- Private by default；Owner／Member authorization 由 Postgres RLS、restricted RPC 与 server-side Edge Functions 强制执行。
- Storage buckets 不公开，媒体通过短期 signed URL 读取。
- Realtime channels 是 private；broadcast 只触发 canonical row refetch。
- Removed Member 后 row／Storage／Realtime／unread／Remote Push access 全部撤销，active Pet 与 scoped cache 被清理。
- Family Push 的 recipient、membership、actor-self exclusion 与 TTL 都由服务器端确认；notification copy 不包含私人内容正文。
- Client bundle 只包含 public Supabase configuration，永不包含 service-role／secret、数据库密码、Expo Access Token、Vault secret 或 Apple credential。
- Production errors／logs 不得记录 password、token、signed URL、email、private message 或 request payload。

## Release Validation

Build 4 release record：

- TypeScript、ESLint、Prettier、i18n parity：PASS。
- Chat client／UI／Realtime／RLS：PASS。
- Removed Member UX／cold restart：PASS。
- Journal、Home、Care、Health、Reminder recurrence／RLS：PASS。
- Family Push、Push worker／TTL：PASS。
- Schedule UI／RLS、Schedule → Reminder、occurrence reschedule：PASS。
- Profile、iPad、Edge ACL／lifecycle：PASS。
- `git diff --check`：PASS。
- npm audit：critical `0`、high `0`；moderate `15` 為已知 transitive baseline。

詳細真機結果見 [REAL_DEVICE_TEST_MATRIX.md](REAL_DEVICE_TEST_MATRIX.md)。

## Product Boundaries and Deferred Work

- Chat 是私人家庭文字 Chat，不提供图片、公开发现、陌生人 messaging 或 Chat system Push。
- Cached reads 可離線顯示；offline mutations 沒有 background queue，使用者需在恢复网络后重试。
- Journal comments／likes／reactions、Journal gallery、Chat images、Schedule advanced recurrence／series、notification history center 仍为 deferred。
- 從未開啟、自然過期的 Password Recovery link 尚無獨立真機樣本，不得記為 PASS。

## App Review and Manual Release

当前可准确使用的状态语言：

```text
HomeyPaw 1.1.0 Build 4
Submitted to App Store Review
Waiting for Review
Manual release
```

下一步只在 App Store Connect 状态变化后执行：处理 review feedback，或在审核通过后由 release operator 决定何时 manual release。不要在审核完成前宣称 `1.1.0` 已可用。

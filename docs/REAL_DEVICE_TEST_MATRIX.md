# HomeyPaw 1.1.0 Build 4 Real-Device Test Matrix

## Release Result

- Version／build：`1.1.0 (4)`
- Bundle Identifier：`com.zhushunli.homeypaw`
- Distribution：TestFlight production-signed build；不依賴 Metro、Development Build launcher 或 developer menu
- Devices：iPhone + iPad，並完成雙帳戶／雙裝置家庭流程
- Result：**PASS**
- App Store Connect：submitted to App Store Review，`Waiting for Review`

以下結果整合既有 real-device acceptance 與 Build 4 release record。無明確證據的項目不会標記 PASS。

## Core Acceptance

| Area                             | Result | Acceptance evidence                                                                                       |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Install／launch／session restore | PASS   | TestFlight cold launch、background／foreground 與 authenticated session restore 正常                      |
| Email auth／confirmation         | PASS   | Sign up、confirmation deep link、sign in／out 正常                                                        |
| Password recovery                | PASS   | Recovery deep link、設定新密碼、session cleanup 與新密碼登入正常                                          |
| Profile／Profile avatar          | PASS   | Display name、locale、avatar 與重新啟動 persistence 正常                                                  |
| Pet／Family invite               | PASS   | Owner 建立邀請、Member 加入、家庭上限與角色權限正常                                                       |
| Journal                          | PASS   | 文字與 1／3／9 圖、時間線、背景 refetch、cached re-entry 正常                                             |
| Photo                            | PASS   | Photo Library／Camera、HEIC、直／橫圖、Live Photo 靜態輸出、viewer、save photo 正常                       |
| Care／Today Care                 | PASS   | Feeding、walking、medication、grooming、play／other 與家庭可見性正常                                      |
| Health／Birthday／Yearly         | PASS   | Health records、Birthday、Yearly recurrence 與 time-zone boundary 正常                                    |
| Reminder                         | PASS   | Once／Daily／Weekly／Monthly／Yearly、Complete／Undo 與 Care Log integration 正常                         |
| Local notification               | PASS   | Permission、deny／Settings recovery、lock screen、background、cold-start tap 與 user-switch cleanup 正常  |
| Schedule                         | PASS   | Create、Owner manage、Member claim／self schedule、多照顧者與日曆顯示正常                                 |
| Schedule occurrence              | PASS   | Care Task occurrence create／claim／complete／cancel／reschedule 正常                                     |
| Schedule → Reminder return       | PASS   | 建立 Reminder 後返回 Schedule 并選中新的 task 正常                                                        |
| Chat history                     | PASS   | PostgreSQL canonical history、send／edit／delete、分頁與 retry 正常                                       |
| Chat Realtime                    | PASS   | Owner／Member private Realtime、active Pet channel rotation、background／foreground 正常                  |
| Chat unread badge／read state    | PASS   | 新訊息 badge、進入 Chat read state、切換 Pet／帳戶與重啟結果正常                                          |
| Chat cache／SWR                  | PASS   | Cached re-entry 不被 reconnect spinner 取代；背景 refetch 保持内容可见                                    |
| Family Remote Push               | PASS   | Journal、Care、Health、Reminder 双裝置 delivery；actor self 零 Push；privacy-safe copy 正常               |
| Push TTL／backlog                | PASS   | 有效事件正常送达，过期 outbox／delivery 不补送                                                            |
| Removed Member                   | PASS   | Row／Storage access、Chat Realtime、unread、Remote Push 均归零                                            |
| Removed Member cold restart      | PASS   | Revoked Pet 不会从 user-scoped persistence 恢复；旧 Journal cache 隐藏且 no-family state 不会无限 loading |
| Account deletion                 | PASS   | App 内永久删除、session／cache cleanup 与旧 credentials 失效正常                                          |
| Deep links                       | PASS   | `pawday://check-email`、`pawday://reset-password` 的 cold／foreground flow 正常                           |
| Offline／reconnect               | PASS   | Cached read、失败写入保留输入、恢复网络重试正常                                                           |
| iPhone layout／accessibility     | PASS   | Dynamic Island、Home Indicator、键盘、Safe Area、Dynamic Type 与主要 VoiceOver flow 正常                  |
| iPad layout／navigation          | PASS   | iPad native layout、tabs、主要 forms／viewer／Schedule／Chat flows 正常                                   |

## Two-Account／Two-Device Security

- [x] Owner A 與 Member B 可看見同一 Pet 的授權 Journal、Care、Health、Reminder、Schedule 與 Chat。
- [x] A／B 的 mutation 在另一裝置經 refresh、Realtime 或 Remote Push 正確反映。
- [x] Actor 自己不收到其 Family Remote Push。
- [x] Owner 移除 Member 後，Member 不需重新登入即失去 Pet 與所有 scoped content access。
- [x] Removed Member 的 Chat subscription 被撤銷，unread 歸零，且不收到後續 Remote Push。
- [x] 冷啟動不恢復 revoked Pet 或其 cached Journal；no-family state 可正常操作。

## Known Deferred Evidence

- **NOT RUN / non-blocking accepted risk:** 一條從未在 App 開啟、自然過期的 Password Recovery link 缺少可用真機樣本。已使用／失效 link 的友好錯誤、無原始 Supabase text 與 retry path 已驗證。

此 deferred evidence 不得寫成 PASS，也不改變 Build 4 已記錄的 release acceptance result。

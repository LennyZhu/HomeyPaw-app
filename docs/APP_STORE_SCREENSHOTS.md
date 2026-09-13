# App Store Screenshot Plan — HomeyPaw 1.1.0

Target the Hong Kong Traditional Chinese storefront first, then use the same product states and claims for English localization. Use genuine production UI and do not expose account email, invite codes, development controls, backend URLs, test labels, or other private data.

## Current Five-Screen Story

1. **一家人，一起照顧毛孩** — Home、Today Care、Reminder 與家庭動態。
2. **把每個可愛瞬間留下來** — Journal、1–9 張相片與私人時間線。
3. **誰照顧、哪一天，一目了然** — 家庭 Schedule、照顧者與 Care Task occurrence。
4. **屬於家人的私人聊天室** — 只限同一 Pet Family Space 的私人文字 Chat。
5. **一個毛孩，一個家庭空間** — Pet、Owner／Member、家庭邀請與管理入口。

## Capture Rules

- iPhone 與 13-inch iPad 使用 App Store Connect 當前接受的精確尺寸；同一 device slot 的全部圖片保持相同尺寸與方向。
- PNG／JPEG 不得包含 alpha channel。
- 使用 production／TestFlight UI；移除 Expo Development Build tools、Simulator outer chrome 與 debug text。
- 保留真實 App 結構、按鈕含義和資料模型，不增加不存在的功能或陌生人／公開社群情境。
- 狀態列、Dynamic Island／Home Indicator、iPad navigation 與 Safe Area 必須自然且無遮擋。
- Marketing copy 可以說明私人 Chat 與 Journal／Care／Health／Reminder Remote Push；不得暗示 Chat system Push、醫療建議、AI、公開 feed 或尚未實作的 deferred features。
- 所有可見人物、Pet 和家庭資料使用安全展示資料；不顯示真實 email、token、URL 或邀請碼。

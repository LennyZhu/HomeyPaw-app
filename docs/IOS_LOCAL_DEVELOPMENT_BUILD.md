# HomeyPaw 本地 iOS Development Build

本文只适用于本地 Debug／Development Build 和已开启 Developer Mode 的真实 iPhone。不得把以下补签步骤用于 Release、Archive、TestFlight、App Store 或任何 Distribution 构建。

## 固定边界

- Workspace：`ios/HomeyPaw.xcworkspace`
- Scheme／Target／Product：`HomeyPaw`
- Configuration：`Debug`
- Bundle Identifier：`com.zhushunli.pawday`
- Signing：Xcode Automatic Signing + 当前 Personal Team 的 Apple Development 身份
- 不创建或使用 Distribution certificate、Distribution provisioning profile 或 App Store archive

## 首选可重复流程

1. 用数据线连接已信任且开启 Developer Mode 的 iPhone。
2. 确认 Xcode 已登录 Apple Account，并在 `HomeyPaw` target 的 Signing & Capabilities 中选择当前 Personal Team 和 Automatic Signing。
3. 在项目根目录运行：

   ```sh
   npx expo run:ios --device --configuration Debug
   ```

   选择已连接的 iPhone。该命令负责本地编译、签名、安装并启动 Development Build。

4. 后续只有 JavaScript／TypeScript 改动时不重建原生 App，运行：

   ```sh
   npx expo start --dev-client --lan
   ```

5. 修改原生配置、config plugin、原生依赖或 `ios/` 后，再执行第 3 步。

Expo 的本地开发流程以 `npx expo run:ios --device` 作为真实设备 Debug build 入口；项目不得用 Expo Go 代替 Phase 8 真机验收。

## Xcode 26.6 已见异常

一次命令行 Debug build 生成了主 App，但以下嵌入 Framework 没有有效签名，安装时由 iPhone 返回 `ApplicationVerificationFailed`：

- `ExpoModulesJSI.framework`
- `React.framework`
- `ReactNativeDependencies.framework`
- `hermesvm.framework`

这不是 Push entitlement 问题，也不应通过增加 Distribution capability、关闭签名检查或修改 Release signing 解决。

## 安装前检查

先在 Xcode 的 Report Navigator 确认构建为 `Debug` 且主 App 使用 Apple Development 身份。然后对实际生成的 `HomeyPaw.app` 执行：

```sh
/usr/bin/codesign -d --verbose=2 "/absolute/path/to/HomeyPaw.app"
/usr/bin/codesign -d --verbose=2 "/absolute/path/to/HomeyPaw.app/Frameworks/ExpoModulesJSI.framework"
/usr/bin/codesign -d --verbose=2 "/absolute/path/to/HomeyPaw.app/Frameworks/React.framework"
/usr/bin/codesign -d --verbose=2 "/absolute/path/to/HomeyPaw.app/Frameworks/ReactNativeDependencies.framework"
/usr/bin/codesign -d --verbose=2 "/absolute/path/to/HomeyPaw.app/Frameworks/hermesvm.framework"
```

每个项目都必须显示 `CodeDirectory` 和相同的 `TeamIdentifier`。缺少签名时不要安装。

## 仅限本地 Debug 的后备补签

优先在 Xcode 中执行 Product → Clean Build Folder，再用 `HomeyPaw.xcworkspace`、`HomeyPaw` scheme、真实设备和 `Debug` 重新 Build & Run。只有同一异常再次出现时，才允许补签已经生成的 Debug `.app`；不要改项目的 Release signing 设置。

1. 用以下命令查看当前可用身份：

   ```sh
   security find-identity -v -p codesigning
   ```

2. 明确填写本次 Debug 产物的绝对路径和当前 Apple Development 身份的 SHA-1；不要把个人身份、设备标识或路径提交到仓库：

   ```sh
   HOMEYPAW_DEBUG_APP="/absolute/path/to/Debug-iphoneos/HomeyPaw.app"
   HOMEYPAW_DEVELOPMENT_IDENTITY="APPLE_DEVELOPMENT_SHA1"
   ```

3. 只对该 Debug 产物由内到外补签：

   ```sh
   /usr/bin/codesign --force --sign "$HOMEYPAW_DEVELOPMENT_IDENTITY" --timestamp=none "$HOMEYPAW_DEBUG_APP/Frameworks/ExpoModulesJSI.framework"
   /usr/bin/codesign --force --sign "$HOMEYPAW_DEVELOPMENT_IDENTITY" --timestamp=none "$HOMEYPAW_DEBUG_APP/Frameworks/React.framework"
   /usr/bin/codesign --force --sign "$HOMEYPAW_DEVELOPMENT_IDENTITY" --timestamp=none "$HOMEYPAW_DEBUG_APP/Frameworks/ReactNativeDependencies.framework"
   /usr/bin/codesign --force --sign "$HOMEYPAW_DEVELOPMENT_IDENTITY" --timestamp=none "$HOMEYPAW_DEBUG_APP/Frameworks/hermesvm.framework"
   /usr/bin/codesign --force --sign "$HOMEYPAW_DEVELOPMENT_IDENTITY" --timestamp=none --preserve-metadata=identifier,entitlements,flags,runtime "$HOMEYPAW_DEBUG_APP"
   ```

4. 重复“安装前检查”，并在 Xcode Devices and Simulators 中安装这个明确的 `.app`。设备成功安装及启动是最终验收。

如果 Framework 名称、TeamIdentifier、Bundle Identifier 或构建 Configuration 与本文不一致，应停止补签并重新检查原生构建配置，不能扩大补签范围。

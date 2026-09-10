import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

import { layout, contentMaxWidth } from '../src/theme/layout.ts';
import {
  getPhotoCropHeight,
  getPhotoEditorDisplayScale,
  getPhotoEditorExportSize,
} from '../src/features/posts/photo-editor-state.ts';

const read = (path) => readFileSync(path, 'utf8');
const config = JSON.parse(read('app.json')).expo;
assert.equal(config.ios.supportsTablet, true);
assert.equal(config.ios.requireFullScreen, false);
assert.equal(config.orientation, 'portrait');
assert.equal(config.scheme, 'pawday');
assert.equal(config.ios.bundleIdentifier, 'com.zhushunli.homeypaw');
assert.equal(config.version, '1.0.0');
assert.equal(config.ios.buildNumber, '1');
assert.equal(
  config.extra.eas.projectId,
  '3623de2b-5a77-48ec-b2ec-45e8136d9ac7',
);

// Exercise the installed SDK's CNG transforms, not an imitation of the plist.
const require = createRequire(import.meta.url);
const { IOSConfig } = require('expo/config-plugins');
const plist = IOSConfig.RequiresFullScreen.setRequiresFullScreen(
  config,
  IOSConfig.Orientation.setOrientation(config, {}),
);
assert.equal(plist.UIRequiresFullScreen, false);
assert(
  !plist.UISupportedInterfaceOrientations.some((value) =>
    value.includes('Landscape'),
  ),
);
assert.equal(plist['UISupportedInterfaceOrientations~ipad'].length, 4);
if (existsSync('ios/HomeyPaw/Info.plist')) {
  const generated = JSON.parse(
    execFileSync(
      'plutil',
      ['-convert', 'json', '-o', '-', 'ios/HomeyPaw/Info.plist'],
      { encoding: 'utf8' },
    ),
  );
  for (const key of [
    'UISupportedInterfaceOrientations',
    'UISupportedInterfaceOrientations~ipad',
    'UIRequiresFullScreen',
  ])
    assert.deepEqual(generated[key], plist[key]);
  const project = read('ios/HomeyPaw.xcodeproj/project.pbxproj');
  assert(project.includes('TARGETED_DEVICE_FAMILY = "1,2"'));
}
const orientationPolicy = read('src/config/orientation.ts');
assert(orientationPolicy.includes("Platform.OS === 'ios' && Platform.isPad"));
assert(orientationPolicy.includes("? ('all' as const)"));
assert(orientationPolicy.includes(": ('portrait' as const)"));
assert(
  read('src/app/_layout.tsx').includes('orientation: appScreenOrientation'),
);
for (const file of [
  'src/app/(auth)/_layout.tsx',
  'src/app/care/_layout.tsx',
  'src/app/posts/_layout.tsx',
  'src/app/reminders/_layout.tsx',
  'src/app/schedule/_layout.tsx',
]) {
  assert(read(file).includes('orientation: appScreenOrientation'));
}
for (const file of [
  'src/features/posts/components/post-photo-editor.tsx',
  'src/features/posts/components/post-photo-viewer.tsx',
]) {
  assert(read(file).includes('modalSupportedOrientations'));
}
console.log(
  'PASS: native and routed screens keep iPhone portrait while iPad supports four orientations and multitasking; release identity unchanged.',
);

assert.equal(layout.screenPadding, 20);
for (const width of [320, 375, 390, 402, 430, 600, 767]) {
  assert.equal(contentMaxWidth(width), 720);
  assert.equal(contentMaxWidth(width, 'schedule'), 720);
  assert.equal(
    Math.min(width, contentMaxWidth(width)) - 40,
    Math.min(width, 720) - 40,
  );
}
for (const width of [768, 834, 1024, 1032, 1194, 1376]) {
  assert.equal(contentMaxWidth(width), 720);
  assert.equal(contentMaxWidth(width, 'schedule'), 960);
  assert.equal(contentMaxWidth(width, 'modal'), 560);
}
const container = read('src/components/content-container.tsx');
const screen = read('src/components/screen.tsx');
assert(container.includes('useWindowDimensions()'));
assert(screen.includes('useContentLayout(contentWidth)'));
assert(screen.includes('KeyboardAvoidingView'));
assert(screen.includes('keyboardShouldPersistTaps'));
assert(read('src/components/modal-screen.tsx').includes('SafeAreaProvider'));
for (const file of [
  'src/features/journal/journal-screen.tsx',
  'src/features/care/care-history-screen.tsx',
])
  assert(read(file).includes('contentStyles.readable'));
assert(
  read('src/features/schedule/schedule-screen.tsx').includes(
    'contentWidth="schedule"',
  ),
);
const tabs = read('src/app/(tabs)/_layout.tsx');
assert.equal((tabs.match(/<Tabs.Screen/g) ?? []).length, 5);
assert(tabs.includes("tabBarLabelPosition: 'below-icon'"));
assert(tabs.includes('isWide'));
assert(tabs.includes('tabBarHideOnKeyboard: true'));
console.log(
  'PASS: compact-window/iPhone baseline, centered feed/forms, wider Schedule, five bottom tabs.',
);

// Rotate/resize a square, landscape crop and tall free canvas: the logical
// crop/export is invariant and the display always fits the measured stage.
for (const aspect of ['square', 'fourThree', 'sixteenNine', 'free']) {
  const width = 720;
  const height = getPhotoCropHeight({
    aspect,
    width,
    freeHeight: 1000,
    minimumHeight: 374.4,
    maximumHeight: 1080,
  });
  if (aspect === 'square') assert.equal(height, width);
  const output = getPhotoEditorExportSize(width, height);
  for (const [availableWidth, availableHeight] of [
    [992, 840],
    [1336, 510],
    [280, 330],
    [510, 180],
  ]) {
    const scale = getPhotoEditorDisplayScale(
      width,
      height,
      availableWidth,
      availableHeight,
    );
    assert(width * scale <= availableWidth + 0.001);
    assert(height * scale <= availableHeight + 0.001);
    assert.deepEqual(getPhotoEditorExportSize(width, height), output);
    assert.equal(Math.max(output.width, output.height), 2048);
  }
}
const editor = read('src/features/posts/components/post-photo-editor.tsx');
const viewer = read('src/features/posts/components/post-photo-viewer.tsx');
for (const source of [editor, viewer]) {
  assert(source.includes('presentationStyle="fullScreen"'));
  assert(source.includes('supportedOrientations='));
}
assert(editor.includes('const [canvasWidth] = useState'));
assert(editor.includes('getPhotoEditorDisplayScale('));
assert(editor.includes('event.translationX / displayScale'));
assert(editor.includes('styles.bottomPanel'));
assert(viewer.includes('[width, height, visible, currentIndex]'));
assert(!viewer.includes('contentStyles.readable'));
console.log(
  'PASS: bounded editor with stable resize coordinates and 2048px export; viewport-sized Viewer resynchronizes current page.',
);

for (const file of [
  'src/features/reminders/components/task-completion-modal.tsx',
  'src/features/journal/components/journal-date-filter-modal.tsx',
  'src/features/chat/components/chat-edit-message-modal.tsx',
  'src/features/chat/components/chat-members-modal.tsx',
  'src/features/pets/components/pet-switcher-modal.tsx',
])
  assert(read(file).includes('<ModalScreen'));
for (const file of [
  'src/features/create/create-screen.tsx',
  'src/features/reminders/new-care-task-screen.tsx',
  'src/features/chat/components/production-chat-message-list.tsx',
])
  assert(read(file).includes('...contentStyles.modal'));
// RN 0.86 supplies the presenting view as the default iPad popover anchor.
const actionSheet = read(
  'node_modules/react-native/React/CoreModules/RCTActionSheetManager.mm',
);
assert(
  actionSheet.includes('popoverPresentationController.sourceView = sourceView'),
);
assert(
  actionSheet.includes(
    'popoverPresentationController.sourceRect = sourceView.bounds',
  ),
);
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) inspect(path);
    else if (/\.tsx?$/.test(path)) {
      const source = read(path);
      assert(
        !/Dimensions\.get\(/.test(source),
        `${path}: launch-only dimensions`,
      );
      assert(
        !/allowFontScaling=\{false\}/.test(source),
        `${path}: disabled text scaling`,
      );
      assert(
        !/width:\s*(375|390)\b/.test(source),
        `${path}: phone canvas width`,
      );
    }
  }
}
inspect('src');
console.log(
  'PASS: bounded scrollable sheets, native iPad action-sheet anchor, live dimensions and font scaling.',
);

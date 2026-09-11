import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { clampPhotoViewerIndex } from '../src/features/posts/photo-viewer-state.ts';
import {
  getNewReminderCompletionNavigation,
  getReminderFormCancelNavigation,
} from '../src/features/reminders/reminder-navigation.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

assert.deepEqual(getNewReminderCompletionNavigation({ canGoBack: true }), {
  kind: 'back',
});
assert.deepEqual(getNewReminderCompletionNavigation({ canGoBack: false }), {
  href: '/reminders',
  kind: 'replace',
});
assert.deepEqual(
  getNewReminderCompletionNavigation({
    canGoBack: true,
    returnTo: '/schedule?date=2026-09-09',
  }),
  { href: '/schedule?date=2026-09-09', kind: 'replace' },
);
assert.deepEqual(getReminderFormCancelNavigation(true, '/reminders'), {
  kind: 'back',
});
assert.deepEqual(getReminderFormCancelNavigation(false, '/reminders/task-1'), {
  href: '/reminders/task-1',
  kind: 'replace',
});
console.log(
  'PASS: Reminder create, direct-entry fallback, Schedule return, cancel, and edit navigation.',
);

assert.equal(clampPhotoViewerIndex(0, 1), 0);
assert.equal(clampPhotoViewerIndex(2, 5), 2);
assert.equal(clampPhotoViewerIndex(-4, 5), 0);
assert.equal(clampPhotoViewerIndex(99, 5), 4);

const [
  appConfig,
  postMedia,
  postForm,
  postViewer,
  postPreview,
  postDetail,
  journal,
  rootLayout,
] = await Promise.all([
  read('app.json'),
  read('src/features/posts/post-media.ts'),
  read('src/features/posts/components/post-form.tsx'),
  read('src/features/posts/components/post-photo-viewer.tsx'),
  read('src/features/posts/components/post-media-preview.tsx'),
  read('src/features/posts/post-detail-screen.tsx'),
  read('src/features/journal/journal-screen.tsx'),
  read('src/app/_layout.tsx'),
]);

const app = JSON.parse(appConfig).expo;
const imagePickerPlugin = app.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker',
);
assert(imagePickerPlugin);
assert.equal(typeof imagePickerPlugin[1].cameraPermission, 'string');
assert.equal(imagePickerPlugin[1].microphonePermission, false);
assert.equal(typeof app.locales.en.ios.NSCameraUsageDescription, 'string');
assert.equal(
  typeof app.locales['zh-HK'].ios.NSCameraUsageDescription,
  'string',
);
assert(
  postMedia.includes("export type PostPhotoSource = 'camera' | 'library'"),
);
assert(postMedia.includes('ImagePicker.launchCameraAsync'));
assert(postMedia.includes('ImagePicker.launchImageLibraryAsync'));
assert(postMedia.includes('CAMERA_PERMISSION_DENIED'));
assert(postMedia.includes('CAMERA_PERMISSION_BLOCKED'));
assert(postMedia.includes('photos: toPostMediaDrafts(result.assets'));
assert(postMedia.includes('export const maximumPostMedia = 9'));
assert(postForm.includes("selectPhotoSource('camera')"));
assert(postForm.includes("selectPhotoSource('library')"));
assert(postForm.includes('maximumPostMedia - media.length'));
assert(postForm.includes('getPostPhotoAddPresentation'));
assert(postForm.includes('<PostComposerActionModal'));
assert.equal(
  postForm.includes('ActionSheetIOS.showActionSheetWithOptions'),
  false,
);
console.log(
  'PASS: Camera and library actions use the responsive composer sheet while preserving validation and the existing nine-photo upload pipeline.',
);

assert(postViewer.includes('Gesture.Pinch()'));
assert(postViewer.includes('.numberOfTaps(2)'));
assert(postViewer.includes('horizontal'));
assert(postViewer.includes('pagingEnabled'));
assert(postViewer.includes('onMomentumScrollEnd'));
assert(postViewer.includes('icon="close"'));
assert(postViewer.includes('accessibilityRole="alert"'));
assert(postViewer.includes('viewerPosition'));
assert(rootLayout.includes('<GestureHandlerRootView'));
assert(postPreview.includes('onPhotoPress(index)'));
assert(postDetail.includes('<PostPhotoViewer'));
assert(journal.includes('<PostPhotoViewer'));
assert(!postDetail.includes('<Modal'));
console.log(
  'PASS: Shared viewer covers initial index, swipe, pinch/reset, close, paging, and image failure UI.',
);

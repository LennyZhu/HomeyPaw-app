import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createPostPhotoSaver,
  getCurrentPostPhoto,
  getPostPhotoFileExtension,
} from '../src/features/posts/post-photo-save.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const photo = {
  authorizedUrl: 'https://storage.example.test/signed-photo?token=private',
  id: 'photo-2',
  mimeType: 'image/jpeg',
};

function dependencies(overrides = {}) {
  return {
    addToPhotoLibrary: async () => undefined,
    downloadAuthorizedPhoto: async () => ({
      cleanup: async () => undefined,
      uri: 'file:///cache/current-photo.jpg',
    }),
    isSupported: () => true,
    requestWritePermission: async () => ({
      canAskAgain: true,
      granted: true,
    }),
    ...overrides,
  };
}

assert.equal(getPostPhotoFileExtension('image/jpeg'), 'jpg');
assert.equal(getPostPhotoFileExtension('image/png'), 'png');
assert.equal(getPostPhotoFileExtension('image/webp'), 'webp');

const media = [
  { id: 'photo-1', mime_type: 'image/jpeg', storage_path: 'post/one.jpg' },
  { id: 'photo-2', mime_type: 'image/png', storage_path: 'post/two.png' },
  { id: 'photo-3', mime_type: 'image/webp', storage_path: 'post/three.webp' },
];
const currentPhoto = getCurrentPostPhoto(
  media,
  {
    'post/one.jpg': 'https://storage.example.test/one?token=private',
    'post/two.png': 'https://storage.example.test/two?token=private',
    'post/three.webp': 'https://storage.example.test/three?token=private',
  },
  1,
);
assert.deepEqual(currentPhoto, {
  authorizedUrl: 'https://storage.example.test/two?token=private',
  id: 'photo-2',
  mimeType: 'image/png',
});
assert.equal(getCurrentPostPhoto(media, {}, 1), null);
console.log('PASS: Multi-photo viewer selects only the current signed photo.');

const events = [];
const save = createPostPhotoSaver(
  dependencies({
    requestWritePermission: async () => {
      events.push('permission');
      return { canAskAgain: true, granted: true };
    },
    downloadAuthorizedPhoto: async (request) => {
      events.push(`download:${request.authorizedUrl}`);
      return {
        cleanup: async () => events.push('cleanup'),
        uri: 'file:///cache/current-photo.jpg',
      };
    },
    addToPhotoLibrary: async (uri) => events.push(`save:${uri}`),
  }),
);
assert.equal(await save(photo), 'saved');
assert.deepEqual(events, [
  'permission',
  `download:${photo.authorizedUrl}`,
  'save:file:///cache/current-photo.jpg',
  'cleanup',
]);
console.log(
  'PASS: Granted permission saves the authorized download and cleans cache.',
);

let restrictedCalls = 0;
const denied = createPostPhotoSaver(
  dependencies({
    requestWritePermission: async () => ({
      canAskAgain: true,
      granted: false,
    }),
    downloadAuthorizedPhoto: async () => {
      restrictedCalls += 1;
      throw new Error('must not download');
    },
  }),
);
const blocked = createPostPhotoSaver(
  dependencies({
    requestWritePermission: async () => ({
      canAskAgain: false,
      granted: false,
    }),
  }),
);
assert.equal(await denied(photo), 'permission-denied');
assert.equal(await blocked(photo), 'permission-blocked');
assert.equal(restrictedCalls, 0);
console.log(
  'PASS: Denied and blocked permissions stop before private download.',
);

let failureCleanupCount = 0;
const failingSave = createPostPhotoSaver(
  dependencies({
    downloadAuthorizedPhoto: async () => ({
      cleanup: async () => {
        failureCleanupCount += 1;
      },
      uri: 'file:///cache/current-photo.jpg',
    }),
    addToPhotoLibrary: async () => {
      throw new Error('native save failed');
    },
  }),
);
assert.equal(await failingSave(photo), 'failed');
assert.equal(failureCleanupCount, 1);
console.log('PASS: Save failure returns a safe result and still cleans cache.');

let releasePermission;
const permissionGate = new Promise((resolve) => {
  releasePermission = resolve;
});
const guardedSave = createPostPhotoSaver(
  dependencies({ requestWritePermission: () => permissionGate }),
);
const firstSave = guardedSave(photo);
assert.equal(await guardedSave(photo), 'busy');
releasePermission({ canAskAgain: true, granted: true });
assert.equal(await firstSave, 'saved');
console.log('PASS: Duplicate taps cannot start concurrent saves.');

let unsupportedPermissionCalls = 0;
const unsupportedSave = createPostPhotoSaver(
  dependencies({
    isSupported: () => false,
    requestWritePermission: async () => {
      unsupportedPermissionCalls += 1;
      return { canAskAgain: true, granted: true };
    },
  }),
);
assert.equal(await unsupportedSave(photo), 'unsupported');
assert.equal(unsupportedPermissionCalls, 0);

const [appConfigText, adapter, webAdapter, viewer] = await Promise.all([
  read('app.json'),
  read('src/features/posts/post-photo-save-adapter.ts'),
  read('src/features/posts/post-photo-save-adapter.web.ts'),
  read('src/features/posts/components/post-photo-viewer.tsx'),
]);
const app = JSON.parse(appConfigText).expo;
const mediaLibraryPlugin = app.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-media-library',
);
assert(mediaLibraryPlugin);
assert.deepEqual(mediaLibraryPlugin[1].granularPermissions, ['photo']);
assert.equal(mediaLibraryPlugin[1].isAccessMediaLocationEnabled, false);
assert.equal(
  typeof app.locales.en.ios.NSPhotoLibraryAddUsageDescription,
  'string',
);
assert.equal(
  typeof app.locales['zh-HK'].ios.NSPhotoLibraryAddUsageDescription,
  'string',
);
assert(adapter.includes("requestPermissionsAsync(true, ['photo'])"));
assert(adapter.includes('File.downloadFileAsync'));
assert(adapter.includes('photo.authorizedUrl'));
assert(adapter.includes('Asset.create(uri)'));
assert(adapter.includes('destination.delete()'));
assert(!adapter.includes('service_role'));
assert(!adapter.includes('getPublicUrl'));
assert(webAdapter.includes('canSavePostPhotoToLibrary = false'));
assert(viewer.includes('getCurrentPostPhoto(media, mediaUrls, currentIndex)'));
assert(viewer.includes("t('posts.photos.saveAccessibility')"));
assert(viewer.includes('busy: isSavingPhoto'));
assert(viewer.includes('disabled: isSavingPhoto'));
assert(viewer.includes('if (!currentPhoto || saveInFlight.current) return'));
assert(viewer.includes('Linking.openSettings()'));
assert(viewer.includes('useSafeAreaInsets'));
assert(viewer.includes('insets.top + spacing.md'));
console.log(
  'PASS: Add-only native permission, authorized signed source, viewer UI, and safe web fallback are configured.',
);

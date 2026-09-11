import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');
const importSource = (path) =>
  import(`${pathToFileURL(resolve(process.cwd(), path)).href}?v=${Date.now()}`);

const state = await importSource('src/features/posts/photo-editor-state.ts');

assert.deepEqual(
  [0, 90, 180, 270].map(state.getNextPhotoRotation),
  [90, 180, 270, 0],
);
assert.equal(
  state.getPhotoCropHeight({
    aspect: 'square',
    freeHeight: 280,
    maximumHeight: 540,
    minimumHeight: 180,
    width: 360,
  }),
  360,
);
assert.equal(
  state.getPhotoCropHeight({
    aspect: 'fourThree',
    freeHeight: 280,
    maximumHeight: 540,
    minimumHeight: 180,
    width: 360,
  }),
  270,
);
assert.equal(
  state.getPhotoCropHeight({
    aspect: 'sixteenNine',
    freeHeight: 280,
    maximumHeight: 540,
    minimumHeight: 180,
    width: 360,
  }),
  202.5,
);
assert.equal(
  state.getPhotoCropHeight({
    aspect: 'free',
    freeHeight: 412,
    maximumHeight: 540,
    minimumHeight: 180,
    width: 360,
  }),
  412,
);
console.log('PASS: Free, square, 4:3, 16:9 crop and 90° rotation cycle.');

const sticker = state.clampPhotoSticker(
  { emoji: '🐾', id: 'sticker', rotation: 42, scale: 8, x: -40, y: 900 },
  360,
  300,
);
assert.equal(sticker.scale, 3);
assert.equal(sticker.rotation, 42);
assert.equal(sticker.x, 84);
assert.equal(sticker.y, 216);
assert(state.photoStickerChoices.includes('🐶'));
assert(state.photoStickerChoices.includes('🍖'));
assert.deepEqual(
  state
    .removePhotoSticker(
      [
        { ...sticker, id: 'keep' },
        { ...sticker, id: 'remove' },
      ],
      'remove',
    )
    .map((item) => item.id),
  ['keep'],
);
console.log(
  'PASS: Sticker add choices, move bounds, scale, rotation, and delete-ready IDs.',
);

const original = {
  editTempUri: null,
  height: 900,
  id: 'middle',
  kind: 'new',
  uri: 'file:///original.jpg',
  width: 1200,
};
const edited = state.createEditedPostMediaDraft(
  original,
  { height: 1536, uri: 'file:///edited.png', width: 2048 },
  'unused',
);
assert.equal(edited.id, 'middle');
assert.equal(edited.editTempUri, 'file:///edited.png');
assert.equal(edited.uri, 'file:///edited.png');
const multi = [
  { ...original, id: 'first' },
  original,
  { ...original, id: 'third' },
].map((item) => (item.id === original.id ? edited : item));
assert.equal(multi[0].uri, 'file:///original.jpg');
assert.equal(multi[1].uri, 'file:///edited.png');
assert.equal(multi[2].uri, 'file:///original.jpg');
const reEdited = state.createEditedPostMediaDraft(
  edited,
  { height: 2048, uri: 'file:///edited-again.png', width: 2048 },
  'unused-again',
);
assert.equal(reEdited.id, edited.id);
assert.equal(reEdited.uri, 'file:///edited-again.png');
const existingEdited = state.createEditedPostMediaDraft(
  {
    height: 800,
    id: 'existing',
    kind: 'existing',
    storagePath: 'user/pet/post/existing.jpg',
    uri: 'https://local.test/signed.jpg',
    width: 600,
  },
  { height: 1024, uri: 'file:///replacement.png', width: 768 },
  'replacement-id',
);
assert.equal(existingEdited.id, 'replacement-id');
assert.equal(existingEdited.kind, 'new');
assert.deepEqual(state.getPhotoEditorExportSize(360, 270, 2048), {
  height: 1536,
  width: 2048,
});
console.log(
  'PASS: Cancel-safe replacement model, re-edit, one-of-three isolation, existing replacement, and lossless export sizing.',
);

const [
  editor,
  form,
  media,
  publishing,
  nativeExport,
  tempFiles,
  viewer,
  en,
  zh,
] = await Promise.all([
  read('src/features/posts/components/post-photo-editor.tsx'),
  read('src/features/posts/components/post-form.tsx'),
  read('src/features/posts/post-media.ts'),
  read('src/features/posts/post-publishing.ts'),
  read('src/features/posts/post-photo-editor-export.native.ts'),
  read('src/features/posts/post-photo-edit-files.ts'),
  read('src/features/posts/components/post-photo-viewer.tsx'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
]);

assert(media.includes("source === 'camera'"));
assert(media.includes('allowsMultipleSelection: true'));
assert(media.includes('editTempUri: null'));
assert(form.includes("icon: 'create-outline'"));
assert(form.includes('onPress={() => openPhotoEditor(item)}'));
assert(form.includes('<PostPhotoEditor'));
assert(form.includes('createEditedPostMediaDraft'));
assert(form.includes('removePostPhotoEditTemp'));
assert(publishing.includes('preparePostPhoto(newMedia[index]!)'));
assert(nativeExport.includes("format: 'png'"));
assert(nativeExport.includes("result: 'tmpfile'"));
assert(tempFiles.includes('file.delete()'));
assert(editor.includes("['free', t('posts.photoEditor.aspects.free')]"));
assert(editor.includes("['square', '1:1']"));
assert(editor.includes('getNextPhotoRotation(rotation)'));
assert(editor.includes('Gesture.Pinch()'));
assert(editor.includes('Gesture.Rotation()'));
assert(editor.includes('Gesture.Pan()'));
assert(editor.includes('deleteSticker'));
assert(editor.includes("'posts.photoEditor.removeStickerAccessibility'"));
assert(editor.includes("t('posts.photoEditor.adjustCrop')"));
assert(editor.includes("t('posts.photoEditor.cropGestureHint')"));
assert(editor.includes('toolOptions: { minHeight: 112'));
assert(editor.includes("alignSelf: 'flex-end'"));
assert(editor.includes('exporting={isExporting}'));
assert(editor.includes('collapsable={false}'));
assert(viewer.includes('getCurrentPostPhoto(media, mediaUrls, currentIndex)'));
assert(en.includes('Your original selection is unchanged'));
assert(zh.includes('原本選擇不會被更改'));
assert(en.includes('Drag to reposition and pinch to zoom'));
assert(zh.includes('拖動圖片調整位置，雙指縮放'));
console.log(
  'PASS: Camera/library composer entry, editor gestures, clean canvas export, temp cleanup, existing upload pipeline, viewer, accessibility, and localized safe errors are wired.',
);

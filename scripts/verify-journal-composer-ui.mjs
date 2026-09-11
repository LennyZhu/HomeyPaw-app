import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getPostPhotoAddPresentation,
  movePostPhoto,
  removePostPhoto,
} from '../src/features/posts/post-composer-photo-state.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

assert.equal(getPostPhotoAddPresentation(0, 9), 'button');
for (const count of [1, 2, 8]) {
  assert.equal(getPostPhotoAddPresentation(count, 9), 'tile');
}
assert.equal(getPostPhotoAddPresentation(9, 9), 'none');

const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.deepEqual(
  movePostPhoto(photos, 1, -1).map((photo) => photo.id),
  ['b', 'a', 'c'],
);
assert.deepEqual(
  movePostPhoto(photos, 1, 1).map((photo) => photo.id),
  ['a', 'c', 'b'],
);
assert.equal(movePostPhoto(photos, 0, -1), photos);
assert.equal(movePostPhoto(photos, 2, 1), photos);
assert.deepEqual(
  removePostPhoto(photos, 'b').map((photo) => photo.id),
  ['a', 'c'],
);

const [create, edit, form, sheet, editor, publishing, enText, zhText] =
  await Promise.all([
    read('src/features/posts/create-post-screen.tsx'),
    read('src/features/posts/edit-post-screen.tsx'),
    read('src/features/posts/components/post-form.tsx'),
    read('src/features/posts/components/post-composer-action-modal.tsx'),
    read('src/features/posts/components/post-photo-editor.tsx'),
    read('src/features/posts/post-publishing.ts'),
    read('src/i18n/locales/en.json'),
    read('src/i18n/locales/zh-HK.json'),
  ]);

assert.ok(create.includes("t('posts.create.title')"));
assert.ok(edit.includes("t('posts.edit.title')"));
assert.ok(create.includes('icon="chevron-back"'));
assert.ok(edit.includes('icon="chevron-back"'));
assert.equal(create.includes("t('posts.create.subtitle'"), false);
assert.equal(edit.includes("t('posts.edit.subtitle'"), false);

assert.ok(form.includes("addPhotoPresentation === 'button'"));
assert.ok(form.includes("addPhotoPresentation === 'tile'"));
assert.ok(form.includes('styles.addPhotoTile'));
assert.ok(form.includes("width: '48.5%'"));
assert.ok(form.includes('icon="ellipsis-horizontal"'));
assert.equal((form.match(/<PhotoOverlayAction/g) ?? []).length, 1);
assert.equal(form.includes('styles.editPhotoAction'), false);
assert.ok(form.includes('onPress={() => openPhotoEditor(item)}'));
assert.ok(form.includes("icon: 'create-outline'"));
assert.ok(form.includes('styles.photoActionVisual'));
assert.ok(form.includes('width: 30'));
assert.ok(form.includes("t('posts.photos.moveEarlier')"));
assert.ok(form.includes("t('posts.photos.moveLater')"));
assert.ok(form.includes("t('posts.photos.remove')"));
assert.equal(form.includes('styles.photoActions'), false);
assert.equal(form.includes('ActionSheetIOS'), false);
assert.ok(form.includes("selectPhotoSource('camera')"));
assert.ok(form.includes("selectPhotoSource('library')"));
assert.ok(form.includes('maximumPostMedia - media.length'));
assert.ok(form.includes('createEditedPostMediaDraft(item, result'));
assert.ok(form.includes('onDone={applyPhotoEdit}'));
assert.ok(editor.includes("t('posts.photoEditor.crop')"));

assert.ok(sheet.includes('accessibilityViewIsModal'));
assert.ok(sheet.includes("useContentLayout('modal')"));
assert.ok(sheet.includes('...contentStyles.modal'));
assert.ok(sheet.includes("justifyContent: 'flex-end'"));
assert.ok(sheet.includes("justifyContent: 'center'"));
assert.ok(sheet.includes('minHeight: 56'));
assert.ok(sheet.includes("t('common.cancel')"));

assert.ok(publishing.includes("item.kind === 'existing'"));
assert.ok(publishing.includes('const newMedia = media.filter'));
assert.ok(publishing.includes('preparePostPhoto(newMedia[index]!)'));
assert.ok(publishing.includes('media.map((item, position)'));

const en = JSON.parse(enText);
const zh = JSON.parse(zhText);
assert.equal(en.posts.photos.sourceTitle, 'Add Photos');
assert.equal(en.posts.photos.takePhoto, 'Take Photo');
assert.equal(en.posts.photos.chooseLibrary, 'Choose from Library');
assert.equal(en.posts.photoEditor.edit, 'Edit Photo');
assert.equal(en.posts.photos.moveEarlier, 'Move Left');
assert.equal(en.posts.photos.moveLater, 'Move Right');
assert.equal(en.posts.photos.remove, 'Delete Photo');
assert.equal(zh.posts.photos.sourceTitle, '新增相片');
assert.equal(zh.posts.photos.takePhoto, '拍照');
assert.equal(zh.posts.photos.chooseLibrary, '從相片選擇');
assert.equal(zh.posts.photos.moveEarlier, '向前移動');
assert.equal(zh.posts.photos.moveLater, '向後移動');
assert.equal(zh.posts.photos.remove, '刪除相片');

console.log(
  'PASS: Journal Composer header, zero-photo button, 1–8 photo Add Tile, nine-photo boundary, compact actions, ordering, deletion, source sheet, and existing-media optimization are preserved.',
);

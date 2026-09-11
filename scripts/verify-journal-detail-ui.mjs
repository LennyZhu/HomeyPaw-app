import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getUserAvatarInitial } from '../src/components/avatar-initial.ts';
import { clampPhotoViewerIndex } from '../src/features/posts/photo-viewer-state.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [detail, actions, avatar, viewer, enText, zhText] = await Promise.all([
  read('src/features/posts/post-detail-screen.tsx'),
  read('src/features/posts/components/post-actions-modal.tsx'),
  read('src/components/avatar.tsx'),
  read('src/features/posts/components/post-photo-viewer.tsx'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
]);

assert.ok(detail.includes('post.post_media.length === 1'));
assert.ok(detail.includes('styles.singlePhotoWrap'));
assert.ok(detail.includes('contentFit="contain"'));
assert.ok(detail.includes('post.post_media[0]!.width'));
assert.ok(detail.includes('Math.max(post.post_media[0]!.height, 1)'));
assert.ok(detail.includes('onPress={() => setViewerIndex(0)}'));
assert.ok(detail.includes("width: '100%'"));

assert.ok(detail.includes('post.post_media.length > 1'));
assert.ok(detail.includes('styles.photoGrid'));
assert.ok(detail.includes('post.post_media.map((media, index)'));
assert.ok(detail.includes('onPress={() => setViewerIndex(index)}'));
assert.ok(detail.includes('contentFit="cover"'));
assert.ok(detail.includes('initialIndex={viewerIndex}'));
assert.equal(clampPhotoViewerIndex(0, 1), 0);
for (let index = 0; index < 4; index += 1) {
  assert.equal(clampPhotoViewerIndex(index, 4), index);
}
for (const behavior of [
  'horizontal',
  'pagingEnabled',
  'Gesture.Pinch()',
  '.numberOfTaps(2)',
  "t('posts.photos.saveAccessibility')",
  "t('posts.photos.viewerPosition'",
]) {
  assert.ok(viewer.includes(behavior), behavior);
}
assert.ok(viewer.includes('{media.length > 1 ? ('));

assert.ok(detail.includes('<Avatar'));
assert.ok(detail.includes('authorMember?.avatarUrl'));
assert.ok(detail.includes('usePetMembers(post?.pet_id ?? null)'));
assert.ok(detail.includes('size={40}'));
assert.ok(detail.includes('numberOfLines={1}'));
assert.ok(detail.includes('accessibilityRole="image"'));
assert.ok(detail.includes('accessible'));
assert.equal(detail.includes('email'), false);
assert.ok(avatar.includes('source && sourceKey !== failedSourceKey'));
assert.ok(avatar.includes('setFailedSourceKey(sourceKey)'));
assert.ok(avatar.includes('getUserAvatarInitial(name)'));
assert.equal(getUserAvatarInitial('Long Display Name For Truncation'), 'L');
assert.equal(getUserAvatarInitial(''), '?');

assert.ok(detail.includes('canEdit={isAuthor}'));
assert.ok(detail.includes('canDelete={canDelete}'));
assert.ok(detail.includes('Boolean(isAuthor || isOwner)'));
assert.ok(actions.includes('accessibilityViewIsModal'));
assert.ok(actions.includes("useContentLayout('modal')"));
assert.ok(actions.includes('...contentStyles.modal'));
assert.ok(actions.includes("justifyContent: 'flex-end'"));
assert.ok(actions.includes("justifyContent: 'center'"));
assert.ok(actions.includes('minHeight: 56'));
assert.ok(actions.includes('destructive'));
assert.ok(actions.includes('lightColors.error'));
assert.ok(actions.includes("t('common.cancel')"));

assert.ok(detail.includes('style={styles.body}'));
assert.ok(detail.includes('body: { width:'));
assert.ok(detail.includes('maxWidth: 640'));
assert.equal(detail.includes('<Card'), false);

const en = JSON.parse(enText);
const zh = JSON.parse(zhText);
assert.equal(en.posts.actions.title, 'Journal actions');
assert.equal(en.posts.actions.edit, 'Edit Journal');
assert.equal(en.posts.delete.action, 'Delete Journal');
assert.equal(zh.posts.actions.title, '日記操作');
assert.equal(zh.posts.actions.edit, '編輯日記');
assert.equal(zh.posts.delete.action, '刪除日記');
assert.ok(en.posts.photos.openFullscreenPosition.includes('{{total}}'));
assert.ok(zh.posts.photos.openFullscreenPosition.includes('{{total}}'));

console.log(
  'PASS: Journal Detail keeps the multi-photo Grid and indexed Viewer while polishing single-photo, author, menu, and long-text presentation.',
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

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
assert.ok(detail.includes('onPress={() => openPhoto(0)}'));
assert.ok(detail.includes("width: '100%'"));

assert.ok(detail.includes('post.post_media.length > 1'));
assert.ok(detail.includes('styles.photoGrid'));
assert.ok(detail.includes('post.post_media.map((media, index)'));
assert.ok(detail.includes('onPress={() => openPhoto(index)}'));
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
assert.ok(viewer.includes('{controlsVisible && media.length > 1 ? ('));

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

// Only the receipt text is actionable inside wrapping author metadata.
assert.equal(detail.includes('readersFooter'), false);
assert.equal(detail.includes('readersRow'), false);
assert.equal(detail.includes('borderTopWidth'), false);
assert.equal(detail.includes('name="chevron-forward"'), false);
assert.equal(detail.includes('posts.readers.empty'), false);
assert.match(detail, /authorMetadata: \{[^}]*flexWrap: 'wrap'/);
assert.match(detail, /authorDate: \{ minWidth: 0, flexShrink: 1 \}/);
assert.match(detail, /readersAction: \{ minWidth: 0, flexShrink: 1 \}/);
assert.ok(detail.includes('hitSlop={spacing.sm}'));
assert.ok(detail.includes("accessibilityHint={t('posts.readers.openHint')}"));
const parsed = ts.createSourceFile(
  'detail.tsx',
  detail,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let metadata;
const findMetadata = (node) => {
  if (
    ts.isJsxElement(node) &&
    node.openingElement
      .getText(parsed)
      .includes('style={styles.authorMetadata}')
  )
    metadata = node;
  ts.forEachChild(node, findMetadata);
};
findMetadata(parsed);
assert.ok(metadata);
const emitted = ts.transpileModule(
  `const render = () => (${metadata.getText(parsed)}); return render();`,
  {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'element' },
  },
).outputText;
const renderMetadata = new Function(
  'element',
  'View',
  'AppText',
  'Pressable',
  'styles',
  'spacing',
  'authorDate',
  'authorTime',
  'readersQuery',
  't',
  'setReadersVisible',
  emitted,
);
const flatten = (node) =>
  !node || typeof node !== 'object'
    ? []
    : [node, ...node.children.flatMap(flatten)];
for (const count of [0, 1, 3]) {
  let opened = 0,
    refreshed = 0;
  const tree = renderMetadata(
    (type, props, ...children) => ({ type, props, children }),
    'View',
    'AppText',
    'Pressable',
    {
      authorMetadata: 'metadata',
      authorDate: 'date',
      readerMetadata: 'receipt',
      readersAction: 'action',
    },
    { sm: 8 },
    '2026年9月29日',
    '15:43',
    {
      isSuccess: true,
      data: Array(count),
      refetch: () => {
        refreshed += 1;
      },
    },
    (key, options) =>
      key === 'posts.readers.count' ? `${options.count} 人已查看` : key,
    (visible) => {
      assert.equal(visible, true);
      opened += 1;
    },
  );
  const nodes = flatten(tree),
    actions = nodes.filter((node) => node.type === 'Pressable');
  assert.equal(actions.length, count > 0 ? 1 : 0);
  const date = nodes.find((node) => node.props?.style === 'date');
  assert.deepEqual(date.children, ['2026年9月29日', ' · ', '15:43']);
  assert.equal(date.props.onPress, undefined);
  assert.equal(tree.props.onPress, undefined);
  if (count > 0) {
    assert.equal(actions[0].props.accessibilityRole, 'button');
    assert.equal(actions[0].props.accessibilityLabel, `${count} 人已查看`);
    assert.equal(actions[0].props.hitSlop, 8);
    actions[0].props.onPress();
    assert.equal(opened, 1);
    assert.equal(refreshed, 1);
  } else
    assert.equal(
      nodes.some((node) => node.props?.style === 'receipt'),
      false,
    );
}

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
  'PASS: Journal media/author/actions retained; no footer; actual metadata JSX hides zero readers, renders only count as an accessible action, leaves date/time noninteractive, and allows wrapping.',
);

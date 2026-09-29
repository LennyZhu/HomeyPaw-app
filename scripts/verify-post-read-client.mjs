import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';

import {
  canMarkPostRead,
  isPostReadAccessError,
  markPostReadOnce,
  postReadKeys,
  resolvePostReaderAvatars,
} from '../src/features/posts/post-read-state.ts';
import { shouldClearFamilyQuery } from '../src/features/family/family-context-state.ts';
import { shouldClearRevokedPetQuery } from '../src/features/pets/pet-access-state.ts';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ready = {
  userId: 'b',
  postId: 'post-a',
  authorId: 'a',
  ready: true,
  focused: true,
  active: true,
};
assert.equal(canMarkPostRead(ready), true);
for (const blocked of [
  { ready: false },
  { focused: false },
  { active: false },
  { userId: undefined },
  { postId: undefined },
  { authorId: 'b' },
])
  assert.equal(canMarkPostRead({ ...ready, ...blocked }), false);
assert.equal(canMarkPostRead({ ...ready, authorId: null }), true);
assert.equal(isPostReadAccessError({ code: '42501' }), true);
assert.equal(isPostReadAccessError(new Error('network')), false);

const client = new QueryClient();
const input = { userId: 'b', postId: 'post-a', petId: 'pet-a' };
let calls = 0;
let finish;
const pendingRpc = () => {
  calls += 1;
  return new Promise((resolve) => {
    finish = resolve;
  });
};
const detail = markPostReadOnce(client, input, pendingRpc);
const photo = markPostReadOnce(client, input, pendingRpc);
const video = markPostReadOnce(client, input, pendingRpc);
assert.equal(calls, 1, 'Detail/photo/video share the pending request.');
finish('recorded');
assert.deepEqual(await Promise.all([detail, photo, video]), [
  'recorded',
  'recorded',
  'recorded',
]);
for (let i = 0; i < 30; i += 1)
  await markPostReadOnce(client, input, pendingRpc);
assert.equal(calls, 1, 'Repeated view/swipe/refetch does not spam RPC.');
client.clear();

for (const order of [
  ['detail', 'viewer'],
  ['viewer', 'detail'],
]) {
  let requests = 0;
  for (let index = 0; index < order.length; index += 1)
    await markPostReadOnce(client, input, async () => {
      requests += 1;
      return 'recorded';
    });
  assert.equal(requests, 1, `${order.join(' → ')} one session mark.`);
  client.clear();
}
let attempts = 0;
await assert.rejects(
  markPostReadOnce(client, input, async () => {
    attempts += 1;
    throw new Error('offline');
  }),
);
await markPostReadOnce(client, input, async () => {
  attempts += 1;
  return 'recorded';
});
assert.equal(attempts, 2, 'Another focus/view can retry a failed request.');
client.clear();

// Membership loss also covers the case where no Pet rows remain cached.
const readersKey = postReadKeys.readers('b', 'post-a', 'pet-a');
const markKey = postReadKeys.mark('b', 'post-a', 'pet-a');
client.setQueryData(readersKey, [{ displayName: 'Member' }]);
client.setQueryData(markKey, 'recorded');
for (const key of [readersKey, markKey]) {
  assert.equal(shouldClearFamilyQuery(key, 'b', 'family-a'), true);
  assert.equal(shouldClearFamilyQuery(key, 'a', 'family-a'), false);
  assert.equal(shouldClearRevokedPetQuery(key, 'b', 'pet-a'), true);
  assert.equal(shouldClearRevokedPetQuery(key, 'b', 'pet-b'), false);
}
client.removeQueries({
  predicate: (query) => shouldClearFamilyQuery(query.queryKey, 'b', 'family-a'),
});
assert.equal(client.getQueryData(readersKey), undefined);
assert.equal(client.getQueryData(markKey), undefined);

let resolveLate;
const late = markPostReadOnce(
  client,
  input,
  () =>
    new Promise((resolve) => {
      resolveLate = resolve;
    }),
);
const canceled = assert.rejects(late);
client.clear();
resolveLate('recorded');
await canceled;
assert.equal(
  client.getQueryData(markKey),
  undefined,
  'Late response cannot recreate session cache after logout.',
);
client.clear();

// Even a transport that resolves after cancellation cannot launch avatar work.
for (const cleanup of ['logout', 'revocation']) {
  let resolveReaders;
  let avatarCalls = 0;
  const response = new Promise((resolve) => {
    resolveReaders = resolve;
  });
  const readersRequest = client.fetchQuery({
    queryKey: readersKey,
    queryFn: async ({ signal }) =>
      resolvePostReaderAvatars(signal, await response, async (paths) => {
        avatarCalls += 1;
        return client.fetchQuery({
          queryKey: ['storage-signed-url', 'profile-avatars', paths[0]],
          queryFn: async () => ({ [paths[0]]: 'signed-url' }),
        });
      }),
  });
  const rejected = assert.rejects(readersRequest);
  if (cleanup === 'logout') client.clear();
  else
    client.removeQueries({
      predicate: (item) =>
        shouldClearFamilyQuery(item.queryKey, 'b', 'family-a'),
    });
  resolveReaders([{ reader_avatar_path: 'former-reader/avatar.jpg' }]);
  await rejected;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(avatarCalls, 0, `${cleanup}: no signing after cancellation.`);
  assert.equal(client.getQueryCache().getAll().length, 0);
}

const hooks = read('src/features/posts/post-read-queries.ts');
const screen = read('src/features/posts/post-detail-screen.tsx');
const journal = read('src/features/journal/journal-screen.tsx');
const query = read('src/features/posts/post-queries.ts');
const modal = read('src/features/posts/components/post-readers-modal.tsx');
const videoScreen = read('src/features/posts/post-video-viewer-screen.tsx');
assert.match(
  hooks,
  /useFocusEffect\([\s\S]*setFocused\(true\)[\s\S]*setFocused\(false\)/,
);
assert.ok(hooks.includes("AppState.currentState === 'active'"));
assert.ok(hooks.includes("AppState.addEventListener('change'"));
assert.ok(hooks.includes('attempted.current !== key'));
assert.ok(hooks.includes('attempted.current = null'));
assert.ok(hooks.includes('queryClient.invalidateQueries'));
assert.ok(hooks.includes('isPostReadAccessError(query.error)'));
assert.ok(hooks.includes('queryClient.removeQueries'));
assert.ok(hooks.includes('queryFn: async ({ signal })'));
assert.ok(hooks.includes('.abortSignal(signal)'));
assert.ok(hooks.includes('resolvePostReaderAvatars(signal, data,'));
assert.ok(
  hooks.includes('if (canFetch) void refetch({ cancelRefetch: false })'),
);
assert.ok(hooks.includes('const canFetch = Boolean(user && post && enabled)'));
assert.equal(hooks.includes('.channel('), false, 'No Realtime.');

assert.match(
  screen,
  /const contentReady =[\s\S]*postQuery\.isSuccess[\s\S]*Boolean\(post\)[\s\S]*!membersQuery\.isError[\s\S]*!authorsQuery\.isError/,
);
assert.ok(screen.includes('usePostReadReceipt(post, contentReady)'));
assert.ok(screen.includes('usePostReaders(post, isViewing)'));
assert.ok(screen.includes('readersQuery.data.length'));
assert.ok(screen.includes('void readersQuery.refetch()'));
assert.ok(
  screen.indexOf('posts.readers.count') <
    screen.indexOf('post.location_name ?'),
);
assert.ok(
  screen.includes('readersQuery.isSuccess && readersQuery.data.length > 0'),
);
assert.equal(screen.includes('posts.readers.empty'), false);
assert.equal(screen.includes('readersFooter'), false);
assert.equal(screen.includes('readersRow'), false);
assert.ok(screen.includes('style={styles.authorMetadata}'));
assert.ok(screen.includes('<PostReadersModal'));
assert.match(
  journal,
  /onOpenPhoto=\{\(initialIndex\) => \{[\s\S]*?setPhotoViewer[\s\S]*?markPostRead\(item\.post\)/,
);
assert.match(
  journal,
  /onOpenVideo=\{\(\) => \{[\s\S]*?router\.push[\s\S]*?markPostRead\(item\.post\)/,
);
assert.equal(
  (journal.match(/markPostRead\(item\.post\)/g) ?? []).length,
  2,
  'Only explicit media click callbacks mark in Feed.',
);
assert.equal(journal.includes('usePostReaders'), false);
assert.equal(
  journal.includes('usePostReadReceipt'),
  false,
  'Passive Feed never automatically marks.',
);
assert.ok(
  videoScreen.includes(
    'usePostReadReceipt(post, postQuery.isSuccess && Boolean(video))',
  ),
);
for (const file of [
  'src/features/posts/components/post-photo-viewer.tsx',
  'src/features/posts/components/post-media-preview.tsx',
  'src/features/posts/components/post-video-thumbnail.tsx',
])
  assert.equal(
    read(file).includes('markPostRead'),
    false,
    `${file}: preload/pager does not mark.`,
  );
assert.equal(query.includes('readers'), false, 'Feed query shape unchanged.');
assert.equal(
  modal.includes('ModalScreen'),
  false,
  'No flex-fill screen wrapper.',
);
assert.equal(modal.includes('presentationStyle="pageSheet"'), false);
assert.ok(modal.includes('transparent'));
assert.ok(modal.includes("useContentLayout('modal')"));
assert.ok(modal.includes('...contentStyles.modal'));
assert.ok(modal.includes('maxHeight: height * 0.65'));
assert.equal(/\bheight\s*:/.test(modal), false, 'Sheet has no fixed height.');
assert.ok(modal.includes('scroll: { flexGrow: 0, flexShrink: 1 }'));
assert.ok(modal.includes('<ScrollView'));
assert.ok(modal.includes('contentContainerStyle={styles.list}'));
assert.ok(modal.includes('alwaysBounceVertical={false}'));
assert.ok(
  modal.indexOf('style={styles.header}') < modal.indexOf('<ScrollView'),
);
assert.ok(modal.includes("<SafeAreaView edges={isWide ? [] : ['bottom']}"));
assert.ok(modal.includes('onRequestClose={onClose}'));
assert.ok(modal.includes('accessibilityViewIsModal'));
assert.ok(modal.includes('onAccessibilityEscape={onClose}'));
assert.ok(modal.includes('event.stopPropagation()'));
assert.ok(modal.includes('readers.map((reader, index)'));
assert.ok(modal.includes('index < readers.length - 1 && styles.rowSeparator'));
assert.match(
  modal,
  /rowSeparator: \{\s*borderBottomColor: lightColors\.border,\s*borderBottomWidth: StyleSheet\.hairlineWidth,/,
);
assert.equal(
  /row: \{[^}]*borderBottom/.test(modal),
  false,
  'Single/last rows have no unconditional separator.',
);
assert.match(modal, /row: \{\s*minHeight: 64,\s*paddingVertical: spacing\.sm,/);
assert.ok(modal.includes('<Avatar'));
assert.ok(modal.includes('reader.displayName'));
assert.ok(modal.includes('reader.avatarUrl'));
assert.ok(modal.includes('reader.firstReadAt'));
assert.ok(modal.includes("dateStyle: 'medium'"));
assert.ok(modal.includes("timeStyle: 'short'"));
assert.equal(/<AppText[^>]*>[^<]*reader\.userId/.test(modal), false);
assert.equal(modal.includes('email'), false);
assert.ok(
  read('src/features/auth/auth-context.tsx').includes('queryClient.clear()'),
);

const en = JSON.parse(read('src/i18n/locales/en.json')).posts.readers;
const zh = JSON.parse(read('src/i18n/locales/zh-HK.json')).posts.readers;
assert.equal(en.count_other, 'Viewed by {{count}} family members');
assert.equal(en.count_one, 'Viewed by {{count}} family member');
assert.equal(en.openHint, 'Show viewers');
assert.equal(zh.openHint, '查看已查看成員');
assert.equal(zh.count_other, '{{count}} 人已查看');
assert.equal(zh.empty, '尚未有人查看');
assert.equal(en.empty, 'No one has viewed this yet');
console.log(
  'PASS: active/focused/non-author eligibility, shared pending/success dedupe, retry and late-response cancellation, Detail/media click boundaries, passive Feed/preload exclusion, modal identity/date/time, and revoked/logout cache cleanup.',
);

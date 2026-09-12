import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const importSource = (path) =>
  import(`${pathToFileURL(resolve(process.cwd(), path)).href}?v=${Date.now()}`);
const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');

const chat = await importSource('src/features/chat/chat-presentation.ts');
const journal = await importSource('src/features/journal/manual-refresh.ts');
const manualRefresh = await importSource('src/lib/manual-refresh.ts');

assert.equal(chat.formatChatBadge(0), undefined);
assert.equal(chat.formatChatBadge(1), '1');
assert.equal(chat.formatChatBadge(2), '2');
assert.equal(chat.formatChatBadge(99), '99');
assert.equal(chat.formatChatBadge(100), '99+');
assert.equal(chat.shouldInvalidateChatUnread('member-b', 'member-a'), true);
assert.equal(chat.shouldInvalidateChatUnread('member-a', 'member-a'), false);

const seen = new Set();
assert.equal(chat.consumeCreatedMessageId(seen, 'message-a'), true);
assert.equal(chat.consumeCreatedMessageId(seen, 'message-a'), false);
assert.equal(chat.consumeCreatedMessageId(seen, 'message-b'), true);
assert.equal(chat.getDisplayedChatUnread(2, false), 2);
assert.equal(chat.getDisplayedChatUnread(2, true), 0);
assert.equal(chat.getDisplayedChatUnread(1, false), 1);
assert.notEqual(
  chat.createChatScopeKey('user-a', 'pet-a'),
  chat.createChatScopeKey('user-a', 'pet-b'),
);
assert.notEqual(
  chat.createChatScopeKey('user-a', 'pet-a'),
  chat.createChatScopeKey('user-b', 'pet-a'),
);
assert.equal(chat.createChatScopeKey(undefined, 'pet-a'), null);
console.log(
  'PASS: other-member unread, self-message exclusion, duplicate ID dedupe, read visibility, and pet/user isolation.',
);

assert.equal(journal.isJournalInitialLoading(false, true), true);
assert.equal(journal.isJournalInitialLoading(true, true), false);
assert.equal(journal.isJournalInitialLoading(true, false), false);

const resolvedStates = [];
await manualRefresh.runManualRefresh(
  (value) => resolvedStates.push(value),
  async () => undefined,
);
assert.deepEqual(resolvedStates, [true, false]);

const rejectedStates = [];
await assert.rejects(
  manualRefresh.runManualRefresh(
    (value) => rejectedStates.push(value),
    async () => {
      throw new Error('offline');
    },
  ),
  /offline/u,
);
assert.deepEqual(rejectedStates, [true, false]);
console.log(
  'PASS: Journal initial/cache distinction and manual refresh resolve/reject cleanup.',
);

const [
  tabs,
  provider,
  screen,
  realtime,
  journalScreen,
  homeScreen,
  packageJson,
  pushFiles,
] = await Promise.all([
  read('src/app/(tabs)/_layout.tsx'),
  read('src/features/chat/chat-session-provider.tsx'),
  read('src/features/chat/chat-screen.tsx'),
  read('src/features/chat/use-chat-realtime.ts'),
  read('src/features/journal/journal-screen.tsx'),
  read('src/features/home/home-screen.tsx'),
  read('package.json'),
  Promise.all([
    read('src/features/reminders/family-push-coordinator.tsx'),
    read('supabase/functions/family-push/index.ts'),
  ]).then((files) => files.join('\n')),
]);

assert.match(tabs, /<ChatSessionProvider>/u);
assert.match(tabs, /tabBarBadge/u);
assert.match(provider, /useChatRealtime/u);
assert.match(provider, /useChatUnreadCount/u);
assert.match(realtime, /message\.sender_id, userId/u);
assert.match(realtime, /consumeCreatedMessageId/u);
assert.match(realtime, /removeChannel/u);
assert.match(realtime, /clearInterval\(membershipRecheck\)/u);
assert.match(realtime, /clearTimeout\(retryTimer\)/u);
assert.match(screen, /hasCachedMessages: messagesQuery\.data !== undefined/u);
assert.doesNotMatch(screen, /useChatRealtime/u);
assert.match(screen, /setChatActive\(true\)/u);
assert.match(screen, /useMarkChatRead/u);
assert.doesNotMatch(
  pushFiles,
  /CHAT_CREATED|CHAT_MESSAGE|chat_message_created/u,
);
console.log(
  'PASS: session-level private Realtime owns unread invalidation and cleanup; Chat cache remains renderable while reconnecting.',
);

assert.match(journalScreen, /refreshing=\{isManualRefreshing\}/u);
assert.match(journalScreen, /runManualRefresh/u);
assert.doesNotMatch(journalScreen, /refreshing=\{[^}]*isFetching/u);
assert.match(journalScreen, /postsQuery\.data !== undefined/u);
assert.match(homeScreen, /runManualRefresh\(setIsRefreshing/u);
assert.match(packageJson, /verify:chat-journal-ux/u);
console.log(
  'PASS: background Journal fetch is silent and only manual pull drives RefreshControl.',
);
console.log('PASS: no Chat remote push event or worker path was added.');

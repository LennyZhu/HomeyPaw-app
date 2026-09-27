import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';

import {
  chatKeys,
  createChatScopeKey,
  getFamilyChatTopic,
  shouldClearFamilyChatQuery,
} from '../src/features/chat/chat-scope.ts';
import { reconcileFamilyContext } from '../src/features/family/family-context-state.ts';
import {
  addOptimisticMessagePages,
  getChronologicalMessagesFromPages,
  reconcileChatMessagePages,
} from '../src/features/chat/chat-cache.ts';
import { consumeCreatedMessageId } from '../src/features/chat/chat-presentation.ts';
import { shouldClearRevokedPetQuery } from '../src/features/pets/pet-access-state.ts';

const client = new QueryClient();
const family = { id: 'family-a', created_at: '2026-09-01' };
const pets = ['Mochi', 'Test'].map((id) => ({
  id,
  family_id: family.id,
  created_at: '2026-09-01',
}));
const context = (storedPetId, familyId = family.id, familyPets = pets) =>
  reconcileFamilyContext({
    families: [family, { id: 'family-b', created_at: '2026-09-02' }],
    pets: familyPets,
    storedFamilyId: familyId,
    storedFamilyUserId: 'user-a',
    storedPetId,
    storedPetUserId: 'user-a',
    userId: 'user-a',
  });
const mochi = context('Mochi');
const test = context('Test');
const key = (state) => chatKeys.messages('user-a', state.currentFamily.id);
assert.deepEqual(
  key(mochi),
  key(test),
  'switching Pet must retain message query identity',
);
for (const kind of ['members', 'unread', 'version']) {
  assert.deepEqual(
    chatKeys[kind]('user-a', mochi.currentFamily.id),
    chatKeys[kind]('user-a', test.currentFamily.id),
  );
}
assert.equal(
  createChatScopeKey('user-a', mochi.currentFamily.id),
  createChatScopeKey('user-a', test.currentFamily.id),
);
const message = (id, petId, createdAt) => ({
  id,
  family_id: family.id,
  pet_id: petId,
  sender_id: 'member',
  client_message_id: id,
  body: id,
  created_at: createdAt,
  updated_at: createdAt,
});
const historical = [
  message('A', 'Mochi', '2026-09-01T10:00:00Z'),
  message('C', 'Test', '2026-09-01T10:02:00Z'),
];
client.setQueryData(key(mochi), {
  pages: [{ messages: historical, nextCursor: null }],
  pageParams: [null],
});
assert.strictEqual(
  client.getQueryData(key(test)),
  client.getQueryData(key(mochi)),
  'Pet switch must use the same cache',
);
assert.deepEqual(
  getChronologicalMessagesFromPages(client.getQueryData(key(test)).pages),
  historical,
);
const sent = message('new Family message', null, '2026-09-01T10:03:00Z');
client.setQueryData(key(test), (data) => ({
  ...data,
  pages: reconcileChatMessagePages(data.pages, sent),
}));
assert.equal(
  getChronologicalMessagesFromPages(client.getQueryData(key(mochi)).pages).at(
    -1,
  ).id,
  sent.id,
  'send while Test selected remains visible on Mochi',
);
// Review E: dual server notifications share one row ID. Family clients only
// subscribe to the Family topic; repeated hints and RPC echoes are idempotent.
const echoed = {
  ...message('server-row', 'Mochi', '2026-09-01T10:04:00Z'),
  client_message_id: 'client-key',
};
let echoPages = addOptimisticMessagePages(
  client.getQueryData(key(mochi)).pages,
  {
    ...echoed,
    id: 'optimistic-row',
    optimistic: true,
    deliveryState: 'sending',
  },
);
const seen = new Set();
for (const source of ['family-hint', 'repeated-family-hint', 'RPC-result']) {
  if (source === 'RPC-result' || consumeCreatedMessageId(seen, echoed.id)) {
    echoPages = reconcileChatMessagePages(echoPages, echoed);
  }
}
assert.equal(seen.size, 1, 'repeated hints processed once');
assert.equal(
  echoPages
    .flatMap((page) => page.messages)
    .filter((row) => row.client_message_id === echoed.client_message_id).length,
  1,
  'one canonical row replaces optimistic state across RPC/realtime ordering',
);
assert.equal(
  echoPages.flatMap((page) => page.messages).some((row) => row.optimistic),
  false,
  'no duplicate optimistic state',
);
// RPC result may arrive first as well.
let rpcFirst = addOptimisticMessagePages([], {
  ...echoed,
  id: 'optimistic-row',
  optimistic: true,
});
for (let attempt = 0; attempt < 3; attempt++)
  rpcFirst = reconcileChatMessagePages(rpcFirst, echoed);
assert.deepEqual(
  rpcFirst[0].messages,
  [echoed],
  'RPC-first repeated realtime echoes retain one row',
);
const zero = context(null, family.id, []);
assert.equal(zero.currentPet, null);
assert.deepEqual(
  key(zero),
  key(mochi),
  'zero-Pet Family must retain a valid room',
);
assert.ok(createChatScopeKey('user-a', zero.currentFamily.id));
const other = context(null, 'family-b', []);
assert.notDeepEqual(key(other), key(mochi));
assert.notEqual(
  createChatScopeKey('user-a', other.currentFamily.id),
  createChatScopeKey('user-a', family.id),
);
assert.equal(
  getFamilyChatTopic(mochi.currentFamily.id, 1),
  getFamilyChatTopic(test.currentFamily.id, 1),
);
assert.notEqual(
  getFamilyChatTopic(other.currentFamily.id, 1),
  getFamilyChatTopic(test.currentFamily.id, 1),
);
assert.notEqual(
  getFamilyChatTopic(family.id, 2),
  getFamilyChatTopic(family.id, 1),
);
client.setQueryData(chatKeys.unread('user-a', family.id), 3);
assert.equal(
  client.getQueryData(chatKeys.unread('user-a', test.currentFamily.id)),
  3,
);
assert.equal(
  shouldClearRevokedPetQuery(
    key(mochi),
    'user-a',
    'Mochi',
    client.getQueryData(key(mochi)),
  ),
  false,
  'Pet lifecycle must not evict Family history',
);
assert.equal(
  client.getQueryData(key(other)),
  undefined,
  'another Family cannot reuse message cache',
);
assert.equal(
  createChatScopeKey('user-b', family.id) ===
    createChatScopeKey('user-a', family.id),
  false,
);

assert.equal(
  shouldClearFamilyChatQuery(key(zero), 'user-a', family.id),
  true,
  'zero-Pet Family access cleanup clears the room',
);
assert.equal(
  shouldClearFamilyChatQuery(key(other), 'user-a', family.id),
  false,
  'cleanup must retain other Family rooms',
);
assert.equal(
  shouldClearFamilyChatQuery(
    chatKeys.messages('user-b', family.id),
    'user-a',
    family.id,
  ),
  false,
  'cleanup must not cross accounts',
);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const queries = read('src/features/chat/chat-queries.ts');
const realtime = read('src/features/chat/use-chat-realtime.ts');
const provider = read('src/features/chat/chat-session-provider.tsx');
const screen = read('src/features/chat/chat-screen.tsx');
const familyCleanup = read('src/features/family/family-access-cleanup.ts');
assert.match(
  familyCleanup,
  /shouldClearFamilyChatQuery\(query.queryKey, userId, familyId\)/,
);
assert.doesNotMatch(queries, /target_pet_id|petId/);
assert.match(queries, /family_id: familyId,[\s\S]*pet_id: null/);
assert.match(queries, /get_family_chat_messages_page/);
assert.match(queries, /send_family_chat_message/);
assert.doesNotMatch(realtime, /petId|pet_id|pet:/);
assert.match(realtime, /message\?\.family_id === familyId/);
assert.match(realtime, /family_chat_channel_rotated/);
assert.match(provider, /familyState\.currentFamilyId/);
assert.doesNotMatch(provider, /currentPet|clearRevokedPetAccess/);
assert.match(screen, /useChatMessages\(\s*familyId,/);
assert.match(screen, /useSendChatMessage\(familyId/);
assert.match(screen, /key=\{familyId\}/);
assert.doesNotMatch(screen, /if \(!pet\)|key=\{pet\.id\}|petId:/);
assert.match(screen, /if \(!familyId\)/);
client.clear();
console.log(
  'PASS: same-Family Pet switch keeps query/cache/messages/send/session/realtime/unread; zero Pet works; Family/user changes isolate rooms; Pet cleanup cannot evict Family history; repeated realtime/RPC echoes replace optimistic state without duplicates.',
);

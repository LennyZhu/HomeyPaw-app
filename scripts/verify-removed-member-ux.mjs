import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const importSource = (path) =>
  import(`${pathToFileURL(resolve(process.cwd(), path)).href}?v=${Date.now()}`);
const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');

const access = await importSource('src/features/pets/pet-access-state.ts');
const journal = await importSource('src/features/journal/manual-refresh.ts');
const pets = [{ id: 'pet-a' }, { id: 'pet-b' }];

assert.equal(
  access.selectAccessiblePet(pets, 'pet-a', 'user-a', 'user-a')?.id,
  'pet-a',
);
assert.equal(
  access.selectAccessiblePet([pets[1]], 'pet-a', 'user-a', 'user-a')?.id,
  'pet-b',
);
assert.equal(access.selectAccessiblePet([], 'pet-a', 'user-a', 'user-a'), null);
assert.equal(
  access.selectAccessiblePet([pets[1], pets[0]], 'pet-a', 'user-a', 'user-b')
    ?.id,
  'pet-b',
);
assert.equal(
  access.selectAccessiblePet(pets, 'pet-a', 'user-a', undefined),
  null,
);
assert.equal(journal.isJournalInitialLoading(false, false, true), false);
assert.equal(journal.isJournalInitialLoading(true, false, true), true);
console.log(
  'PASS: revoked active pet falls back safely, no-family state does not spin, and persisted selection is user-scoped.',
);

for (const key of [
  ['care', 'user-a', 'history', 'pet-a'],
  ['care-schedule', 'user-a', 'pet', 'pet-a'],
  ['care-tasks', 'user-a', 'occurrences', 'pet-a'],
  ['chat', 'user-a', 'messages', 'pet-a'],
  ['family', 'user-a', 'members', 'pet-a'],
  ['pet', 'user-a', 'pet-a'],
  ['posts', 'user-a', 'list', 'pet-a'],
]) {
  assert.equal(access.shouldClearRevokedPetQuery(key, 'user-a', 'pet-a'), true);
}
assert.equal(
  access.shouldClearRevokedPetQuery(
    ['posts', 'user-a', 'detail', 'post-a'],
    'user-a',
    'pet-a',
    { pet_id: 'pet-a' },
  ),
  true,
);
assert.equal(
  access.shouldClearRevokedPetQuery(
    ['posts', 'user-b', 'list', 'pet-a'],
    'user-a',
    'pet-a',
  ),
  false,
);
assert.equal(
  access.shouldClearRevokedPetQuery(
    ['posts', 'user-a', 'list', 'pet-b'],
    'user-a',
    'pet-a',
  ),
  false,
);
assert.equal(
  access.shouldClearRevokedPetQuery(['profile', 'user-a'], 'user-a', 'pet-a'),
  false,
);
console.log(
  'PASS: revoked-pet Journal, Chat, Care, Reminder, Schedule, Family, and pet caches are cleared without crossing user or pet scope.',
);

const [
  provider,
  cleanup,
  realtime,
  journalScreen,
  homeScreen,
  chatScreen,
  scheduleScreen,
  remindersScreen,
  push,
  packageJson,
] = await Promise.all([
  read('src/features/chat/chat-session-provider.tsx'),
  read('src/features/pets/pet-access-cleanup.ts'),
  read('src/features/chat/use-chat-realtime.ts'),
  read('src/features/journal/journal-screen.tsx'),
  read('src/features/home/home-screen.tsx'),
  read('src/features/chat/chat-screen.tsx'),
  read('src/features/schedule/schedule-screen.tsx'),
  read('src/features/reminders/reminders-screen.tsx'),
  Promise.all([
    read('src/features/reminders/family-push-coordinator.tsx'),
    read('supabase/functions/family-push/index.ts'),
  ]).then((files) => files.join('\n')),
  read('package.json'),
]);

assert.match(provider, /clearRevokedPetAccess/u);
assert.match(
  provider,
  /setQueryData\(chatKeys\.unread\(user\.id, petId\), 0\)/u,
);
assert.match(cleanup, /removeQueries/u);
assert.match(cleanup, /filter\(\(pet\) => pet\.id !== petId\)/u);
assert.match(cleanup, /setCurrentPetId\(null\)/u);
assert.match(cleanup, /syncCareTaskNotifications/u);
assert.match(realtime, /membershipRecheckIntervalMs/u);
assert.match(realtime, /AppState\.addEventListener/u);
assert.match(realtime, /clearInterval\(membershipRecheck\)/u);
assert.match(realtime, /removeChannel/u);
assert.match(journalScreen, /Boolean\(petsState\.currentPet\)/u);
assert.match(journalScreen, /posts\.empty\.noPetTitle/u);
assert.match(homeScreen, /petsState\.isSuccess && !pet/u);
assert.match(chatScreen, /if \(!pet\)/u);
assert.match(scheduleScreen, /!pet && petsState\.isSuccess/u);
assert.match(remindersScreen, /!pet && petsState\.isSuccess/u);
assert.doesNotMatch(push, /CHAT_CREATED|CHAT_MESSAGE|chat_message_created/u);
assert.match(packageJson, /verify:removed-member-ux/u);
console.log(
  'PASS: foreground, resume, and cold-start convergence paths retain Realtime cleanup and schedule no Chat push.',
);

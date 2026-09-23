import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isChatMessageConsecutive } from '../src/features/chat/chat-message-grouping.ts';
import { resolveHistoricalActorDisplayName } from '../src/features/family/historical-actor.ts';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const zhHK = JSON.parse(read('src/i18n/locales/zh-HK.json'));
const databaseTypes = read('src/types/database.ts');
const helper = read('src/features/family/historical-actor.ts');

const files = {
  careHistory: read('src/features/care/care-history-screen.tsx'),
  chatGrouping: read('src/features/chat/chat-message-grouping.ts'),
  chatList: read(
    'src/features/chat/components/production-chat-message-list.tsx',
  ),
  home: read('src/features/home/home-screen.tsx'),
  journal: read('src/features/journal/journal-screen.tsx'),
  postDetail: read('src/features/posts/post-detail-screen.tsx'),
  reminderDetail: read('src/features/reminders/care-task-detail-screen.tsx'),
  reminders: read('src/features/reminders/reminders-screen.tsx'),
  scheduleHome: read('src/features/schedule/components/home-schedule-card.tsx'),
  scheduleModel: read('src/features/schedule/care-schedule-model.ts'),
  scheduleShift: read(
    'src/features/schedule/components/schedule-shift-card.tsx',
  ),
};

const translations = {
  'common.deletedUser': 'Deleted user',
  'family.members.formerMember': 'Former family member',
};
const t = (key) => translations[key] ?? key;

assert.equal(en.common.deletedUser, 'Deleted user');
assert.equal(zhHK.common.deletedUser, '已刪除用戶');
assert.equal(en.family.members.formerMember, 'Former family member');
assert.equal(zhHK.family.members.formerMember, '已離開的家庭成員');

assert.equal(
  resolveHistoricalActorDisplayName({
    actorId: null,
    displayName: 'Stale cached personal name',
    t,
  }),
  'Deleted user',
  'A NULL actor must override cached profile or member data.',
);
assert.equal(
  resolveHistoricalActorDisplayName({
    actorId: 'existing-former-member-id',
    displayName: null,
    t,
  }),
  'Former family member',
  'A non-NULL actor missing from membership must remain a former member.',
);
assert.equal(
  resolveHistoricalActorDisplayName({
    actorId: 'current-member-id',
    displayName: 'Taylor',
    t,
  }),
  'Taylor',
  'A current actor must retain their display name.',
);
assert.equal(
  resolveHistoricalActorDisplayName({
    actorId: 'profile-loading-id',
    displayName: undefined,
    t,
  }),
  'Former family member',
  'An unresolved non-NULL actor must not be labeled as deleted.',
);
assert.match(
  helper,
  /if \(actorId === null\) return t\('common\.deletedUser'\)/u,
);

for (const [column, expected] of [
  ['author_id', 'string | null'],
  ['performed_by', 'string | null'],
  ['completed_by', 'string | null'],
  ['sender_id', 'string | null'],
]) {
  assert.match(
    databaseTypes,
    new RegExp(`${column}: ${expected.replace('|', '\\|')};`, 'u'),
    `${column} is not nullable in Database Types.`,
  );
}

for (const [label, source] of Object.entries({
  'Journal feed': files.journal,
  'Journal detail': files.postDetail,
  'Home activity': files.home,
  'Care history': files.careHistory,
  'Chat message list': files.chatList,
  'Reminder detail': files.reminderDetail,
  'Reminder list': files.reminders,
  'Schedule home': files.scheduleHome,
  'Schedule completion': files.scheduleShift,
})) {
  assert.match(
    source,
    /resolveHistoricalActorDisplayName/u,
    `${label} does not use the shared historical actor contract.`,
  );
}

assert.match(files.journal, /actorId: item\.post\.author_id/u);
assert.match(files.postDetail, /actorId: post\.author_id/u);
assert.match(files.home, /actorId: log\.performed_by/u);
assert.match(files.home, /actorId: post\.author_id/u);
assert.match(files.careHistory, /actorId: item\.log\.performed_by/u);
assert.match(files.chatList, /actorId: item\.sender_id/u);
assert.match(files.reminderDetail, /actorId: task\.created_by/u);
assert.match(files.reminderDetail, /actorId: occurrence\.completed_by/u);
assert.match(files.reminders, /actorId: occurrence\.created_by/u);
assert.match(files.reminders, /actorId: occurrence\.completed_by/u);
assert.match(files.scheduleHome, /actorId: item\.completed_by/u);
assert.match(files.scheduleShift, /actorId: item\.completed_by/gu);

assert.match(
  files.postDetail,
  /const authorMember = post\.author_id\s+\?[^:]+: undefined;/su,
  'Journal detail can reuse an avatar lookup for a NULL author.',
);
assert.match(
  files.chatList,
  /const member = item\.sender_id\s+\?[^:]+: undefined;/su,
  'Chat can reuse an avatar lookup for a NULL sender.',
);
assert.match(
  files.postDetail,
  /const isAuthor = post\.author_id !== null &&/u,
  'Anonymous Journal capability is not explicitly non-author.',
);
assert.match(
  files.chatGrouping,
  /message\.sender_id === null[\s\S]+previous\.sender_id === null/u,
  'Anonymous Chat messages can be grouped as if they share a known sender.',
);

const timestamp = '2026-09-23T09:00:00.000Z';
assert.equal(
  isChatMessageConsecutive(
    { created_at: timestamp, sender_id: null },
    { created_at: timestamp, sender_id: null },
  ),
  false,
  'Two anonymous Chat messages must not imply the same deleted identity.',
);
assert.equal(
  isChatMessageConsecutive(
    { created_at: timestamp, sender_id: 'member-a' },
    { created_at: timestamp, sender_id: 'member-a' },
  ),
  true,
  'Known-sender Chat grouping regressed.',
);

assert.match(
  files.scheduleHome,
  /!group\.assigneeUserId[\s\S]+schedule\.unassigned/u,
);
assert.match(files.scheduleShift, /isUnassigned[\s\S]+schedule\.unassigned/u);
assert.match(
  files.scheduleModel,
  /const key = shift\.assigneeUserId \?\? 'unassigned'/u,
  'Schedule no longer preserves the existing unassigned NULL contract.',
);

const presentationSources = Object.values(files).join('\n');
assert.doesNotMatch(
  presentationSources,
  /['"](?:Deleted user|已刪除用戶)['"]/u,
  'Deleted User copy is hard-coded outside i18n.',
);
assert.doesNotMatch(
  presentationSources,
  /(?:author_id|performed_by|completed_by|sender_id|created_by)\s+as\s+string/u,
  'A nullable historical actor is forced to string.',
);
assert.doesNotMatch(
  presentationSources,
  /(?:author_id|performed_by|completed_by|sender_id|created_by)!/u,
  'A nullable historical actor uses a non-null assertion.',
);
assert.doesNotMatch(
  presentationSources,
  /\.eq\(['"]id['"],\s*(?:post\.author_id|log\.performed_by|item\.completed_by|item\.sender_id)/u,
  'A nullable actor is sent to a per-record Profile lookup.',
);
assert.doesNotMatch(
  presentationSources,
  /(?:authorName|performerName|senderName|completerName)\s*\?\?\s*(?:.*(?:id|email))/iu,
  'A technical identifier is used as an identity fallback.',
);

console.log(
  'PASS: C4D-D Deleted User labels, former-member distinction, nullable actor boundaries, avatar safety, UI capability checks, and Schedule ambiguity contract.',
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CHAT_MESSAGE_GROUP_WINDOW_MS,
  isChatMessageConsecutive,
} from '../src/features/chat/chat-message-grouping.ts';

const [screen, list, english, chinese] = await Promise.all([
  readFile(
    new URL('../src/features/chat/chat-screen.tsx', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL(
      '../src/features/chat/components/production-chat-message-list.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL('../src/i18n/locales/en.json', import.meta.url),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('../src/i18n/locales/zh-HK.json', import.meta.url),
    'utf8',
  ).then(JSON.parse),
]);

assert.match(screen, /numberOfLines=\{1\}[\s\S]*\{pet\.name\}/u);
assert.match(screen, /ellipsizeMode="tail"/u);
assert.match(screen, /chat\.live\.header\.subtitle/u);
assert.doesNotMatch(
  screen,
  /t\('chat\.live\.header\.title', \{ name: pet\.name \}\)/u,
);
assert.equal(
  chinese.chat.live.header.subtitle_other,
  '家庭聊天室 · {{count}}位家人',
);
assert.equal(
  english.chat.live.header.subtitle_other,
  'Family Chat · {{count}} family members',
);

assert.match(list, /member\?\.displayName/u);
assert.doesNotMatch(list, /member\?\.role|member\.role/u);
assert.match(list, /!isOwn && !consecutive/u);
assert.match(list, /consecutive && styles\.consecutiveRow/u);
assert.match(list, /consecutive \? \([\s\S]*styles\.avatarSpacer/u);

const message = (senderId, createdAt) => ({
  created_at: createdAt,
  sender_id: senderId,
});
const first = message('member-a', '2026-09-11T02:00:00.000Z');
assert.equal(
  isChatMessageConsecutive(
    message('member-a', '2026-09-11T02:04:59.000Z'),
    first,
  ),
  true,
);
assert.equal(
  isChatMessageConsecutive(
    message(
      'member-a',
      new Date(
        new Date(first.created_at).getTime() + CHAT_MESSAGE_GROUP_WINDOW_MS,
      ).toISOString(),
    ),
    first,
  ),
  true,
);
assert.equal(
  isChatMessageConsecutive(
    message('member-a', '2026-09-11T02:05:00.001Z'),
    first,
  ),
  false,
);
assert.equal(
  isChatMessageConsecutive(
    message('member-b', '2026-09-11T02:01:00.000Z'),
    first,
  ),
  false,
);
assert.equal(
  isChatMessageConsecutive(
    message('member-a', '2026-09-10T16:01:00.000Z'),
    message('member-a', '2026-09-10T15:59:00.000Z'),
  ),
  false,
);
assert.equal(
  isChatMessageConsecutive(
    message('current-user', '2026-09-11T02:02:00.000Z'),
    message('current-user', '2026-09-11T02:01:00.000Z'),
  ),
  true,
);

assert.match(list, /onLongPress=\{\(\) =>/u);
assert.match(list, /Haptics\.selectionAsync/u);
assert.match(list, /accessibilityActions=\{actions\}/u);
assert.doesNotMatch(list, /name="ellipsis-horizontal"/u);
assert.match(
  list,
  /onPress=\{canRetry \? \(\) => requestAction\(item\) : undefined\}/u,
);
assert.match(
  list,
  /const canDelete = !item\.optimistic && \(isOwn \|\| canModerate\)/u,
);
assert.match(list, /const canEdit = !item\.optimistic && isOwn/u);
assert.match(list, /canEdit=\{targetCanEdit\}/u);
assert.match(list, /canDelete=\{targetCanDelete\}/u);

assert.match(list, /useContentLayout\('modal'\)/u);
assert.match(list, /animationType=\{isWide \? 'fade' : 'slide'\}/u);
assert.match(list, /isWide && styles\.actionOverlayWide/u);
assert.match(list, /contentStyles\.modal/u);
assert.match(list, /accessibilityViewIsModal/u);
assert.match(list, /minHeight: 56/u);
assert.match(list, /cancel && styles\.cancelAction/u);
assert.match(list, /destructive \? lightColors\.error/u);

console.log(
  'PASS: compact Chat header copy, truncation, and full-name accessibility.',
);
console.log(
  'PASS: five-minute, sender, and local-date message grouping boundaries.',
);
console.log(
  'PASS: own/member/owner actions remain permission-scoped and accessible.',
);
console.log('PASS: long press replaces permanent message action affordances.');
console.log('PASS: iPhone sheet and iPad centered action modal variants.');

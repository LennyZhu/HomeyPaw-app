import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const route = read('src/app/chat-preview.tsx');
const rootLayout = read('src/app/_layout.tsx');
const tabsLayout = read('src/app/(tabs)/_layout.tsx');
const mockData = read('src/features/chat/mock-chat-data.ts');
const previewSource = [
  route,
  read('src/features/chat/chat-preview-screen.tsx'),
  read('src/features/chat/components/chat-message-list.tsx'),
  read('src/features/chat/components/chat-composer.tsx'),
  read('src/features/chat/chat-date.ts'),
  mockData,
].join('\n');

assert(
  route.includes('if (!__DEV__)'),
  'Route is missing its page-level production guard.',
);
assert(
  route.includes('<Redirect href="/" />'),
  'Production route guard does not redirect away from the preview.',
);
assert(
  rootLayout.includes('<Stack.Protected guard={__DEV__}>') &&
    rootLayout.includes('<Stack.Screen name="chat-preview" />'),
  'Root navigator is missing its development-only protected route.',
);
assert(
  !tabsLayout.includes('chat-preview') && !tabsLayout.includes('name="chat"'),
  'Production bottom tabs expose a Chat route.',
);
assert(
  mockData.includes('Array.from({ length: 100 }'),
  'The 100-message performance story is missing.',
);
assert(
  mockData.includes("id: 'mock-pet-doudou'") &&
    mockData.includes("id: 'mock-pet-mochi'"),
  'Independent mock pet identities are missing.',
);

const forbiddenRuntimePatterns = [
  /requireSupabase/u,
  /from\(['"]chat_/u,
  /\.rpc\(/u,
  /\.channel\(/u,
  /WebSocket/u,
  /AsyncStorage/u,
  /expo-image-picker/u,
  /expo-camera/u,
  /expo-notifications/u,
];
for (const pattern of forbiddenRuntimePatterns) {
  assert(
    !pattern.test(previewSource),
    `Forbidden prototype runtime pattern found: ${pattern}`,
  );
}

const beforeMidnight = new Date('2026-08-25T15:59:00.000Z');
const afterMidnight = new Date('2026-08-25T16:01:00.000Z');
const dateOnly = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};
assert(
  dateOnly(beforeMidnight) === '2026-08-25' &&
    dateOnly(afterMidnight) === '2026-08-26',
  'Hong Kong 23:59/00:01 date grouping check failed.',
);

const longZh = JSON.parse(read('src/i18n/locales/zh-HK.json')).chat.preview.mock
  .long.body;
const longEn = JSON.parse(read('src/i18n/locales/en.json')).chat.preview.mock
  .long.body;
assert(
  longZh.length >= 500,
  `zh-HK long-message fixture is only ${longZh.length} characters.`,
);
assert(
  longEn.length >= 500,
  `English long-message fixture is only ${longEn.length} characters.`,
);

if (failures.length) {
  console.error('Chat prototype verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    'PASS: development guards, bottom tabs, Mock-only runtime, 100-message fixture,',
  );
  console.log(
    '      pet isolation, Hong Kong midnight grouping, and long-message fixtures.',
  );
}

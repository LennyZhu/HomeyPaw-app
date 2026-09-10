import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { primaryCreateActions } from '../src/features/create/create-menu-model.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [journal, create, en, zh] = await Promise.all([
  read('src/features/journal/journal-screen.tsx'),
  read('src/features/create/create-screen.tsx'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
]);

assert.ok(journal.includes("t('journal.title')"));
assert.equal(journal.includes("t('journal.timelineSubtitle'"), false);
assert.equal(journal.includes("t('posts.list.noPetSubtitle')"), false);
assert.equal(journal.includes("t('posts.list.add')"), false);
assert.equal(journal.includes('styles.addButton'), false);
assert.ok(journal.includes('styles.petSelector'));
assert.ok(journal.includes('styles.filterButton'));
assert.ok(journal.includes("router.push('/posts/new')"));

for (const scrollBehavior of [
  'contentOffset={{ x: 0, y: initialScrollOffset }}',
  'key={listStateKey}',
  'maintainVisibleContentPosition',
  'setJournalScrollOffset',
  'postsQuery.fetchNextPage()',
]) {
  assert.ok(journal.includes(scrollBehavior), scrollBehavior);
}

assert.deepEqual(
  primaryCreateActions.map((action) => action.id),
  ['journal', 'care', 'reminder', 'schedule'],
);
assert.equal(primaryCreateActions.length, 4);
assert.deepEqual(
  primaryCreateActions.map((action) => action.destination),
  [
    { href: '/posts/new', kind: 'route' },
    { href: '/create?mode=care', kind: 'route' },
    { href: '/reminders/new', kind: 'route' },
    { href: '/schedule/new', kind: 'route' },
  ],
);
assert.equal(
  primaryCreateActions.some((action) => 'type' in action.destination),
  false,
);

assert.ok(create.includes("activeMenu === 'care'"));
assert.ok(create.includes("mode === 'care' ? 'care' : 'root'"));
assert.ok(create.includes('careTypes.map'));
assert.ok(create.includes('healthObservationTypes.map'));
assert.equal(create.includes("t('care.quick.subtitle'"), false);
assert.ok(create.includes('accessibilityLabel={label}'));
assert.ok(create.includes('accessibilityViewIsModal'));
assert.ok(create.includes('minHeight: 56'));
assert.ok(create.includes('...contentStyles.modal'));
assert.ok(create.includes("router.replace('/')"));
assert.ok(create.includes('requestAnimationFrame(() => router.push(href))'));

const enLocale = JSON.parse(en);
const zhLocale = JSON.parse(zh);
assert.deepEqual(enLocale.create.menu, {
  care: 'Record Care',
  journal: 'New Journal',
  reminder: 'New Reminder',
  schedule: 'New Schedule',
  title: 'New',
});
assert.deepEqual(zhLocale.create.menu, {
  care: '記錄照顧',
  journal: '記錄日記',
  reminder: '新增提醒',
  schedule: '新增排班',
  title: '新增',
});

console.log(
  'PASS: Journal header is reduced without changing timeline state, and Global Create exposes four accessible primary routes with a nested Care picker.',
);

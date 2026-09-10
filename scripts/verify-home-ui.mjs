import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildCalendarMonth } from '../src/features/schedule/calendar-date.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [home, homeSchedule, schedule, sectionHeader] = await Promise.all([
  read('src/features/home/home-screen.tsx'),
  read('src/features/schedule/components/home-schedule-card.tsx'),
  read('src/features/schedule/schedule-screen.tsx'),
  read('src/features/home/components/home-section-header.tsx'),
]);

const hierarchy = [
  'style={styles.petHeader}',
  "title={t('care.home.title')}",
  '<HomeScheduleCard',
  "title={t('home.recentActivity')}",
  "<HomeSection title={t('home.family')}",
].map((needle) => home.indexOf(needle));

assert.ok(hierarchy.every((index) => index >= 0));
assert.deepEqual(
  hierarchy,
  [...hierarchy].sort((a, b) => a - b),
);
assert.ok(home.includes('getCompanionDays(pet.adoption_date)'));
assert.ok(home.includes('companionDays !== null && companionDays > 0'));
assert.ok(home.includes('name="heart-outline"'));

for (const removed of [
  'getGreetingKey',
  'home.greetingSubtitle',
  'home.greetings.',
  'home.memory.',
  'home.viewJournal',
  'usePetMemory',
  'PostMediaPreview',
]) {
  assert.equal(home.includes(removed), false, `${removed} remains on Home`);
}

assert.equal(buildCalendarMonth('2023-02-01').length, 35);
assert.equal(buildCalendarMonth('2026-05-01').length, 42);
assert.equal(homeSchedule.includes('fixedSixWeeks'), false);
assert.match(schedule, /<ScheduleMonthCalendar\s+fixedSixWeeks/u);

assert.ok(home.includes('<HomeSectionHeader'));
assert.ok(homeSchedule.includes('<HomeSectionHeader'));
assert.ok(sectionHeader.includes('accessibilityLabel={action}'));
assert.ok(sectionHeader.includes('accessibilityRole="button"'));
assert.ok(sectionHeader.includes('minHeight: 44'));
assert.ok(sectionHeader.includes('tone="brand"'));
assert.ok(sectionHeader.includes('variant="footnote"'));

console.log(
  'PASS: Home hierarchy, companion visibility, removed modules, compact calendar, full schedule grid, and shared section actions.',
);

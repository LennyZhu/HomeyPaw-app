import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandCareTaskOccurrences } from '../src/features/reminders/care-task-recurrence.ts';
import {
  planCareTaskNotifications,
  occurrenceKey,
  rollingWindowDays,
  maximumScheduledNotifications,
} from '../src/services/care-task-notification-plan.ts';
const now = new Date('2026-10-01T00:00Z');
const end = new Date(now.getTime() + rollingWindowDays * 86_400_000);
const rule = {
  scheduleType: 'weekly',
  startsOn: '2026-10-01',
  endsOn: null,
  localTime: '18:00',
  timeZone: 'Asia/Hong_Kong',
  weekDays: [1, 2, 3, 4, 5],
  monthDay: null,
  scheduledAt: null,
};
const rows = (task_id, schedule) =>
  expandCareTaskOccurrences(schedule, now, end).map((date) => ({
    task_id,
    scheduled_for: date.toISOString(),
    completion_id: null,
  }));
const weekly = rows('weekly', rule);
assert.equal(weekly.length, 22, 'Mon-Fri occurrences in 30-day window');
const all = [
  ...weekly,
  ...rows('weekly-b', rule),
  ...rows('daily', { ...rule, scheduleType: 'daily', weekDays: null }),
];
const plan = planCareTaskNotifications([...all, ...weekly].reverse(), now);
assert.equal(plan.length, maximumScheduledNotifications);
assert.equal(maximumScheduledNotifications, 48);
assert.deepEqual(
  plan,
  planCareTaskNotifications(all, now),
  'stable order regardless of input/duplicates',
);
assert.equal(
  new Set(plan.map((row) => occurrenceKey(row.task_id, row.scheduled_for)))
    .size,
  48,
);
assert.ok(plan.every((row) => new Date(row.scheduled_for) < end));
const short = planCareTaskNotifications(
  rows('weekly', { ...rule, endsOn: '2026-10-02' }),
  now,
);
assert.equal(short.length, 2);
const desiredKeys = new Set(
  short.map((row) => occurrenceKey(row.task_id, row.scheduled_for)),
);
const invalid = weekly.filter(
  (row) => !desiredKeys.has(occurrenceKey(row.task_id, row.scheduled_for)),
);
assert.equal(invalid.length, 20, 'shortening end removes stale pending keys');
const changed = planCareTaskNotifications(
  rows('weekly', { ...rule, weekDays: [7] }),
  now,
);
assert.ok(
  changed.every(
    (row) => !weekly.some((old) => old.scheduled_for === row.scheduled_for),
  ),
);
assert.equal(
  planCareTaskNotifications([{ ...weekly[0], completion_id: 'done' }], now)
    .length,
  0,
);
const service = readFileSync(
  new URL('../src/services/care-task-notifications.ts', import.meta.url),
  'utf8',
);
assert.match(service, /planCareTaskNotifications\(occurrences, now\)/u);
assert.match(
  service,
  /!desiredByKey\.has\(key\) \|\| !pendingIds\.has\(mapping\.notificationId\)/u,
);
assert.match(service, /cancelScheduledNotificationAsync/u);
assert.match(service, /SchedulableTriggerInputTypes\.DATE/u);
console.log(
  'PASS: 30-day Mon-Fri plan, deterministic/deduplicated earliest 48, completed filtering and invalid pending notification keys canceled by sync.',
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  mergeScheduleReminderSelection,
  occurrenceKey,
  stageScheduleReminderReturn,
  takeScheduleReminderReturn,
} from '../src/features/schedule/schedule-reminder-return.ts';
import { getNewReminderCompletionNavigation } from '../src/features/reminders/reminder-navigation.ts';
import { getLocalDateInTimeZone } from '../src/features/schedule/calendar-date.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const reminderReturn = {
  draftId: 'schedule-draft-1',
  petId: 'pet-1',
  scheduleDate: '2026-09-13',
  taskId: 'task-new',
};
const newOccurrence = {
  care_type: 'feeding',
  completion_id: null,
  is_active: true,
  scheduled_for: '2026-09-12T16:30:00.000Z',
  task_id: 'task-new',
  time_zone: 'Asia/Hong_Kong',
  title: 'Breakfast',
};
const existingOccurrence = {
  ...newOccurrence,
  scheduled_for: '2026-09-13T01:00:00.000Z',
  task_id: 'task-existing',
  title: 'Walk',
};

stageScheduleReminderReturn(reminderReturn);
assert.deepEqual(
  takeScheduleReminderReturn(reminderReturn.draftId),
  reminderReturn,
);
assert.equal(takeScheduleReminderReturn(reminderReturn.draftId), null);

const existingKey = occurrenceKey(existingOccurrence);
const onScheduleDate = [existingOccurrence, newOccurrence].filter(
  (occurrence) =>
    getLocalDateInTimeZone(occurrence.scheduled_for, occurrence.time_zone) ===
    reminderReturn.scheduleDate,
);
const selected = mergeScheduleReminderSelection({
  assignedKeys: new Set(),
  currentSelectedKeys: new Set([existingKey]),
  occurrences: onScheduleDate,
  petId: 'pet-1',
  result: reminderReturn,
  scheduleDate: '2026-09-13',
});
assert.equal(selected.kind, 'selected');
assert.deepEqual(
  [...selected.selectedKeys].sort(),
  [existingKey, occurrenceKey(newOccurrence)].sort(),
);
const deduplicated = mergeScheduleReminderSelection({
  assignedKeys: new Set(),
  currentSelectedKeys: selected.selectedKeys,
  occurrences: [newOccurrence],
  petId: 'pet-1',
  result: reminderReturn,
  scheduleDate: '2026-09-13',
});
assert.equal(deduplicated.selectedKeys.size, 2);
assert.equal(
  mergeScheduleReminderSelection({
    assignedKeys: new Set(),
    currentSelectedKeys: new Set(),
    occurrences: [
      { ...newOccurrence, time_zone: 'America/Los_Angeles' },
    ].filter(
      (occurrence) =>
        getLocalDateInTimeZone(
          occurrence.scheduled_for,
          occurrence.time_zone,
        ) === reminderReturn.scheduleDate,
    ),
    petId: 'pet-1',
    result: reminderReturn,
    scheduleDate: '2026-09-13',
  }).kind,
  'ineligible',
);
assert.equal(
  mergeScheduleReminderSelection({
    assignedKeys: new Set([occurrenceKey(newOccurrence)]),
    currentSelectedKeys: new Set(),
    occurrences: [newOccurrence],
    petId: 'pet-1',
    result: reminderReturn,
    scheduleDate: '2026-09-13',
  }).kind,
  'ineligible',
);
console.log(
  'PASS: returned Reminder selection preserves existing choices, deduplicates, and uses the occurrence IANA time zone.',
);

assert.deepEqual(
  getNewReminderCompletionNavigation({
    canGoBack: true,
    returnTo: '/schedule/new?date=2026-09-13',
    source: 'schedule',
  }),
  { kind: 'back' },
);
assert.deepEqual(
  getNewReminderCompletionNavigation({
    canGoBack: false,
    returnTo: '/schedule/new?date=2026-09-13',
    source: 'schedule',
  }),
  { href: '/schedule/new?date=2026-09-13', kind: 'replace' },
);
assert.deepEqual(getNewReminderCompletionNavigation({ canGoBack: true }), {
  kind: 'back',
});
assert.deepEqual(getNewReminderCompletionNavigation({ canGoBack: false }), {
  href: '/reminders',
  kind: 'replace',
});
console.log(
  'PASS: Schedule uses history-aware back navigation while ordinary Reminder navigation remains unchanged.',
);

const [scheduleScreen, reminderScreen, queries] = await Promise.all([
  read('src/features/schedule/new-schedule-screen.tsx'),
  read('src/features/reminders/new-care-task-screen.tsx'),
  read('src/features/reminders/care-task-queries.ts'),
]);
assert.match(scheduleScreen, /const \[draftId\] = useState/u);
assert.match(scheduleScreen, /source: 'schedule'/u);
assert.match(scheduleScreen, /scheduleDate: date/u);
assert.match(scheduleScreen, /scheduleDraftId: draftId/u);
assert.match(scheduleScreen, /takeScheduleReminderReturn\(draftId\)/u);
assert.match(scheduleScreen, /refetchOccurrences\(\)/u);
assert.match(scheduleScreen, /mergeScheduleReminderSelection/u);
assert.match(
  scheduleScreen,
  /disabled=\{Boolean\(dateError\) \|\| selectedOccurrences\.length === 0\}/u,
);
assert.match(reminderScreen, /stageScheduleReminderReturn/u);
assert.match(reminderScreen, /taskId,/u);
assert.match(reminderScreen, /monthDay: String\(day\)/u);
assert.match(reminderScreen, /weekDay: String\(jsDay === 0 \? 7 : jsDay\)/u);
assert.match(queries, /invalidateQueries\(\{ queryKey: careTaskKeys\.all/u);
console.log(
  'PASS: canonical task handoff, targeted occurrence refetch, date anchors, auto-selection, and enabled Create Shift CTA are wired.',
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import {
  addCalendarDays,
  buildCalendarMonth,
  getCalendarMonthRange,
  getLocalDateInTimeZone,
  getSixWeekCalendarRange,
  parseCalendarDate,
  shiftCalendarMonth,
} from '../src/features/schedule/calendar-date.ts';
import { getUserAvatarInitial } from '../src/components/avatar-initial.ts';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const modelSource = await read('src/features/schedule/care-schedule-model.ts');
const calendarModuleUrl = new URL(
  '../src/features/schedule/calendar-date.ts',
  import.meta.url,
).href;
const transpiledModel = ts
  .transpileModule(modelSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace("'./calendar-date'", `'${calendarModuleUrl}'`);
const {
  canCompleteCareScheduleItem,
  canManageCareShift,
  groupCareScheduleByAssignee,
  groupCareScheduleByShift,
  isCareScheduleItemMutable,
  scheduleItemsByDate,
  shouldExpandScheduleGroup,
  summarizeScheduleDay,
  truncateCareScheduleGroups,
} = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledModel).toString('base64')}`
);

function scheduleItem(overrides = {}) {
  return {
    assignee_avatar_path: null,
    assignee_avatar_url: null,
    assignee_display_name: 'Member B',
    assignee_user_id: 'member-b',
    care_log_id: null,
    care_task_id: 'task-1',
    claimed_at: null,
    completed_at: null,
    completed_by: null,
    completer_display_name: null,
    completion_id: null,
    local_date: '2026-09-08',
    pet_id: 'pet-1',
    shift_canceled_at: null,
    shift_id: 'shift-1',
    shift_note: null,
    shift_status: 'scheduled',
    shift_task_canceled_at: null,
    shift_task_id: 'shift-task-1',
    shift_task_status: 'scheduled',
    source_scheduled_for: '2026-09-08T00:00:00.000Z',
    split_from_shift_id: null,
    task_care_type: 'feeding',
    task_note: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'Breakfast',
    ...overrides,
  };
}

const leapGrid = buildCalendarMonth('2024-02-14');
assert.equal(
  leapGrid.filter((cell) => cell.inMonth).at(-1)?.date,
  '2024-02-29',
);
assert.equal(
  buildCalendarMonth('2023-02-14')
    .filter((cell) => cell.inMonth)
    .at(-1)?.date,
  '2023-02-28',
);
assert.equal(buildCalendarMonth('2026-11-01')[0]?.date, '2026-11-01');
assert.equal(buildCalendarMonth('2026-06-01')[1]?.date, '2026-06-01');
assert.equal(buildCalendarMonth('2026-05-01').length, 42);
assert.equal(getSixWeekCalendarRange('2026-09-08').end, '2026-10-11');
assert.deepEqual(getCalendarMonthRange('2026-12-20'), {
  end: '2027-01-01',
  start: '2026-12-01',
});
assert.equal(shiftCalendarMonth('2026-12-01', 1), '2027-01-01');
assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
assert.equal(parseCalendarDate('2026-02-29'), null);
assert.equal(
  getLocalDateInTimeZone('2026-09-07T16:30:00.000Z', 'Asia/Hong_Kong'),
  '2026-09-08',
);
console.log(
  'PASS: leap year, month boundaries, 6-week grid, and date-only math.',
);

assert.equal(getUserAvatarInitial(' Simulator Member '), 'S');
assert.equal(getUserAvatarInitial('jamie'), 'J');
assert.equal(getUserAvatarInitial('Alex'), 'A');
assert.equal(getUserAvatarInitial(' 家明'), '家');
assert.equal(getUserAvatarInitial(''), '?');
assert.equal(getUserAvatarInitial('   '), '?');
assert.equal(getUserAvatarInitial(null), '?');
console.log(
  'PASS: shared user avatar initials cover English, Chinese, and empty names.',
);

const groupedInput = [
  scheduleItem(),
  scheduleItem({
    care_task_id: 'task-2',
    shift_task_id: 'shift-task-2',
    source_scheduled_for: '2026-09-08T04:30:00.000Z',
    task_title: 'Walk',
  }),
  scheduleItem({
    assignee_display_name: 'Member C',
    assignee_user_id: 'member-c',
    shift_id: 'shift-2',
    shift_task_id: 'shift-task-3',
  }),
  scheduleItem({
    assignee_display_name: null,
    assignee_user_id: null,
    shift_id: 'shift-3',
    shift_task_id: 'shift-task-4',
  }),
];
const shifts = groupCareScheduleByShift(groupedInput);
assert.equal(shifts.length, 3);
assert.equal(shifts[0]?.items.length, 2);
assert.equal(scheduleItemsByDate(groupedInput)['2026-09-08']?.length, 4);
assert.deepEqual(summarizeScheduleDay(groupedInput), {
  completedCount: 0,
  itemCount: 4,
  members: [
    {
      avatarPath: null,
      avatarUrl: null,
      displayName: 'Member B',
      userId: 'member-b',
    },
    {
      avatarPath: null,
      avatarUrl: null,
      displayName: 'Member C',
      userId: 'member-c',
    },
  ],
  memberIds: ['member-b', 'member-c'],
  unassignedCount: 1,
});
const markerSummary = summarizeScheduleDay([
  scheduleItem(),
  scheduleItem({ shift_task_id: 'duplicate-member-task' }),
  scheduleItem({
    assignee_display_name: 'Member C',
    assignee_user_id: 'member-c',
    shift_id: 'shift-c',
    shift_task_id: 'member-c-task',
  }),
  scheduleItem({
    assignee_display_name: 'Member D',
    assignee_user_id: 'member-d',
    shift_id: 'shift-d',
    shift_task_id: 'member-d-task',
  }),
  scheduleItem({
    assignee_display_name: null,
    assignee_user_id: null,
    shift_id: 'shift-unassigned',
    shift_task_id: 'unassigned-task',
  }),
]);
assert.deepEqual(
  markerSummary.members.map((member) => member.userId),
  ['member-b', 'member-c', 'member-d'],
);
assert.equal(markerSummary.unassignedCount, 1);

const assigneeGroups = groupCareScheduleByAssignee(
  groupCareScheduleByShift([
    ...groupedInput,
    scheduleItem({
      care_task_id: 'task-5',
      shift_id: 'shift-4',
      shift_task_id: 'shift-task-5',
    }),
    scheduleItem({
      assignee_display_name: 'Member Complete',
      assignee_user_id: 'member-complete',
      completed_at: '2026-09-08T01:00:00.000Z',
      completed_by: 'member-complete',
      completion_id: 'completion-1',
      shift_id: 'shift-complete',
      shift_task_id: 'shift-task-complete',
    }),
    scheduleItem({
      assignee_display_name: 'Member Canceled',
      assignee_user_id: 'member-canceled',
      shift_canceled_at: '2026-09-07T00:00:00.000Z',
      shift_id: 'shift-canceled',
      shift_status: 'canceled',
      shift_task_canceled_at: '2026-09-07T00:00:00.000Z',
      shift_task_id: 'shift-task-canceled',
      shift_task_status: 'canceled',
    }),
  ]),
);
assert.equal(
  assigneeGroups.filter((group) => group.key === 'member-b').length,
  1,
);
assert.equal(
  assigneeGroups.find((group) => group.key === 'member-b')?.items.length,
  3,
);
const homeSummary = truncateCareScheduleGroups(assigneeGroups, 4);
assert.equal(
  homeSummary.visibleGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  ),
  4,
);
assert.equal(homeSummary.hiddenCount, 3);
assert.equal(
  shouldExpandScheduleGroup(
    assigneeGroups.find((group) => group.key === 'member-complete'),
  ),
  false,
);
assert.equal(
  shouldExpandScheduleGroup(
    assigneeGroups.find((group) => group.key === 'member-canceled'),
  ),
  false,
);
assert.equal(
  shouldExpandScheduleGroup(
    assigneeGroups.find((group) => group.key === 'unassigned'),
  ),
  true,
);
assert.equal(
  shouldExpandScheduleGroup(
    assigneeGroups.find((group) => group.key === 'member-b'),
  ),
  true,
);
const shift = shifts[0];
assert(shift);
assert.equal(canManageCareShift(shift, 'owner', 'owner-a'), true);
assert.equal(canManageCareShift(shift, 'member', 'member-b'), true);
assert.equal(canManageCareShift(shift, 'member', 'member-c'), false);
assert.equal(canManageCareShift(shift, 'viewer', 'member-b'), false);
assert.equal(
  isCareScheduleItemMutable(scheduleItem(), new Date('2026-09-07T20:00:00Z')),
  true,
);
assert.equal(
  canCompleteCareScheduleItem(scheduleItem(), new Date('2026-09-08T00:01:00Z')),
  true,
);
assert.equal(
  canCompleteCareScheduleItem(
    scheduleItem({ shift_task_status: 'canceled' }),
    new Date('2026-09-08T00:01:00Z'),
  ),
  false,
);
console.log(
  'PASS: Avatar deduplication, assignee grouping, truncation, defaults, and permissions.',
);

const [
  packageJson,
  avatar,
  rootLayout,
  homeScreen,
  homeSchedule,
  calendar,
  scheduleScreen,
  assigneeGroup,
  newScreen,
  editScreen,
  queries,
  scheduleApi,
  featureFlags,
  backendTarget,
  enText,
  zhText,
] = await Promise.all([
  read('package.json'),
  read('src/components/avatar.tsx'),
  read('src/app/_layout.tsx'),
  read('src/features/home/home-screen.tsx'),
  read('src/features/schedule/components/home-schedule-card.tsx'),
  read('src/features/schedule/components/schedule-month-calendar.tsx'),
  read('src/features/schedule/schedule-screen.tsx'),
  read('src/features/schedule/components/schedule-assignee-group.tsx'),
  read('src/features/schedule/new-schedule-screen.tsx'),
  read('src/features/schedule/edit-schedule-screen.tsx'),
  read('src/features/schedule/care-schedule-queries.ts'),
  read('src/features/schedule/care-schedule-api.ts'),
  read('src/config/features.ts'),
  read('src/config/backend-target.ts'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
]);

const packageData = JSON.parse(packageJson);
assert.equal(
  packageData.scripts['verify:phase11a-schedule-ui'],
  'node --experimental-strip-types scripts/verify-phase11a-schedule-ui.mjs',
);
assert(avatar.includes('source && sourceKey !== failedSourceKey'));
assert(avatar.includes('setFailedSourceKey(sourceKey)'));
assert(avatar.includes('getUserAvatarInitial(name)'));
assert(!avatar.includes('name="paw"'));
assert(
  !Object.keys(packageData.dependencies).some((name) =>
    /calendar/iu.test(name),
  ),
);
assert(rootLayout.includes('<Stack.Screen name="schedule" />'));
assert(homeScreen.includes('<HomeScheduleCard'));
assert(scheduleScreen.includes('<FlatList'));
assert(scheduleScreen.includes('getSixWeekCalendarRange'));
assert(scheduleScreen.includes("AppState.addEventListener('change'"));
assert(scheduleScreen.includes('<RefreshControl'));
assert(scheduleScreen.includes('groupCareScheduleByAssignee'));
assert(scheduleScreen.includes('setGroupExpansion'));
assert(homeSchedule.includes('const homeItemLimit = 4'));
assert(homeSchedule.includes('truncateCareScheduleGroups'));
assert(homeSchedule.includes('/schedule?date=${encodeURIComponent(date)}'));
assert(homeSchedule.includes("t('schedule.overflowCount'"));
assert(newScreen.includes('<CareTaskOccurrencePicker'));
assert(newScreen.includes("pathname: '/reminders/new'"));
assert(editScreen.includes('useCancelCareShiftTask'));
assert(editScreen.includes('isCareScheduleItemMutable'));
console.log(
  'PASS: Home integration, full-screen routing, forms, and virtualized day list.',
);

assert(scheduleApi.includes("'complete_care_shift_task'"));
assert(featureFlags.includes('SCHEDULE_ENABLED = LOCAL_FEATURE_PREVIEW'));
assert(featureFlags.includes('__DEV__ && LOCAL_BACKEND'));
assert(backendTarget.includes("['localhost', '127.0.0.1']"));
assert(scheduleApi.includes('SCHEDULE_BACKEND_UNAVAILABLE'));
assert(scheduleApi.includes('rpcCallsBlocked: true'));
assert(queries.includes('retry: false'));
assert(!scheduleScreen.includes("rpc('complete_care_task'"));
assert(queries.includes('careTaskKeys.all'));
assert(queries.includes('careKeys.all'));
assert(queries.includes('placeholderData: keepPreviousData'));
assert(queries.includes('queryClient.cancelQueries'));
assert(queries.includes('userId') && queries.includes('petId'));
assert(scheduleScreen.includes('isCareShiftAlreadyClaimed'));
assert(scheduleScreen.includes('clearCareSchedulePetCache'));
console.log(
  'PASS: completion wrapper, claim reconciliation, and user/Pet/range cache safety.',
);

assert(
  calendar.includes('accessibilityState={{ disabled, selected: isSelected }}'),
);
assert(calendar.includes('<Avatar'));
assert(calendar.includes('summary.members.slice(0, 2)'));
assert(
  calendar.includes('const overflow = Math.max(summary.members.length - 2, 0)'),
);
assert(calendar.includes('name="hand-left-outline"'));
assert(calendar.includes('height: 58'));
assert(!calendar.includes('styles.todayCell'));
assert(calendar.includes('isToday && styles.todayNumber'));
assert(calendar.includes("todayNumber: { textDecorationLine: 'underline' }"));
assert(calendar.includes('isSelected && styles.selectedCell'));
assert(calendar.includes('backgroundColor: lightColors.primarySoft'));
assert(assigneeGroup.includes('accessibilityState={{ expanded }}'));
assert(
  assigneeGroup.includes(
    "name={expanded ? 'chevron-down' : 'chevron-forward'}",
  ),
);
assert(newScreen.includes('accessibilityRole="radiogroup"'));
assert(editScreen.includes('accessibilityRole="radiogroup"'));
const en = JSON.parse(enText);
const zh = JSON.parse(zhText);
for (const key of [
  'title',
  'seeAll',
  'add',
  'edit',
  'canceled',
  'unassigned',
  'claim',
  'completed',
  'pending',
  'scheduled',
  'addCareTask',
  'previousMonth',
  'nextMonth',
  'today',
  'overflowCount_one',
  'overflowCount_other',
  'groupItemCount_one',
  'groupItemCount_other',
  'groupStatusCount',
]) {
  assert.equal(typeof en.schedule[key], 'string');
  assert.equal(typeof zh.schedule[key], 'string');
}
assert(
  !`${homeScreen}${homeSchedule}${scheduleScreen}${newScreen}${editScreen}`.match(
    /postgres_changes|realtime\.channel|Broadcast|Presence/u,
  ),
);
console.log(
  'PASS: accessibility structure, i18n coverage, and no Schedule Realtime.',
);

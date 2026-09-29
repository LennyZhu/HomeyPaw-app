import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  expandCareTaskOccurrences,
  toggleCareTaskWeekDay,
  normalizeCareTaskWeekDays,
} from '../src/features/reminders/care-task-recurrence.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const require = createRequire(import.meta.url);
const recurrenceUrl = new URL(
  'src/features/reminders/care-task-recurrence.ts',
  root,
).href;
async function loadPure(path) {
  const source = read(path)
    .replace("'./care-task-recurrence'", JSON.stringify(recurrenceUrl))
    .replace(
      "'zod'",
      JSON.stringify(pathToFileURL(require.resolve('zod')).href),
    );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  );
}
const { createCareTaskFormSchema } = await loadPure(
  'src/features/reminders/care-task-schema.ts',
);
const { getScheduleLabel, getTaskEndLabel } = await loadPure(
  'src/features/reminders/care-task-display.ts',
);
const dictionaries = ['en', 'zh-HK'].map((lang) =>
  JSON.parse(read(`src/i18n/locales/${lang}.json`)),
);
const translate =
  (dict) =>
  (key, values = {}) => {
    let value = key.split('.').reduce((node, part) => node?.[part], dict);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/gu, (_, name) =>
      String(values[name] ?? ''),
    );
  };
const schedule = {
  scheduleType: 'weekly',
  startsOn: '2026-10-01',
  endsOn: '2026-10-11',
  localTime: '18:00',
  timeZone: 'Asia/Hong_Kong',
  weekDays: [1, 2, 3, 4, 5],
  monthDay: null,
  scheduledAt: null,
};
const expand = (rule, start = '2026-10-01T00:00Z', end = '2026-10-20T00:00Z') =>
  expandCareTaskOccurrences(rule, new Date(start), new Date(end)).map((date) =>
    date.toISOString(),
  );
assert.deepEqual(expand(schedule), [
  '2026-10-01T10:00:00.000Z',
  '2026-10-02T10:00:00.000Z',
  '2026-10-05T10:00:00.000Z',
  '2026-10-06T10:00:00.000Z',
  '2026-10-07T10:00:00.000Z',
  '2026-10-08T10:00:00.000Z',
  '2026-10-09T10:00:00.000Z',
]);
assert.equal(
  expand({ ...schedule, endsOn: '2026-10-01' }).length,
  1,
  'inclusive equal start/end',
);
assert.equal(
  expand({
    ...schedule,
    scheduleType: 'daily',
    weekDays: null,
    endsOn: '2026-10-02',
  }).length,
  2,
  'daily inclusive end',
);
assert.deepEqual(normalizeCareTaskWeekDays([5, 1, 3, 1]), [1, 3, 5]);
assert.deepEqual(toggleCareTaskWeekDay([1, 2, 3, 4, 5], 6), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(toggleCareTaskWeekDay([1, 2, 3, 4, 5], 3), [1, 2, 4, 5]);
for (const [i, lang] of ['en', 'zh-HK'].entries()) {
  const t = translate(dictionaries[i]);
  const schema = createCareTaskFormSchema(t, 'Asia/Hong_Kong');
  const values = {
    careType: 'feeding',
    category: 'standard',
    date: '2026-10-01',
    localTime: '18:00',
    monthDay: '31',
    note: '',
    scheduleType: 'weekly',
    title: 'Reminder',
    weekDays: [1, 3, 5],
    endMode: 'date',
    endsOn: '2026-10-01',
  };
  assert.equal(schema.safeParse(values).success, true);
  for (const invalid of [
    { ...values, weekDays: [] },
    { ...values, endsOn: '2026-09-30' },
    { ...values, endsOn: '2026-02-30' },
    { ...values, weekDays: [0, 8] },
  ])
    assert.equal(schema.safeParse(invalid).success, false);
  assert.equal(
    schema.safeParse({ ...values, endMode: 'never', endsOn: '' }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      ...values,
      scheduleType: 'once',
      date: '2030-10-01',
      weekDays: [],
      endsOn: '',
    }).success,
    true,
  );
  const label = getScheduleLabel(
    {
      schedule_type: 'weekly',
      local_time: '18:00',
      week_days: [1, 3, 5],
      week_day: 1,
      starts_on: '2026-10-01',
      month_day: null,
      scheduled_at: null,
    },
    lang,
    t,
  );
  for (const day of [1, 3, 5])
    assert.ok(label.includes(t(`reminders.weekDays.${day}`)));
  assert.equal(label.includes('['), false, 'no debug array');
  assert.equal(
    getTaskEndLabel({ ends_on: null }, lang, t),
    t('reminders.end.never'),
  );
  assert.ok(
    getTaskEndLabel({ ends_on: '2026-12-31' }, lang, t).includes('2026'),
  );
}
const form = read('src/features/reminders/components/care-task-form.tsx');
assert.match(form, /name="weekDays"/u);
const weeklyStart = form.indexOf("{scheduleType === 'weekly' ? (");
const monthlyStart = form.indexOf(
  "{scheduleType === 'monthly' ? (",
  weeklyStart,
);
assert.ok(weeklyStart >= 0 && monthlyStart > weeklyStart);
const weeklyForm = form.slice(weeklyStart, monthlyStart);
const header = weeklyForm.match(
  /<View style=\{styles\.weekDaysHeader\}>[\s\S]*?<\/Pressable>\s*<\/View>/u,
)?.[0];
assert.ok(header, 'Weekly label and shortcut share a header row');
assert.match(header, /t\('reminders\.fields\.weekDays'\)/u);
assert.match(header, /t\('reminders\.form\.selectWeekdays'\)/u);
const shortcut = header.match(/<Pressable[\s\S]*?<\/Pressable>/u)?.[0];
assert.ok(shortcut);
assert.match(shortcut, /accessibilityRole="button"/u);
assert.match(shortcut, /field\.onChange\(\[1, 2, 3, 4, 5\]\)/u);
assert.match(shortcut, /tone="secondary" variant="footnote"/u);
assert.doesNotMatch(
  shortcut,
  /accessibilityState|selected|checked|chipSelected|field\.value/u,
  'Preset is an action, without persistent selected state',
);
assert.match(weeklyForm, /toggleCareTaskWeekDay\(field\.value, day\)/u);
assert.match(weeklyForm, /selected=\{field\.value\.includes\(day\)\}/u);
assert.doesNotMatch(form, /weekdaysPreset|styles\.preset/u);
assert.equal(dictionaries[1].reminders.fields.weekDays, '重複星期');
for (const [i, copy] of ['Select weekdays', '選擇平日'].entries()) {
  assert.equal(dictionaries[i].reminders.form.selectWeekdays, copy);
  assert.equal('weekdaysPreset' in dictionaries[i].reminders.form, false);
  assert.doesNotMatch(
    JSON.stringify(dictionaries[i]),
    /平日（週一至週五）|Weekdays \(Mon–Fri\)/u,
  );
}
assert.match(form, /multiple \? 'checkbox' : 'radio'/u);
assert.match(form, /endMode === 'date'/u);
assert.match(form, /minimumDate=\{date\}/u);
assert.match(
  read('src/features/reminders/edit-care-task-screen.tsx'),
  /weekDays: task\.week_days/u,
);
assert.match(
  read('src/features/reminders/edit-care-task-screen.tsx'),
  /endMode: task\.ends_on \? 'date' : 'never'/u,
);
const queries = read('src/features/reminders/care-task-queries.ts');
for (const name of [
  'create_care_task_v2',
  'update_care_task_v2',
  'task_week_days',
  'task_ends_on',
  'syncCareTaskNotifications',
])
  assert.ok(queries.includes(name));
assert.match(
  read('src/features/reminders/care-task-api.ts'),
  /'get_care_task_occurrences_v2'/u,
);
assert.match(
  read('src/features/reminders/care-task-detail-screen.tsx'),
  /getTaskEndLabel\(task, i18n\.language, t\)/u,
);
console.log(
  'PASS: recurrence v2 form validation, inclusive dates, multi weekdays/preset toggles, edit/payload/display and v2 routes.',
);
console.log(
  'PASS: Weekly header keeps a secondary Select weekdays action, no persistent selected state, editable weekday chips and no obsolete preset copy.',
);

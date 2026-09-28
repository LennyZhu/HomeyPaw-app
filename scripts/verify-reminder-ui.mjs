import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';

import {
  formatReminderDate,
  reminderDatePickerLocale,
} from '../src/features/reminders/reminder-date.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [screen, queries, form, dateField, detail, english, chinese] =
  await Promise.all([
    read('src/features/reminders/reminders-screen.tsx'),
    read('src/features/reminders/care-task-queries.ts'),
    read('src/features/reminders/components/care-task-form.tsx'),
    read('src/features/reminders/components/task-date-time-fields.native.tsx'),
    read('src/features/reminders/care-task-detail-screen.tsx'),
    read('src/i18n/locales/en.json').then(JSON.parse),
    read('src/i18n/locales/zh-HK.json').then(JSON.parse),
  ]);

assert.match(screen, /accessibilityLabel=\{t\('reminders\.add'\)\}/u);
assert.match(screen, /activeTasksQuery\.data === 0/u);
assert.match(screen, /t\('reminders\.upcomingEmpty'\)/u);
assert.doesNotMatch(screen, /<AppButton\s+label=\{t\('reminders\.add'\)\}/u);
assert.match(queries, /\.eq\('pet_id', petId\)/u);
assert.match(queries, /\.eq\('is_active', true\)/u);
assert.match(queries, /count: 'exact', head: true/u);
assert.equal(chinese.reminders.emptyTitle, '還沒有提醒');
assert.equal(chinese.reminders.emptyBody, '建立第一個照顧提醒吧');
assert.equal(chinese.reminders.upcomingEmpty, '未來 30 天沒有其他提醒');
assert.equal(
  english.reminders.upcomingEmpty,
  'No other reminders in the next 30 days.',
);
console.log(
  'PASS: Reminder list keeps the top add action and separates full-empty from future-empty states.',
);

assert.match(form, /category === 'standard' \? \(/u);
assert.match(form, /setValue\('careType', 'custom'\)/u);
assert.match(form, /setValue\('scheduleType', 'yearly'\)/u);
assert.match(form, /previousStandardCareType\.current/u);
assert.match(
  form,
  /setValue\('careType', previousStandardCareType\.current\)/u,
);
assert.match(form, /category === 'birthday' \? \['yearly'\] : scheduleTypes/u);
assert.match(
  form,
  /values\.category === 'birthday'[\s\S]*careType: 'custom', scheduleType: 'yearly'/u,
);
assert.match(form, /accessibilityState=\{\{ checked: selected \}\}/u);
assert.doesNotMatch(form, /allowFontScaling=\{false\}/u);
assert.match(detail, /task\.task_category === 'standard' \? \(/u);
console.log(
  'PASS: Birthday hides Care type, uses custom/yearly internally, and restores the prior standard Care type.',
);

assert.equal(formatReminderDate('2026-09-11', 'zh-HK'), '2026年9月11日');
assert.equal(formatReminderDate('2026-09-11', 'en'), 'Sep 11, 2026');
assert.equal(reminderDatePickerLocale('zh-HK'), 'zh-HK');
assert.equal(reminderDatePickerLocale('en'), 'en');
assert.match(dateField, /locale=\{pickerLocale\}/u);
assert.match(
  dateField,
  /accessibilityLabel=\{`\$\{dateLabel\}: \$\{formattedDate\}`\}/u,
);
console.log(
  'PASS: Reminder date display, picker locale, and accessibility copy follow the app locale.',
);

assert.equal(chinese.reminders.form.yearlyHint, '每年於這個日期和時間提醒。');
assert.equal(
  chinese.reminders.form.yearlyLeapHint,
  '非閏年會於 2 月 28 日提醒。',
);
assert.equal(
  english.reminders.form.yearlyHint,
  'Repeats every year on this date and time.',
);
assert.equal(
  english.reminders.form.yearlyLeapHint,
  'In non-leap years, this reminder will occur on February 28.',
);
assert.match(form, /scheduleType === 'yearly'/u);
assert.match(form, /isLeapDay \? \(/u);
console.log(
  'PASS: Yearly help stays concise and adds the February 28 note only for February 29.',
);

assert.equal(
  chinese.reminders.subtitle,
  '和家人一起安排照顧，不錯過重要時刻。',
);
assert.equal(
  chinese.reminders.new.subtitle,
  '這個家庭的成員都會看到這項提醒。',
);
assert.equal(
  chinese.reminders.edit.subtitle,
  '修改後只會影響之後的提醒，過去記錄不會改變。',
);
assert.equal(
  english.reminders.subtitle,
  'Plan care together and stay on top of important moments.',
);
assert.equal(
  english.reminders.new.subtitle,
  'Everyone in this family can see this reminder.',
);
assert.equal(
  english.reminders.edit.subtitle,
  'Changes only affect future reminders. Past records stay unchanged.',
);
console.log('PASS: Reminder list, create, and edit copy is user-facing.');

assert.doesNotMatch(
  form,
  /reminders\.form\.timeZone|timeZoneNote|globe-outline/u,
);
assert.doesNotMatch(
  detail,
  /reminders\.fields\.timeZone|value=\{task\.time_zone\}/u,
);
for (const locale of [english, chinese]) {
  assert.equal('timeZone' in locale.reminders.form, false);
  assert.equal('timeZone' in locale.reminders.fields, false);
}
const [newScreen, editScreen, notifications] = await Promise.all([
  read('src/features/reminders/new-care-task-screen.tsx'),
  read('src/features/reminders/edit-care-task-screen.tsx'),
  read('src/services/care-task-notifications.ts'),
]);
assert.match(newScreen, /useState\(\(\) => getDeviceTimeZone\(\)\)/u);
assert.match(newScreen, /timeZone=\{timeZone\}/u);
assert.match(editScreen, /timeZone: task\.time_zone/u);
assert.match(editScreen, /timeZone=\{task\.time_zone\}/u);
assert.match(form, /createCareTaskFormSchema\(t, timeZone\)/u);
assert.match(queries, /task_time_zone: timeZone/u);
assert.match(
  queries,
  /localDateTimeToInstant\(values\.date, values\.localTime, timeZone\)/u,
);
assert.match(notifications, /timeZone: occurrence\.time_zone/u);
assert.match(notifications, /new Date\(occurrence\.scheduled_for\)/u);
assert.match(notifications, /SchedulableTriggerInputTypes\.DATE/u);

// Inspect presentation only: timezone props and formatter arguments remain valid.
const rawIana =
  /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[\w+/-]+/u;
const rawZoneValue = /^(?:[\w]+\.)*(?:timeZone|(?:\w+_)?time_zone)$/u;
const visibleProps = new Set([
  'label',
  'value',
  'title',
  'text',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
]);
function assertNoRawTimeZonePresentation(source, path) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const check = (value) => {
    if (!value) return;
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
      assert.doesNotMatch(
        value.getText(file),
        rawZoneValue,
        `${path}: raw timezone value displayed`,
      );
    } else if (ts.isStringLiteralLike(value)) {
      assert.doesNotMatch(
        value.text,
        rawIana,
        `${path}: raw IANA literal displayed`,
      );
    } else if (ts.isTemplateExpression(value)) {
      assert.doesNotMatch(value.head.text, rawIana, path);
      for (const span of value.templateSpans) {
        check(span.expression);
        assert.doesNotMatch(span.literal.text, rawIana, path);
      }
    } else if (
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      check(value.left);
      check(value.right);
    }
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) assert.doesNotMatch(node.text, rawIana, path);
    if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    )
      check(node.expression);
    if (ts.isJsxAttribute(node) && visibleProps.has(node.name.getText(file))) {
      check(
        node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
assert.throws(() =>
  assertNoRawTimeZonePresentation(
    '<AppText>{task.time_zone}</AppText>',
    'raw-value.tsx',
  ),
);
assert.throws(() =>
  assertNoRawTimeZonePresentation(
    '<AppText>Asia/Hong_Kong</AppText>',
    'raw-literal.tsx',
  ),
);
assert.doesNotThrow(() =>
  assertNoRawTimeZonePresentation(
    '<CareTaskForm timeZone={task.time_zone} /><AppText>{formatTaskTime(instant, task.time_zone, locale)}</AppText>',
    'internal-timezone.tsx',
  ),
);
const uiPaths = (
  await readdir(new URL('src/', root), { recursive: true })
).filter((path) => path.endsWith('.tsx'));
await Promise.all(
  uiPaths.map(async (path) =>
    assertNoRawTimeZonePresentation(await read(`src/${path}`), path),
  ),
);
console.log(
  `PASS: Reminder timezone presentation removed; RPC/schema/notification timezone wiring retained; ${uiPaths.length} UI source files (including Schedule) have no direct raw timezone presentation.`,
);

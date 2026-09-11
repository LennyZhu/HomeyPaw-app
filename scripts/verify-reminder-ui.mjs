import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

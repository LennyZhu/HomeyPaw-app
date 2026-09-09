import assert from 'node:assert/strict';

import {
  expandCareTaskOccurrences,
  getYearlyOccurrenceDate,
  localDateTimeToInstant,
} from '../src/features/reminders/care-task-recurrence.ts';

function isoList(schedule, start, end) {
  return expandCareTaskOccurrences(
    schedule,
    new Date(start),
    new Date(end),
  ).map((date) => date.toISOString());
}

const once = isoList(
  {
    localTime: null,
    monthDay: null,
    scheduleType: 'once',
    scheduledAt: '2026-08-24T12:00:00.000Z',
    startsOn: null,
    timeZone: 'Asia/Hong_Kong',
    weekDay: null,
  },
  '2026-08-24T00:00:00.000Z',
  '2026-08-25T00:00:00.000Z',
);
assert.deepEqual(once, ['2026-08-24T12:00:00.000Z']);

const dailyYearBoundary = isoList(
  {
    localTime: '08:00',
    monthDay: null,
    scheduleType: 'daily',
    scheduledAt: null,
    startsOn: '2026-12-31',
    timeZone: 'Asia/Hong_Kong',
    weekDay: null,
  },
  '2026-12-30T16:00:00.000Z',
  '2027-01-02T16:00:00.000Z',
);
assert.deepEqual(dailyYearBoundary, [
  '2026-12-31T00:00:00.000Z',
  '2027-01-01T00:00:00.000Z',
  '2027-01-02T00:00:00.000Z',
]);

const weekly = isoList(
  {
    localTime: '10:00',
    monthDay: null,
    scheduleType: 'weekly',
    scheduledAt: null,
    startsOn: '2026-08-24',
    timeZone: 'Asia/Hong_Kong',
    weekDay: 6,
  },
  '2026-08-23T16:00:00.000Z',
  '2026-09-07T16:00:00.000Z',
);
assert.deepEqual(weekly, [
  '2026-08-29T02:00:00.000Z',
  '2026-09-05T02:00:00.000Z',
]);

const monthly31 = isoList(
  {
    localTime: '09:00',
    monthDay: 31,
    scheduleType: 'monthly',
    scheduledAt: null,
    startsOn: '2026-01-01',
    timeZone: 'Asia/Hong_Kong',
    weekDay: null,
  },
  '2026-01-01T00:00:00.000Z',
  '2026-05-02T00:00:00.000Z',
);
assert.deepEqual(monthly31, [
  '2026-01-31T01:00:00.000Z',
  '2026-03-31T01:00:00.000Z',
]);

const yearly = isoList(
  {
    localTime: '09:00',
    monthDay: null,
    scheduleType: 'yearly',
    scheduledAt: null,
    startsOn: '2026-10-15',
    timeZone: 'Asia/Hong_Kong',
    weekDay: null,
  },
  '2027-10-14T16:00:00.000Z',
  '2027-10-16T16:00:00.000Z',
);
assert.deepEqual(yearly, ['2027-10-15T01:00:00.000Z']);

const yearlyDecember = isoList(
  {
    localTime: '09:00',
    monthDay: null,
    scheduleType: 'yearly',
    scheduledAt: null,
    startsOn: '2026-12-31',
    timeZone: 'Asia/Hong_Kong',
    weekDay: null,
  },
  '2027-12-30T16:00:00.000Z',
  '2028-01-01T16:00:00.000Z',
);
assert.deepEqual(yearlyDecember, ['2027-12-31T01:00:00.000Z']);

const yearlyDst = isoList(
  {
    localTime: '09:00',
    monthDay: null,
    scheduleType: 'yearly',
    scheduledAt: null,
    startsOn: '2026-07-04',
    timeZone: 'America/Los_Angeles',
    weekDay: null,
  },
  '2027-07-04T00:00:00.000Z',
  '2027-07-05T00:00:00.000Z',
);
assert.deepEqual(yearlyDst, ['2027-07-04T16:00:00.000Z']);
assert.equal(getYearlyOccurrenceDate(2029, '2028-02-29'), '2029-02-28');
assert.equal(getYearlyOccurrenceDate(2030, '2028-02-29'), '2030-02-28');
assert.equal(getYearlyOccurrenceDate(2032, '2028-02-29'), '2032-02-29');

assert.equal(
  localDateTimeToInstant('2026-03-08', '02:30', 'America/Los_Angeles'),
  null,
  'A nonexistent DST wall-clock time must be skipped.',
);
assert.equal(
  localDateTimeToInstant(
    '2026-11-01',
    '01:30',
    'America/Los_Angeles',
  )?.toISOString(),
  '2026-11-01T09:30:00.000Z',
  'An ambiguous DST time must match PostgreSQL standard-time resolution.',
);

console.log(
  'PASS: Once, daily, weekly, and monthly recurrence are deterministic.',
);
console.log(
  'PASS: Hong Kong year-boundary occurrences preserve wall-clock time.',
);
console.log('PASS: Monthly day 31 skips months without that date.');
console.log(
  'PASS: Yearly recurrence preserves local month/day/time across zones.',
);
console.log('PASS: Feb 29 yearly recurrence falls back to Feb 28 when needed.');
console.log('PASS: Los Angeles DST gap and overlap are handled safely.');

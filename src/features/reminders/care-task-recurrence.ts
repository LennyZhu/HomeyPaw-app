import type { CareTaskScheduleType } from '@/types/database';

export type CareTaskSchedule = {
  localTime: string | null;
  monthDay: number | null;
  scheduleType: CareTaskScheduleType;
  scheduledAt: string | null;
  startsOn: string | null;
  timeZone: string;
  weekDay: number | null;
};

type LocalParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const timePattern = /^(\d{2}):(\d{2})(?::\d{2})?$/u;

function getLocalParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, Number(part.value)]),
  );
  return {
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    month: values.month ?? 0,
    year: values.year ?? 0,
  };
}

function matchesLocal(candidate: Date, desired: LocalParts, timeZone: string) {
  const actual = getLocalParts(candidate, timeZone);
  return (
    actual.year === desired.year &&
    actual.month === desired.month &&
    actual.day === desired.day &&
    actual.hour === desired.hour &&
    actual.minute === desired.minute
  );
}

export function localDateTimeToInstant(
  dateOnly: string,
  localTime: string,
  timeZone: string,
) {
  const dateMatch = dateOnlyPattern.exec(dateOnly);
  const timeMatch = timePattern.exec(localTime);
  if (!dateMatch || !timeMatch) return null;

  const desired: LocalParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const initialParts = getLocalParts(new Date(desiredAsUtc), timeZone);
  const initialAsUtc = Date.UTC(
    initialParts.year,
    initialParts.month - 1,
    initialParts.day,
    initialParts.hour,
    initialParts.minute,
  );
  const initialCandidate = new Date(
    desiredAsUtc - (initialAsUtc - desiredAsUtc),
  );

  // A fall-back transition can map one wall-clock time to two instants. PostgreSQL
  // resolves `timestamp AT TIME ZONE zone` to the later (standard-time) instant,
  // so inspect the small transition window and make the same deterministic choice.
  const matches: Date[] = [];
  for (let deltaMinutes = -120; deltaMinutes <= 180; deltaMinutes += 15) {
    const candidate = new Date(
      initialCandidate.getTime() + deltaMinutes * 60_000,
    );
    if (matchesLocal(candidate, desired, timeZone)) matches.push(candidate);
  }
  return (
    matches.sort((left, right) => right.getTime() - left.getTime())[0] ?? null
  );
}

export function getDateOnlyInZone(date: Date, timeZone: string) {
  const parts = getLocalParts(date, timeZone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month
    .toString()
    .padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

export function addDateOnlyDays(dateOnly: string, amount: number) {
  const match = dateOnlyPattern.exec(dateOnly);
  if (!match) return dateOnly;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount),
  );
  return date.toISOString().slice(0, 10);
}

function getIsoWeekDay(dateOnly: string) {
  const match = dateOnlyPattern.exec(dateOnly);
  if (!match) return 0;
  const jsDay = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function getMonthDay(dateOnly: string) {
  return Number(dateOnly.slice(8, 10));
}

export function expandCareTaskOccurrences(
  schedule: CareTaskSchedule,
  windowStart: Date,
  windowEnd: Date,
) {
  if (windowEnd <= windowStart) return [];
  if (schedule.scheduleType === 'once') {
    if (!schedule.scheduledAt) return [];
    const instant = new Date(schedule.scheduledAt);
    return instant >= windowStart && instant < windowEnd ? [instant] : [];
  }

  if (!schedule.startsOn || !schedule.localTime) return [];
  let dateOnly = addDateOnlyDays(
    getDateOnlyInZone(windowStart, schedule.timeZone),
    -1,
  );
  const lastDate = addDateOnlyDays(
    getDateOnlyInZone(windowEnd, schedule.timeZone),
    1,
  );
  const occurrences: Date[] = [];

  while (dateOnly <= lastDate) {
    const isOnOrAfterStart = dateOnly >= schedule.startsOn;
    const matchesSchedule =
      schedule.scheduleType === 'daily' ||
      (schedule.scheduleType === 'weekly' &&
        getIsoWeekDay(dateOnly) === schedule.weekDay) ||
      (schedule.scheduleType === 'monthly' &&
        getMonthDay(dateOnly) === schedule.monthDay);
    if (isOnOrAfterStart && matchesSchedule) {
      const instant = localDateTimeToInstant(
        dateOnly,
        schedule.localTime,
        schedule.timeZone,
      );
      if (instant && instant >= windowStart && instant < windowEnd) {
        occurrences.push(instant);
      }
    }
    dateOnly = addDateOnlyDays(dateOnly, 1);
  }

  return occurrences.sort((left, right) => left.getTime() - right.getTime());
}

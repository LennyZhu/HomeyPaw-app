export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

type DateParts = { day: number; month: number; year: number };

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseCalendarDate(value: string): DateParts | null {
  const match = dateOnlyPattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
}

export function toCalendarDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function utcDate(value: string) {
  const parts = parseCalendarDate(value);
  if (!parts) throw new Error(`Invalid date-only value: ${value}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function addCalendarDays(value: string, amount: number) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return toCalendarDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function startOfCalendarMonth(value: string) {
  const parts = parseCalendarDate(value);
  if (!parts) throw new Error(`Invalid date-only value: ${value}`);
  return toCalendarDate(parts.year, parts.month, 1);
}

export function startOfNextCalendarMonth(value: string) {
  return shiftCalendarMonth(startOfCalendarMonth(value), 1);
}

export function shiftCalendarMonth(value: string, amount: number) {
  const parts = parseCalendarDate(value);
  if (!parts) throw new Error(`Invalid date-only value: ${value}`);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1));
  return toCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function getCalendarMonthRange(value: string) {
  const start = startOfCalendarMonth(value);
  return { end: startOfNextCalendarMonth(start), start };
}

export function buildCalendarMonth(
  value: string,
  options: { fixedSixWeeks?: boolean; weekStartsOn?: 0 | 1 } = {},
) {
  const monthStart = startOfCalendarMonth(value);
  const parts = parseCalendarDate(monthStart)!;
  const firstWeekday = utcDate(monthStart).getUTCDay();
  const weekStartsOn = options.weekStartsOn ?? 0;
  const leadingDays = (firstWeekday - weekStartsOn + 7) % 7;
  const nextMonth = startOfNextCalendarMonth(monthStart);
  const daysInMonth = Number(addCalendarDays(nextMonth, -1).slice(-2));
  const minimumCellCount = leadingDays + daysInMonth;
  const cellCount = options.fixedSixWeeks
    ? 42
    : Math.ceil(minimumCellCount / 7) * 7;
  const gridStart = addCalendarDays(monthStart, -leadingDays);

  return Array.from({ length: cellCount }, (_, index): CalendarCell => {
    const date = addCalendarDays(gridStart, index);
    const dateParts = parseCalendarDate(date)!;
    return {
      date,
      day: dateParts.day,
      inMonth: dateParts.year === parts.year && dateParts.month === parts.month,
    };
  });
}

export function getSixWeekCalendarRange(value: string) {
  const cells = buildCalendarMonth(value, { fixedSixWeeks: true });
  return {
    end: addCalendarDays(cells.at(-1)!.date, 1),
    start: cells[0]!.date,
  };
}

export function getCalendarWeekdayLabels(
  locale: string,
  weekStartsOn: 0 | 1 = 0,
) {
  const sunday = new Date(Date.UTC(2026, 0, 4));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setUTCDate(date.getUTCDate() + index + weekStartsOn);
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'short',
    }).format(date);
  });
}

export function formatCalendarMonth(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(utcDate(startOfCalendarMonth(value)));
}

export function formatCalendarDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(utcDate(value));
}

export function getLocalDateInTimeZone(
  instant: Date | string,
  timeZone: string,
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(typeof instant === 'string' ? new Date(instant) : instant);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year ?? ''}-${values.month ?? ''}-${values.day ?? ''}`;
}

export function formatScheduleTime(
  instant: string,
  timeZone: string,
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(instant));
}

export function isDateInRange(date: string, start: string, end: string) {
  return date >= start && date < end;
}

export function getOccurrenceSearchWindow(value: string) {
  const parts = parseCalendarDate(value);
  if (!parts) throw new Error(`Invalid date-only value: ${value}`);
  return {
    end: new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 2)),
    start: new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1)),
  };
}

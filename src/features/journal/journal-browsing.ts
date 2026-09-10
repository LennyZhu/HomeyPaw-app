export type JournalDateRange = {
  endDate: string;
  startDate: string;
};

const journalScrollOffsets = new Map<string, number>();

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function toLocalDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createJournalContextKey(
  userId: string | undefined,
  petId: string | null,
) {
  return `${userId ?? 'signed-out'}:${petId ?? 'no-pet'}`;
}

export function createJournalDateRangeKey(range: JournalDateRange | undefined) {
  return range ? `${range.startDate}:${range.endDate}` : 'all';
}

export function createJournalListStateKey(
  userId: string | undefined,
  petId: string | null,
  range: JournalDateRange | undefined,
) {
  return `${createJournalContextKey(userId, petId)}:${createJournalDateRangeKey(range)}`;
}

export function getJournalScrollOffset(key: string) {
  return journalScrollOffsets.get(key) ?? 0;
}

export function setJournalScrollOffset(key: string, offset: number) {
  if (!Number.isFinite(offset)) return;
  journalScrollOffsets.set(key, Math.max(0, offset));
}

export function getRecentJournalDateRange(days: number, today = new Date()) {
  const safeDays = Math.max(1, Math.trunc(days));
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12,
  );
  const start = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() - safeDays + 1,
    12,
  );

  return {
    endDate: toLocalDateOnly(end),
    startDate: toLocalDateOnly(start),
  } satisfies JournalDateRange;
}

export function toJournalCreatedAtBounds(range: JournalDateRange | undefined) {
  if (!range) return null;

  const parsedStart = parseLocalDate(range.startDate);
  const parsedEnd = parseLocalDate(range.endDate);
  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) return null;

  const start = new Date(
    parsedStart.getFullYear(),
    parsedStart.getMonth(),
    parsedStart.getDate(),
  );
  const endExclusive = new Date(
    parsedEnd.getFullYear(),
    parsedEnd.getMonth(),
    parsedEnd.getDate() + 1,
  );

  return {
    endExclusiveUtc: endExclusive.toISOString(),
    startUtc: start.toISOString(),
  };
}

export function isValidJournalDateRange(range: JournalDateRange) {
  return toJournalCreatedAtBounds(range) !== null;
}

export function formatCompactJournalDateRange(
  range: JournalDateRange,
  locale: string,
) {
  const start = parseLocalDate(range.startDate);
  const end = parseLocalDate(range.endDate);
  if (!start || !end) return `${range.startDate}–${range.endDate}`;

  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'numeric',
    year: start.getFullYear() === end.getFullYear() ? undefined : '2-digit',
  };
  const formatter = new Intl.DateTimeFormat(locale, options);

  return `${formatter.format(start)}–${formatter.format(end)}`;
}

export function formatAccessibleJournalDateRange(
  range: JournalDateRange,
  locale: string,
) {
  const start = parseLocalDate(range.startDate);
  const end = parseLocalDate(range.endDate);
  if (!start || !end) return `${range.startDate} – ${range.endDate}`;

  const formatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

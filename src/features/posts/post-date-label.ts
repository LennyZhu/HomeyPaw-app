export type RelativeDateKind = 'date' | 'today' | 'yesterday';

function toLocalDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getRelativeDateKind(
  dateOnly: string,
  today = new Date(),
): RelativeDateKind {
  if (dateOnly === toLocalDateOnly(today)) {
    return 'today';
  }

  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
    12,
  );

  return dateOnly === toLocalDateOnly(yesterday) ? 'yesterday' : 'date';
}

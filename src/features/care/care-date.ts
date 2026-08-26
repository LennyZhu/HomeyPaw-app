import { parseDateOnly } from '@/features/pets/pet-dates';
import { getRelativeDateKind } from '@/features/posts/post-date-label';

export function getDeviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function getLocalDateOnly(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: getDeviceTimeZone(),
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatCareTime(
  occurredAt: string,
  timeZone: string,
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(occurredAt));
}

export function formatCareDate(dateOnly: string, locale: string) {
  const date = parseDateOnly(dateOnly);
  if (!date) {
    return dateOnly;
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function getCareDateKind(dateOnly: string) {
  return getRelativeDateKind(dateOnly);
}

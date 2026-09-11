export function reminderDatePickerLocale(locale: string) {
  return locale.startsWith('en') ? 'en' : 'zh-HK';
}

export function formatReminderDate(value: string, locale: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const [, year = '', month = '', day = ''] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(reminderDatePickerLocale(locale), {
    day: 'numeric',
    month: locale.startsWith('en') ? 'short' : 'long',
    year: 'numeric',
  }).format(date);
}

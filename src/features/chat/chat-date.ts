import type { TFunction } from 'i18next';

import { formatCareTime } from '@/features/care/care-date';
import {
  addDateOnlyDays,
  getDateOnlyInZone,
} from '@/features/reminders/care-task-recurrence';

export const CHAT_MOCK_TIME_ZONE = 'Asia/Hong_Kong';

export function formatChatTime(
  createdAt: string,
  locale: string,
  timeZone = CHAT_MOCK_TIME_ZONE,
) {
  return formatCareTime(createdAt, timeZone, locale);
}

export function getChatDateOnly(
  createdAt: string,
  timeZone = CHAT_MOCK_TIME_ZONE,
) {
  return getDateOnlyInZone(new Date(createdAt), timeZone);
}

export function formatChatDateLabel(
  createdAt: string,
  locale: string,
  t: TFunction,
  now = new Date(),
  timeZone = CHAT_MOCK_TIME_ZONE,
) {
  const messageDate = getChatDateOnly(createdAt, timeZone);
  const today = getDateOnlyInZone(now, timeZone);

  if (messageDate === today) return t('chat.preview.date.today');
  if (messageDate === addDateOnlyDays(today, -1)) {
    return t('chat.preview.date.yesterday');
  }

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(createdAt));
}

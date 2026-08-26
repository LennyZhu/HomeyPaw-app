import type { TFunction } from 'i18next';

import type { CareTask, CareTaskScheduleType } from '@/types/database';

import {
  getDateOnlyInZone,
  localDateTimeToInstant,
} from './care-task-recurrence';
import type { CareTaskOccurrence } from './care-task-types';

export type CareTaskStatus = 'completed' | 'due' | 'overdue' | 'upcoming';

export function getCareTaskStatus(
  occurrence: CareTaskOccurrence,
  now = new Date(),
): CareTaskStatus {
  if (occurrence.completion_id) return 'completed';
  const scheduled = new Date(occurrence.scheduled_for);
  if (scheduled > now) return 'upcoming';
  if (now.getTime() - scheduled.getTime() <= 15 * 60_000) return 'due';
  return 'overdue';
}

export function formatTaskTime(
  scheduledFor: string,
  timeZone: string,
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(scheduledFor));
}

export function formatTaskDateTime(
  scheduledFor: string,
  timeZone: string,
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(scheduledFor));
}

function dateOnlyToUtcTime(dateOnly: string) {
  const [year = 0, month = 1, day = 1] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function formatTaskDayLabel(
  scheduledFor: string,
  timeZone: string,
  locale: string,
  t: TFunction,
  now = new Date(),
) {
  const scheduled = new Date(scheduledFor);
  const scheduledDate = getDateOnlyInZone(scheduled, timeZone);
  const today = getDateOnlyInZone(now, timeZone);
  const difference = Math.round(
    (dateOnlyToUtcTime(scheduledDate) - dateOnlyToUtcTime(today)) / 86_400_000,
  );
  if (difference === 0) return t('reminders.dayLabel.today');
  if (difference === 1) return t('reminders.dayLabel.tomorrow');
  if (difference > 1 && difference < 7) {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'long',
    }).format(scheduled);
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(scheduled);
}

function formatTaskLocalTime(
  localTime: string,
  timeZone: string,
  locale: string,
) {
  const instant = localDateTimeToInstant('2026-01-15', localTime, timeZone);
  return instant ? formatTaskTime(instant.toISOString(), timeZone, locale) : '';
}

export function getScheduleLabel(
  task: Pick<
    CareTask,
    | 'local_time'
    | 'month_day'
    | 'schedule_type'
    | 'scheduled_at'
    | 'time_zone'
    | 'week_day'
  >,
  locale: string,
  t: TFunction,
) {
  if (task.schedule_type === 'once' && task.scheduled_at) {
    return formatTaskDateTime(task.scheduled_at, task.time_zone, locale);
  }
  const time = task.local_time
    ? formatTaskLocalTime(task.local_time, task.time_zone, locale)
    : '';
  if (task.schedule_type === 'weekly') {
    return t('reminders.scheduleLabel.weekly', {
      day: t(`reminders.weekDays.${task.week_day}`),
      time,
    });
  }
  if (task.schedule_type === 'monthly') {
    return t('reminders.scheduleLabel.monthly', {
      day: task.month_day,
      time,
    });
  }
  return t('reminders.scheduleLabel.daily', { time });
}

export function taskKindLabel(
  careType: CareTaskOccurrence['care_type'],
  t: TFunction,
) {
  return careType ? t(`care.types.${careType}`) : t('reminders.types.custom');
}

export function scheduleTypeLabel(
  scheduleType: CareTaskScheduleType,
  t: TFunction,
) {
  return t(`reminders.schedule.${scheduleType}`);
}

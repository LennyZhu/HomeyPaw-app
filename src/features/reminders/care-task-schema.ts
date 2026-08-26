import type { TFunction } from 'i18next';
import { z } from 'zod';

import type { CareTaskScheduleType, CareType } from '@/types/database';

import { localDateTimeToInstant } from './care-task-recurrence';

export type CareTaskKind = CareType | 'custom';

export type CareTaskFormValues = {
  careType: CareTaskKind;
  date: string;
  localTime: string;
  monthDay: string;
  note: string;
  scheduleType: CareTaskScheduleType;
  title: string;
  weekDay: string;
};

export function createCareTaskFormSchema(t: TFunction, timeZone: string) {
  return z
    .object({
      careType: z.enum([
        'feeding',
        'walk',
        'medicine',
        'bath',
        'grooming',
        'other',
        'custom',
      ]),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u, t('reminders.validation.date')),
      localTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, t('reminders.validation.time')),
      monthDay: z.string(),
      note: z.string().trim().max(300, t('reminders.validation.note')),
      scheduleType: z.enum(['once', 'daily', 'weekly', 'monthly']),
      title: z
        .string()
        .trim()
        .min(1, t('reminders.validation.title'))
        .max(100, t('reminders.validation.title')),
      weekDay: z.string(),
    })
    .superRefine((values, context) => {
      if (values.scheduleType === 'once') {
        const instant = localDateTimeToInstant(
          values.date,
          values.localTime,
          timeZone,
        );
        if (!instant || instant.getTime() <= Date.now()) {
          context.addIssue({
            code: 'custom',
            message: t('reminders.validation.future'),
            path: ['date'],
          });
        }
      }

      if (
        values.scheduleType === 'weekly' &&
        !/^[1-7]$/u.test(values.weekDay)
      ) {
        context.addIssue({
          code: 'custom',
          message: t('reminders.validation.weekDay'),
          path: ['weekDay'],
        });
      }

      if (values.scheduleType === 'monthly') {
        const day = Number(values.monthDay);
        if (!Number.isInteger(day) || day < 1 || day > 31) {
          context.addIssue({
            code: 'custom',
            message: t('reminders.validation.monthDay'),
            path: ['monthDay'],
          });
        }
      }
    });
}

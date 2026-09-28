import type { TFunction } from 'i18next';
import { z } from 'zod';

import type {
  CareTaskCategory,
  CareTaskScheduleType,
  CareType,
} from '@/types/database';

import {
  isValidCareTaskDate,
  localDateTimeToInstant,
} from './care-task-recurrence';

export type CareTaskKind = Exclude<CareType, 'health'> | 'custom';

export type CareTaskFormValues = {
  careType: CareTaskKind;
  category: CareTaskCategory;
  date: string;
  localTime: string;
  monthDay: string;
  note: string;
  scheduleType: CareTaskScheduleType;
  title: string;
  weekDays: number[];
  endMode: 'never' | 'date';
  endsOn: string;
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
      category: z.enum(['standard', 'birthday']),
      date: z
        .string()
        .refine(isValidCareTaskDate, t('reminders.validation.date')),
      localTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, t('reminders.validation.time')),
      monthDay: z.string(),
      note: z.string().trim().max(300, t('reminders.validation.note')),
      scheduleType: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']),
      title: z
        .string()
        .trim()
        .min(1, t('reminders.validation.title'))
        .max(100, t('reminders.validation.title')),
      weekDays: z.array(z.number().int().min(1).max(7)),
      endMode: z.enum(['never', 'date']),
      endsOn: z.string(),
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

      if (values.scheduleType === 'weekly' && values.weekDays.length === 0) {
        context.addIssue({
          code: 'custom',
          message: t('reminders.validation.weekDay'),
          path: ['weekDays'],
        });
      }

      if (values.scheduleType !== 'once' && values.endMode === 'date') {
        if (!isValidCareTaskDate(values.endsOn)) {
          context.addIssue({
            code: 'custom',
            message: t('reminders.validation.date'),
            path: ['endsOn'],
          });
        } else if (values.endsOn < values.date) {
          context.addIssue({
            code: 'custom',
            message: t('reminders.validation.endsOn'),
            path: ['endsOn'],
          });
        }
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

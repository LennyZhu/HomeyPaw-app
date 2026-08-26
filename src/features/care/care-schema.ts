import type { TFunction } from 'i18next';
import { z } from 'zod';

import type { CareType } from '@/types/database';

export type CareFormValues = {
  durationMinutes: string;
  note: string;
  occurredAt: string;
};

export function createCareFormSchema(t: TFunction, careType: CareType) {
  return z
    .object({
      durationMinutes: z.string(),
      note: z.string().trim().max(500, t('care.validation.noteTooLong')),
      occurredAt: z.string().refine((value) => {
        const timestamp = Date.parse(value);
        return (
          Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60_000
        );
      }, t('care.validation.timeInvalid')),
    })
    .superRefine((values, context) => {
      if (careType === 'other' && !values.note.trim()) {
        context.addIssue({
          code: 'custom',
          message: t('care.validation.otherNoteRequired'),
          path: ['note'],
        });
      }

      if (values.durationMinutes) {
        const duration = Number(values.durationMinutes);
        if (
          careType !== 'walk' ||
          !Number.isInteger(duration) ||
          duration < 1 ||
          duration > 1440
        ) {
          context.addIssue({
            code: 'custom',
            message: t('care.validation.durationInvalid'),
            path: ['durationMinutes'],
          });
        }
      }
    });
}

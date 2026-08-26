import type { TFunction } from 'i18next';
import { z } from 'zod';

import { parseDateOnly, toDateOnly } from './pet-dates';

const optionalDate = (t: TFunction) =>
  z
    .string()
    .trim()
    .refine((value) => !value || Boolean(parseDateOnly(value)), {
      message: t('pets.validation.dateInvalid'),
    })
    .refine((value) => !value || value <= toDateOnly(new Date()), {
      message: t('pets.validation.dateFuture'),
    });

export function createPetFormSchema(t: TFunction) {
  return z.object({
    adoptionDate: optionalDate(t),
    birthday: optionalDate(t),
    breed: z.string().trim().max(80, t('pets.validation.breedTooLong')),
    description: z
      .string()
      .trim()
      .max(2000, t('pets.validation.descriptionTooLong')),
    gender: z.enum(['male', 'female', 'unknown']),
    name: z
      .string()
      .trim()
      .min(1, t('pets.validation.nameRequired'))
      .max(80, t('pets.validation.nameTooLong')),
    species: z.enum(['dog', 'cat', 'other']),
    weight: z
      .string()
      .trim()
      .refine(
        (value) =>
          !value || (/^\d+(?:\.\d{1,2})?$/u.test(value) && Number(value) > 0),
        { message: t('pets.validation.weightPositive') },
      )
      .refine((value) => !value || Number(value) <= 1000, {
        message: t('pets.validation.weightMaximum'),
      }),
  });
}

export type PetFormValues = z.infer<ReturnType<typeof createPetFormSchema>>;

export const defaultPetFormValues: PetFormValues = {
  adoptionDate: '',
  birthday: '',
  breed: '',
  description: '',
  gender: 'unknown',
  name: '',
  species: 'dog',
  weight: '',
};

import { z } from 'zod';
import type { TFunction } from 'i18next';

import { parseDateOnly, toDateOnly } from '@/features/pets/pet-dates';
import type { PostTag } from '@/types/database';

export const postTags: PostTag[] = [
  'walk',
  'meal',
  'sleep',
  'play',
  'grooming',
  'vet',
  'birthday',
  'travel',
  'other',
];

export type PostFormValues = {
  content: string;
  eventDate: string;
  locationName: string;
  tag: PostTag | null;
};

export function createPostFormSchema(t: TFunction) {
  return z.object({
    content: z.string().trim().max(4000, t('posts.validation.contentTooLong')),
    eventDate: z.string().refine((value) => {
      const date = parseDateOnly(value);
      return Boolean(date && value <= toDateOnly(new Date()));
    }, t('posts.validation.dateInvalid')),
    locationName: z
      .string()
      .trim()
      .max(160, t('posts.validation.locationTooLong')),
    tag: z.enum(postTags).nullable(),
  });
}

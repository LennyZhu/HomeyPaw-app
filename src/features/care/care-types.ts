import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import type { CareType } from '@/types/database';

export const careTypes: CareType[] = [
  'feeding',
  'walk',
  'medicine',
  'bath',
  'grooming',
  'other',
];

export type CareIconName = ComponentProps<typeof Ionicons>['name'];

export const careTypeIcons: Record<CareType, CareIconName> = {
  bath: 'water-outline',
  feeding: 'restaurant-outline',
  grooming: 'cut-outline',
  medicine: 'medkit-outline',
  other: 'ellipsis-horizontal-circle-outline',
  walk: 'footsteps-outline',
};

export function isCareType(value: string | undefined): value is CareType {
  return Boolean(value && careTypes.includes(value as CareType));
}

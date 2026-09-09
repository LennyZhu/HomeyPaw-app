import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { TFunction } from 'i18next';

import type { CareType, HealthObservationType } from '@/types/database';

export const careTypes: CareType[] = [
  'feeding',
  'walk',
  'medicine',
  'bath',
  'grooming',
  'other',
];

export const healthObservationTypes: HealthObservationType[] = [
  'stool',
  'vomiting',
  'energy',
];

export type CareIconName = ComponentProps<typeof Ionicons>['name'];

export const careTypeIcons: Record<CareType, CareIconName> = {
  bath: 'water-outline',
  feeding: 'restaurant-outline',
  grooming: 'cut-outline',
  health: 'heart-outline',
  medicine: 'medkit-outline',
  other: 'ellipsis-horizontal-circle-outline',
  walk: 'footsteps-outline',
};

export function isCareType(value: string | undefined): value is CareType {
  return Boolean(
    value && (value === 'health' || careTypes.includes(value as CareType)),
  );
}

export function isHealthObservationType(
  value: string | undefined,
): value is HealthObservationType {
  return Boolean(
    value && healthObservationTypes.includes(value as HealthObservationType),
  );
}

export function careLogLabel(
  log: { care_type: CareType; health_subtype: HealthObservationType | null },
  t: TFunction,
) {
  return log.care_type === 'health' && log.health_subtype
    ? t('care.health.titleWithSubtype', {
        subtype: t(`care.health.subtypes.${log.health_subtype}`),
      })
    : t(`care.types.${log.care_type}`);
}

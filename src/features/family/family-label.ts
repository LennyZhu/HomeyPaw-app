import type { TFunction } from 'i18next';

import type { Family } from './family-types';

export function familyLabel(
  family: Family,
  pets: { family_id: string | null; name: string }[],
  t: TFunction,
) {
  const firstPet = pets.find((pet) => pet.family_id === family.id);
  return firstPet
    ? t('family.lifecycle.namedFamily', { name: firstPet.name })
    : t('family.lifecycle.emptyFamily', { id: family.id.slice(0, 8) });
}

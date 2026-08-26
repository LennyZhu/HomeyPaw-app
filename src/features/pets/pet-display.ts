import type { TFunction } from 'i18next';

import type { Pet } from '@/types/database';

import { getPetAge } from './pet-dates';

export function getPetAgeLabel(pet: Pet, t: TFunction) {
  const age = getPetAge(pet.birthday);

  if (!age) {
    return null;
  }

  return age.unit === 'year'
    ? t('pets.age.year', { count: age.value })
    : t('pets.age.month', { count: age.value });
}

export function getPetBreedSpeciesLabel(pet: Pet, t: TFunction) {
  return pet.breed || t(`pets.codes.${pet.species}`);
}

export function getPetSummaryLabel(pet: Pet, t: TFunction) {
  const parts = [getPetBreedSpeciesLabel(pet, t), getPetAgeLabel(pet, t)];

  return parts.filter(Boolean).join(' · ');
}

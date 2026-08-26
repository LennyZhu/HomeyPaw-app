import { useEffect } from 'react';

import { useCurrentPetStore } from '@/stores/current-pet-store';

import { usePets } from './pet-queries';

export function useCurrentPet() {
  const petsQuery = usePets();
  const currentPetId = useCurrentPetStore((state) => state.currentPetId);
  const setCurrentPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const pets = petsQuery.data ?? [];
  const currentPet =
    pets.find((pet) => pet.id === currentPetId) ?? pets[0] ?? null;

  useEffect(() => {
    if (!petsQuery.isSuccess) {
      return;
    }

    if (currentPet?.id !== currentPetId) {
      setCurrentPetId(currentPet?.id ?? null);
    }
  }, [currentPet?.id, currentPetId, petsQuery.isSuccess, setCurrentPetId]);

  return {
    ...petsQuery,
    currentPet,
    currentPetId: currentPet?.id ?? null,
    pets,
    setCurrentPetId,
  };
}

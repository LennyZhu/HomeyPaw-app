import { useCallback, useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { useCurrentPetStore } from '@/stores/current-pet-store';

import { selectAccessiblePet } from './pet-access-state';
import { usePets } from './pet-queries';

export function useCurrentPet() {
  const { user } = useAuth();
  const petsQuery = usePets();
  const storedPetId = useCurrentPetStore((state) => state.currentPetId);
  const storedUserId = useCurrentPetStore((state) => state.currentPetUserId);
  const setStoredPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const pets = petsQuery.data ?? [];
  const currentPet = selectAccessiblePet(
    pets,
    storedPetId,
    storedUserId,
    user?.id,
  );
  const setCurrentPetId = useCallback(
    (petId: string | null) => setStoredPetId(petId, user?.id ?? null),
    [setStoredPetId, user?.id],
  );

  useEffect(() => {
    if (!petsQuery.isSuccess || !user) {
      return;
    }

    if (storedUserId !== user.id || currentPet?.id !== storedPetId) {
      setStoredPetId(currentPet?.id ?? null, user.id);
    }
  }, [
    currentPet?.id,
    petsQuery.isSuccess,
    setStoredPetId,
    storedPetId,
    storedUserId,
    user,
  ]);

  return {
    ...petsQuery,
    currentPet,
    currentPetId: currentPet?.id ?? null,
    pets,
    setCurrentPetId,
  };
}

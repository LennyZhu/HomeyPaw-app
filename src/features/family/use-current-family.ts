import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { usePets } from '@/features/pets/pet-queries';
import { useCurrentFamilyStore } from '@/stores/current-family-store';
import { useCurrentPetStore } from '@/stores/current-pet-store';

import { reconcileFamilyContext } from './family-context-state';
import { removeFamilyQueries, useFamilies } from './family-queries';

export function useCurrentFamily() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const familiesQuery = useFamilies();
  const petsQuery = usePets();
  const storedFamilyId = useCurrentFamilyStore(
    (state) => state.currentFamilyId,
  );
  const storedFamilyUserId = useCurrentFamilyStore(
    (state) => state.currentFamilyUserId,
  );
  const setStoredFamilyId = useCurrentFamilyStore(
    (state) => state.setCurrentFamilyId,
  );
  const storedPetId = useCurrentPetStore((state) => state.currentPetId);
  const storedPetUserId = useCurrentPetStore((state) => state.currentPetUserId);
  const setStoredPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const familyAccess = useMemo(
    () => familiesQuery.data ?? [],
    [familiesQuery.data],
  );
  const families = useMemo(
    () => familyAccess.map((access) => access.family),
    [familyAccess],
  );
  const pets = useMemo(() => petsQuery.data ?? [], [petsQuery.data]);
  const context = reconcileFamilyContext({
    families,
    pets,
    storedFamilyId,
    storedFamilyUserId,
    storedPetId,
    storedPetUserId,
    userId: user?.id,
  });
  const currentMembership =
    familyAccess.find(
      (access) => access.family.id === context.currentFamily?.id,
    )?.membership ?? null;

  useEffect(() => {
    if (!user || !familiesQuery.isSuccess || !petsQuery.isSuccess) return;

    if (
      storedFamilyUserId === user.id &&
      storedFamilyId &&
      !families.some((family) => family.id === storedFamilyId)
    ) {
      removeFamilyQueries(queryClient, user.id, storedFamilyId);
    }

    if (
      storedFamilyUserId !== user.id ||
      storedFamilyId !== context.currentFamily?.id
    ) {
      setStoredFamilyId(context.currentFamily?.id ?? null, user.id);
    }
    if (storedPetUserId !== user.id || storedPetId !== context.currentPet?.id) {
      setStoredPetId(context.currentPet?.id ?? null, user.id);
    }
  }, [
    context.currentFamily?.id,
    context.currentPet?.id,
    familiesQuery.isSuccess,
    petsQuery.isSuccess,
    families,
    queryClient,
    setStoredFamilyId,
    setStoredPetId,
    storedFamilyId,
    storedFamilyUserId,
    storedPetId,
    storedPetUserId,
    user,
  ]);

  const setCurrentFamilyId = useCallback(
    (familyId: string | null) => {
      if (!user || !familyId) {
        setStoredFamilyId(null, user?.id ?? null);
        setStoredPetId(null, user?.id ?? null);
        return;
      }

      const nextContext = reconcileFamilyContext({
        families,
        pets,
        storedFamilyId: familyId,
        storedFamilyUserId: user.id,
        storedPetId,
        storedPetUserId,
        userId: user.id,
      });
      setStoredFamilyId(nextContext.currentFamily?.id ?? null, user.id);
      setStoredPetId(nextContext.currentPet?.id ?? null, user.id);
    },
    [
      families,
      pets,
      setStoredFamilyId,
      setStoredPetId,
      storedPetId,
      storedPetUserId,
      user,
    ],
  );

  const setCurrentPetId = useCallback(
    (petId: string | null) => {
      if (!user || !petId) {
        setStoredPetId(null, user?.id ?? null);
        return;
      }

      const pet = pets.find((candidate) => candidate.id === petId);
      if (!pet?.family_id) {
        setStoredPetId(null, user.id);
        return;
      }

      setStoredFamilyId(pet.family_id, user.id);
      setStoredPetId(pet.id, user.id);
    },
    [pets, setStoredFamilyId, setStoredPetId, user],
  );

  return {
    currentFamily: context.currentFamily,
    currentFamilyId: context.currentFamily?.id ?? null,
    currentMembership,
    currentPet: context.currentPet,
    currentPetId: context.currentPet?.id ?? null,
    families: familyAccess,
    familiesQuery,
    familyPets: context.familyPets,
    pets,
    petsQuery,
    setCurrentFamilyId,
    setCurrentPetId,
  };
}

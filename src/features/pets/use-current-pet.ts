import { useCallback } from 'react';

import { useCurrentFamily } from '@/features/family/use-current-family';

export function useCurrentPet() {
  const familyContext = useCurrentFamily();
  const petsQuery = familyContext.petsQuery;
  const refetch = useCallback(async () => {
    const [petsResult] = await Promise.all([
      petsQuery.refetch(),
      familyContext.familiesQuery.refetch(),
    ]);
    return petsResult;
  }, [familyContext.familiesQuery, petsQuery]);

  return {
    ...petsQuery,
    currentFamily: familyContext.currentFamily,
    currentFamilyId: familyContext.currentFamilyId,
    currentPet: familyContext.currentPet,
    currentPetId: familyContext.currentPetId,
    error: petsQuery.error ?? familyContext.familiesQuery.error,
    isError: petsQuery.isError || familyContext.familiesQuery.isError,
    isPending: petsQuery.isPending || familyContext.familiesQuery.isPending,
    isSuccess: petsQuery.isSuccess && familyContext.familiesQuery.isSuccess,
    pets: petsQuery.data ?? [],
    refetch,
    setCurrentFamilyId: familyContext.setCurrentFamilyId,
    setCurrentPetId: familyContext.setCurrentPetId,
  };
}

import { useCallback } from 'react';

import { useCurrentFamily } from '@/features/family/use-current-family';

export function useCurrentPet() {
  const familyContext = useCurrentFamily();
  const petsQuery = familyContext.petsQuery;
  const refetch = useCallback(async () => {
    const capability = await familyContext.capabilityQuery.refetch();
    const [petsResult] = await Promise.all([
      petsQuery.refetch(),
      capability.isSuccess && capability.data === 'FAMILY_MULTI_PET'
        ? familyContext.familiesQuery.refetch()
        : Promise.resolve(),
    ]);
    return petsResult;
  }, [familyContext.capabilityQuery, familyContext.familiesQuery, petsQuery]);

  return {
    ...petsQuery,
    currentFamily: familyContext.currentFamily,
    currentFamilyId: familyContext.currentFamilyId,
    currentPet: familyContext.currentPet,
    currentPetId: familyContext.currentPetId,
    error:
      familyContext.capabilityQuery.error ??
      petsQuery.error ??
      (familyContext.backendCapability === 'FAMILY_MULTI_PET'
        ? familyContext.familiesQuery.error
        : null),
    isError:
      familyContext.capabilityQuery.isError ||
      petsQuery.isError ||
      (familyContext.backendCapability === 'FAMILY_MULTI_PET' &&
        familyContext.familiesQuery.isError),
    isPending:
      familyContext.capabilityQuery.isPending ||
      petsQuery.isPending ||
      (familyContext.backendCapability === 'FAMILY_MULTI_PET' &&
        familyContext.familiesQuery.isPending),
    isSuccess:
      familyContext.capabilityQuery.isSuccess &&
      petsQuery.isSuccess &&
      (familyContext.backendCapability === 'LEGACY_PET' ||
        familyContext.familiesQuery.isSuccess),
    pets: petsQuery.data ?? [],
    refetch,
    setCurrentFamilyId: familyContext.setCurrentFamilyId,
    setCurrentPetId: familyContext.setCurrentPetId,
  };
}

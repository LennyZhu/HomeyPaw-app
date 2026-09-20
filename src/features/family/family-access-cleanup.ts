import type { QueryClient } from '@tanstack/react-query';

import { petKeys } from '@/features/pets/pet-queries';
import { shouldClearRevokedPetQuery } from '@/features/pets/pet-access-state';
import type { Pet } from '@/types/database';

import { shouldClearFamilyQuery } from './family-context-state';
import { familyKeys, removeFamilyQueries } from './family-queries';
import type { AccessibleFamily } from './family-types';

export function clearRevokedFamilyAccess(input: {
  familyId: string;
  queryClient: QueryClient;
  setCurrentFamilyId: (familyId: string | null) => void;
  setCurrentPetId: (petId: string | null) => void;
  userId: string;
}) {
  const { familyId, queryClient, setCurrentFamilyId, setCurrentPetId, userId } =
    input;
  const cachedPets = queryClient.getQueryData<Pet[]>(petKeys.all(userId)) ?? [];
  const revokedPetIds = cachedPets
    .filter((pet) => pet.family_id === familyId)
    .map((pet) => pet.id);
  const revokedQueries = {
    predicate: (query: {
      queryKey: readonly unknown[];
      state: { data: unknown };
    }) =>
      shouldClearFamilyQuery(query.queryKey, userId, familyId) ||
      revokedPetIds.some((petId) =>
        shouldClearRevokedPetQuery(
          query.queryKey,
          userId,
          petId,
          query.state.data,
        ),
      ),
  };

  void queryClient.cancelQueries(revokedQueries).catch(() => undefined);
  queryClient.setQueryData<AccessibleFamily[]>(
    familyKeys.list(userId),
    (families) => families?.filter((access) => access.family.id !== familyId),
  );
  queryClient.setQueryData<Pet[]>(petKeys.all(userId), (pets) =>
    pets?.filter((pet) => pet.family_id !== familyId),
  );
  setCurrentFamilyId(null);
  setCurrentPetId(null);
  queryClient.removeQueries(revokedQueries);
  removeFamilyQueries(queryClient, userId, familyId);

  void Promise.all([
    queryClient.invalidateQueries({ queryKey: familyKeys.list(userId) }),
    queryClient.invalidateQueries({ queryKey: petKeys.all(userId) }),
  ]).catch(() => undefined);
}

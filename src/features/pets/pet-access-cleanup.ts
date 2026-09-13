import type { QueryClient } from '@tanstack/react-query';

import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import type { Pet } from '@/types/database';

import { petKeys } from './pet-queries';
import { shouldClearRevokedPetQuery } from './pet-access-state';

export function clearRevokedPetAccess(input: {
  petId: string;
  queryClient: QueryClient;
  setCurrentPetId: (petId: string | null) => void;
  userId: string;
}) {
  const { petId, queryClient, setCurrentPetId, userId } = input;
  const revokedQuery = {
    predicate: (query: {
      queryKey: readonly unknown[];
      state: { data: unknown };
    }) =>
      shouldClearRevokedPetQuery(
        query.queryKey,
        userId,
        petId,
        query.state.data,
      ),
  };

  void queryClient.cancelQueries(revokedQuery).catch(() => undefined);
  queryClient.setQueryData<Pet[]>(petKeys.all(userId), (pets) =>
    pets?.filter((pet) => pet.id !== petId),
  );
  setCurrentPetId(null);
  queryClient.removeQueries(revokedQuery);

  void Promise.all([
    queryClient.invalidateQueries({ queryKey: petKeys.all(userId) }),
    syncCareTaskNotifications(userId),
  ]).catch(() => undefined);
}

export type BackendCapability = 'LEGACY_PET' | 'FAMILY_MULTI_PET';

type ProbeError = { code?: string; message?: string };

export function getBackendQueryRouting(
  authenticated: boolean,
  capability: BackendCapability | undefined,
) {
  return {
    familyQueriesEnabled: authenticated && capability === 'FAMILY_MULTI_PET',
    petQueryEnabled: authenticated && Boolean(capability),
  };
}

/** A missing canonical table is the only evidence accepted for legacy mode. */
export function classifyBackendCapability(
  error: ProbeError | null,
): BackendCapability {
  if (!error) return 'FAMILY_MULTI_PET';
  if (
    (error.code === 'PGRST205' || error.code === '42P01') &&
    /\bfamily_members\b/i.test(error.message ?? '')
  ) {
    return 'LEGACY_PET';
  }
  throw error;
}

export function reconcileLegacyPet<TPet extends { id: string }>(
  pets: TPet[],
  storedPetId: string | null,
  storedPetUserId: string | null,
  userId: string | undefined,
): TPet | null {
  if (!userId) return null;
  const scopedId = storedPetUserId === userId ? storedPetId : null;
  return pets.find((pet) => pet.id === scopedId) ?? pets[0] ?? null;
}

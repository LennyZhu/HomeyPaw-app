type PetIdentity = { id: string };

const petDataQueryRoots = new Set([
  'care',
  'care-schedule',
  'care-tasks',
  'chat',
  'family',
  'pet',
  'posts',
]);

function containsPetId(value: unknown, petId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('pet_id' in value && value.pet_id === petId) return true;
  return Object.values(value).some((item) => containsPetId(item, petId));
}

export function selectAccessiblePet<T extends PetIdentity>(
  pets: T[],
  storedPetId: string | null,
  storedUserId: string | null,
  userId: string | undefined,
) {
  if (!userId) return null;
  const scopedPetId = storedUserId === userId ? storedPetId : null;
  return pets.find((pet) => pet.id === scopedPetId) ?? pets[0] ?? null;
}

export function shouldClearRevokedPetQuery(
  queryKey: readonly unknown[],
  userId: string,
  petId: string,
  data?: unknown,
) {
  return (
    queryKey[1] === userId &&
    petDataQueryRoots.has(String(queryKey[0])) &&
    (queryKey.includes(petId) || containsPetId(data, petId))
  );
}

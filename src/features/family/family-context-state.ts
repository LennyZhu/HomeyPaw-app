type FamilyIdentity = {
  created_at: string;
  id: string;
};

type FamilyPetIdentity = {
  created_at: string;
  family_id: string | null;
  id: string;
};

type FamilyContextInput<TFamily, TPet> = {
  families: TFamily[];
  pets: TPet[];
  storedFamilyId: string | null;
  storedFamilyUserId: string | null;
  storedPetId: string | null;
  storedPetUserId: string | null;
  userId: string | undefined;
};

function compareStableIdentity(left: FamilyIdentity, right: FamilyIdentity) {
  return (
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function reconcileFamilyContext<
  TFamily extends FamilyIdentity,
  TPet extends FamilyPetIdentity,
>(input: FamilyContextInput<TFamily, TPet>) {
  const {
    storedFamilyId,
    storedFamilyUserId,
    storedPetId,
    storedPetUserId,
    userId,
  } = input;

  if (!userId) {
    return {
      currentFamily: null,
      currentPet: null,
      familyPets: [] as TPet[],
    };
  }

  const families = [...input.families].sort(compareStableIdentity);
  const accessibleFamilyIds = new Set(families.map((family) => family.id));
  const pets = [...input.pets]
    .filter((pet) => pet.family_id && accessibleFamilyIds.has(pet.family_id))
    .sort(compareStableIdentity);
  const scopedFamilyId = storedFamilyUserId === userId ? storedFamilyId : null;
  const scopedPetId = storedPetUserId === userId ? storedPetId : null;
  const storedPet = pets.find((pet) => pet.id === scopedPetId) ?? null;
  const currentFamily =
    families.find((family) => family.id === scopedFamilyId) ??
    families.find((family) => family.id === storedPet?.family_id) ??
    families[0] ??
    null;
  const familyPets = currentFamily
    ? pets.filter((pet) => pet.family_id === currentFamily.id)
    : [];
  const currentPet =
    familyPets.find((pet) => pet.id === scopedPetId) ?? familyPets[0] ?? null;

  return { currentFamily, currentPet, familyPets };
}

export function shouldClearFamilyQuery(
  queryKey: readonly unknown[],
  userId: string,
  familyId?: string,
) {
  return (
    queryKey[0] === 'families' &&
    queryKey[1] === userId &&
    (!familyId || queryKey.includes(familyId))
  );
}

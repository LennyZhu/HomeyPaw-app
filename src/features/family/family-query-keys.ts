export const familyKeys = {
  all: (userId: string | undefined) => ['families', userId] as const,
  detail: (userId: string | undefined, familyId: string) =>
    [...familyKeys.all(userId), 'detail', familyId] as const,
  list: (userId: string | undefined) =>
    [...familyKeys.all(userId), 'list'] as const,
  members: (userId: string | undefined, familyId: string) =>
    [...familyKeys.all(userId), 'members', familyId] as const,
  pets: (userId: string | undefined, familyId: string) =>
    [...familyKeys.all(userId), 'pets', familyId] as const,
};

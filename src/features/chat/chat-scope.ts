// Room identity is independent of the active Pet, including zero-Pet Families.
export function createChatScopeKey(
  userId: string | undefined,
  familyId: string | null,
) {
  return userId && familyId ? `${userId}:${familyId}` : null;
}

export function getFamilyChatTopic(familyId: string, channelVersion: number) {
  return `family:${familyId}:chat:v${channelVersion}`;
}

export const chatKeys = {
  all: (userId: string | undefined) => ['chat', userId] as const,
  members: (userId: string | undefined, familyId: string) =>
    [...chatKeys.all(userId), 'family', familyId, 'members'] as const,
  messages: (userId: string | undefined, familyId: string) =>
    [...chatKeys.all(userId), 'family', familyId, 'messages'] as const,
  unread: (userId: string | undefined, familyId: string) =>
    [...chatKeys.all(userId), 'family', familyId, 'unread'] as const,
  version: (userId: string | undefined, familyId: string) =>
    [...chatKeys.all(userId), 'family', familyId, 'version'] as const,
};

export function shouldClearFamilyChatQuery(
  queryKey: readonly unknown[],
  userId: string,
  familyId: string,
) {
  return (
    queryKey[0] === 'chat' &&
    queryKey[1] === userId &&
    queryKey[2] === 'family' &&
    queryKey[3] === familyId
  );
}

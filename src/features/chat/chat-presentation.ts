export type ChatRealtimeStatus = 'connecting' | 'error' | 'idle' | 'subscribed';

export function formatChatBadge(count: number | undefined) {
  if (!count || count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

export function createChatScopeKey(
  userId: string | undefined,
  petId: string | null,
) {
  return userId && petId ? `${userId}:${petId}` : null;
}

export function getDisplayedChatUnread(
  count: number | undefined,
  active: boolean,
) {
  return active ? 0 : (count ?? 0);
}

export function shouldInvalidateChatUnread(
  senderId: string,
  currentUserId: string,
) {
  return senderId !== currentUserId;
}

export function shouldShowChatInitialLoading({
  hasCachedMessages,
  messagesPending,
  realtimeStatus,
}: {
  hasCachedMessages: boolean;
  messagesPending: boolean;
  realtimeStatus: ChatRealtimeStatus;
}) {
  return (
    !hasCachedMessages &&
    (messagesPending ||
      realtimeStatus === 'connecting' ||
      realtimeStatus === 'idle')
  );
}

export function consumeCreatedMessageId(
  seenMessageIds: Set<string>,
  messageId: string,
) {
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.add(messageId);
  return true;
}

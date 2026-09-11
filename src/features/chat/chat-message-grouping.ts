import type { ChatListMessage } from './chat-queries';

export const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60_000;

type GroupableChatMessage = Pick<ChatListMessage, 'created_at' | 'sender_id'>;

function getDateKey(createdAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(createdAt));

  return parts
    .filter((part) => part.type !== 'literal')
    .map((part) => `${part.type}:${part.value}`)
    .join('|');
}

export function isChatMessageConsecutive(
  message: GroupableChatMessage,
  previous: GroupableChatMessage | undefined,
  timeZone = 'Asia/Hong_Kong',
) {
  if (!previous || previous.sender_id !== message.sender_id) return false;
  if (
    getDateKey(previous.created_at, timeZone) !==
    getDateKey(message.created_at, timeZone)
  ) {
    return false;
  }

  const elapsed =
    new Date(message.created_at).getTime() -
    new Date(previous.created_at).getTime();
  return elapsed >= 0 && elapsed <= CHAT_MESSAGE_GROUP_WINDOW_MS;
}

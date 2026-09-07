import type { ChatMessage } from '@/types/database';

export type ChatListMessage = ChatMessage & {
  deliveryState?: 'failed' | 'sending';
  optimistic?: boolean;
};

export type ChatCursor = {
  createdAt: string;
  id: string;
};

export type ChatPage = {
  messages: ChatListMessage[];
  nextCursor: ChatCursor | null;
};

export function reconcileChatMessagePages(
  pages: ChatPage[],
  message: ChatMessage,
) {
  const withoutDuplicate = pages.map((page) => ({
    ...page,
    messages: page.messages.filter(
      (candidate) =>
        candidate.id !== message.id &&
        candidate.client_message_id !== message.client_message_id,
    ),
  }));
  const firstPage = withoutDuplicate[0];
  if (!firstPage) return [{ messages: [message], nextCursor: null }];

  return [
    { ...firstPage, messages: [message, ...firstPage.messages] },
    ...withoutDuplicate.slice(1),
  ];
}

export function removeChatMessagePages(pages: ChatPage[], messageId: string) {
  return pages.map((page) => ({
    ...page,
    messages: page.messages.filter((message) => message.id !== messageId),
  }));
}

export function addOptimisticMessagePages(
  pages: ChatPage[],
  message: ChatListMessage,
) {
  const withoutPreviousAttempt = pages.map((page) => ({
    ...page,
    messages: page.messages.filter(
      (candidate) => candidate.client_message_id !== message.client_message_id,
    ),
  }));
  const firstPage = withoutPreviousAttempt[0];
  if (!firstPage) return [{ messages: [message], nextCursor: null }];

  return [
    { ...firstPage, messages: [message, ...firstPage.messages] },
    ...withoutPreviousAttempt.slice(1),
  ];
}

export function markOptimisticMessageFailedPages(
  pages: ChatPage[],
  clientMessageId: string,
) {
  return pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) =>
      message.client_message_id === clientMessageId && message.optimistic
        ? { ...message, deliveryState: 'failed' as const }
        : message,
    ),
  }));
}

export function getChronologicalMessagesFromPages(pages: ChatPage[] = []) {
  const byId = new Map<string, ChatListMessage>();
  for (const page of pages) {
    for (const message of page.messages) {
      const key = message.optimistic
        ? `optimistic:${message.client_message_id}`
        : message.id;
      byId.set(key, message);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const timestamp = left.created_at.localeCompare(right.created_at);
    return timestamp || left.id.localeCompare(right.id);
  });
}

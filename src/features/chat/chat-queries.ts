import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { createProfileAvatarSignedUrls } from '@/features/profile/profile-avatar';
import { requireSupabase } from '@/lib/supabase/client';
import type { ChatMessage, PetMemberRole } from '@/types/database';

import {
  addOptimisticMessagePages,
  getChronologicalMessagesFromPages,
  markOptimisticMessageFailedPages,
  reconcileChatMessagePages,
  removeChatMessagePages,
  type ChatCursor,
  type ChatListMessage,
  type ChatPage,
} from './chat-cache';

import { chatKeys } from './chat-scope';

export type { ChatListMessage, ChatPage } from './chat-cache';

export const CHAT_PAGE_SIZE = 30;

export type ChatMemberSummary = {
  avatarPath: string | null;
  avatarUrl: string | null;
  displayName: string;
  joinedAt: string;
  role: PetMemberRole;
  userId: string;
};

export { chatKeys } from './chat-scope';

export function isChatAccessError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === '42501' ||
    candidate.message?.toLowerCase().includes('family not found') === true ||
    candidate.message?.toLowerCase().includes('jwt') === true
  );
}

export async function fetchChatChannelVersion(familyId: string) {
  const { data, error } = await requireSupabase().rpc(
    'get_family_chat_channel_version',
    { target_family_id: familyId },
  );

  if (error) throw error;
  return data;
}

async function fetchChatPage(
  familyId: string,
  cursor: ChatCursor | null,
): Promise<ChatPage> {
  const { data, error } = await requireSupabase().rpc(
    'get_family_chat_messages_page',
    {
      before_created_at: cursor?.createdAt ?? null,
      before_message_id: cursor?.id ?? null,
      requested_limit: CHAT_PAGE_SIZE,
      target_family_id: familyId,
    },
  );

  if (error) throw error;

  const lastMessage = data.at(-1);
  return {
    messages: data,
    nextCursor:
      data.length === CHAT_PAGE_SIZE && lastMessage
        ? { createdAt: lastMessage.created_at, id: lastMessage.id }
        : null,
  };
}

export async function fetchChatMessageById(messageId: string) {
  const { data, error } = await requireSupabase()
    .from('chat_messages')
    .select(
      'id, family_id, pet_id, sender_id, client_message_id, body, created_at, updated_at',
    )
    .eq('id', messageId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function fetchChatMembers(
  familyId: string,
  queryClient: QueryClient,
): Promise<ChatMemberSummary[]> {
  const { data, error } = await requireSupabase().rpc(
    'get_family_chat_members',
    {
      target_family_id: familyId,
    },
  );

  if (error) throw error;
  const avatarPaths = data.flatMap((member) =>
    member.member_avatar_url ? [member.member_avatar_url] : [],
  );
  const signedUrls = await createProfileAvatarSignedUrls(
    queryClient,
    avatarPaths,
  ).catch(() => ({}) as Record<string, string>);

  return data.map((member) => ({
    avatarPath: member.member_avatar_url,
    avatarUrl: member.member_avatar_url
      ? (signedUrls[member.member_avatar_url] ?? null)
      : null,
    displayName: member.member_display_name,
    joinedAt: member.member_joined_at,
    role: member.member_role,
    userId: member.member_user_id,
  }));
}

async function sendChatMessage(
  familyId: string,
  clientMessageId: string,
  body: string,
) {
  const { data, error } = await requireSupabase().rpc(
    'send_family_chat_message',
    {
      message_body: body,
      target_client_message_id: clientMessageId,
      target_family_id: familyId,
    },
  );

  if (error) throw error;
  return data;
}

async function updateChatMessage(messageId: string, body: string) {
  const { data, error } = await requireSupabase().rpc(
    'update_family_chat_message',
    {
      message_body: body,
      target_message_id: messageId,
    },
  );

  if (error) throw error;
  return data;
}

async function deleteChatMessage(messageId: string) {
  const { data, error } = await requireSupabase().rpc(
    'delete_family_chat_message',
    {
      target_message_id: messageId,
    },
  );

  if (error) throw error;
  return data;
}

async function markChatRead(familyId: string, messageId: string) {
  const { data, error } = await requireSupabase().rpc('mark_family_chat_read', {
    target_message_id: messageId,
    target_family_id: familyId,
  });

  if (error) throw error;
  return data;
}

async function fetchUnreadCount(familyId: string) {
  const { data, error } = await requireSupabase().rpc(
    'get_family_chat_unread_count',
    {
      target_family_id: familyId,
    },
  );

  if (error) throw error;
  return data;
}

function updateMessageCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  update: (pages: ChatPage[]) => ChatPage[],
) {
  queryClient.setQueryData<InfiniteData<ChatPage>>(queryKey, (current) => {
    if (!current) return current;
    return { ...current, pages: update(current.pages) };
  });
}

export function mergeChatMessage(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  message: ChatMessage,
) {
  updateMessageCache(queryClient, queryKey, (pages) =>
    reconcileChatMessagePages(pages, message),
  );
}

export function removeChatMessageFromCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  messageId: string,
) {
  updateMessageCache(queryClient, queryKey, (pages) =>
    removeChatMessagePages(pages, messageId),
  );
}

function addOptimisticMessage(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  message: ChatListMessage,
) {
  updateMessageCache(queryClient, queryKey, (pages) =>
    addOptimisticMessagePages(pages, message),
  );
}

function markOptimisticMessageFailed(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  clientMessageId: string,
) {
  updateMessageCache(queryClient, queryKey, (pages) =>
    markOptimisticMessageFailedPages(pages, clientMessageId),
  );
}

export function clearChatFamilyCache(
  queryClient: QueryClient,
  userId: string | undefined,
  familyId: string,
) {
  queryClient.removeQueries({ queryKey: chatKeys.messages(userId, familyId) });
  queryClient.removeQueries({ queryKey: chatKeys.members(userId, familyId) });
  queryClient.removeQueries({ queryKey: chatKeys.unread(userId, familyId) });
  queryClient.removeQueries({ queryKey: chatKeys.version(userId, familyId) });
}

export function getChronologicalMessages(
  data: InfiniteData<ChatPage> | undefined,
) {
  return getChronologicalMessagesFromPages(data?.pages);
}

export function useChatChannelVersion(familyId: string | null, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && familyId && enabled),
    queryFn: () => fetchChatChannelVersion(familyId!),
    queryKey: chatKeys.version(user?.id, familyId ?? ''),
    retry: false,
    staleTime: 0,
  });
}

export function useChatMessages(familyId: string | null, enabled: boolean) {
  const { user } = useAuth();
  const queryKey = chatKeys.messages(user?.id, familyId ?? '');
  return useInfiniteQuery<
    ChatPage,
    Error,
    InfiniteData<ChatPage>,
    typeof queryKey,
    ChatCursor | null
  >({
    enabled: Boolean(user && familyId && enabled),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as ChatCursor | null,
    queryFn: ({ pageParam }) => fetchChatPage(familyId!, pageParam),
    queryKey,
    retry: false,
    staleTime: 0,
  });
}

export function useChatMembers(familyId: string | null, enabled: boolean) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useQuery({
    enabled: Boolean(user && familyId && enabled),
    queryFn: () => fetchChatMembers(familyId!, queryClient),
    queryKey: chatKeys.members(user?.id, familyId ?? ''),
    retry: false,
  });
}

export function useChatUnreadCount(familyId: string | null, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && familyId && enabled),
    queryFn: () => fetchUnreadCount(familyId!),
    queryKey: chatKeys.unread(user?.id, familyId ?? ''),
    retry: false,
    staleTime: 0,
  });
}

export function useSendChatMessage(familyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = chatKeys.messages(user?.id, familyId);

  return useMutation({
    mutationFn: ({
      body,
      clientMessageId,
    }: {
      body: string;
      clientMessageId: string;
    }) => sendChatMessage(familyId, clientMessageId, body),
    onError: (_error, variables) => {
      markOptimisticMessageFailed(
        queryClient,
        queryKey,
        variables.clientMessageId,
      );
    },
    onMutate: (variables) => {
      addOptimisticMessage(queryClient, queryKey, {
        body: variables.body.trim(),
        client_message_id: variables.clientMessageId,
        created_at: new Date().toISOString(),
        deliveryState: 'sending',
        id: `optimistic:${variables.clientMessageId}`,
        optimistic: true,
        family_id: familyId,
        pet_id: null,
        sender_id: user!.id,
        updated_at: new Date().toISOString(),
      });
    },
    onSuccess: (message) => {
      mergeChatMessage(queryClient, queryKey, message);
    },
  });
}

export function useDeleteChatMessage(familyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = chatKeys.messages(user?.id, familyId);

  return useMutation({
    mutationFn: deleteChatMessage,
    onSuccess: (deleted, messageId) => {
      if (deleted) removeChatMessageFromCache(queryClient, queryKey, messageId);
    },
  });
}

export function useUpdateChatMessage(familyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = chatKeys.messages(user?.id, familyId);

  return useMutation({
    mutationFn: ({ body, messageId }: { body: string; messageId: string }) =>
      updateChatMessage(messageId, body),
    onSuccess: (message) => {
      mergeChatMessage(queryClient, queryKey, message);
    },
  });
}

export function useMarkChatRead(familyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) => markChatRead(familyId, messageId),
    onMutate: async () => {
      const queryKey = chatKeys.unread(user?.id, familyId);
      await queryClient.cancelQueries({ queryKey });
      const previousCount = queryClient.getQueryData<number>(queryKey);
      queryClient.setQueryData(queryKey, 0);
      return { previousCount };
    },
    onError: (_error, _messageId, context) => {
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          chatKeys.unread(user?.id, familyId),
          context.previousCount,
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.unread(user?.id, familyId),
      });
    },
  });
}

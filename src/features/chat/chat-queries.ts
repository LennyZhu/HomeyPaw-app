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

export const chatKeys = {
  all: (userId: string | undefined) => ['chat', userId] as const,
  members: (userId: string | undefined, petId: string) =>
    [...chatKeys.all(userId), 'members', petId] as const,
  messages: (userId: string | undefined, petId: string) =>
    [...chatKeys.all(userId), 'messages', petId] as const,
  unread: (userId: string | undefined, petId: string) =>
    [...chatKeys.all(userId), 'unread', petId] as const,
  version: (userId: string | undefined, petId: string) =>
    [...chatKeys.all(userId), 'version', petId] as const,
};

export function isChatAccessError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === '42501' ||
    candidate.message?.toLowerCase().includes('pet not found') === true ||
    candidate.message?.toLowerCase().includes('jwt') === true
  );
}

export async function fetchChatChannelVersion(petId: string) {
  const { data, error } = await requireSupabase().rpc(
    'get_pet_chat_channel_version',
    { target_pet_id: petId },
  );

  if (error) throw error;
  return data;
}

async function fetchChatPage(
  petId: string,
  cursor: ChatCursor | null,
): Promise<ChatPage> {
  const { data, error } = await requireSupabase().rpc(
    'get_chat_messages_page',
    {
      before_created_at: cursor?.createdAt ?? null,
      before_message_id: cursor?.id ?? null,
      requested_limit: CHAT_PAGE_SIZE,
      target_pet_id: petId,
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
      'id, pet_id, sender_id, client_message_id, body, created_at, updated_at',
    )
    .eq('id', messageId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function fetchChatMembers(petId: string): Promise<ChatMemberSummary[]> {
  const { data, error } = await requireSupabase().rpc('get_pet_chat_members', {
    target_pet_id: petId,
  });

  if (error) throw error;
  const avatarPaths = data.flatMap((member) =>
    member.member_avatar_url ? [member.member_avatar_url] : [],
  );
  const signedUrls = await createProfileAvatarSignedUrls(avatarPaths).catch(
    () => ({}),
  );

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
  petId: string,
  clientMessageId: string,
  body: string,
) {
  const { data, error } = await requireSupabase().rpc('send_chat_message', {
    message_body: body,
    target_client_message_id: clientMessageId,
    target_pet_id: petId,
  });

  if (error) throw error;
  return data;
}

async function updateChatMessage(messageId: string, body: string) {
  const { data, error } = await requireSupabase().rpc('update_chat_message', {
    message_body: body,
    target_message_id: messageId,
  });

  if (error) throw error;
  return data;
}

async function deleteChatMessage(messageId: string) {
  const { data, error } = await requireSupabase().rpc('delete_chat_message', {
    target_message_id: messageId,
  });

  if (error) throw error;
  return data;
}

async function markChatRead(petId: string, messageId: string) {
  const { data, error } = await requireSupabase().rpc('mark_chat_read', {
    target_message_id: messageId,
    target_pet_id: petId,
  });

  if (error) throw error;
  return data;
}

async function fetchUnreadCount(petId: string) {
  const { data, error } = await requireSupabase().rpc('get_chat_unread_count', {
    target_pet_id: petId,
  });

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

export function clearChatPetCache(
  queryClient: QueryClient,
  userId: string | undefined,
  petId: string,
) {
  queryClient.removeQueries({ queryKey: chatKeys.messages(userId, petId) });
  queryClient.removeQueries({ queryKey: chatKeys.members(userId, petId) });
  queryClient.removeQueries({ queryKey: chatKeys.unread(userId, petId) });
  queryClient.removeQueries({ queryKey: chatKeys.version(userId, petId) });
}

export function getChronologicalMessages(
  data: InfiniteData<ChatPage> | undefined,
) {
  return getChronologicalMessagesFromPages(data?.pages);
}

export function useChatChannelVersion(petId: string | null, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && petId && enabled),
    queryFn: () => fetchChatChannelVersion(petId!),
    queryKey: chatKeys.version(user?.id, petId ?? ''),
    retry: false,
    staleTime: 0,
  });
}

export function useChatMessages(petId: string | null, enabled: boolean) {
  const { user } = useAuth();
  const queryKey = chatKeys.messages(user?.id, petId ?? '');
  return useInfiniteQuery<
    ChatPage,
    Error,
    InfiniteData<ChatPage>,
    typeof queryKey,
    ChatCursor | null
  >({
    enabled: Boolean(user && petId && enabled),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as ChatCursor | null,
    queryFn: ({ pageParam }) => fetchChatPage(petId!, pageParam),
    queryKey,
    retry: false,
    staleTime: 0,
  });
}

export function useChatMembers(petId: string | null, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && petId && enabled),
    queryFn: () => fetchChatMembers(petId!),
    queryKey: chatKeys.members(user?.id, petId ?? ''),
    retry: false,
  });
}

export function useChatUnreadCount(petId: string | null, enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && petId && enabled),
    queryFn: () => fetchUnreadCount(petId!),
    queryKey: chatKeys.unread(user?.id, petId ?? ''),
    retry: false,
    staleTime: 0,
  });
}

export function useSendChatMessage(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = chatKeys.messages(user?.id, petId);

  return useMutation({
    mutationFn: ({
      body,
      clientMessageId,
    }: {
      body: string;
      clientMessageId: string;
    }) => sendChatMessage(petId, clientMessageId, body),
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
        pet_id: petId,
        sender_id: user!.id,
        updated_at: new Date().toISOString(),
      });
    },
    onSuccess: (message) => {
      mergeChatMessage(queryClient, queryKey, message);
    },
  });
}

export function useDeleteChatMessage(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = chatKeys.messages(user?.id, petId);

  return useMutation({
    mutationFn: deleteChatMessage,
    onSuccess: (deleted, messageId) => {
      if (deleted) removeChatMessageFromCache(queryClient, queryKey, messageId);
    },
  });
}

export function useUpdateChatMessage(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = chatKeys.messages(user?.id, petId);

  return useMutation({
    mutationFn: ({ body, messageId }: { body: string; messageId: string }) =>
      updateChatMessage(messageId, body),
    onSuccess: (message) => {
      mergeChatMessage(queryClient, queryKey, message);
    },
  });
}

export function useMarkChatRead(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) => markChatRead(petId, messageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.unread(user?.id, petId),
      });
    },
  });
}

import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useMemo,
  useState,
} from 'react';

import { CHAT_ENABLED } from '@/config/features';
import { useAuth } from '@/features/auth/auth-context';
import { familyKeys } from '@/features/family/family-queries';
import { petKeys } from '@/features/pets/pet-queries';
import { useCurrentPet } from '@/features/pets/use-current-pet';

import {
  chatKeys,
  clearChatPetCache,
  useChatChannelVersion,
  useChatUnreadCount,
} from './chat-queries';
import {
  createChatScopeKey,
  getDisplayedChatUnread,
  type ChatRealtimeStatus,
} from './chat-presentation';
import { useChatRealtime } from './use-chat-realtime';

type ChatSessionContextValue = {
  accessLost: boolean;
  isChatActive: boolean;
  markAccessLost: () => void;
  retryConnection: () => void;
  setChatActive: (active: boolean) => void;
  status: ChatRealtimeStatus;
  unreadCount: number;
  versionError: Error | null;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function ChatSessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const petId = petsState.currentPetId;
  const [accessLostScope, setAccessLostScope] = useState<string | null>(null);
  const [activeChatScope, setActiveChatScope] = useState<string | null>(null);
  const scope = createChatScopeKey(user?.id, petId);
  const accessLost = Boolean(scope && accessLostScope === scope);
  const isChatActive = Boolean(scope && activeChatScope === scope);

  const clearAccess = useCallback(() => {
    if (!user || !petId) return;
    setAccessLostScope(`${user.id}:${petId}`);
    queryClient.setQueryData(chatKeys.unread(user.id, petId), 0);
    void queryClient
      .cancelQueries({ queryKey: chatKeys.all(user.id) })
      .then(async () => {
        clearChatPetCache(queryClient, user.id, petId);
        queryClient.removeQueries({
          queryKey: familyKeys.members(user.id, petId),
        });
        queryClient.removeQueries({ queryKey: petKeys.detail(user.id, petId) });
        await queryClient.invalidateQueries({ queryKey: petKeys.all(user.id) });
      })
      .catch(() => undefined);
  }, [petId, queryClient, user]);

  const versionQuery = useChatChannelVersion(
    petId,
    CHAT_ENABLED && !accessLost,
  );
  const realtime = useChatRealtime({
    channelVersion: versionQuery.data,
    enabled: Boolean(CHAT_ENABLED && user && petId && !accessLost),
    onAccessLost: clearAccess,
    petId,
    userId: user?.id,
  });
  const unreadQuery = useChatUnreadCount(
    petId,
    realtime.status === 'subscribed' && !accessLost,
  );

  const retryConnection = useCallback(() => {
    if (scope && accessLostScope === scope) {
      setAccessLostScope(null);
      return;
    }
    void versionQuery.refetch();
    void realtime.validateAndReconcile();
  }, [accessLostScope, realtime, scope, versionQuery]);
  const setChatActive = useCallback(
    (active: boolean) => setActiveChatScope(active ? scope : null),
    [scope],
  );

  const value = useMemo<ChatSessionContextValue>(
    () => ({
      accessLost,
      isChatActive,
      markAccessLost: clearAccess,
      retryConnection,
      setChatActive,
      status: realtime.status,
      unreadCount: getDisplayedChatUnread(unreadQuery.data, isChatActive),
      versionError: versionQuery.error,
    }),
    [
      accessLost,
      clearAccess,
      isChatActive,
      realtime.status,
      retryConnection,
      setChatActive,
      unreadQuery.data,
      versionQuery.error,
    ],
  );

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession() {
  const value = use(ChatSessionContext);
  if (!value) {
    throw new Error('useChatSession must be used inside ChatSessionProvider.');
  }
  return value;
}

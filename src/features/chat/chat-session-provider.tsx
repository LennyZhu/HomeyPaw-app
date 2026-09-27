import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CHAT_ENABLED } from '@/config/features';
import { useAuth } from '@/features/auth/auth-context';
import { familyKeys } from '@/features/family/family-query-keys';
import { useCurrentFamily } from '@/features/family/use-current-family';

import {
  chatKeys,
  clearChatFamilyCache,
  useChatChannelVersion,
  useChatUnreadCount,
} from './chat-queries';
import {
  getDisplayedChatUnread,
  type ChatRealtimeStatus,
} from './chat-presentation';
import { createChatScopeKey } from './chat-scope';
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
  const familyState = useCurrentFamily();
  const familyId = familyState.currentFamilyId;
  const [accessLostScope, setAccessLostScope] = useState<string | null>(null);
  const [activeChatScope, setActiveChatScope] = useState<string | null>(null);
  const scope = createChatScopeKey(user?.id, familyId);
  const accessLost = Boolean(scope && accessLostScope === scope);
  const isChatActive = Boolean(scope && activeChatScope === scope);

  useEffect(() => {
    const userId = user?.id;
    if (!userId || !familyId) return;
    return () => {
      void queryClient.cancelQueries({
        queryKey: [...chatKeys.all(userId), 'family', familyId],
      });
      clearChatFamilyCache(queryClient, userId, familyId);
    };
  }, [familyId, queryClient, user?.id]);

  const clearAccess = useCallback(() => {
    if (!user || !familyId) return;
    setAccessLostScope(`${user.id}:${familyId}`);
    queryClient.setQueryData(chatKeys.unread(user.id, familyId), 0);
    clearChatFamilyCache(queryClient, user.id, familyId);
    // Revalidate membership without clearing the active Pet or unrelated data.
    void queryClient.invalidateQueries({ queryKey: familyKeys.list(user.id) });
  }, [familyId, queryClient, user]);

  const versionQuery = useChatChannelVersion(
    familyId,
    CHAT_ENABLED && !accessLost,
  );
  const realtime = useChatRealtime({
    channelVersion: versionQuery.data,
    enabled: Boolean(CHAT_ENABLED && user && familyId && !accessLost),
    onAccessLost: clearAccess,
    familyId,
    userId: user?.id,
  });
  const unreadQuery = useChatUnreadCount(
    familyId,
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

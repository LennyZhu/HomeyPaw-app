import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { familyKeys } from '@/features/family/family-query-keys';
import { petKeys } from '@/features/pets/pet-queries';
import { logError } from '@/lib/logger';
import { requireSupabase } from '@/lib/supabase/client';

import {
  chatKeys,
  clearChatFamilyCache,
  fetchChatChannelVersion,
  fetchChatMessageById,
  isChatAccessError,
  mergeChatMessage,
  removeChatMessageFromCache,
} from './chat-queries';
import { getFamilyChatTopic } from './chat-scope';
import {
  consumeCreatedMessageId,
  shouldInvalidateChatUnread,
  type ChatRealtimeStatus,
} from './chat-presentation';

type ChatRealtimeConnection = {
  status: ChatRealtimeStatus;
  topic: string | null;
};

type UseChatRealtimeOptions = {
  channelVersion: number | undefined;
  enabled: boolean;
  onAccessLost: () => void;
  familyId: string | null;
  userId: string | undefined;
};

type BroadcastEnvelope = {
  payload?: {
    message_id?: unknown;
    family_id?: unknown;
    type?: unknown;
  };
};

const staleVersionRetryDelayMs = 500;
const membershipRecheckIntervalMs = 15_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function getMessageId(event: BroadcastEnvelope) {
  const messageId = event.payload?.message_id;
  return typeof messageId === 'string' && uuidPattern.test(messageId)
    ? messageId
    : null;
}

export function useChatRealtime({
  channelVersion,
  enabled,
  onAccessLost,
  familyId,
  userId,
}: UseChatRealtimeOptions) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ChatRealtimeConnection>({
    status: 'idle',
    topic: null,
  });
  const [controlStatus, setControlStatus] =
    useState<ChatRealtimeStatus>('idle');
  const validateRef = useRef<() => Promise<void>>(async () => undefined);
  const rotationRef = useRef<(rotatedFamilyId: string) => Promise<void>>(
    async () => undefined,
  );

  useEffect(() => {
    if (
      !enabled ||
      !familyId ||
      !userId ||
      channelVersion === undefined ||
      controlStatus !== 'subscribed'
    )
      return;

    const client = requireSupabase();
    const messageQueryKey = chatKeys.messages(userId, familyId);
    const versionQueryKey = chatKeys.version(userId, familyId);
    const topic = getFamilyChatTopic(familyId, channelVersion);
    let active = true;
    let retryAttempted = false;
    let rotationRunning = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const seenCreatedMessageIds = new Set<string>();

    const loseAccess = async () => {
      if (!active) return;
      await queryClient.cancelQueries({ queryKey: chatKeys.all(userId) });
      clearChatFamilyCache(queryClient, userId, familyId);
      queryClient.removeQueries({
        queryKey: familyKeys.members(userId, familyId),
      });
      queryClient.removeQueries({
        queryKey: familyKeys.detail(userId, familyId),
      });
      await queryClient.invalidateQueries({ queryKey: petKeys.all(userId) });
      if (active) onAccessLost();
    };

    const clearRoomCaches = async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: messageQueryKey }),
        queryClient.cancelQueries({
          queryKey: chatKeys.members(userId, familyId),
        }),
        queryClient.cancelQueries({
          queryKey: chatKeys.unread(userId, familyId),
        }),
      ]);
      queryClient.removeQueries({ queryKey: messageQueryKey });
      queryClient.removeQueries({
        queryKey: chatKeys.members(userId, familyId),
      });
      queryClient.removeQueries({
        queryKey: chatKeys.unread(userId, familyId),
      });
    };

    const applyChannelVersion = async (nextVersion: number) => {
      if (!active || nextVersion === channelVersion) return;
      setConnection({ status: 'connecting', topic });
      if (channel) {
        const staleChannel = channel;
        channel = null;
        await client.removeChannel(staleChannel);
      }
      await clearRoomCaches();
      if (active) queryClient.setQueryData(versionQueryKey, nextVersion);
    };

    const reconcileRotation = async (rotatedFamilyId: string) => {
      if (!active || rotatedFamilyId !== familyId || rotationRunning) return;
      rotationRunning = true;
      setConnection({ status: 'connecting', topic });

      try {
        const nextVersion = await fetchChatChannelVersion(familyId);
        if (!active) return;
        if (nextVersion === channelVersion) {
          setConnection({ status: 'subscribed', topic });
          return;
        }
        if (channel) {
          const staleChannel = channel;
          channel = null;
          await client.removeChannel(staleChannel);
        }
        await clearRoomCaches();
        if (active) queryClient.setQueryData(versionQueryKey, nextVersion);
      } catch (error) {
        if (isChatAccessError(error)) {
          await loseAccess();
        } else {
          logError('chat_rotation_reconcile_failed', error);
          if (active) setConnection({ status: 'error', topic });
        }
      } finally {
        rotationRunning = false;
      }
    };
    rotationRef.current = reconcileRotation;

    const validateAndReconcile = async () => {
      if (!active) return;
      try {
        await client.realtime.setAuth();
        const currentVersion = await fetchChatChannelVersion(familyId);
        if (!active) return;

        if (currentVersion !== channelVersion) {
          await applyChannelVersion(currentVersion);
          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: messageQueryKey }),
          queryClient.invalidateQueries({
            queryKey: chatKeys.members(userId, familyId),
          }),
          queryClient.invalidateQueries({
            queryKey: chatKeys.unread(userId, familyId),
          }),
        ]);
      } catch (error) {
        if (isChatAccessError(error)) {
          await loseAccess();
          return;
        }
        logError('chat_realtime_reconcile_failed', error);
      }
    };
    validateRef.current = validateAndReconcile;

    const reconcileMessage = async (
      event: BroadcastEnvelope,
      invalidateUnread: boolean,
    ) => {
      const messageId = getMessageId(event);
      if (!messageId || !active) return;

      if (
        invalidateUnread &&
        !consumeCreatedMessageId(seenCreatedMessageIds, messageId)
      )
        return;

      try {
        const message = await fetchChatMessageById(messageId);
        if (!active) return;
        if (message?.family_id === familyId) {
          mergeChatMessage(queryClient, messageQueryKey, message);
          if (
            invalidateUnread &&
            shouldInvalidateChatUnread(message.sender_id, userId)
          ) {
            await queryClient.invalidateQueries({
              queryKey: chatKeys.unread(userId, familyId),
            });
          }
        } else if (invalidateUnread) {
          seenCreatedMessageIds.delete(messageId);
        }
      } catch (error) {
        if (invalidateUnread) seenCreatedMessageIds.delete(messageId);
        if (isChatAccessError(error)) {
          await loseAccess();
          return;
        }
        logError('chat_message_reconcile_failed', error);
      }
    };

    const reconcileDeletion = async (event: BroadcastEnvelope) => {
      const messageId = getMessageId(event);
      if (!messageId || !active) return;
      removeChatMessageFromCache(queryClient, messageQueryKey, messageId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: messageQueryKey }),
        queryClient.invalidateQueries({
          queryKey: chatKeys.unread(userId, familyId),
        }),
      ]);
    };

    const subscribe = async () => {
      await client.realtime.setAuth();
      if (!active) return;
      setConnection({ status: 'connecting', topic });

      channel = client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'message_created' }, (event) =>
          reconcileMessage(event as unknown as BroadcastEnvelope, true),
        )
        .on('broadcast', { event: 'message_updated' }, (event) =>
          reconcileMessage(event as unknown as BroadcastEnvelope, false),
        )
        .on('broadcast', { event: 'message_deleted' }, reconcileDeletion)
        .subscribe((nextStatus) => {
          if (!active) return;

          if (nextStatus === 'SUBSCRIBED') {
            setConnection({ status: 'subscribed', topic });
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: messageQueryKey }),
              queryClient.invalidateQueries({
                queryKey: chatKeys.members(userId, familyId),
              }),
              queryClient.invalidateQueries({
                queryKey: chatKeys.unread(userId, familyId),
              }),
            ]);
            return;
          }

          if (nextStatus === 'CHANNEL_ERROR' && !retryAttempted) {
            retryAttempted = true;
            setConnection({ status: 'connecting', topic });
            retryTimer = setTimeout(() => {
              retryTimer = null;
              void fetchChatChannelVersion(familyId)
                .then((latestVersion) => {
                  if (!active) return;
                  if (latestVersion !== channelVersion) {
                    void applyChannelVersion(latestVersion);
                  } else {
                    setConnection({ status: 'error', topic });
                  }
                })
                .catch(async (error: unknown) => {
                  if (isChatAccessError(error)) {
                    await loseAccess();
                  } else if (active) {
                    setConnection({ status: 'error', topic });
                    logError('chat_channel_version_retry_failed', error);
                  }
                });
            }, staleVersionRetryDelayMs);
            return;
          }

          if (nextStatus === 'TIMED_OUT') {
            setConnection({ status: 'connecting', topic });
          }
        });
    };

    void subscribe().catch(async (error: unknown) => {
      if (isChatAccessError(error)) {
        await loseAccess();
      } else if (active) {
        setConnection({ status: 'error', topic });
        logError('chat_channel_subscribe_failed', error);
      }
    });

    return () => {
      active = false;
      validateRef.current = async () => undefined;
      rotationRef.current = async () => undefined;
      if (retryTimer) clearTimeout(retryTimer);
      setConnection((current) =>
        current.topic === topic ? { status: 'idle', topic: null } : current,
      );
      if (channel) void client.removeChannel(channel);
    };
  }, [
    channelVersion,
    controlStatus,
    enabled,
    onAccessLost,
    familyId,
    queryClient,
    userId,
  ]);

  useEffect(() => {
    if (!enabled || !userId) return;

    const client = requireSupabase();
    const controlTopic = `user:${userId}:chat-control`;
    let active = true;
    let controlChannel: RealtimeChannel | null = null;

    const subscribeControl = async () => {
      await client.realtime.setAuth();
      if (!active) return;
      setControlStatus('connecting');

      controlChannel = client
        .channel(controlTopic, { config: { private: true } })
        .on('broadcast', { event: 'family_chat_channel_rotated' }, (event) => {
          const rotatedFamilyId = (event as BroadcastEnvelope).payload
            ?.family_id;
          if (
            typeof rotatedFamilyId === 'string' &&
            uuidPattern.test(rotatedFamilyId)
          ) {
            void rotationRef.current(rotatedFamilyId);
          }
        })
        .subscribe((status) => {
          if (!active) return;
          if (status === 'SUBSCRIBED') {
            setControlStatus('subscribed');
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setControlStatus('error');
          }
        });
    };

    void subscribeControl().catch((error: unknown) => {
      if (active) {
        setControlStatus('error');
        logError('chat_control_channel_subscribe_failed', error);
      }
    });

    return () => {
      active = false;
      setControlStatus('idle');
      if (controlChannel) void client.removeChannel(controlChannel);
    };
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled) return;
    const client = requireSupabase();
    const deferredValidationTimers = new Set<ReturnType<typeof setTimeout>>();
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState === 'active') void validateRef.current();
      },
    );
    const unsubscribeNetwork = NetInfo.addEventListener((networkState) => {
      if (
        networkState.isConnected === true &&
        networkState.isInternetReachable !== false
      ) {
        void validateRef.current();
      }
    });
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') {
        const timer = setTimeout(() => {
          deferredValidationTimers.delete(timer);
          void validateRef.current();
        }, 0);
        deferredValidationTimers.add(timer);
      }
    });
    const membershipRecheck = setInterval(
      () => void validateRef.current(),
      membershipRecheckIntervalMs,
    );
    return () => {
      appStateSubscription.remove();
      unsubscribeNetwork();
      authListener.subscription.unsubscribe();
      clearInterval(membershipRecheck);
      for (const timer of deferredValidationTimers) clearTimeout(timer);
    };
  }, [enabled]);

  const expectedTopic =
    enabled && familyId && channelVersion !== undefined
      ? getFamilyChatTopic(familyId, channelVersion)
      : null;
  const status: ChatRealtimeStatus = !expectedTopic
    ? 'idle'
    : controlStatus === 'error'
      ? 'error'
      : controlStatus !== 'subscribed'
        ? 'connecting'
        : connection.topic === expectedTopic
          ? connection.status
          : 'connecting';

  return { status, validateAndReconcile: () => validateRef.current() };
}

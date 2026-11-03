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
  userId: string | null;
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
    userId: null,
  });
  const [controlConnection, setControlConnection] = useState<{
    userId: string | null;
    status: ChatRealtimeStatus;
  }>({ userId: null, status: 'idle' });
  const controlStatus =
    controlConnection.userId === userId ? controlConnection.status : 'idle';
  const sessionUserRef = useRef(userId);
  const onlineRef = useRef(true);
  const onAccessLostRef = useRef(onAccessLost);
  const roomRemovalRef = useRef<Promise<unknown>>(Promise.resolve());
  const controlRemovalRef = useRef<Promise<unknown>>(Promise.resolve());
  const validateRef = useRef<() => Promise<void>>(async () => undefined);
  const rotationRef = useRef<(rotatedFamilyId: string) => Promise<void>>(
    async () => undefined,
  );

  useEffect(() => {
    onAccessLostRef.current = onAccessLost;
  }, [onAccessLost]);

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
    let validationPromise: Promise<void> | null = null;
    const controller = new AbortController();
    const isCurrent = () => active && sessionUserRef.current === userId;
    const setRoomConnection = (status: ChatRealtimeStatus) => {
      if (isCurrent()) setConnection({ status, topic, userId });
    };
    const seenCreatedMessageIds = new Set<string>();

    const loseAccess = async () => {
      if (!isCurrent()) return;
      await queryClient.cancelQueries({ queryKey: chatKeys.all(userId) });
      if (!isCurrent()) return;
      clearChatFamilyCache(queryClient, userId, familyId);
      queryClient.removeQueries({
        queryKey: familyKeys.members(userId, familyId),
      });
      queryClient.removeQueries({
        queryKey: familyKeys.detail(userId, familyId),
      });
      await queryClient.invalidateQueries({ queryKey: petKeys.all(userId) });
      if (isCurrent()) onAccessLostRef.current();
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
      if (!isCurrent()) return;
      queryClient.removeQueries({ queryKey: messageQueryKey });
      queryClient.removeQueries({
        queryKey: chatKeys.members(userId, familyId),
      });
      queryClient.removeQueries({
        queryKey: chatKeys.unread(userId, familyId),
      });
    };

    const applyChannelVersion = async (nextVersion: number) => {
      if (!isCurrent() || nextVersion === channelVersion) return;
      setRoomConnection('connecting');
      if (channel) {
        const staleChannel = channel;
        channel = null;
        roomRemovalRef.current = client.removeChannel(staleChannel);
        await roomRemovalRef.current;
      }
      if (!isCurrent()) return;
      await clearRoomCaches();
      if (isCurrent()) queryClient.setQueryData(versionQueryKey, nextVersion);
    };

    const reconcileRotation = async (rotatedFamilyId: string) => {
      if (!isCurrent() || rotatedFamilyId !== familyId || rotationRunning)
        return;
      rotationRunning = true;
      setRoomConnection('connecting');

      try {
        const nextVersion = await fetchChatChannelVersion(
          familyId,
          controller.signal,
        );
        if (!isCurrent()) return;
        if (nextVersion === channelVersion) {
          setRoomConnection('subscribed');
          return;
        }
        if (channel) {
          const staleChannel = channel;
          channel = null;
          roomRemovalRef.current = client.removeChannel(staleChannel);
          await roomRemovalRef.current;
        }
        if (!isCurrent()) return;
        await clearRoomCaches();
        if (isCurrent()) queryClient.setQueryData(versionQueryKey, nextVersion);
      } catch (error) {
        if (!isCurrent()) return;
        if (isChatAccessError(error)) {
          await loseAccess();
        } else {
          logError('chat_rotation_reconcile_failed', error);
          setRoomConnection('error');
        }
      } finally {
        rotationRunning = false;
      }
    };
    rotationRef.current = reconcileRotation;

    const validateAndReconcile = () => {
      if (
        !isCurrent() ||
        !onlineRef.current ||
        AppState.currentState !== 'active'
      )
        return Promise.resolve();
      if (validationPromise) return validationPromise;
      validationPromise = (async () => {
        let phase = 'auth';
        try {
          await client.realtime.setAuth();
          if (!isCurrent()) return;
          phase = 'channel_version';
          const currentVersion = await fetchChatChannelVersion(
            familyId,
            controller.signal,
          );
          if (!isCurrent()) return;

          if (currentVersion !== channelVersion) {
            await applyChannelVersion(currentVersion);
            return;
          }

          phase = 'refresh_queries';
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
          if (!isCurrent()) return;
          if (isChatAccessError(error)) {
            await loseAccess();
            return;
          }
          logError('chat_realtime_reconcile_failed', error, {
            phase,
            connection: channel?.state ?? 'absent',
            foreground: AppState.currentState === 'active',
            online: onlineRef.current,
          });
        }
      })().finally(() => {
        validationPromise = null;
      });
      return validationPromise;
    };
    validateRef.current = validateAndReconcile;

    const reconcileMessage = async (
      event: BroadcastEnvelope,
      invalidateUnread: boolean,
    ) => {
      const messageId = getMessageId(event);
      if (!messageId || !isCurrent()) return;

      if (
        invalidateUnread &&
        !consumeCreatedMessageId(seenCreatedMessageIds, messageId)
      )
        return;

      try {
        const message = await fetchChatMessageById(
          messageId,
          controller.signal,
        );
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
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
      if (!messageId || !isCurrent()) return;
      removeChatMessageFromCache(queryClient, messageQueryKey, messageId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: messageQueryKey }),
        queryClient.invalidateQueries({
          queryKey: chatKeys.unread(userId, familyId),
        }),
      ]);
    };

    const subscribe = async () => {
      // The SDK reuses channels by topic until removeChannel finishes.
      await roomRemovalRef.current;
      if (!isCurrent()) return;
      await client.realtime.setAuth();
      if (!isCurrent()) return;
      setRoomConnection('connecting');

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
          if (!isCurrent()) return;

          if (nextStatus === 'SUBSCRIBED') {
            setRoomConnection('subscribed');
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
            setRoomConnection('connecting');
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (!isCurrent()) return;
              void fetchChatChannelVersion(familyId, controller.signal)
                .then((latestVersion) => {
                  if (!isCurrent()) return;
                  if (latestVersion !== channelVersion) {
                    return applyChannelVersion(latestVersion);
                  } else {
                    setRoomConnection('error');
                  }
                })
                .catch(async (error: unknown) => {
                  if (!isCurrent()) return;
                  if (isChatAccessError(error)) {
                    await loseAccess();
                  } else {
                    setRoomConnection('error');
                    logError('chat_channel_version_retry_failed', error);
                  }
                });
            }, staleVersionRetryDelayMs);
            return;
          }

          if (nextStatus === 'TIMED_OUT') {
            setRoomConnection('connecting');
          }
        });
    };

    void subscribe().catch(async (error: unknown) => {
      if (!isCurrent()) return;
      if (isChatAccessError(error)) {
        await loseAccess();
      } else {
        setRoomConnection('error');
        logError('chat_channel_subscribe_failed', error);
      }
    });

    return () => {
      active = false;
      controller.abort();
      validateRef.current = async () => undefined;
      rotationRef.current = async () => undefined;
      if (retryTimer) clearTimeout(retryTimer);
      setConnection((current) =>
        current.topic === topic && current.userId === userId
          ? { status: 'idle', topic: null, userId: null }
          : current,
      );
      if (channel) {
        roomRemovalRef.current = client.removeChannel(channel);
        void roomRemovalRef.current.catch((error: unknown) =>
          logError('chat_channel_cleanup_failed', error),
        );
      }
    };
  }, [channelVersion, controlStatus, enabled, familyId, queryClient, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;

    const client = requireSupabase();
    const controlTopic = `user:${userId}:chat-control`;
    let active = true;
    let controlChannel: RealtimeChannel | null = null;
    const isCurrent = () => active && sessionUserRef.current === userId;
    const updateControl = (status: ChatRealtimeStatus) => {
      if (isCurrent()) setControlConnection({ userId, status });
    };

    const subscribeControl = async () => {
      await controlRemovalRef.current;
      if (!isCurrent()) return;
      await client.realtime.setAuth();
      if (!isCurrent()) return;
      updateControl('connecting');

      controlChannel = client
        .channel(controlTopic, { config: { private: true } })
        .on('broadcast', { event: 'family_chat_channel_rotated' }, (event) => {
          if (!isCurrent()) return;
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
          if (!isCurrent()) return;
          if (status === 'SUBSCRIBED') {
            updateControl('subscribed');
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            updateControl('error');
          }
        });
    };

    void subscribeControl().catch((error: unknown) => {
      if (isCurrent()) {
        updateControl('error');
        logError('chat_control_channel_subscribe_failed', error);
      }
    });

    return () => {
      active = false;
      setControlConnection((current) =>
        current.userId === userId ? { userId: null, status: 'idle' } : current,
      );
      if (controlChannel) {
        controlRemovalRef.current = client.removeChannel(controlChannel);
        void controlRemovalRef.current.catch((error: unknown) =>
          logError('chat_control_channel_cleanup_failed', error),
        );
      }
    };
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    const client = requireSupabase();
    sessionUserRef.current = userId;
    let active = true;
    const deferredValidationTimers = new Set<ReturnType<typeof setTimeout>>();
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (active && nextState === 'active') void validateRef.current();
      },
    );
    const unsubscribeNetwork = NetInfo.addEventListener((networkState) => {
      if (!active) return;
      onlineRef.current =
        networkState.isConnected !== false &&
        networkState.isInternetReachable !== false;
      if (
        networkState.isConnected === true &&
        networkState.isInternetReachable !== false
      ) {
        void validateRef.current();
      }
    });
    const { data: authListener } = client.auth.onAuthStateChange(
      (event, session) => {
        if (!active) return;
        // Auth changes precede React's effect cleanup. Fence old account work
        // immediately without invoking async Supabase calls inside this callback.
        sessionUserRef.current = session?.user.id;
        if (sessionUserRef.current !== userId) return;
        if (event === 'TOKEN_REFRESHED') {
          const timer = setTimeout(() => {
            deferredValidationTimers.delete(timer);
            void validateRef.current();
          }, 0);
          deferredValidationTimers.add(timer);
        }
      },
    );
    const membershipRecheck = setInterval(
      () => void validateRef.current(),
      membershipRecheckIntervalMs,
    );
    return () => {
      active = false;
      appStateSubscription.remove();
      unsubscribeNetwork();
      authListener.subscription.unsubscribe();
      clearInterval(membershipRecheck);
      for (const timer of deferredValidationTimers) clearTimeout(timer);
    };
  }, [enabled, userId]);

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
        : connection.topic === expectedTopic && connection.userId === userId
          ? connection.status
          : 'connecting';

  return { status, validateAndReconcile: () => validateRef.current() };
}

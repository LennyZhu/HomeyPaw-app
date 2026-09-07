import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { familyKeys } from '@/features/family/family-queries';
import { petKeys } from '@/features/pets/pet-queries';
import { logError } from '@/lib/logger';
import { requireSupabase } from '@/lib/supabase/client';

import {
  chatKeys,
  clearChatPetCache,
  fetchChatChannelVersion,
  fetchChatMessageById,
  isChatAccessError,
  mergeChatMessage,
  removeChatMessageFromCache,
} from './chat-queries';

type ChatRealtimeStatus = 'connecting' | 'error' | 'idle' | 'subscribed';
type ChatRealtimeConnection = {
  status: ChatRealtimeStatus;
  topic: string | null;
};

type UseChatRealtimeOptions = {
  channelVersion: number | undefined;
  enabled: boolean;
  onAccessLost: () => void;
  petId: string | null;
  userId: string | undefined;
};

type BroadcastEnvelope = {
  payload?: {
    message_id?: unknown;
    pet_id?: unknown;
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
  petId,
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
  const rotationRef = useRef<(rotatedPetId: string) => Promise<void>>(
    async () => undefined,
  );

  useEffect(() => {
    if (
      !enabled ||
      !petId ||
      !userId ||
      channelVersion === undefined ||
      controlStatus !== 'subscribed'
    )
      return;

    const client = requireSupabase();
    const messageQueryKey = chatKeys.messages(userId, petId);
    const versionQueryKey = chatKeys.version(userId, petId);
    const topic = `pet:${petId}:chat:v${channelVersion}`;
    let active = true;
    let retryAttempted = false;
    let rotationRunning = false;
    let channel: RealtimeChannel | null = null;

    const loseAccess = async () => {
      if (!active) return;
      await queryClient.cancelQueries({ queryKey: chatKeys.all(userId) });
      clearChatPetCache(queryClient, userId, petId);
      queryClient.removeQueries({
        queryKey: familyKeys.members(userId, petId),
      });
      queryClient.removeQueries({ queryKey: petKeys.detail(userId, petId) });
      await queryClient.invalidateQueries({ queryKey: petKeys.all(userId) });
      if (active) onAccessLost();
    };

    const clearRoomCaches = async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: messageQueryKey }),
        queryClient.cancelQueries({
          queryKey: chatKeys.members(userId, petId),
        }),
        queryClient.cancelQueries({
          queryKey: chatKeys.unread(userId, petId),
        }),
      ]);
      queryClient.removeQueries({ queryKey: messageQueryKey });
      queryClient.removeQueries({
        queryKey: chatKeys.members(userId, petId),
      });
      queryClient.removeQueries({
        queryKey: chatKeys.unread(userId, petId),
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

    const reconcileRotation = async (rotatedPetId: string) => {
      if (!active || rotatedPetId !== petId || rotationRunning) return;
      rotationRunning = true;
      setConnection({ status: 'connecting', topic });

      try {
        const nextVersion = await fetchChatChannelVersion(petId);
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
        const currentVersion = await fetchChatChannelVersion(petId);
        if (!active) return;

        if (currentVersion !== channelVersion) {
          await applyChannelVersion(currentVersion);
          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: messageQueryKey }),
          queryClient.invalidateQueries({
            queryKey: chatKeys.members(userId, petId),
          }),
          queryClient.invalidateQueries({
            queryKey: chatKeys.unread(userId, petId),
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

    const reconcileMessage = async (event: BroadcastEnvelope) => {
      const messageId = getMessageId(event);
      if (!messageId || !active) return;

      try {
        const message = await fetchChatMessageById(messageId);
        if (!active) return;
        if (message?.pet_id === petId) {
          mergeChatMessage(queryClient, messageQueryKey, message);
          await queryClient.invalidateQueries({
            queryKey: chatKeys.unread(userId, petId),
          });
        }
      } catch (error) {
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
          queryKey: chatKeys.unread(userId, petId),
        }),
      ]);
    };

    const subscribe = async () => {
      await client.realtime.setAuth();
      if (!active) return;
      setConnection({ status: 'connecting', topic });

      channel = client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'message_created' }, reconcileMessage)
        .on('broadcast', { event: 'message_updated' }, reconcileMessage)
        .on('broadcast', { event: 'message_deleted' }, reconcileDeletion)
        .subscribe((nextStatus) => {
          if (!active) return;

          if (nextStatus === 'SUBSCRIBED') {
            setConnection({ status: 'subscribed', topic });
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: messageQueryKey }),
              queryClient.invalidateQueries({
                queryKey: chatKeys.members(userId, petId),
              }),
              queryClient.invalidateQueries({
                queryKey: chatKeys.unread(userId, petId),
              }),
            ]);
            return;
          }

          if (nextStatus === 'CHANNEL_ERROR' && !retryAttempted) {
            retryAttempted = true;
            setConnection({ status: 'connecting', topic });
            setTimeout(() => {
              void fetchChatChannelVersion(petId)
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
    petId,
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
        .on('broadcast', { event: 'chat_channel_rotated' }, (event) => {
          const rotatedPetId = (event as BroadcastEnvelope).payload?.pet_id;
          if (
            typeof rotatedPetId === 'string' &&
            uuidPattern.test(rotatedPetId)
          ) {
            void rotationRef.current(rotatedPetId);
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
        setTimeout(() => void validateRef.current(), 0);
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
    };
  }, [enabled]);

  const expectedTopic =
    enabled && petId && channelVersion !== undefined
      ? `pet:${petId}:chat:v${channelVersion}`
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

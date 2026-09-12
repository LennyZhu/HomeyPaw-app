import Ionicons from '@expo/vector-icons/Ionicons';
import { onlineManager } from '@tanstack/react-query';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { PetAvatar } from '@/features/pets/components/pet-avatar';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { logError } from '@/lib/logger';
import { lightColors, layout, radius, spacing } from '@/theme';

import {
  getChronologicalMessages,
  isChatAccessError,
  useChatMembers,
  useChatMessages,
  useChatUnreadCount,
  useDeleteChatMessage,
  useMarkChatRead,
  useSendChatMessage,
  useUpdateChatMessage,
  type ChatListMessage,
} from './chat-queries';
import { shouldShowChatInitialLoading } from './chat-presentation';
import { useChatSession } from './chat-session-provider';
import { ChatEditMessageModal } from './components/chat-edit-message-modal';
import { ChatMembersModal } from './components/chat-members-modal';
import { ProductionChatComposer } from './components/production-chat-composer';
import { ProductionChatMessageList } from './components/production-chat-message-list';

export default function ChatScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const pet = petsState.currentPet;
  const petId = pet?.id ?? null;
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ChatListMessage | null>(null);
  const [visibleCursor, setVisibleCursor] = useState<{
    messageId: string;
    petId: string;
  } | null>(null);
  const messageListRef = useRef<FlatList<ChatListMessage>>(null);
  const lastReadRequestRef = useRef<string | null>(null);
  const {
    accessLost: sessionAccessLost,
    isChatActive,
    markAccessLost,
    retryConnection: retrySessionConnection,
    setChatActive,
    status: realtimeStatus,
    versionError,
  } = useChatSession();

  useFocusEffect(
    useCallback(() => {
      setChatActive(true);
      return () => setChatActive(false);
    }, [setChatActive]),
  );

  const onAccessLost = useCallback(() => {
    setIsMembersOpen(false);
    setEditTarget(null);
    markAccessLost();
  }, [markAccessLost]);

  const isSubscribed = realtimeStatus === 'subscribed';
  const messagesQuery = useChatMessages(
    petId,
    isSubscribed && !sessionAccessLost,
  );
  const membersQuery = useChatMembers(
    petId,
    isSubscribed && !sessionAccessLost,
  );
  const unreadQuery = useChatUnreadCount(
    petId,
    isSubscribed && !sessionAccessLost,
  );
  const sendMutation = useSendChatMessage(petId ?? '');
  const updateMutation = useUpdateChatMessage(petId ?? '');
  const deleteMutation = useDeleteChatMessage(petId ?? '');
  const markReadMutation = useMarkChatRead(petId ?? '');
  const messages = useMemo(
    () => getChronologicalMessages(messagesQuery.data),
    [messagesQuery.data],
  );
  const members = membersQuery.data ?? [];
  const currentMember = members.find((member) => member.userId === user?.id);
  const isOwner = currentMember?.role === 'owner';
  const queryError = versionError ?? messagesQuery.error ?? membersQuery.error;
  const accessLost = sessionAccessLost || isChatAccessError(queryError);
  const visibleMessageId =
    visibleCursor?.petId === petId ? visibleCursor.messageId : null;

  useEffect(() => {
    if (!petId || !user || sessionAccessLost || !isChatAccessError(queryError))
      return;

    let active = true;
    void Promise.resolve().then(() => {
      if (active) onAccessLost();
    });
    return () => {
      active = false;
    };
  }, [onAccessLost, petId, queryError, sessionAccessLost, user]);

  useEffect(() => {
    if (
      isChatActive &&
      isSubscribed &&
      unreadQuery.data !== undefined &&
      unreadQuery.data > 0 &&
      visibleMessageId &&
      lastReadRequestRef.current !== `${petId}:${visibleMessageId}` &&
      !markReadMutation.isPending
    ) {
      const requestKey = `${petId}:${visibleMessageId}`;
      lastReadRequestRef.current = requestKey;
      markReadMutation.mutate(visibleMessageId, {
        onError: (error) => {
          if (lastReadRequestRef.current === requestKey) {
            lastReadRequestRef.current = null;
          }
          if (isChatAccessError(error)) onAccessLost();
          else logError('chat_mark_read_failed', error);
        },
      });
    }
  }, [
    isChatActive,
    isSubscribed,
    markReadMutation,
    messages.length,
    onAccessLost,
    petId,
    unreadQuery.data,
    visibleMessageId,
  ]);

  useEffect(() => {
    if (isChatActive && messages.length > 0) {
      const timer = setTimeout(
        () => messageListRef.current?.scrollToEnd({ animated: false }),
        40,
      );
      return () => clearTimeout(timer);
    }
  }, [isChatActive, messages.length, petId]);

  if (petsState.isPending) {
    return <LoadingView label={t('pets.loading.list')} />;
  }

  if (!pet) {
    return (
      <Screen contentContainerStyle={styles.noPetContent}>
        <EmptyState
          actionLabel={t('chat.live.noPet.add')}
          body={t('chat.live.noPet.body')}
          icon="chatbubble-ellipses-outline"
          onActionPress={() => router.push('/pets/new')}
          title={t('chat.live.noPet.title')}
        />
        <AppButton
          label={t('chat.live.noPet.join')}
          onPress={() => router.push('/join-family' as Href)}
          style={styles.secondaryAction}
          variant="secondary"
        />
      </Screen>
    );
  }

  const send = (body: string, clientMessageId = Crypto.randomUUID()) => {
    if (onlineManager.isOnline() === false) {
      Alert.alert(t('chat.live.offline.title'), t('chat.live.offline.body'));
      return false;
    }

    sendMutation.mutate(
      { body, clientMessageId },
      {
        onError: (error) => {
          if (isChatAccessError(error)) onAccessLost();
          else logError('chat_send_failed', error);
        },
      },
    );
    return true;
  };

  const retry = (message: ChatListMessage) => {
    send(message.body, message.client_message_id);
  };

  const remove = (message: ChatListMessage) => {
    deleteMutation.mutate(message.id, {
      onError: (error) => {
        if (isChatAccessError(error)) {
          onAccessLost();
          return;
        }
        logError('chat_delete_failed', error);
        Alert.alert(
          t('chat.live.delete.failedTitle'),
          t('chat.live.delete.failedBody'),
        );
      },
    });
  };

  const edit = (message: ChatListMessage) => {
    updateMutation.reset();
    setEditTarget(message);
  };

  const saveEdit = (body: string) => {
    if (!editTarget) return;
    updateMutation.mutate(
      { body, messageId: editTarget.id },
      {
        onError: (error) => {
          if (isChatAccessError(error)) onAccessLost();
          else logError('chat_update_failed', error);
        },
        onSuccess: () => setEditTarget(null),
      },
    );
  };

  const retryConnection = () => {
    retrySessionConnection();
  };

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable
          accessibilityHint={t('chat.live.header.switchHint')}
          accessibilityLabel={t('chat.live.header.switchPet', {
            name: pet.name,
          })}
          accessibilityRole="button"
          onPress={() => setIsSwitcherOpen(true)}
          style={({ pressed }) => [
            styles.petSelector,
            pressed && styles.pressed,
          ]}
        >
          <PetAvatar
            accessibilityLabel={t('pets.avatar.accessibility', {
              name: pet.name,
            })}
            avatarPath={pet.avatar_path}
            name={pet.name}
            size={44}
          />
          <View style={styles.titleCopy}>
            <AppText
              accessibilityLabel={pet.name}
              accessibilityRole="header"
              ellipsizeMode="tail"
              numberOfLines={1}
              style={styles.petName}
              variant="headline"
            >
              {pet.name}
            </AppText>
            <AppText tone="secondary" variant="caption">
              {t('chat.live.header.subtitle', { count: members.length })}
            </AppText>
          </View>
          <Ionicons
            color={lightColors.textSecondary}
            name="chevron-down"
            size={17}
          />
        </Pressable>

        <Pressable
          accessibilityLabel={t('chat.live.header.members')}
          accessibilityRole="button"
          disabled={!isSubscribed}
          onPress={() => setIsMembersOpen(true)}
          style={({ pressed }) => [
            styles.membersButton,
            !isSubscribed && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={lightColors.secondary}
            name="people-outline"
            size={22}
          />
        </Pressable>
      </View>

      {accessLost ? (
        <View style={styles.flex}>
          <EmptyState
            actionLabel={t('chat.live.accessLost.action')}
            body={t('chat.live.accessLost.body')}
            icon="lock-closed-outline"
            onActionPress={() => router.replace('/')}
            title={t('chat.live.accessLost.title')}
          />
        </View>
      ) : (versionError || realtimeStatus === 'error') &&
        messagesQuery.data === undefined ? (
        <View style={styles.flex}>
          <EmptyState
            actionLabel={t('common.retry')}
            body={t('chat.live.error.body')}
            icon="cloud-offline-outline"
            onActionPress={retryConnection}
            title={t('chat.live.error.title')}
          />
        </View>
      ) : shouldShowChatInitialLoading({
          hasCachedMessages: messagesQuery.data !== undefined,
          messagesPending: messagesQuery.isPending || membersQuery.isPending,
          realtimeStatus,
        }) ? (
        <LoadingView label={t('chat.live.loading')} />
      ) : messages.length === 0 ? (
        <View style={styles.emptyRoom}>
          <EmptyState
            {...(members.length === 1
              ? {
                  actionLabel: t('chat.live.singleMember.action'),
                  onActionPress: () =>
                    router.push(`/pets/${pet.id}/members` as Href),
                }
              : {})}
            body={
              members.length === 1
                ? t('chat.live.singleMember.body')
                : t('chat.live.empty.body')
            }
            icon={
              members.length === 1 ? 'person-add-outline' : 'chatbubble-outline'
            }
            title={
              members.length === 1
                ? t('chat.live.singleMember.title')
                : t('chat.live.empty.title')
            }
          />
        </View>
      ) : (
        <ProductionChatMessageList
          canModerate={isOwner}
          currentUserId={user!.id}
          hasEarlier={messagesQuery.hasNextPage}
          isLoadingEarlier={messagesQuery.isFetchingNextPage}
          members={members}
          messages={messages}
          onDelete={remove}
          onEdit={edit}
          onLoadEarlier={() => void messagesQuery.fetchNextPage()}
          onRetry={retry}
          onVisibleMessageChange={(messageId) => {
            setVisibleCursor({ messageId, petId: pet.id });
          }}
          ref={messageListRef}
        />
      )}

      {!accessLost && isSubscribed ? (
        <ProductionChatComposer
          disabled={realtimeStatus !== 'subscribed'}
          key={pet.id}
          onSend={send}
        />
      ) : null}

      <PetSwitcherModal
        currentPetId={petsState.currentPetId}
        onAddPet={() => {
          setIsSwitcherOpen(false);
          router.push('/pets/new');
        }}
        onClose={() => setIsSwitcherOpen(false)}
        onSelectPet={(nextPetId) => {
          setEditTarget(null);
          petsState.setCurrentPetId(nextPetId);
          setIsSwitcherOpen(false);
        }}
        pets={petsState.pets}
        visible={isSwitcherOpen}
      />

      <ChatMembersModal
        members={members}
        onClose={() => setIsMembersOpen(false)}
        petName={pet.name}
        visible={isMembersOpen}
      />

      {editTarget ? (
        <ChatEditMessageModal
          error={updateMutation.isError}
          isSaving={updateMutation.isPending}
          key={editTarget.id}
          message={editTarget}
          onClose={() => {
            if (!updateMutation.isPending) setEditTarget(null);
          }}
          onSave={saveEdit}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0 },
  noPetContent: { paddingBottom: spacing.huge },
  secondaryAction: { marginBottom: spacing.xxl, marginHorizontal: spacing.xl },
  flex: { flex: 1 },
  header: {
    minHeight: 72,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
  petSelector: {
    minHeight: 52,
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  titleCopy: { flex: 1, gap: 2 },
  petName: { flexShrink: 1 },
  membersButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  emptyRoom: { flex: 1, minHeight: 280 },
  pressed: { opacity: 0.62 },
  disabled: { opacity: 0.45 },
});

import { contentStyles } from '@/components/content-container';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ImageSource } from 'expo-image';
import { forwardRef, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewToken,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { AppButton } from '@/components/app-button';
import { Avatar } from '@/components/avatar';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatChatDateLabel,
  formatChatTime,
  getChatDateOnly,
} from '../chat-date';
import type { ChatListMessage, ChatMemberSummary } from '../chat-queries';

type ProductionChatMessageListProps = {
  canModerate: boolean;
  currentUserId: string;
  hasEarlier: boolean;
  isLoadingEarlier: boolean;
  members: ChatMemberSummary[];
  messages: ChatListMessage[];
  onDelete: (message: ChatListMessage) => void;
  onEdit: (message: ChatListMessage) => void;
  onLoadEarlier: () => void;
  onRetry: (message: ChatListMessage) => void;
  onVisibleMessageChange: (messageId: string) => void;
};

function isConsecutive(
  message: ChatListMessage,
  previous: ChatListMessage | undefined,
) {
  if (!previous || previous.sender_id !== message.sender_id) return false;
  return (
    new Date(message.created_at).getTime() -
      new Date(previous.created_at).getTime() <
    5 * 60_000
  );
}

export const ProductionChatMessageList = forwardRef<
  FlatList<ChatListMessage>,
  ProductionChatMessageListProps
>(function ProductionChatMessageList(
  {
    canModerate,
    currentUserId,
    hasEarlier,
    isLoadingEarlier,
    members,
    messages,
    onDelete,
    onEdit,
    onLoadEarlier,
    onRetry,
    onVisibleMessageChange,
  },
  ref,
) {
  const { i18n, t } = useTranslation();
  const [actionTarget, setActionTarget] = useState<ChatListMessage | null>(
    null,
  );
  const onVisibleMessageChangeRef = useRef(onVisibleMessageChange);
  onVisibleMessageChangeRef.current = onVisibleMessageChange;
  const lastVisibleMessageIdRef = useRef<string | null>(null);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 250,
  }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ChatListMessage>[] }) => {
      const visibleMessages = viewableItems
        .map((token) => token.item)
        .filter((message) => !message.optimistic)
        .sort((left, right) => {
          const timestamp = left.created_at.localeCompare(right.created_at);
          return timestamp || left.id.localeCompare(right.id);
        });
      const latestVisible = visibleMessages.at(-1);
      if (
        latestVisible &&
        latestVisible.id !== lastVisibleMessageIdRef.current
      ) {
        lastVisibleMessageIdRef.current = latestVisible.id;
        onVisibleMessageChangeRef.current(latestVisible.id);
      }
    },
  ).current;
  const memberById = new Map(members.map((member) => [member.userId, member]));

  const confirmDelete = (message: ChatListMessage) => {
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('chat.live.delete.confirmBody'))) {
        onDelete(message);
      }
      return;
    }

    Alert.alert(
      t('chat.live.delete.confirmTitle'),
      t('chat.live.delete.confirmBody'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          onPress: () => onDelete(message),
          style: 'destructive',
          text: t('chat.live.delete.action'),
        },
      ],
    );
  };

  const requestAction = (message: ChatListMessage) => {
    if (message.deliveryState === 'failed') {
      onRetry(message);
      return;
    }

    const canDelete =
      !message.optimistic &&
      (canModerate || message.sender_id === currentUserId);
    const canEdit = !message.optimistic && message.sender_id === currentUserId;
    if (canDelete || canEdit) setActionTarget(message);
  };

  const targetCanEdit = Boolean(
    actionTarget &&
    !actionTarget.optimistic &&
    actionTarget.sender_id === currentUserId,
  );
  const targetCanDelete = Boolean(
    actionTarget &&
    !actionTarget.optimistic &&
    (canModerate || actionTarget.sender_id === currentUserId),
  );

  return (
    <>
      <FlatList
        accessibilityLabel={t('chat.live.accessibility.messageList')}
        contentContainerStyle={styles.listContent}
        data={messages}
        initialNumToRender={24}
        keyExtractor={(item) => item.id}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          hasEarlier ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: isLoadingEarlier }}
              disabled={isLoadingEarlier}
              onPress={onLoadEarlier}
              style={({ pressed }) => [
                styles.loadEarlier,
                pressed && styles.pressed,
              ]}
            >
              {isLoadingEarlier ? (
                <ActivityIndicator color={lightColors.secondary} size="small" />
              ) : (
                <Ionicons
                  color={lightColors.secondary}
                  name="arrow-up-circle-outline"
                  size={17}
                />
              )}
              <AppText tone="secondary" variant="footnote">
                {t('chat.live.loadEarlier')}
              </AppText>
            </Pressable>
          ) : null
        }
        maxToRenderPerBatch={16}
        ref={ref}
        renderItem={({ index, item }) => {
          const previous = messages[index - 1];
          const startsDate =
            !previous ||
            getChatDateOnly(item.created_at) !==
              getChatDateOnly(previous.created_at);
          const consecutive = isConsecutive(item, previous);
          const isOwn = item.sender_id === currentUserId;
          const member = memberById.get(item.sender_id);
          const authorName = isOwn
            ? t('chat.live.accessibility.you')
            : (member?.displayName ?? t('chat.live.formerMember'));
          const time = formatChatTime(item.created_at, i18n.language);
          const canDelete = !item.optimistic && (isOwn || canModerate);
          const canEdit = !item.optimistic && isOwn;
          const canRetry = item.deliveryState === 'failed';
          const actions = [
            ...(canRetry
              ? [{ label: t('chat.live.retry'), name: 'activate' as const }]
              : []),
            ...(canDelete
              ? [
                  {
                    label: t('chat.live.delete.action'),
                    name: 'delete' as const,
                  },
                ]
              : []),
            ...(canEdit
              ? [{ label: t('chat.live.edit.action'), name: 'edit' as const }]
              : []),
          ];

          return (
            <View>
              {startsDate ? (
                <View style={styles.dateDivider}>
                  <View style={styles.dateLine} />
                  <AppText tone="tertiary" variant="caption">
                    {formatChatDateLabel(item.created_at, i18n.language, t)}
                  </AppText>
                  <View style={styles.dateLine} />
                </View>
              ) : null}

              <View
                style={[
                  styles.messageRow,
                  isOwn ? styles.ownRow : styles.otherRow,
                  consecutive && styles.consecutiveRow,
                ]}
              >
                {!isOwn ? (
                  consecutive ? (
                    <View style={styles.avatarSpacer} />
                  ) : (
                    <Avatar
                      accessibilityLabel={t(
                        'chat.live.accessibility.memberAvatar',
                        { name: authorName },
                      )}
                      name={authorName}
                      size={34}
                      source={
                        member?.avatarUrl
                          ? ({ uri: member.avatarUrl } satisfies ImageSource)
                          : undefined
                      }
                    />
                  )
                ) : null}

                <Pressable
                  accessible
                  accessibilityActions={actions}
                  accessibilityHint={
                    canRetry
                      ? t('chat.live.accessibility.retryHint')
                      : canEdit || canDelete
                        ? t('chat.live.accessibility.actionsHint')
                        : undefined
                  }
                  accessibilityLabel={`${authorName}, ${item.body}, ${time}`}
                  accessibilityRole={
                    canRetry || canEdit || canDelete ? 'button' : 'text'
                  }
                  delayLongPress={420}
                  onAccessibilityAction={(event) => {
                    if (
                      event.nativeEvent.actionName === 'activate' &&
                      canRetry
                    ) {
                      onRetry(item);
                    }
                    if (
                      event.nativeEvent.actionName === 'delete' &&
                      canDelete
                    ) {
                      confirmDelete(item);
                    }
                    if (event.nativeEvent.actionName === 'edit' && canEdit) {
                      onEdit(item);
                    }
                  }}
                  onLongPress={() => requestAction(item)}
                  onPress={() => requestAction(item)}
                  style={({ pressed }) => [
                    styles.messageColumn,
                    isOwn ? styles.ownColumn : styles.otherColumn,
                    pressed && (canRetry || canEdit || canDelete)
                      ? styles.actionPressed
                      : null,
                  ]}
                >
                  {!isOwn && !consecutive ? (
                    <AppText
                      style={styles.authorName}
                      tone="secondary"
                      variant="caption"
                    >
                      {authorName}
                    </AppText>
                  ) : null}
                  <View
                    style={[
                      styles.bubble,
                      isOwn ? styles.ownBubble : styles.otherBubble,
                      canRetry && styles.failedBubble,
                    ]}
                  >
                    <AppText style={styles.body}>{item.body}</AppText>
                    <View style={styles.messageMeta}>
                      {item.deliveryState ? (
                        <Ionicons
                          color={
                            canRetry
                              ? lightColors.error
                              : lightColors.textTertiary
                          }
                          name={canRetry ? 'alert-circle' : 'time-outline'}
                          size={13}
                        />
                      ) : null}
                      <AppText tone="tertiary" variant="caption">
                        {canRetry ? t('chat.live.sendFailed') : time}
                      </AppText>
                      {canEdit || canDelete ? (
                        <Ionicons
                          accessibilityElementsHidden
                          color={lightColors.textTertiary}
                          importantForAccessibility="no-hide-descendants"
                          name="ellipsis-horizontal"
                          size={14}
                        />
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              </View>
            </View>
          );
        }}
        removeClippedSubviews={Platform.OS === 'android'}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={9}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setActionTarget(null)}
        transparent
        visible={Boolean(actionTarget)}
      >
        <View style={styles.actionOverlay}>
          <Pressable
            accessibilityLabel={t('common.close')}
            accessibilityRole="button"
            onPress={() => setActionTarget(null)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={styles.actionSheet}>
            <AppText accessibilityRole="header" variant="title3">
              {t('chat.live.actions.title')}
            </AppText>
            {targetCanEdit && actionTarget ? (
              <AppButton
                label={t('chat.live.edit.action')}
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  onEdit(target);
                }}
                variant="secondary"
              />
            ) : null}
            {targetCanDelete && actionTarget ? (
              <AppButton
                label={t('chat.live.delete.action')}
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  confirmDelete(target);
                }}
                variant="danger"
              />
            ) : null}
            <AppButton
              label={t('common.cancel')}
              onPress={() => setActionTarget(null)}
              variant="ghost"
            />
          </View>
        </View>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  loadEarlier: {
    minHeight: 44,
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: 0.62 },
  actionPressed: { opacity: 0.7 },
  dateDivider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  dateLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightColors.border,
    flex: 1,
  },
  messageRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  consecutiveRow: { marginTop: spacing.xs },
  ownRow: { justifyContent: 'flex-end' },
  otherRow: { justifyContent: 'flex-start' },
  avatarSpacer: { width: 34 },
  messageColumn: { flexShrink: 1, maxWidth: '79%' },
  ownColumn: { alignItems: 'flex-end' },
  otherColumn: { alignItems: 'flex-start' },
  authorName: { marginBottom: spacing.xs, marginLeft: spacing.sm },
  bubble: {
    borderRadius: radius.lg,
    gap: spacing.xs,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ownBubble: {
    backgroundColor: lightColors.primarySoft,
    borderBottomRightRadius: radius.sm,
  },
  otherBubble: {
    backgroundColor: lightColors.surface,
    borderBottomLeftRadius: radius.sm,
    borderColor: lightColors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  failedBubble: { borderColor: lightColors.error, borderWidth: 1 },
  body: { flexShrink: 1 },
  messageMeta: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 3,
  },
  actionOverlay: {
    flex: 1,
    backgroundColor: lightColors.overlay,
    justifyContent: 'flex-end',
    padding: spacing.xl,
  },
  actionSheet: {
    ...contentStyles.modal,
    backgroundColor: lightColors.surface,
    borderRadius: radius.xl,
    gap: spacing.sm,
    padding: spacing.xl,
  },
});

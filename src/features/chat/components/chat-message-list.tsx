import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { forwardRef, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatChatDateLabel,
  formatChatTime,
  getChatDateOnly,
} from '../chat-date';
import type { MockChatImage, MockChatMessage } from '../chat-preview-types';

const imageSources: Record<MockChatImage, ImageSource> = {
  cozyMeal: require('@/assets/images/cozy-meal.svg'),
  harbourWalk: require('@/assets/images/harbour-walk.svg'),
  petPortrait: require('@/assets/images/pet-portrait.svg'),
};

type ChatMessageListProps = {
  messages: MockChatMessage[];
  now: Date;
  onContentSizeChange: () => void;
  onLoadEarlier: () => void;
  showLoadEarlier: boolean;
  showTypingIndicator: boolean;
};

function isConsecutiveMessage(
  message: MockChatMessage,
  previous: MockChatMessage | undefined,
) {
  if (
    !previous ||
    !message.authorId ||
    message.authorId !== previous.authorId ||
    message.isOwn !== previous.isOwn ||
    getChatDateOnly(message.createdAt) !== getChatDateOnly(previous.createdAt)
  ) {
    return false;
  }

  const difference =
    new Date(message.createdAt).getTime() -
    new Date(previous.createdAt).getTime();
  return difference >= 0 && difference <= 5 * 60_000;
}

function DateDivider({ createdAt, now }: { createdAt: string; now: Date }) {
  const { i18n, t } = useTranslation();
  const label = formatChatDateLabel(createdAt, i18n.language, t, now);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={styles.dateRow}
    >
      <View style={styles.dividerLine} />
      <AppText style={styles.dateLabel} tone="tertiary" variant="caption">
        {label}
      </AppText>
      <View style={styles.dividerLine} />
    </View>
  );
}

function UnreadDivider() {
  const { t } = useTranslation();

  return (
    <View
      accessibilityLabel={t('chat.preview.unread')}
      accessibilityRole="text"
      style={styles.unreadRow}
    >
      <View style={styles.unreadLine} />
      <AppText style={styles.unreadLabel} tone="brand" variant="caption">
        {t('chat.preview.unread')}
      </AppText>
      <View style={styles.unreadLine} />
    </View>
  );
}

function SystemMessage({ message }: { message: MockChatMessage }) {
  const { i18n, t } = useTranslation();
  const body = message.body ?? (message.bodyKey ? t(message.bodyKey) : '');
  const time = formatChatTime(message.createdAt, i18n.language);
  const icon =
    message.type === 'care'
      ? 'paw-outline'
      : message.type === 'reminder'
        ? 'checkmark-circle-outline'
        : 'people-outline';

  return (
    <View
      accessible
      accessibilityLabel={`${body}, ${time}`}
      accessibilityRole="text"
      style={styles.systemRow}
    >
      <Ionicons color={lightColors.textTertiary} name={icon} size={14} />
      <AppText style={styles.systemText} tone="tertiary" variant="caption">
        {body}
      </AppText>
    </View>
  );
}

function ImageGrid({
  imageIds,
  width,
}: {
  imageIds: MockChatImage[];
  width: number;
}) {
  const { t } = useTranslation();
  const isSingle = imageIds.length === 1;
  const tileWidth = isSingle ? width : (width - spacing.xs) / 2;
  const tileHeight = isSingle ? Math.min(190, width * 0.72) : tileWidth;

  return (
    <View style={[styles.imageGrid, { width }]}>
      {imageIds.map((imageId, index) => (
        <Image
          accessibilityLabel={t('chat.preview.accessibility.image', {
            count: imageIds.length,
            index: index + 1,
          })}
          contentFit="cover"
          key={`${imageId}-${index}`}
          source={imageSources[imageId]}
          style={{
            borderRadius: isSingle ? radius.md : radius.sm,
            height: tileHeight,
            width: tileWidth,
          }}
        />
      ))}
    </View>
  );
}

function HumanMessage({
  consecutive,
  message,
}: {
  consecutive: boolean;
  message: MockChatMessage;
}) {
  const { i18n, t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const body = message.body ?? (message.bodyKey ? t(message.bodyKey) : '');
  const time = formatChatTime(message.createdAt, i18n.language);
  const authorName = message.isOwn
    ? t('chat.preview.accessibility.you')
    : message.authorNameKey
      ? t(message.authorNameKey)
      : '';
  const imageIds = message.imageIds ?? [];
  const imageWidth = Math.min(276, screenWidth * 0.68);
  const accessibilityBody = imageIds.length
    ? t('chat.preview.accessibility.imageMessage', {
        body,
        count: imageIds.length,
      })
    : body;

  return (
    <View
      style={[
        styles.messageRow,
        message.isOwn ? styles.ownRow : styles.otherRow,
        consecutive && styles.consecutiveRow,
      ]}
    >
      {!message.isOwn ? (
        consecutive ? (
          <View style={styles.avatarSpacer} />
        ) : (
          <Avatar
            accessibilityLabel={t('chat.preview.accessibility.memberAvatar', {
              name: authorName,
            })}
            name={authorName}
            size={34}
          />
        )
      ) : null}

      <View
        accessible
        accessibilityLabel={`${authorName}, ${accessibilityBody}, ${time}`}
        accessibilityRole="text"
        style={[
          styles.messageColumn,
          message.isOwn ? styles.ownColumn : styles.otherColumn,
        ]}
      >
        {!message.isOwn && !consecutive ? (
          <AppText style={styles.authorName} tone="secondary" variant="caption">
            {authorName}
          </AppText>
        ) : null}
        <View
          style={[
            styles.bubble,
            message.isOwn ? styles.ownBubble : styles.otherBubble,
            imageIds.length > 0 && styles.imageBubble,
          ]}
        >
          {imageIds.length > 0 ? (
            <ImageGrid imageIds={imageIds} width={imageWidth} />
          ) : null}
          <AppText style={styles.messageBody}>{body}</AppText>
          <AppText
            style={message.isOwn ? styles.ownTime : styles.otherTime}
            tone="tertiary"
            variant="caption"
          >
            {time}
          </AppText>
        </View>
      </View>
    </View>
  );
}

function MessageItem({
  index,
  message,
  messages,
  now,
}: {
  index: number;
  message: MockChatMessage;
  messages: MockChatMessage[];
  now: Date;
}) {
  const previous = messages[index - 1];
  const startsDate =
    !previous ||
    getChatDateOnly(message.createdAt) !== getChatDateOnly(previous.createdAt);
  const isSystem = ['system', 'care', 'reminder'].includes(message.type);

  return (
    <>
      {startsDate ? (
        <DateDivider createdAt={message.createdAt} now={now} />
      ) : null}
      {message.startsUnread ? <UnreadDivider /> : null}
      {isSystem ? (
        <SystemMessage message={message} />
      ) : (
        <HumanMessage
          consecutive={isConsecutiveMessage(message, previous)}
          message={message}
        />
      )}
    </>
  );
}

function TypingIndicator() {
  const { t } = useTranslation();

  return (
    <View
      accessible
      accessibilityLabel={t('chat.preview.typing')}
      accessibilityRole="text"
      style={styles.typingRow}
    >
      <View style={styles.avatarSpacer} />
      <View style={styles.typingBubble}>
        <View style={styles.typingDots}>
          <View style={styles.dot} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
        <AppText tone="tertiary" variant="caption">
          {t('chat.preview.typing')}
        </AppText>
      </View>
    </View>
  );
}

export const ChatMessageList = forwardRef<
  FlatList<MockChatMessage>,
  ChatMessageListProps
>(function ChatMessageList(
  {
    messages,
    now,
    onContentSizeChange,
    onLoadEarlier,
    showLoadEarlier,
    showTypingIndicator,
  },
  ref,
) {
  const { t } = useTranslation();
  const listFooter = useMemo(
    () =>
      showTypingIndicator ? (
        <TypingIndicator />
      ) : (
        <View style={styles.footerSpace} />
      ),
    [showTypingIndicator],
  );

  return (
    <FlatList
      accessibilityLabel={t('chat.preview.accessibility.messageList')}
      contentContainerStyle={styles.listContent}
      data={messages}
      initialNumToRender={18}
      keyExtractor={(item) => item.id}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      ListFooterComponent={listFooter}
      ListHeaderComponent={
        showLoadEarlier ? (
          <Pressable
            accessibilityRole="button"
            onPress={onLoadEarlier}
            style={({ pressed }) => [
              styles.loadEarlier,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              color={lightColors.secondary}
              name="arrow-up-circle-outline"
              size={17}
            />
            <AppText tone="secondary" variant="footnote">
              {t('chat.preview.loadEarlier')}
            </AppText>
          </Pressable>
        ) : null
      }
      maxToRenderPerBatch={14}
      onContentSizeChange={onContentSizeChange}
      ref={ref}
      renderItem={({ index, item }) => (
        <MessageItem
          index={index}
          message={item}
          messages={messages}
          now={now}
        />
      )}
      showsVerticalScrollIndicator={false}
      style={styles.list}
      updateCellsBatchingPeriod={30}
      windowSize={7}
    />
  );
});

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  dateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginTop: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightColors.border,
  },
  dateLabel: {
    backgroundColor: lightColors.background,
    paddingHorizontal: spacing.xs,
  },
  unreadRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  unreadLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightColors.primary,
  },
  unreadLabel: {
    paddingHorizontal: spacing.xs,
  },
  systemRow: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginBottom: spacing.xl,
    maxWidth: '86%',
    paddingHorizontal: spacing.md,
  },
  systemText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  messageRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  consecutiveRow: {
    marginTop: -spacing.sm,
  },
  ownRow: {
    justifyContent: 'flex-end',
  },
  otherRow: {
    justifyContent: 'flex-start',
  },
  avatarSpacer: {
    width: 34,
  },
  messageColumn: {
    maxWidth: '80%',
  },
  ownColumn: {
    alignItems: 'flex-end',
  },
  otherColumn: {
    alignItems: 'flex-start',
  },
  authorName: {
    marginBottom: spacing.xs,
    marginLeft: spacing.sm,
  },
  bubble: {
    borderRadius: radius.md,
    maxWidth: '100%',
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
  imageBubble: {
    gap: spacing.sm,
    padding: spacing.xs,
    paddingBottom: spacing.sm,
  },
  messageBody: {
    flexShrink: 1,
  },
  ownTime: {
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  otherTime: {
    marginTop: spacing.xs,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  typingRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  typingBubble: {
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  typingDots: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    width: 5,
    height: 5,
    backgroundColor: lightColors.textTertiary,
    borderRadius: radius.full,
  },
  loadEarlier: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  footerSpace: {
    height: spacing.xs,
  },
});

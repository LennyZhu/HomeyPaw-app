import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, layout, radius, spacing, typography } from '@/theme';

const MESSAGE_LIMIT = 2000;
const COMPOSER_MAX_FONT_SCALE = 1.8;

type ChatComposerProps = {
  autoFocus?: boolean;
  onAttachmentPress: () => void;
  onSend: (body: string) => void;
  petId: string;
};

export function ChatComposer({
  autoFocus = false,
  onAttachmentPress,
  onSend,
  petId,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const trimmedDraft = draft.trim();
  const canSend = trimmedDraft.length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(trimmedDraft);
    setDraft('');
  };

  return (
    <View
      key={petId}
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <Pressable
        accessibilityHint={t('chat.preview.composer.attachmentHint')}
        accessibilityLabel={t('chat.preview.composer.attachment')}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onAttachmentPress}
        style={({ pressed }) => [
          styles.attachmentButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons color={lightColors.secondary} name="add" size={25} />
      </Pressable>

      <View style={styles.inputWrap}>
        <TextInput
          accessibilityLabel={t('chat.preview.composer.inputLabel')}
          autoFocus={autoFocus}
          maxLength={MESSAGE_LIMIT}
          maxFontSizeMultiplier={COMPOSER_MAX_FONT_SCALE}
          multiline
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder={t('chat.preview.composer.placeholder')}
          placeholderTextColor={lightColors.textTertiary}
          returnKeyType="default"
          scrollEnabled
          style={styles.input}
          textAlignVertical="center"
          value={draft}
        />
        {draft.length >= 1800 ? (
          <AppText
            accessibilityLabel={t('chat.preview.composer.charactersRemaining', {
              count: MESSAGE_LIMIT - draft.length,
            })}
            style={styles.characterCount}
            tone="tertiary"
            variant="caption"
          >
            {draft.length}/{MESSAGE_LIMIT}
          </AppText>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel={t('chat.preview.composer.send')}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={send}
        style={({ pressed }) => [
          styles.sendButton,
          !canSend && styles.sendDisabled,
          pressed && canSend && styles.sendPressed,
        ]}
      >
        <Ionicons color={lightColors.onPrimary} name="arrow-up" size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-end',
    backgroundColor: lightColors.surface,
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  attachmentButton: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
    marginBottom: 2,
  },
  inputWrap: {
    flex: 1,
  },
  input: {
    minHeight: 44,
    maxHeight: typography.body.lineHeight * 5 + spacing.md,
    backgroundColor: lightColors.background,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    color: lightColors.textPrimary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  characterCount: {
    marginRight: spacing.md,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  sendButton: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: lightColors.primary,
    borderRadius: radius.full,
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendDisabled: {
    backgroundColor: lightColors.textTertiary,
    opacity: 0.46,
  },
  sendPressed: {
    backgroundColor: lightColors.primaryPressed,
    transform: [{ scale: 0.96 }],
  },
  pressed: {
    opacity: 0.62,
  },
});

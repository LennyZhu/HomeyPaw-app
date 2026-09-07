import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, layout, radius, spacing, typography } from '@/theme';

const messageLimit = 2000;

type ProductionChatComposerProps = {
  disabled?: boolean;
  onSend: (body: string) => boolean;
};

export function ProductionChatComposer({
  disabled = false,
  onSend,
}: ProductionChatComposerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const trimmedDraft = draft.trim();
  const canSend = !disabled && trimmedDraft.length > 0;

  const send = () => {
    if (!canSend) return;
    if (onSend(trimmedDraft)) setDraft('');
  };

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <View style={styles.inputWrap}>
        <TextInput
          accessibilityLabel={t('chat.live.composer.inputLabel')}
          editable={!disabled}
          maxLength={messageLimit}
          multiline
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder={t('chat.live.composer.placeholder')}
          placeholderTextColor={lightColors.textTertiary}
          returnKeyType="default"
          scrollEnabled
          style={styles.input}
          textAlignVertical="center"
          value={draft}
        />
        {draft.length >= 1800 ? (
          <AppText
            accessibilityLabel={t('chat.live.composer.charactersRemaining', {
              count: messageLimit - draft.length,
            })}
            accessibilityLiveRegion="polite"
            style={styles.characterCount}
            tone="tertiary"
            variant="caption"
          >
            {draft.length}/{messageLimit}
          </AppText>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel={t('chat.live.composer.send')}
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
  inputWrap: { flex: 1 },
  input: {
    minHeight: layout.minimumTouchTarget,
    maxHeight: typography.body.lineHeight * 6 + spacing.lg,
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
  sendDisabled: { backgroundColor: lightColors.textTertiary, opacity: 0.46 },
  sendPressed: {
    backgroundColor: lightColors.primaryPressed,
    transform: [{ scale: 0.96 }],
  },
});

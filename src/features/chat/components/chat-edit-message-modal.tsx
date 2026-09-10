import { useState } from 'react';
import { Modal, StyleSheet, TextInput, View } from 'react-native';
import { ModalScreen } from '@/components/modal-screen';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';

import type { ChatListMessage } from '../chat-queries';

const messageLimit = 2000;

type ChatEditMessageModalProps = {
  error: boolean;
  isSaving: boolean;
  message: ChatListMessage;
  onClose: () => void;
  onSave: (body: string) => void;
};

export function ChatEditMessageModal({
  error,
  isSaving,
  message,
  onClose,
  onSave,
}: ChatEditMessageModalProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState(message.body);
  const normalizedBody = body.trim();
  const canSave =
    !isSaving && normalizedBody.length > 0 && normalizedBody !== message.body;

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!isSaving) onClose();
      }}
      presentationStyle="pageSheet"
      visible
    >
      <ModalScreen contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <AppText accessibilityRole="header" variant="title2">
            {t('chat.live.edit.title')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t('chat.live.edit.body')}
          </AppText>
        </View>

        <TextInput
          accessibilityLabel={t('chat.live.edit.inputLabel')}
          autoFocus
          editable={!isSaving}
          maxLength={messageLimit}
          multiline
          onChangeText={setBody}
          style={styles.input}
          textAlignVertical="top"
          value={body}
        />

        <AppText
          accessibilityLiveRegion="polite"
          style={styles.characterCount}
          tone={error ? 'error' : 'tertiary'}
          variant="caption"
        >
          {error
            ? t('chat.live.edit.failed')
            : t('chat.live.edit.charactersRemaining', {
                count: messageLimit - body.length,
              })}
        </AppText>

        <View style={styles.actions}>
          <AppButton
            disabled={isSaving}
            label={t('common.cancel')}
            onPress={onClose}
            style={styles.action}
            variant="secondary"
          />
          <AppButton
            disabled={!canSave}
            label={t('chat.live.edit.save')}
            loading={isSaving}
            onPress={() => onSave(normalizedBody)}
            style={styles.action}
          />
        </View>
      </ModalScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    paddingTop: spacing.xl,
    backgroundColor: lightColors.background,
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  header: { gap: spacing.xs },
  input: {
    minHeight: 180,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    color: lightColors.textPrimary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    padding: spacing.lg,
  },
  characterCount: { textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});

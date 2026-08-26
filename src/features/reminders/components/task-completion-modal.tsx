import { useState } from 'react';
import { Modal, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';
import type { CareType } from '@/types/database';

type Props = {
  careType: CareType | null;
  isCompleting: boolean;
  onClose: () => void;
  onComplete: (input: {
    durationMinutes: number | null;
    note: string | null;
  }) => Promise<void>;
  title: string;
  visible: boolean;
};

export function TaskCompletionModal({
  careType,
  isCompleting,
  onClose,
  onComplete,
  title,
  visible,
}: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');

  const submit = async () => {
    const durationValue = duration ? Number(duration) : null;
    if (
      durationValue !== null &&
      (!Number.isInteger(durationValue) ||
        durationValue < 1 ||
        durationValue > 1440)
    ) {
      return;
    }
    await onComplete({
      durationMinutes: durationValue,
      note: note.trim() || null,
    });
    setNote('');
    setDuration('');
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <AppText accessibilityRole="header" variant="title1">
            {t('reminders.complete.title')}
          </AppText>
          <AppText tone="secondary">{title}</AppText>

          {careType === 'walk' ? (
            <View style={styles.field}>
              <AppText variant="subheadline">
                {t('care.fields.duration')}
              </AppText>
              <TextInput
                keyboardType="number-pad"
                maxLength={4}
                onChangeText={setDuration}
                placeholder={t('care.form.durationPlaceholder')}
                placeholderTextColor={lightColors.textTertiary}
                style={styles.input}
                value={duration}
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <AppText variant="subheadline">
              {t('reminders.complete.note')}
            </AppText>
            <TextInput
              maxLength={200}
              multiline
              onChangeText={setNote}
              placeholder={t('reminders.complete.notePlaceholder')}
              placeholderTextColor={lightColors.textTertiary}
              style={[styles.input, styles.note]}
              textAlignVertical="top"
              value={note}
            />
          </View>

          <View style={styles.actions}>
            <AppButton
              disabled={isCompleting}
              label={t('common.cancel')}
              onPress={onClose}
              variant="secondary"
            />
            <AppButton
              label={t('reminders.complete.action')}
              loading={isCompleting}
              onPress={() => void submit()}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: lightColors.background },
  content: { gap: spacing.xl, padding: spacing.xl, paddingTop: spacing.xxxl },
  field: { gap: spacing.sm },
  input: {
    minHeight: 50,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    color: lightColors.textPrimary,
    paddingHorizontal: spacing.lg,
    ...typography.body,
  },
  note: { minHeight: 100, paddingTop: spacing.md },
  actions: { gap: spacing.md },
});

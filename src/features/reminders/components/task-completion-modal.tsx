import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ModalScreen } from '@/components/modal-screen';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';
import type { CareType } from '@/types/database';
import { CareDateTimeField } from '@/features/care/components/care-date-time-field';
import { isValidActualCareTime } from '@/features/schedule/care-completion-time';

type Props = {
  careType: CareType | null;
  scheduledFor?: string;
  timeZone?: string;
  isCompleting: boolean;
  onClose: () => void;
  onComplete: (input: {
    durationMinutes: number | null;
    note: string | null;
    occurredAt?: string | null;
  }) => Promise<void>;
  title: string;
  visible: boolean;
};

export function TaskCompletionModal({
  careType,
  scheduledFor,
  timeZone,
  isCompleting,
  onClose,
  onComplete,
  title,
  visible,
}: Props) {
  const { t, i18n } = useTranslation();
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');
  const [timeChoice, setTimeChoice] = useState<
    'planned' | 'now' | 'other' | null
  >(null);
  const [customTime, setCustomTime] = useState(() => new Date().toISOString());
  const actualTime =
    timeChoice === 'planned'
      ? scheduledFor
      : timeChoice === 'now'
        ? null // The server records the first successful completion time.
        : timeChoice === 'other'
          ? customTime
          : undefined;
  const validTime =
    !scheduledFor ||
    timeChoice === 'now' ||
    Boolean(actualTime && isValidActualCareTime(actualTime));
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));

  const submit = async () => {
    if (isCompleting || !validTime) return;
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
      ...(scheduledFor && actualTime !== undefined
        ? { occurredAt: actualTime }
        : {}),
    });
    setNote('');
    setDuration('');
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!isCompleting) onClose();
      }}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <ModalScreen contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" variant="title1">
          {t('reminders.complete.title')}
        </AppText>
        <AppText tone="secondary">{title}</AppText>

        {scheduledFor ? (
          <View style={styles.field}>
            <AppText tone="secondary" variant="footnote">
              {t('reminders.complete.actualTime.planned', {
                time: formatTime(scheduledFor),
              })}
            </AppText>
            <AppText variant="subheadline">
              {t('reminders.complete.actualTime.question')}
            </AppText>
            {(['planned', 'now', 'other'] as const).map((choice) => {
              const disabled =
                isCompleting ||
                (choice === 'planned' && !isValidActualCareTime(scheduledFor));
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: timeChoice === choice,
                    disabled,
                  }}
                  disabled={disabled}
                  key={choice}
                  onPress={() => setTimeChoice(choice)}
                  style={({ pressed }) => [
                    styles.timeChoice,
                    disabled && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.radio,
                      timeChoice === choice && styles.radioSelected,
                    ]}
                  />
                  <View style={styles.choiceCopy}>
                    <AppText>
                      {t(`reminders.complete.actualTime.${choice}Choice`)}
                    </AppText>
                    {choice !== 'other' ? (
                      <AppText tone="secondary" variant="footnote">
                        {choice === 'planned'
                          ? formatTime(scheduledFor)
                          : t('reminders.complete.actualTime.nowHint')}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
            {!isValidActualCareTime(scheduledFor) ? (
              <AppText tone="secondary" variant="footnote">
                {t('reminders.complete.actualTime.futurePlanned')}
              </AppText>
            ) : null}
            {timeChoice === 'other' ? (
              <CareDateTimeField
                allowFutureMinutes={0}
                error={
                  isValidActualCareTime(customTime)
                    ? undefined
                    : t('reminders.complete.actualTime.invalid')
                }
                label={t('care.fields.occurredAt')}
                onChange={setCustomTime}
                timeZone={timeZone}
                value={customTime}
              />
            ) : null}
          </View>
        ) : null}

        {careType === 'walk' ? (
          <View style={styles.field}>
            <AppText variant="subheadline">{t('care.fields.duration')}</AppText>
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
            disabled={!validTime}
            label={t('reminders.complete.action')}
            loading={isCompleting}
            onPress={() => void submit()}
          />
        </View>
      </ModalScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  timeChoice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceCopy: { flex: 1, gap: spacing.xs },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: lightColors.border,
  },
  radioSelected: { borderColor: lightColors.primary, borderWidth: 6 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.62 },
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

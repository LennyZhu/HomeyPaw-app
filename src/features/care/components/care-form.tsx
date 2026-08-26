import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';
import type { CareType } from '@/types/database';

import { createCareFormSchema, type CareFormValues } from '../care-schema';
import { careTypeIcons } from '../care-types';
import { CareDateTimeField } from './care-date-time-field';

type Props = {
  careType: CareType;
  initialValues: CareFormValues;
  onSubmit: (values: CareFormValues) => Promise<void>;
  petName: string;
  submitError?: string | null;
  submitLabel: string;
};

const durationShortcuts = [15, 30, 45, 60];

export function CareForm({
  careType,
  initialValues,
  onSubmit,
  petName,
  submitError,
  submitLabel,
}: Props) {
  const { t } = useTranslation();
  const schema = useMemo(
    () => createCareFormSchema(t, careType),
    [careType, t],
  );
  const {
    control,
    formState: { isSubmitting },
    handleSubmit,
    reset,
  } = useForm<CareFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
  });

  useEffect(() => reset(initialValues), [initialValues, reset]);
  const submit = handleSubmit(onSubmit);

  return (
    <View style={styles.form}>
      <View style={styles.summary}>
        <View style={styles.icon}>
          <Ionicons
            color={lightColors.secondary}
            name={careTypeIcons[careType]}
            size={28}
          />
        </View>
        <View style={styles.summaryCopy}>
          <AppText variant="title2">{t(`care.types.${careType}`)}</AppText>
          <AppText tone="secondary" variant="footnote">
            {petName}
          </AppText>
        </View>
      </View>

      {submitError ? <AppText tone="error">{submitError}</AppText> : null}

      <Controller
        control={control}
        name="occurredAt"
        render={({ field, fieldState }) => (
          <CareDateTimeField
            error={fieldState.error?.message}
            label={t('care.fields.occurredAt')}
            onChange={field.onChange}
            value={field.value}
          />
        )}
      />

      {careType === 'walk' ? (
        <Controller
          control={control}
          name="durationMinutes"
          render={({ field, fieldState }) => (
            <View style={styles.field}>
              <AppText variant="subheadline">
                {t('care.fields.duration')}
              </AppText>
              <View style={styles.shortcuts}>
                {durationShortcuts.map((minutes) => (
                  <Pressable
                    accessibilityRole="button"
                    key={minutes}
                    onPress={() => field.onChange(String(minutes))}
                    style={({ pressed }) => [
                      styles.shortcut,
                      field.value === String(minutes) &&
                        styles.shortcutSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppText
                      tone={
                        field.value === String(minutes) ? 'brand' : 'secondary'
                      }
                      variant="footnote"
                    >
                      {t('care.durationMinutes', { count: minutes })}
                    </AppText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel={t('care.fields.duration')}
                keyboardType="number-pad"
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                placeholder={t('care.form.durationPlaceholder')}
                placeholderTextColor={lightColors.textTertiary}
                style={[styles.input, fieldState.error && styles.inputError]}
                value={field.value}
              />
              {fieldState.error ? (
                <AppText tone="error" variant="footnote">
                  {fieldState.error.message}
                </AppText>
              ) : null}
            </View>
          )}
        />
      ) : null}

      <Controller
        control={control}
        name="note"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <AppText variant="subheadline">{t('care.fields.note')}</AppText>
              <AppText tone="tertiary" variant="footnote">
                {careType === 'other'
                  ? t('care.form.required')
                  : t('care.form.optional')}
              </AppText>
            </View>
            <TextInput
              accessibilityLabel={t('care.fields.note')}
              maxLength={500}
              multiline
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              placeholder={t('care.form.notePlaceholder')}
              placeholderTextColor={lightColors.textTertiary}
              style={[
                styles.input,
                styles.noteInput,
                fieldState.error && styles.inputError,
              ]}
              textAlignVertical="top"
              value={field.value}
            />
            {fieldState.error ? (
              <AppText tone="error" variant="footnote">
                {fieldState.error.message}
              </AppText>
            ) : null}
          </View>
        )}
      />

      <AppButton
        label={submitLabel}
        loading={isSubmitting}
        onPress={() => void submit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.xl },
  summary: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  summaryCopy: { flex: 1, gap: spacing.xxs },
  icon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  field: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
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
  inputError: { borderColor: lightColors.error },
  noteInput: { minHeight: 112, paddingTop: spacing.md },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  shortcut: {
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  shortcutSelected: {
    backgroundColor: lightColors.primarySoft,
    borderColor: lightColors.primary,
  },
  pressed: { opacity: 0.62 },
});

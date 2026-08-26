import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { careTypeIcons } from '@/features/care/care-types';
import { lightColors, radius, spacing, typography } from '@/theme';
import type { CareTaskScheduleType } from '@/types/database';

import {
  createCareTaskFormSchema,
  type CareTaskFormValues,
  type CareTaskKind,
} from '../care-task-schema';
import { TaskDateTimeFields } from './task-date-time-fields';

type Props = {
  initialValues: CareTaskFormValues;
  onSubmit: (values: CareTaskFormValues) => Promise<void>;
  submitError?: string | null;
  submitLabel: string;
  timeZone: string;
};

const taskKinds: CareTaskKind[] = [
  'feeding',
  'walk',
  'medicine',
  'bath',
  'grooming',
  'custom',
];
const scheduleTypes: CareTaskScheduleType[] = [
  'once',
  'daily',
  'weekly',
  'monthly',
];
const weekDays = [1, 2, 3, 4, 5, 6, 7];

export function CareTaskForm({
  initialValues,
  onSubmit,
  submitError,
  submitLabel,
  timeZone,
}: Props) {
  const { t } = useTranslation();
  const schema = useMemo(
    () => createCareTaskFormSchema(t, timeZone),
    [t, timeZone],
  );
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    reset,
  } = useForm<CareTaskFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
  });
  const scheduleType = useWatch({ control, name: 'scheduleType' });

  useEffect(() => reset(initialValues), [initialValues, reset]);
  const submit = handleSubmit(onSubmit);

  return (
    <View style={styles.form}>
      {submitError ? <AppText tone="error">{submitError}</AppText> : null}

      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <Field label={t('reminders.fields.title')}>
            <TextInput
              accessibilityLabel={t('reminders.fields.title')}
              maxLength={100}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              placeholder={t('reminders.form.titlePlaceholder')}
              placeholderTextColor={lightColors.textTertiary}
              style={[styles.input, fieldState.error && styles.inputError]}
              value={field.value}
            />
            <FieldError message={fieldState.error?.message} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="careType"
        render={({ field }) => (
          <Field label={t('reminders.fields.type')}>
            <View style={styles.chips}>
              {taskKinds.map((kind) => (
                <ChoiceChip
                  icon={careTypeIcons[kind === 'custom' ? 'other' : kind]}
                  key={kind}
                  label={
                    kind === 'custom'
                      ? t('reminders.types.custom')
                      : t(`care.types.${kind}`)
                  }
                  onPress={() => field.onChange(kind)}
                  selected={field.value === kind}
                />
              ))}
            </View>
          </Field>
        )}
      />

      <Controller
        control={control}
        name="scheduleType"
        render={({ field }) => (
          <Field label={t('reminders.fields.repeat')}>
            <View style={styles.chips}>
              {scheduleTypes.map((type) => (
                <ChoiceChip
                  key={type}
                  label={t(`reminders.schedule.${type}`)}
                  onPress={() => field.onChange(type)}
                  selected={field.value === type}
                />
              ))}
            </View>
          </Field>
        )}
      />

      <View>
        <Controller
          control={control}
          name="date"
          render={({ field: dateField }) => (
            <Controller
              control={control}
              name="localTime"
              render={({ field: timeField }) => (
                <TaskDateTimeFields
                  date={dateField.value}
                  dateLabel={
                    scheduleType === 'once'
                      ? t('reminders.fields.date')
                      : t('reminders.fields.startsOn')
                  }
                  onDateChange={dateField.onChange}
                  onTimeChange={timeField.onChange}
                  time={timeField.value}
                  timeLabel={t('reminders.fields.time')}
                />
              )}
            />
          )}
        />
        <FieldError
          message={errors.date?.message ?? errors.localTime?.message}
        />
      </View>

      {scheduleType === 'weekly' ? (
        <Controller
          control={control}
          name="weekDay"
          render={({ field, fieldState }) => (
            <Field label={t('reminders.fields.weekDay')}>
              <View style={styles.chips}>
                {weekDays.map((day) => (
                  <ChoiceChip
                    key={day}
                    label={t(`reminders.weekDays.${day}`)}
                    onPress={() => field.onChange(String(day))}
                    selected={field.value === String(day)}
                  />
                ))}
              </View>
              <FieldError message={fieldState.error?.message} />
            </Field>
          )}
        />
      ) : null}

      {scheduleType === 'monthly' ? (
        <Controller
          control={control}
          name="monthDay"
          render={({ field, fieldState }) => (
            <Field label={t('reminders.fields.monthDay')}>
              <TextInput
                accessibilityLabel={t('reminders.fields.monthDay')}
                keyboardType="number-pad"
                maxLength={2}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                placeholder="1–31"
                placeholderTextColor={lightColors.textTertiary}
                style={[styles.input, fieldState.error && styles.inputError]}
                value={field.value}
              />
              <AppText tone="tertiary" variant="footnote">
                {t('reminders.form.monthDayHint')}
              </AppText>
              <FieldError message={fieldState.error?.message} />
            </Field>
          )}
        />
      ) : null}

      <Controller
        control={control}
        name="note"
        render={({ field, fieldState }) => (
          <Field label={t('reminders.fields.note')}>
            <TextInput
              accessibilityLabel={t('reminders.fields.note')}
              maxLength={300}
              multiline
              onBlur={field.onBlur}
              onChangeText={field.onChange}
              placeholder={t('reminders.form.notePlaceholder')}
              placeholderTextColor={lightColors.textTertiary}
              style={[
                styles.input,
                styles.noteInput,
                fieldState.error && styles.inputError,
              ]}
              textAlignVertical="top"
              value={field.value}
            />
            <FieldError message={fieldState.error?.message} />
          </Field>
        )}
      />

      <View style={styles.timeZoneNote}>
        <Ionicons
          color={lightColors.textTertiary}
          name="globe-outline"
          size={16}
        />
        <AppText tone="tertiary" variant="footnote">
          {t('reminders.form.timeZone', { timeZone })}
        </AppText>
      </View>

      <AppButton
        label={submitLabel}
        loading={isSubmitting}
        onPress={() => void submit()}
      />
    </View>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      {children}
    </View>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <AppText tone="error" variant="footnote">
      {message}
    </AppText>
  ) : null;
}

function ChoiceChip({
  icon,
  label,
  onPress,
  selected,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <Ionicons
          color={selected ? lightColors.primary : lightColors.textSecondary}
          name={icon}
          size={17}
        />
      ) : null}
      <AppText tone={selected ? 'brand' : 'secondary'} variant="footnote">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.xl },
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
  inputError: { borderColor: lightColors.error },
  noteInput: { minHeight: 100, paddingTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 42,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  chipSelected: {
    backgroundColor: lightColors.primarySoft,
    borderColor: lightColors.primary,
  },
  timeZoneNote: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  pressed: { opacity: 0.62 },
});

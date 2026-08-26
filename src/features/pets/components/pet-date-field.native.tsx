import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';

import { formatDateOnly, parseDateOnly, toDateOnly } from '../pet-dates';

type PetDateFieldProps = {
  label: string;
  onChange: (value: string) => void;
  value: string;
  error?: string | undefined;
};

export function PetDateField({
  label,
  onChange,
  value,
  error,
}: PetDateFieldProps) {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = parseDateOnly(value) ?? new Date();

  const handleValueChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    if (Platform.OS === 'android') {
      setIsOpen(false);
    }

    onChange(toDateOnly(date));
  };

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={() => setIsOpen((open) => !open)}
        style={({ pressed }) => [
          styles.control,
          error && styles.controlError,
          pressed && styles.pressed,
        ]}
      >
        <AppText tone={value ? 'primary' : 'tertiary'}>
          {formatDateOnly(value, i18n.language) ?? t('pets.form.selectDate')}
        </AppText>
      </Pressable>
      {value ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange('')}
          style={styles.clearButton}
        >
          <AppText tone="brand" variant="footnote">
            {t('pets.form.clearDate')}
          </AppText>
        </Pressable>
      ) : null}
      {isOpen ? (
        <DateTimePicker
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={new Date()}
          mode="date"
          onDismiss={() => setIsOpen(false)}
          onValueChange={handleValueChange}
          value={selectedDate}
        />
      ) : null}
      {error ? (
        <AppText tone="error" variant="footnote">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  control: {
    minHeight: 50,
    justifyContent: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  controlError: {
    borderColor: lightColors.error,
  },
  clearButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.62,
  },
});

import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import {
  formatDateOnly,
  parseDateOnly,
  toDateOnly,
} from '@/features/pets/pet-dates';
import { lightColors, radius, spacing } from '@/theme';

type Props = {
  label: string;
  onChange: (value: string) => void;
  value: string;
};

export function JournalDateField({ label, onChange, value }: Props) {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = parseDateOnly(value) ?? new Date();
  const maximumDate = useMemo(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  }, []);
  const handleChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    onChange(toDateOnly(date));
    if (Platform.OS === 'android') setIsOpen(false);
  };

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          accessibilityLabel={label}
          display="compact"
          maximumDate={maximumDate}
          mode="date"
          onValueChange={handleChange}
          value={selectedDate}
        />
      ) : (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={() => setIsOpen(true)}
          style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        >
          <AppText>{formatDateOnly(value, i18n.language)}</AppText>
        </Pressable>
      )}
      {Platform.OS === 'android' && isOpen ? (
        <DateTimePicker
          display="default"
          maximumDate={maximumDate}
          mode="date"
          onDismiss={() => setIsOpen(false)}
          onValueChange={handleChange}
          value={selectedDate}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  control: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  pressed: { opacity: 0.62 },
});

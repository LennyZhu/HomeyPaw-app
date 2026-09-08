import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatCalendarDate,
  parseCalendarDate,
  toCalendarDate,
} from '../calendar-date';

type Props = {
  error?: string | undefined;
  label: string;
  onChange: (value: string) => void;
  value: string;
};

function localDate(value: string) {
  const parts = parseCalendarDate(value);
  return parts
    ? new Date(parts.year, parts.month - 1, parts.day, 12)
    : new Date();
}

export function ScheduleDateField({ error, label, onChange, value }: Props) {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = localDate(value);
  const minimumDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);

  const handleChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    if (Platform.OS === 'android') setIsOpen(false);
    onChange(
      toCalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    );
  };

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          display="compact"
          minimumDate={minimumDate}
          mode="date"
          onValueChange={handleChange}
          value={selectedDate}
        />
      ) : (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={() => setIsOpen(true)}
          style={({ pressed }) => [
            styles.control,
            error && styles.controlError,
            pressed && styles.pressed,
          ]}
        >
          <AppText>{formatCalendarDate(value, i18n.language)}</AppText>
        </Pressable>
      )}
      {Platform.OS === 'android' && isOpen ? (
        <DateTimePicker
          display="default"
          minimumDate={minimumDate}
          mode="date"
          onDismiss={() => setIsOpen(false)}
          onValueChange={handleChange}
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
  field: { gap: spacing.sm },
  control: {
    minHeight: 50,
    justifyContent: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  controlError: { borderColor: lightColors.error },
  pressed: { opacity: 0.62 },
});

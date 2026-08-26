import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';

type Props = {
  error?: string | undefined;
  label: string;
  onChange: (value: string) => void;
  value: string;
};

export function CareDateTimeField({ error, label, onChange, value }: Props) {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [androidMode, setAndroidMode] = useState<'date' | 'time'>('date');
  const [maximumDate, setMaximumDate] = useState(
    () => new Date(Date.now() + 5 * 60_000),
  );
  const selectedDate = Number.isFinite(Date.parse(value))
    ? new Date(value)
    : new Date();

  const handleChange = (_event: DateTimePickerChangeEvent, date: Date) => {
    if (Platform.OS === 'android' && androidMode === 'date') {
      const next = new Date(selectedDate);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      onChange(next.toISOString());
      setAndroidMode('time');
      return;
    }
    onChange(date.toISOString());
    if (Platform.OS === 'android') {
      setAndroidMode('date');
      setIsOpen(false);
    }
  };

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={() => {
          setMaximumDate(new Date(Date.now() + 5 * 60_000));
          setAndroidMode('date');
          setIsOpen((open) => !open);
        }}
        style={({ pressed }) => [
          styles.control,
          error && styles.controlError,
          pressed && styles.pressed,
        ]}
      >
        <AppText>
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(selectedDate)}
        </AppText>
      </Pressable>
      {isOpen ? (
        <DateTimePicker
          display={Platform.OS === 'ios' ? 'compact' : 'default'}
          maximumDate={maximumDate}
          mode={Platform.OS === 'ios' ? 'datetime' : androidMode}
          onDismiss={() => {
            setAndroidMode('date');
            setIsOpen(false);
          }}
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

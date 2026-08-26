import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { parseDateOnly, toDateOnly } from '@/features/pets/pet-dates';
import { lightColors, radius, spacing } from '@/theme';

type Props = {
  date: string;
  dateLabel: string;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  time: string;
  timeLabel: string;
};

function timeValue(value: string) {
  const [hour = '9', minute = '0'] = value.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date;
}

export function TaskDateTimeFields({
  date,
  dateLabel,
  onDateChange,
  onTimeChange,
  time,
  timeLabel,
}: Props) {
  const { i18n } = useTranslation();
  const [androidMode, setAndroidMode] = useState<'date' | 'time' | null>(null);
  const selectedDate = parseDateOnly(date) ?? new Date();
  const selectedTime = useMemo(() => timeValue(time), [time]);
  const minimumDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);

  return (
    <View style={styles.fields}>
      <View style={styles.field}>
        <AppText variant="subheadline">{dateLabel}</AppText>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            display="compact"
            minimumDate={minimumDate}
            mode="date"
            onValueChange={(_event: DateTimePickerChangeEvent, value: Date) =>
              onDateChange(toDateOnly(value))
            }
            value={selectedDate}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAndroidMode('date')}
            style={styles.control}
          >
            <AppText>
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
              }).format(selectedDate)}
            </AppText>
          </Pressable>
        )}
      </View>
      <View style={styles.field}>
        <AppText variant="subheadline">{timeLabel}</AppText>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            display="compact"
            mode="time"
            onValueChange={(_event: DateTimePickerChangeEvent, value: Date) =>
              onTimeChange(
                `${value.getHours().toString().padStart(2, '0')}:${value
                  .getMinutes()
                  .toString()
                  .padStart(2, '0')}`,
              )
            }
            value={selectedTime}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAndroidMode('time')}
            style={styles.control}
          >
            <AppText>{time}</AppText>
          </Pressable>
        )}
      </View>
      {Platform.OS === 'android' && androidMode ? (
        <DateTimePicker
          display="default"
          {...(androidMode === 'date' ? { minimumDate } : {})}
          mode={androidMode}
          onDismiss={() => setAndroidMode(null)}
          onValueChange={(_event: DateTimePickerChangeEvent, value: Date) => {
            if (androidMode === 'date') {
              onDateChange(toDateOnly(value));
            } else {
              onTimeChange(
                `${value.getHours().toString().padStart(2, '0')}:${value
                  .getMinutes()
                  .toString()
                  .padStart(2, '0')}`,
              );
            }
            setAndroidMode(null);
          }}
          value={androidMode === 'date' ? selectedDate : selectedTime}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
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
});

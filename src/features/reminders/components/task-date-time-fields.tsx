import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';

type Props = {
  date: string;
  dateLabel: string;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  time: string;
  timeLabel: string;
};

export function TaskDateTimeFields(props: Props) {
  return (
    <View style={styles.fields}>
      <View style={styles.field}>
        <AppText variant="subheadline">{props.dateLabel}</AppText>
        <TextInput
          onChangeText={props.onDateChange}
          placeholder="YYYY-MM-DD"
          style={styles.input}
          value={props.date}
        />
      </View>
      <View style={styles.field}>
        <AppText variant="subheadline">{props.timeLabel}</AppText>
        <TextInput
          onChangeText={props.onTimeChange}
          placeholder="HH:mm"
          style={styles.input}
          value={props.time}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
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
});

import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';

type Props = {
  label: string;
  onChange: (value: string) => void;
  value: string;
};

export function JournalDateField({ label, onChange, value }: Props) {
  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="numeric"
        maxLength={10}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={lightColors.textTertiary}
        style={styles.control}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  control: {
    minHeight: 48,
    color: lightColors.textPrimary,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    ...typography.body,
  },
});

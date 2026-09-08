import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';

type Props = {
  error?: string | undefined;
  label: string;
  onChange: (value: string) => void;
  value: string;
};

export function ScheduleDateField({ error, label, onChange, value }: Props) {
  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={lightColors.textTertiary}
        style={[styles.input, error && styles.inputError]}
        value={value}
      />
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
});

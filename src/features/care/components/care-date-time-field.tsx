import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';

type Props = {
  error?: string | undefined;
  label: string;
  onChange: (value: string) => void;
  value: string;
};

function toLocalInputValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function CareDateTimeField({ error, label, onChange, value }: Props) {
  const [draft, setDraft] = useState(() => toLocalInputValue(value));

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        onBlur={() => {
          const date = new Date(draft);
          if (Number.isFinite(date.getTime())) {
            onChange(date.toISOString());
          } else {
            setDraft(toLocalInputValue(value));
          }
        }}
        onChangeText={setDraft}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={lightColors.textTertiary}
        style={[styles.input, error && styles.inputError]}
        value={draft}
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

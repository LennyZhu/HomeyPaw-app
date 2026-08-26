import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useState } from 'react';
import type { TextInputProps } from 'react-native';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';

type AuthFieldProps = TextInputProps & {
  label: string;
  error?: string | undefined;
  secureToggleLabel?: string | undefined;
};

export const AuthField = forwardRef<TextInput, AuthFieldProps>(
  function AuthField(
    { error, label, secureTextEntry, secureToggleLabel, style, ...props },
    ref,
  ) {
    const [isSecure, setIsSecure] = useState(Boolean(secureTextEntry));
    const hasSecureToggle = Boolean(secureTextEntry && secureToggleLabel);

    return (
      <View style={styles.field}>
        <AppText variant="subheadline">{label}</AppText>
        <View style={[styles.inputWrap, error && styles.inputWrapError]}>
          <TextInput
            accessibilityLabel={label}
            autoCapitalize="none"
            placeholderTextColor={lightColors.textTertiary}
            ref={ref}
            secureTextEntry={hasSecureToggle ? isSecure : secureTextEntry}
            selectionColor={lightColors.primary}
            style={[styles.input, style]}
            {...props}
          />
          {hasSecureToggle ? (
            <Pressable
              accessibilityLabel={secureToggleLabel}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setIsSecure((value) => !value)}
              style={styles.eyeButton}
            >
              <Ionicons
                color={lightColors.textSecondary}
                name={isSecure ? 'eye-outline' : 'eye-off-outline'}
                size={21}
              />
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <AppText
            accessibilityLiveRegion="polite"
            tone="error"
            variant="footnote"
          >
            {error}
          </AppText>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  inputWrap: {
    minHeight: 52,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
  },
  inputWrapError: {
    borderColor: lightColors.error,
  },
  input: {
    ...typography.body,
    color: lightColors.textPrimary,
    flex: 1,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  eyeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
});

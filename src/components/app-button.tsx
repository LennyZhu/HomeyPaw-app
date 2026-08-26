import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { lightColors, radius, spacing, typography } from '@/theme';

import { AppText } from './app-text';

type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: AppButtonVariant;
};

const variantStyles = {
  primary: {
    background: lightColors.primary,
    pressed: lightColors.primaryPressed,
    textTone: 'onPrimary' as const,
  },
  secondary: {
    background: lightColors.secondarySoft,
    pressed: '#D6E2D8',
    textTone: 'primary' as const,
  },
  ghost: {
    background: 'transparent',
    pressed: lightColors.surfaceSecondary,
    textTone: 'brand' as const,
  },
  danger: {
    background: lightColors.error,
    pressed: '#963636',
    textTone: 'onPrimary' as const,
  },
};

export function AppButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
  icon,
  loading = false,
  style,
  variant = 'primary',
}: AppButtonProps) {
  const palette = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? palette.pressed : palette.background },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'primary' || variant === 'danger'
              ? lightColors.onPrimary
              : lightColors.primary
          }
        />
      ) : (
        <View style={styles.content}>
          {icon}
          <AppText style={typography.headline} tone={palette.textTone}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.48,
  },
});

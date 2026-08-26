import type { TextProps } from 'react-native';
import { Text } from 'react-native';

import { lightColors, typography, type TypographyVariant } from '@/theme';

type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'brand'
  | 'success'
  | 'warning'
  | 'error'
  | 'onPrimary';

const toneColors: Record<TextTone, string> = {
  primary: lightColors.textPrimary,
  secondary: lightColors.textSecondary,
  tertiary: lightColors.textTertiary,
  brand: lightColors.primary,
  success: lightColors.success,
  warning: lightColors.warning,
  error: lightColors.error,
  onPrimary: lightColors.onPrimary,
};

type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
};

export function AppText({
  variant = 'body',
  tone = 'primary',
  style,
  allowFontScaling = true,
  ...props
}: AppTextProps) {
  return (
    <Text
      allowFontScaling={allowFontScaling}
      style={[typography[variant], { color: toneColors[tone] }, style]}
      {...props}
    />
  );
}

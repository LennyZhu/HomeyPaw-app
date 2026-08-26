import { lightColors } from './colors';
import { layout } from './layout';
import { radius } from './radius';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { typography } from './typography';

export const lightTheme = {
  colors: lightColors,
  layout,
  radius,
  shadows,
  spacing,
  typography,
} as const;

export type AppTheme = typeof lightTheme;

export { lightColors, layout, radius, shadows, spacing, typography };
export type { ThemeColors } from './colors';
export type { TypographyVariant } from './typography';

export const lightColors = {
  background: '#FBF7F2',
  surface: '#FFFFFF',
  surfaceSecondary: '#F3ECE5',
  textPrimary: '#302B27',
  textSecondary: '#675F59',
  textTertiary: '#8C827A',
  primary: '#C9604F',
  primaryPressed: '#A94B3E',
  primarySoft: '#F7E3DD',
  onPrimary: '#FFFFFF',
  secondary: '#6F8C78',
  secondarySoft: '#E4ECE5',
  border: '#E5DDD5',
  success: '#3F7D59',
  warning: '#A96D22',
  error: '#B74444',
  tabActive: '#B95243',
  tabInactive: '#91877F',
  overlay: 'rgba(48, 43, 39, 0.42)',
} as const;

export type ThemeColors = typeof lightColors;

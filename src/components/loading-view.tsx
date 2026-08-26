import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { lightColors, spacing } from '@/theme';

import { AppText } from './app-text';

type LoadingViewProps = {
  label: string;
};

export function LoadingView({ label }: LoadingViewProps) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={styles.container}
    >
      <ActivityIndicator color={lightColors.primary} />
      <AppText tone="secondary" variant="subheadline">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 180,
  },
});

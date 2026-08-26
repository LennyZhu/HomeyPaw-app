import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';

type FormMessageProps = {
  message: string;
  tone?: 'error' | 'success';
};

export function FormMessage({ message, tone = 'error' }: FormMessageProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.message, tone === 'error' ? styles.error : styles.success]}
    >
      <AppText tone={tone} variant="subheadline">
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  message: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  error: {
    backgroundColor: '#F9E7E7',
    borderColor: lightColors.error,
    borderWidth: StyleSheet.hairlineWidth,
  },
  success: {
    backgroundColor: '#E6F1E9',
    borderColor: lightColors.success,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

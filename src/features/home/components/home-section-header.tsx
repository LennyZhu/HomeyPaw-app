import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { spacing } from '@/theme';

type Props = {
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  title: string;
};

export function HomeSectionHeader({ action, onAction, title }: Props) {
  return (
    <View style={styles.heading}>
      <AppText style={styles.title} variant="title2">
        {title}
      </AppText>
      {action && onAction ? (
        <Pressable
          accessibilityLabel={action}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText tone="brand" variant="footnote">
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  title: { flex: 1 },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
  pressed: { opacity: 0.65 },
});

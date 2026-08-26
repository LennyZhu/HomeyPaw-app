import { Pressable, StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';

import { AppText } from './app-text';

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

export function SectionHeader({
  title,
  actionLabel,
  onActionPress,
}: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <AppText accessibilityRole="header" variant="title3">
        {title}
      </AppText>
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onActionPress}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText tone="brand" variant="subheadline">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: layout.minimumTouchTarget,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  action: {
    minHeight: layout.minimumTouchTarget,
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
  pressed: {
    opacity: 0.58,
  },
});

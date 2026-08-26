import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { lightColors, radius, spacing } from '@/theme';

import { AppButton } from './app-button';
import { AppText } from './app-text';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type EmptyStateProps = {
  body: string;
  icon: IoniconName;
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

export function EmptyState({
  body,
  icon,
  title,
  actionLabel,
  onActionPress,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons color={lightColors.secondary} name={icon} size={30} />
      </View>
      <AppText
        accessibilityRole="header"
        style={styles.centerText}
        variant="title2"
      >
        {title}
      </AppText>
      <AppText style={styles.body} tone="secondary">
        {body}
      </AppText>
      {actionLabel && onActionPress ? (
        <AppButton
          label={actionLabel}
          onPress={onActionPress}
          style={styles.button}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  centerText: {
    textAlign: 'center',
  },
  body: {
    maxWidth: 310,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xxl,
  },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { lightColors, spacing } from '@/theme';

import { AppText } from './app-text';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type SettingsRowProps = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  busy?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: IoniconName;
  last?: boolean;
  subtitle?: string | undefined;
};

export function SettingsRow({
  label,
  onPress,
  accessibilityLabel,
  busy = false,
  danger = false,
  disabled = false,
  icon,
  last = false,
  subtitle,
}: SettingsRowProps) {
  const unavailable = busy || disabled;
  const color = danger ? lightColors.error : lightColors.textPrimary;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.divider,
        pressed && styles.pressed,
        unavailable && styles.disabled,
      ]}
    >
      {icon ? <Ionicons color={color} name={icon} size={20} /> : null}
      <View style={styles.copy}>
        <AppText tone={danger ? 'error' : 'primary'} variant="body">
          {label}
        </AppText>
        {subtitle ? (
          <AppText tone="secondary" variant="footnote">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Ionicons
          color={danger ? lightColors.error : lightColors.textTertiary}
          name="chevron-forward"
          size={18}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: {
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});

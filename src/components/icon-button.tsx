import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { AccessibilityValue, StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';

import { lightColors, layout, radius } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type IconButtonProps = {
  accessibilityLabel: string;
  accessibilityValue?: AccessibilityValue;
  icon: IoniconName;
  onPress: () => void;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  accessibilityLabel,
  accessibilityValue,
  icon,
  onPress,
  color = lightColors.textPrimary,
  size = 22,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityValue={accessibilityValue}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}
    >
      <Ionicons color={color} name={icon} size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: lightColors.surfaceSecondary,
    transform: [{ scale: 0.96 }],
  },
});

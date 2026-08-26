import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { lightColors, layout, radius, shadows, spacing } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type TabIconProps = {
  color: ColorValue;
  focused: boolean;
  name: IoniconName;
  nameFocused: IoniconName;
  size: number;
};

function TabIcon({ color, focused, name, nameFocused, size }: TabIconProps) {
  return (
    <Ionicons color={color} name={focused ? nameFocused : name} size={size} />
  );
}

function CreateTabIcon() {
  return (
    <View style={styles.createIcon}>
      <Ionicons color={lightColors.onPrimary} name="add" size={29} />
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: lightColors.tabActive,
        tabBarInactiveTintColor: lightColors.tabInactive,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarStyle: [
          styles.tabBar,
          {
            height: Math.max(60, layout.tabBarBaseHeight + insets.bottom),
            paddingBottom: Math.max(insets.bottom, spacing.sm),
          },
        ],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarAccessibilityLabel: t('tabs.home'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIcon
              color={color}
              focused={focused}
              name="home-outline"
              nameFocused="home"
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: t('tabs.journal'),
          tabBarAccessibilityLabel: t('tabs.journal'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIcon
              color={color}
              focused={focused}
              name="book-outline"
              nameFocused="book"
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tabs.create'),
          tabBarAccessibilityLabel: t('tabs.create'),
          tabBarIcon: CreateTabIcon,
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarAccessibilityLabel: t('tabs.profile'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIcon
              color={color}
              focused={focused}
              name="person-outline"
              nameFocused="person"
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: lightColors.surface,
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  createIcon: {
    width: 50,
    height: 50,
    alignItems: 'center',
    backgroundColor: lightColors.primary,
    borderRadius: radius.full,
    justifyContent: 'center',
    transform: [{ translateY: -5 }],
    ...shadows.floating,
  },
});

import { Stack } from 'expo-router';

import { appScreenOrientation } from '@/config/orientation';

export const unstable_settings = {
  initialRouteName: 'sign-in',
};

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, orientation: appScreenOrientation }}
    />
  );
}

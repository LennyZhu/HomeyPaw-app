import { Stack } from 'expo-router';

import { appScreenOrientation } from '@/config/orientation';

export default function RemindersLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, orientation: appScreenOrientation }}
    />
  );
}

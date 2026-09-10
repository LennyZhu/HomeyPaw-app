import { Stack } from 'expo-router';

import { appScreenOrientation } from '@/config/orientation';

export default function CareLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, orientation: appScreenOrientation }}
    />
  );
}

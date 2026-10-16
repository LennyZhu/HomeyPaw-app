import { Redirect } from 'expo-router';

import FamilyPlusScreen from '@/features/billing/family-plus-screen';
import { canUseFamilyPlusPreview } from '@/features/billing/family-plus-preview';

export default function FamilyPlusRoute() {
  if (!canUseFamilyPlusPreview(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL))
    return <Redirect href="/" />;
  return <FamilyPlusScreen />;
}

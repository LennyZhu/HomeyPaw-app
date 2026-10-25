import { Redirect } from 'expo-router';

import FamilyPlusScreen from '@/features/billing/family-plus-screen';
import { isFamilyPlusAvailable } from '@/features/billing/family-plus-environment';

export default function FamilyPlusRoute() {
  if (!isFamilyPlusAvailable()) return <Redirect href="/" />;
  return <FamilyPlusScreen />;
}

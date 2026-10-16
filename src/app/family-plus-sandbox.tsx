import { Redirect } from 'expo-router';
import { isBillingSandboxEnabled } from '@/features/billing/billing-client';
import FamilyPlusSandboxScreen from '@/features/billing/family-plus-sandbox-screen';

export default function FamilyPlusSandboxRoute() {
  if (!isBillingSandboxEnabled()) return <Redirect href="/" />;
  return <FamilyPlusSandboxScreen />;
}

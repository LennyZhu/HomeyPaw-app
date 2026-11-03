import { Redirect } from 'expo-router';
import { canUseBillingTestAccount } from '@/features/billing/billing-test-account';
import BillingTestAccountScreen from '@/features/billing/billing-test-account-screen';

export default function BillingTestAccountRoute() {
  if (!canUseBillingTestAccount()) return <Redirect href="/sign-in" />;
  return <BillingTestAccountScreen />;
}

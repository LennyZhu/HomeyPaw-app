import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { getAppVersionHeaders } from '@/features/app-release/minimum-version';
import { requireSupabase } from '@/lib/supabase/client';
import type { Json } from '@/types/database';
import {
  canUseBillingSandbox,
  canUseBillingSigning,
} from './billing-sandbox-gate';

export type BillingState = {
  tier: 'free' | 'transition' | 'plus';
  limit_bytes: number;
  video_limit: number | null;
  sandbox_enabled: boolean;
  has_subscription: boolean;
  purchase_blocked: boolean;
  pending_intent: boolean;
};
type PurchaseIntent = {
  intent_id: string;
  customer_id: string;
  product_id: string;
  status: string;
};
export type BillingOutcome = 'confirmed' | 'pending' | 'cancelled' | 'failed';
let busy = false;

export function isBillingSandboxEnabled() {
  return canUseBillingSandbox({
    development: __DEV__,
    platform: Platform.OS,
    enabled: process.env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    allowedHost: process.env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_HOST,
    targetMode: process.env.EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE,
    projectRef: process.env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF,
  });
}
function assertEnabled() {
  if (!isBillingSandboxEnabled()) throw new Error('BILLING_SANDBOX_DISABLED');
}
function object(data: Json): Record<string, Json | undefined> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('BILLING_INVALID_RESPONSE');
  return data;
}
export async function readFamilyBillingState(
  familyId: string,
): Promise<BillingState> {
  assertEnabled();
  const { data, error } = await requireSupabase().rpc(
    'get_family_billing_state',
    { target_family_id: familyId },
  );
  if (error) throw error;
  const value = object(data);
  if (
    !['free', 'transition', 'plus'].includes(String(value.tier)) ||
    typeof value.limit_bytes !== 'number'
  )
    throw new Error('BILLING_INVALID_RESPONSE');
  return value as unknown as BillingState;
}
async function assertAccount(userId: string) {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || data.user?.id !== userId)
    throw new Error('BILLING_ACCOUNT_CHANGED');
}
async function nativeCustomer(userId: string) {
  assertEnabled();
  // EAS internal Dev Clients are Ad Hoc signed. Neither an editable env flag
  // nor provisioning alone admits an ordinary release build.
  if (
    !canUseBillingSigning(
      __DEV__,
      Boolean(requireOptionalNativeModule('ExpoDevLauncher')),
      await Application.getIosApplicationReleaseTypeAsync(),
    )
  )
    throw new Error('BILLING_DEVELOPMENT_BUILD_REQUIRED');
  await assertAccount(userId);
  const key = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY;
  if (!key?.startsWith('appl_'))
    throw new Error('BILLING_SANDBOX_NOT_CONFIGURED');
  const { data: customerId, error } = await requireSupabase().rpc(
    'get_family_billing_customer',
  );
  if (error) throw error;
  // Dynamic import lets the rest of the App keep running in an old Dev Client
  // that does not yet contain RNPurchases. This screen reports build/config error.
  const { default: purchases, STOREKIT_VERSION } =
    await import('react-native-purchases');
  if (!(await purchases.isConfigured()))
    purchases.configure({
      apiKey: key,
      appUserID: customerId,
      storeKitVersion: STOREKIT_VERSION.STOREKIT_2,
    });
  else if ((await purchases.getAppUserID()) !== customerId)
    await purchases.logIn(customerId);
  // Wait for the identified customer to exist at RevenueCat before server
  // reconciliation. CustomerInfo is not used to grant Family rights.
  await purchases.getCustomerInfo();
  return { purchases, customerId };
}
async function exclusive<T>(operation: () => Promise<T>) {
  if (busy) throw new Error('BILLING_OPERATION_IN_PROGRESS');
  busy = true;
  try {
    return await operation();
  } finally {
    busy = false;
  }
}
export function loadSandboxPackages(userId: string) {
  return exclusive(async () => {
    const { purchases } = await nativeCustomer(userId);
    const offerings = await purchases.getOfferings();
    return (
      offerings.current?.availablePackages.filter(
        (p) => p.packageType === 'MONTHLY' || p.packageType === 'ANNUAL',
      ) ?? []
    );
  });
}
export async function reconcileBilling(): Promise<'confirmed' | 'pending'> {
  assertEnabled();
  const { data, error } = await requireSupabase().functions.invoke(
    'family-billing-reconcile',
    { body: {}, headers: getAppVersionHeaders() },
  );
  if (error || !['reconciled', 'empty'].includes(data?.status))
    return 'pending';
  return 'confirmed';
}
export function purchaseFamilyPlus(
  userId: string,
  familyId: string,
  item: PurchasesPackage,
): Promise<BillingOutcome> {
  return exclusive(async () => {
    const { purchases, customerId } = await nativeCustomer(userId);
    // Recover known server state before asking for a new purchase intent.
    const { data: preflight, error: preflightError } =
      await requireSupabase().functions.invoke('family-billing-reconcile', {
        body: { operation: 'purchase_preflight' },
        headers: getAppVersionHeaders(),
      });
    if (
      preflightError ||
      preflight?.status !== 'purchase_ready' ||
      preflight.family_id !== familyId
    )
      throw new Error('BILLING_RECONCILIATION_REQUIRED');
    const { data, error } = await requireSupabase().rpc(
      'begin_family_billing_purchase',
      {
        target_family_id: familyId,
        request_id: Crypto.randomUUID(),
        period: item.packageType === 'ANNUAL' ? 'yearly' : 'monthly',
      },
    );
    if (error) throw error;
    const raw = object(data);
    if (
      typeof raw.intent_id !== 'string' ||
      raw.customer_id !== customerId ||
      raw.product_id !== item.product.identifier ||
      raw.status !== 'prepared'
    )
      throw new Error('BILLING_INTENT_CONFLICT');
    const intent = raw as unknown as PurchaseIntent;
    const { error: pendingError } = await requireSupabase().rpc(
      'update_family_billing_intent',
      { target_intent_id: intent.intent_id, next_status: 'store_pending' },
    );
    if (pendingError) throw pendingError;
    await assertAccount(userId);
    try {
      await purchases.purchasePackage(item);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const codes = purchases.PURCHASES_ERROR_CODE;
      if (code === codes.PAYMENT_PENDING_ERROR) return 'pending';
      if (code === codes.PURCHASE_CANCELLED_ERROR) {
        await requireSupabase().rpc('update_family_billing_intent', {
          target_intent_id: intent.intent_id,
          next_status: 'cancelled',
        });
        return 'cancelled';
      }
      // Network/provider errors may follow an actual store charge. Keep the
      // intent pending rather than inviting a duplicate purchase; reconcile it.
      return 'failed';
    }
    await assertAccount(userId);
    await reconcileBilling();
    const state = await readFamilyBillingState(familyId);
    return state.tier === 'plus' ? 'confirmed' : 'pending';
  });
}
export function restoreFamilyPlus(userId: string): Promise<BillingOutcome> {
  return exclusive(async () => {
    const { purchases } = await nativeCustomer(userId);
    await purchases.restorePurchases();
    await assertAccount(userId);
    // Restore never creates a new Family claim or uses a Family ID as identity.
    return reconcileBilling();
  });
}
export function manageAppleSubscription(userId: string) {
  return exclusive(async () => {
    const { purchases } = await nativeCustomer(userId);
    await purchases.showManageSubscriptions();
  });
}

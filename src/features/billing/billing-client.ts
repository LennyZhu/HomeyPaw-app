import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { getAppVersionHeaders } from '@/features/app-release/minimum-version';
import { requireSupabase as requireDefaultSupabase } from '@/lib/supabase/client';
import { supabaseEnvironment } from '@/lib/supabase/environment';
import type { Json } from '@/types/database';
import {
  canUseBillingSandbox,
  canUseBillingSigning,
} from './billing-sandbox-gate';
import { isFamilyPlusRelease as isDefaultRelease } from './family-plus-environment';

export const familyPlusProducts = {
  monthly: 'homeypaw.familyplus.monthly',
  yearly: 'homeypaw.familyplus.yearly',
} as const;
export type BillingState = {
  tier: 'free' | 'transition' | 'plus';
  limit_bytes: number;
  video_limit: number | null;
  sandbox_enabled: boolean;
  billing_enabled: boolean;
  has_subscription: boolean;
  purchase_blocked: boolean;
  pending_intent: boolean;
  environment: 'SANDBOX' | 'PRODUCTION';
};
export type BillingOutcome =
  'confirmed' | 'pending' | 'cancelled' | 'failed' | 'nothingToRestore';
let busy = false;
export function isBillingSandboxEnabled() {
  return canUseBillingSandbox({
    development: __DEV__,
    buildTarget: process.env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET,
    platform: Platform.OS,
    enabled: process.env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED,
    supabaseUrl: supabaseEnvironment.url,
    allowedHost: process.env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_HOST,
    targetMode: process.env.EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE,
    projectRef: process.env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF,
  });
}
export const isFamilyBillingEnabled = () =>
  isBillingSandboxEnabled() || (Platform.OS === 'ios' && isDefaultRelease());

export type FamilyBillingOptions = {
  getClient: typeof requireDefaultSupabase;
  environment: 'SANDBOX' | 'PRODUCTION';
  enabled: () => boolean;
  storeBuild: boolean;
  applePublicKey: () => string | undefined;
  authorize: () => Promise<void>;
};
// One implementation, independently scoped authentication. The SDK operation
// lock remains module-wide because RevenueCat's native instance is shared.
export function createFamilyBillingClient(options?: FamilyBillingOptions) {
  const requireSupabase = options ? options.getClient : requireDefaultSupabase;
  const isFamilyPlusRelease = () =>
    options ? options.environment === 'PRODUCTION' : isDefaultRelease();
  const billingEnabled = () =>
    options
      ? options.enabled() && Platform.OS === 'ios'
      : isFamilyBillingEnabled();
  let authUser: string | null | undefined;
  let revision = 0;

  // Synchronous invalidation on logout/account changes. Keep only identified RC
  // users: SDK logOut would create an anonymous identity that can later be aliased.
  // No SDK operation is permitted until getUser verifies the next signed-in user.
  function setBillingAuthUser(userId: string | null) {
    if (authUser !== userId) {
      authUser = userId;
      revision++;
    }
  }
  function assertEnabled() {
    if (!billingEnabled()) throw new Error('BILLING_SANDBOX_DISABLED');
  }
  function object(data: Json): Record<string, Json | undefined> {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('BILLING_INVALID_RESPONSE');
    return data;
  }
  async function readFamilyBillingState(
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
      value.environment !== (isFamilyPlusRelease() ? 'PRODUCTION' : 'SANDBOX')
    )
      throw new Error('BILLING_ENVIRONMENT_DENIED');
    if (
      !['free', 'transition', 'plus'].includes(String(value.tier)) ||
      typeof value.limit_bytes !== 'number' ||
      [
        'sandbox_enabled',
        'billing_enabled',
        'has_subscription',
        'purchase_blocked',
        'pending_intent',
      ].some((k) => typeof value[k] !== 'boolean')
    )
      throw new Error('BILLING_INVALID_RESPONSE');
    return value as unknown as BillingState;
  }
  async function readBillingReleaseLock() {
    assertEnabled();
    const { data, error } = await requireSupabase().rpc(
      'is_pre_cutover_release_locked',
    );
    if (error || typeof data !== 'boolean')
      throw new Error('BILLING_RELEASE_LOCK_UNKNOWN');
    return data;
  }
  async function assertAccount(userId: string, expectedRevision?: number) {
    const { data, error } = await requireSupabase().auth.getUser();
    await options?.authorize?.();
    if (authUser === undefined && !error)
      setBillingAuthUser(data.user?.id ?? null);
    if (
      error ||
      data.user?.id !== userId ||
      authUser !== userId ||
      (expectedRevision !== undefined && expectedRevision !== revision)
    )
      throw new Error('BILLING_ACCOUNT_CHANGED');
    return revision;
  }
  async function assertOwner(
    userId: string,
    familyId: string,
    checkout = false,
  ) {
    assertEnabled();
    const epoch = await assertAccount(userId);
    const { data, error } = await requireSupabase().rpc(
      'get_family_plus_summary',
      { target_family_id: familyId },
    );
    if (error) throw error;
    const summary = object(data);
    if (
      summary.family_id !== familyId ||
      summary.viewer_user_id !== userId ||
      summary.role !== 'owner'
    )
      throw new Error('BILLING_OWNER_REQUIRED');
    const [state, locked] = await Promise.all([
      readFamilyBillingState(familyId),
      readBillingReleaseLock(),
    ]);
    if (
      !state.billing_enabled ||
      (checkout && !state.sandbox_enabled) ||
      locked
    )
      throw new Error('BILLING_SANDBOX_NOT_CONFIGURED');
    await assertAccount(userId, epoch);
    return { state, epoch };
  }
  async function nativeCustomer(userId: string) {
    assertEnabled();
    const releaseType = await Application.getIosApplicationReleaseTypeAsync();
    if (
      isFamilyPlusRelease()
        ? releaseType !== 5
        : !canUseBillingSigning(
            __DEV__,
            Boolean(requireOptionalNativeModule('ExpoDevLauncher')),
            releaseType,
            options?.storeBuild ??
              process.env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET ===
                'billing-rc-sandbox',
          )
    )
      throw new Error('BILLING_DEVELOPMENT_BUILD_REQUIRED');
    const epoch = await assertAccount(userId);
    const key = options
      ? options.applePublicKey()
      : isFamilyPlusRelease()
        ? process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY
        : process.env.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY;
    if (!key?.startsWith('appl_'))
      throw new Error('BILLING_SANDBOX_NOT_CONFIGURED');
    const { data: customerId, error } = await requireSupabase().rpc(
      'get_family_billing_customer',
    );
    if (error) throw error;
    if (customerId !== userId)
      throw new Error('BILLING_LEGACY_IDENTITY_REVIEW_REQUIRED');
    const { default: purchases, STOREKIT_VERSION } =
      await import('react-native-purchases');
    await assertAccount(userId, epoch);
    if (!(await purchases.isConfigured()))
      purchases.configure({
        apiKey: key,
        appUserID: userId,
        storeKitVersion: STOREKIT_VERSION.STOREKIT_2,
      });
    else if ((await purchases.getAppUserID()) !== userId)
      await purchases.logIn(userId);
    const customerInfo = await purchases.getCustomerInfo();
    if (customerInfo.originalAppUserId !== userId)
      throw new Error('BILLING_STORE_IDENTITY_REVIEW_REQUIRED');
    await assertAccount(userId, epoch);
    return { purchases, customerId, epoch };
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
  async function storePackages(
    purchases: Awaited<ReturnType<typeof nativeCustomer>>['purchases'],
  ) {
    const offerings = await purchases.getOfferings();
    const packages = offerings.all.default?.availablePackages ?? [];
    return packages.filter(
      (p) =>
        ((p.packageType === 'MONTHLY' &&
          p.product.identifier === familyPlusProducts.monthly) ||
          (p.packageType === 'ANNUAL' &&
            p.product.identifier === familyPlusProducts.yearly)) &&
        Boolean(p.product.priceString) &&
        Number.isFinite(p.product.price) &&
        p.product.price > 0 &&
        Boolean(p.product.currencyCode),
    );
  }
  function loadSandboxPackages(userId: string, familyId: string) {
    return exclusive(async () => {
      await assertOwner(userId, familyId, true);
      const { purchases, epoch } = await nativeCustomer(userId);
      const packages = await storePackages(purchases);
      await assertAccount(userId, epoch);
      return packages;
    });
  }
  async function reconcileBilling(): Promise<'confirmed' | 'pending'> {
    assertEnabled();
    const { data, error } = await requireSupabase().functions.invoke(
      'family-billing-reconcile',
      { body: {}, headers: getAppVersionHeaders() },
    );
    return !error && ['reconciled', 'empty'].includes(data?.status)
      ? 'confirmed'
      : 'pending';
  }
  function purchaseFamilyPlus(
    userId: string,
    familyId: string,
    item: PurchasesPackage,
  ): Promise<BillingOutcome> {
    return exclusive(async () => {
      const { state } = await assertOwner(userId, familyId, true);
      if (
        state.purchase_blocked ||
        state.pending_intent ||
        (state.has_subscription && state.tier === 'plus')
      )
        throw new Error('FAMILY_ALREADY_SUBSCRIBED');
      const { purchases, customerId, epoch } = await nativeCustomer(userId);
      // Re-resolve from the required Offering. Arbitrary packages cannot buy a
      // different product/period under this Family's server intent.
      const selected = (await storePackages(purchases)).find(
        (p) =>
          p.identifier === item.identifier &&
          p.product.identifier === item.product.identifier,
      );
      if (!selected) throw new Error('BILLING_PRODUCTS_UNAVAILABLE');
      await assertAccount(userId, epoch);
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
      await assertAccount(userId, epoch);
      const { data, error } = await requireSupabase().rpc(
        'begin_family_billing_purchase',
        {
          target_family_id: familyId,
          request_id: Crypto.randomUUID(),
          period: selected.packageType === 'ANNUAL' ? 'yearly' : 'monthly',
        },
      );
      if (error) throw error;
      const intent = object(data);
      if (
        typeof intent.intent_id !== 'string' ||
        intent.customer_id !== customerId ||
        intent.product_id !== selected.product.identifier ||
        intent.status !== 'prepared'
      )
        throw new Error('BILLING_INTENT_CONFLICT');
      const { error: pendingError } = await requireSupabase().rpc(
        'update_family_billing_intent',
        { target_intent_id: intent.intent_id, next_status: 'store_pending' },
      );
      if (pendingError) throw pendingError;
      await assertAccount(userId, epoch);
      await assertOwner(userId, familyId, true);
      try {
        await purchases.purchasePackage(selected);
      } catch (error) {
        const code = (error as { code?: string }).code;
        const codes = purchases.PURCHASES_ERROR_CODE;
        if (code === codes.PAYMENT_PENDING_ERROR) return 'pending';
        if (code === codes.PURCHASE_CANCELLED_ERROR) {
          await assertAccount(userId, epoch);
          const cancelled = await requireSupabase().rpc(
            'update_family_billing_intent',
            { target_intent_id: intent.intent_id, next_status: 'cancelled' },
          );
          if (cancelled.error) return 'pending';
          return 'cancelled';
        }
        return 'failed'; // Ambiguous errors retain the intent for reconciliation.
      }
      await assertAccount(userId, epoch);
      await reconcileBilling();
      const next = await readFamilyBillingState(familyId);
      await assertAccount(userId, epoch);
      return next.tier === 'plus' ? 'confirmed' : 'pending';
    });
  }
  function restoreFamilyPlus(
    userId: string,
    familyId: string,
  ): Promise<BillingOutcome> {
    return exclusive(async () => {
      await assertOwner(userId, familyId);
      const { purchases, epoch } = await nativeCustomer(userId);
      try {
        await purchases.restorePurchases();
      } catch (error) {
        return (error as { code?: string }).code ===
          purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
          ? 'cancelled'
          : 'failed';
      }
      await assertAccount(userId, epoch);
      const result = await reconcileBilling();
      const state = await readFamilyBillingState(familyId);
      await assertAccount(userId, epoch);
      // Existing Plus access is not proof that this restore was verified.
      if (result === 'pending') return 'pending';
      return state.tier === 'plus' ? 'confirmed' : 'nothingToRestore';
    });
  }
  function manageAppleSubscription(userId: string, familyId: string) {
    return exclusive(async () => {
      await assertOwner(userId, familyId);
      const { purchases, epoch } = await nativeCustomer(userId);
      await assertAccount(userId, epoch);
      await purchases.showManageSubscriptions();
    });
  }

  return {
    isFamilyBillingEnabled: billingEnabled,
    setBillingAuthUser,
    readFamilyBillingState,
    readBillingReleaseLock,
    loadSandboxPackages,
    reconcileBilling,
    purchaseFamilyPlus,
    restoreFamilyPlus,
    manageAppleSubscription,
  };
}

export type FamilyBillingClient = ReturnType<typeof createFamilyBillingClient>;
export const {
  setBillingAuthUser,
  readFamilyBillingState,
  readBillingReleaseLock,
  loadSandboxPackages,
  reconcileBilling,
  purchaseFamilyPlus,
  restoreFamilyPlus,
  manageAppleSubscription,
} = createFamilyBillingClient();

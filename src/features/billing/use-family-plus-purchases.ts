import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { logError } from '@/lib/logger';

import {
  billingPurchaseErrorMessage,
  type BillingPurchaseStage,
} from './billing-purchase-feedback';

import {
  isFamilyBillingEnabled,
  loadSandboxPackages,
  purchaseFamilyPlus,
  readFamilyBillingState,
  readBillingReleaseLock,
  reconcileBilling,
  restoreFamilyPlus,
  manageAppleSubscription,
  type FamilyBillingClient,
} from './billing-client';
import { familyPlusKeys } from './use-family-plus';
import type {
  FamilyPlusAction,
  FamilyPlusPeriod,
  FamilyPlusRole,
} from './family-plus-presentation';

export function useFamilyPlusPurchases(input: {
  userId: string | null;
  familyId: string | null;
  role: FamilyPlusRole;
  server: boolean;
  client?: FamilyBillingClient;
}) {
  const client = input.client ?? {
    isFamilyBillingEnabled,
    loadSandboxPackages,
    purchaseFamilyPlus,
    readFamilyBillingState,
    readBillingReleaseLock,
    reconcileBilling,
    restoreFamilyPlus,
    manageAppleSubscription,
  };
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<BillingPurchaseStage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageAction, setMessageAction] = useState<
    FamilyPlusAction | 'refresh' | null
  >(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const scope = `${input.userId}:${input.familyId}:${input.role}`;
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const currentGeneration = ++generation.current;
    return () => {
      mounted.current = false;
      generation.current = currentGeneration + 1;
    };
  }, [scope, input.client]);
  const enabled =
    input.server &&
    client.isFamilyBillingEnabled() &&
    Boolean(input.userId && input.familyId && input.role);
  const state = useQuery({
    queryKey: ['family-billing', input.userId, input.familyId],
    queryFn: async () => {
      const [billing, locked] = await Promise.all([
        client.readFamilyBillingState(input.familyId!),
        client.readBillingReleaseLock(),
      ]);
      return { billing, locked };
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 15_000,
  });
  const managementReady =
    enabled &&
    !state.isError &&
    !state.isPending &&
    state.data?.billing.billing_enabled === true &&
    state.data.locked === false;
  const ready = managementReady && state.data?.billing.sandbox_enabled === true;
  const blocked =
    state.data?.billing.purchase_blocked === true ||
    state.data?.billing.pending_intent === true;
  const products = useQuery({
    queryKey: ['family-store-products', input.userId, input.familyId],
    queryFn: async () => {
      try {
        return await client.loadSandboxPackages(input.userId!, input.familyId!);
      } catch (error) {
        logError('family-billing.products', error);
        throw error;
      }
    },
    enabled: ready && input.role === 'owner' && !blocked && !busy,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const action = async (
    action: FamilyPlusAction | 'refresh',
    period: FamilyPlusPeriod,
  ) => {
    if (lock.current) return;
    if (
      input.role !== 'owner' ||
      (action === 'purchase' ? !ready : !managementReady) ||
      !input.userId ||
      !input.familyId
    ) {
      setMessage('notReady');
      return;
    }
    const startedGeneration = generation.current;
    const present = () =>
      mounted.current && generation.current === startedGeneration;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setStage(null);
    setMessageAction(action);
    try {
      let result: string;
      if (action === 'purchase') {
        const item = products.data?.find(
          (p) => p.packageType === (period === 'yearly' ? 'ANNUAL' : 'MONTHLY'),
        );
        if (blocked || !item) throw new Error('BILLING_PRODUCTS_UNAVAILABLE');
        result = await client.purchaseFamilyPlus(
          input.userId,
          input.familyId,
          item,
          (next) => {
            if (present()) setStage(next);
          },
        );
      } else if (action === 'restore')
        result = await client.restoreFamilyPlus(input.userId, input.familyId);
      else if (action === 'manage') {
        await client.manageAppleSubscription(input.userId, input.familyId);
        result = 'managed';
      } else
        result =
          (await client.reconcileBilling()) === 'pending'
            ? 'pending'
            : 'refreshed';
      if (!present()) return;
      setMessage(
        action === 'restore' && result === 'confirmed' ? 'restored' : result,
      );
    } catch (error) {
      logError('family-billing.action', error, { action });
      if (present()) setMessage(billingPurchaseErrorMessage(error));
    } finally {
      // Cache refresh is follow-up work, not part of the native purchase lock.
      // A slow refetch must not leave a completed/cancelled action spinning.
      lock.current = false;
      if (present()) {
        setBusy(false);
        setStage(null);
        void Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: familyPlusKeys(input.userId, input.familyId),
          }),
          state.refetch(),
        ]);
      }
    }
  };
  return {
    ready,
    managementReady,
    blocked,
    busy: busy || products.isFetching,
    message: busy
      ? messageAction === 'restore'
        ? 'restoring'
        : messageAction === 'purchase'
          ? stage === 'store'
            ? 'openingStore'
            : stage === 'verifying'
              ? 'verifying'
              : 'preparing'
          : null
      : messageAction === 'purchase' &&
          ready &&
          state.data?.billing.tier === 'plus' &&
          (message === 'pending' || message === 'failed')
        ? 'confirmed'
        : message,
    productsLoading: products.isFetching,
    productsError: products.isError,
    prices: (products.data ?? []).map((p) => ({
      period:
        p.packageType === 'ANNUAL' ? ('yearly' as const) : ('monthly' as const),
      priceString: p.product.priceString,
      source: 'apple' as const,
    })),
    action,
    reload: () => {
      if (enabled) void state.refetch();
      if (ready && input.role === 'owner' && !blocked) void products.refetch();
    },
  };
}
export type FamilyPlusPurchases = ReturnType<typeof useFamilyPlusPurchases>;

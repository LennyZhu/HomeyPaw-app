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

const defaultClient = {
  isFamilyBillingEnabled,
  loadSandboxPackages,
  purchaseFamilyPlus,
  readFamilyBillingState,
  readBillingReleaseLock,
  reconcileBilling,
  restoreFamilyPlus,
  manageAppleSubscription,
};
// Each client owns a pinned environment and Auth transport. Identical user and
// Family IDs must never share a query across independent clients/sessions.
const clientScopes = new WeakMap<object, number>();
let nextClientScope = 0;
function getClientScope(client: object) {
  let scope = clientScopes.get(client);
  if (scope === undefined) {
    scope = ++nextClientScope;
    clientScopes.set(client, scope);
  }
  return scope;
}

export function useFamilyPlusPurchases(input: {
  userId: string | null;
  familyId: string | null;
  role: FamilyPlusRole;
  server: boolean;
  client?: FamilyBillingClient;
}) {
  const client = input.client ?? defaultClient;
  const queryScope = [
    getClientScope(client),
    input.userId,
    input.familyId,
    input.role,
  ];
  const scope = JSON.stringify(queryScope);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionScope, setActionScope] = useState<string | null>(null);
  const [reloadingScope, setReloadingScope] = useState<string | null>(null);
  const [stage, setStage] = useState<BillingPurchaseStage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageAction, setMessageAction] = useState<
    FamilyPlusAction | 'refresh' | null
  >(null);
  const lock = useRef(false);
  const reloadLock = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const currentGeneration = ++generation.current;
    return () => {
      mounted.current = false;
      generation.current = currentGeneration + 1;
    };
  }, [scope]);
  const acting = busy && actionScope === scope;
  const enabled =
    input.server &&
    client.isFamilyBillingEnabled() &&
    Boolean(input.userId && input.familyId && input.role);
  const state = useQuery({
    queryKey: ['family-billing', ...queryScope],
    queryFn: async ({ signal }) => {
      if (signal.aborted) throw new Error('BILLING_READ_CANCELLED');
      const [billing, locked] = await Promise.all([
        client.readFamilyBillingState(input.familyId!),
        client.readBillingReleaseLock(),
      ]);
      if (signal.aborted) throw new Error('BILLING_READ_CANCELLED');
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
    queryKey: ['family-store-products', ...queryScope],
    queryFn: async ({ signal }) => {
      try {
        if (signal.aborted) throw new Error('BILLING_READ_CANCELLED');
        const packages = await client.loadSandboxPackages(
          input.userId!,
          input.familyId!,
        );
        if (signal.aborted) throw new Error('BILLING_READ_CANCELLED');
        return packages;
      } catch (error) {
        if (!signal.aborted) logError('family-billing.products', error);
        throw error;
      }
    },
    // Reading prices never starts checkout. Pending still blocks action() and
    // the unchanged purchase client/server checks, not this read-only query.
    enabled: ready && input.role === 'owner' && !acting,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const productsStatus = products.isFetching
    ? ('loading' as const)
    : products.isError
      ? ('error' as const)
      : products.data
        ? ('success' as const)
        : ('idle' as const);
  const action = async (
    action: FamilyPlusAction | 'refresh',
    period: FamilyPlusPeriod,
  ) => {
    if (lock.current || reloadLock.current) return;
    setActionScope(scope);
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
        if (blocked) {
          setMessage('blocked');
          return;
        }
        const item = products.data?.find(
          (p) => p.packageType === (period === 'yearly' ? 'ANNUAL' : 'MONTHLY'),
        );
        if (!item) throw new Error('BILLING_PRODUCTS_UNAVAILABLE');
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
      // No newer action can own this lock yet. Release it even if the scope
      // changed, so returning to the original Family cannot revive stale busy.
      if (mounted.current) setBusy(false);
      if (present()) {
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
    busy: acting || products.isFetching || reloadingScope === scope,
    message:
      actionScope !== scope
        ? null
        : acting
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
    pendingIntent: state.data?.billing.pending_intent === true,
    productsStatus,
    productsLoading: productsStatus === 'loading',
    productsError: products.isError,
    prices: (products.data ?? []).map((p) => ({
      period:
        p.packageType === 'ANNUAL' ? ('yearly' as const) : ('monthly' as const),
      priceString: p.product.priceString,
      source: 'apple' as const,
    })),
    action,
    reload: async () => {
      if (
        !enabled ||
        input.role !== 'owner' ||
        lock.current ||
        reloadLock.current
      )
        return;
      const startedGeneration = generation.current;
      const present = () =>
        mounted.current && generation.current === startedGeneration;
      reloadLock.current = true;
      setReloadingScope(scope);
      try {
        // Recheck the Gate first. cancelRefetch:false joins an in-flight read
        // instead of cancelling it and issuing duplicate SDK/network calls.
        const fresh = await state.refetch({ cancelRefetch: false });
        if (
          !present() ||
          fresh.isError ||
          fresh.data?.billing.billing_enabled !== true ||
          fresh.data.billing.sandbox_enabled !== true ||
          fresh.data.locked !== false
        )
          return;
        await products.refetch({ cancelRefetch: false });
      } finally {
        reloadLock.current = false;
        if (mounted.current) setReloadingScope(null);
      }
    },
  };
}
export type FamilyPlusPurchases = ReturnType<typeof useFamilyPlusPurchases>;

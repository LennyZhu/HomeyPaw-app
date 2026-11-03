export type BillingPurchaseStage =
  'checking' | 'products' | 'preflight' | 'intent' | 'store' | 'verifying';

// Read-only SDK calls can time out safely. Never race purchasePackage against a
// timer: StoreKit may still complete a payment after the UI's timer expires.
export async function readBillingStoreMetadata<T>(
  read: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('BILLING_STORE_METADATA_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function billingPurchaseErrorMessage(error: unknown) {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '';
  if (
    [
      'BILLING_STORE_IDENTITY_REVIEW_REQUIRED',
      'BILLING_LEGACY_IDENTITY_REVIEW_REQUIRED',
    ].includes(message)
  )
    return 'identityReview';
  if (message === 'BILLING_STORE_METADATA_TIMEOUT') return 'timedOut';
  if (message === 'BILLING_PRODUCTS_UNAVAILABLE') return 'productsUnavailable';
  if (message === 'BILLING_RECONCILIATION_REQUIRED') return 'preflightFailed';
  if (message === 'BILLING_OPERATION_IN_PROGRESS') return 'operationInProgress';
  if (
    ['BILLING_ACCOUNT_CHANGED', 'BILLING_TEST_ACCESS_DENIED'].includes(message)
  )
    return 'accessDenied';
  return 'failed';
}

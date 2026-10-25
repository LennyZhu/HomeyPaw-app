// RevenueCat delivery is a wake-up signal. Only a fresh server API snapshot
// can derive access. No SDK CustomerInfo, mutable attributes or event expiry.
export { assertSandboxTarget } from './family-billing-target.mjs';
export async function digest(value) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const eventDigest = (event) => digest(JSON.stringify(canonical(event)));
export async function authorizationMatches(actual, secret) {
  if (!secret || secret.length < 32 || !actual?.startsWith('Bearer '))
    return false;
  const [a, b] = await Promise.all([digest(actual.slice(7)), digest(secret)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
const iso = (ms) => {
  if (!Number.isSafeInteger(ms) || ms <= 0)
    throw new Error('BILLING_INVALID_PROVIDER_TIME');
  return new Date(ms).toISOString();
};
export function createRevenueCatReader({
  secret,
  projectId,
  environment = 'SANDBOX',
  fetchImpl = fetch,
  deadlineAt = Infinity,
  now = Date.now,
}) {
  if (!secret || !projectId || !['SANDBOX', 'PRODUCTION'].includes(environment))
    throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');
  const root = `/v2/projects/${encodeURIComponent(projectId)}`;
  const get = async (path) => {
    // Do not follow provider pagination/redirects to another host with a secret.
    if (!path.startsWith(root + '/') || path.includes('..'))
      throw new Error('BILLING_INVALID_PROVIDER_PATH');
    const remaining = deadlineAt - now();
    if (remaining <= 0) throw new Error('BILLING_RECOVERY_TIME_BUDGET');
    const response = await fetchImpl(`https://api.revenuecat.com${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(10_000, remaining)),
    });
    if (!response.ok)
      throw new Error(`BILLING_PROVIDER_HTTP_${response.status}`);
    return response.json();
  };
  const list = async (path) => {
    const items = [];
    for (let page = 0; path && page < 20; page++) {
      const result = await get(path);
      if (!Array.isArray(result.items))
        throw new Error('BILLING_INVALID_PROVIDER_LIST');
      items.push(...result.items);
      path = result.next_page;
    }
    if (path) throw new Error('BILLING_PROVIDER_PAGINATION_LIMIT');
    return items;
  };
  return {
    withDeadline(until) {
      return createRevenueCatReader({
        secret,
        projectId,
        environment,
        fetchImpl,
        deadlineAt: Math.min(deadlineAt, until),
        now,
      });
    },
    async hasSubscriptions(customerId) {
      const items = await list(
        `${root}/customers/${encodeURIComponent(customerId)}/subscriptions?environment=${environment.toLowerCase()}`,
      );
      return items.some(
        (s) =>
          s.store === 'app_store' &&
          s.environment === environment.toLowerCase(),
      );
    },
    // Known-chain reconciliation never relies on a client transaction ID.
    async snapshot(customerId, originalId, cfg) {
      if (
        cfg.rc_project_id !== projectId ||
        (cfg.environment ?? 'SANDBOX') !== environment
      )
        throw new Error('BILLING_PROVIDER_PROJECT_DENIED');
      const candidates = await list(
        `${root}/subscriptions?store_subscription_identifier=${encodeURIComponent(originalId)}`,
      );
      if (candidates.length !== 1)
        throw new Error('BILLING_CHAIN_LOOKUP_AMBIGUOUS');
      const sub = candidates[0];
      if (
        sub.environment !== environment.toLowerCase() ||
        sub.store !== 'app_store' ||
        sub.ownership !== 'purchased' ||
        sub.customer_id !== customerId ||
        sub.original_customer_id !== customerId
      )
        throw new Error('BILLING_PROVIDER_IDENTITY_DENIED');
      const product = await get(
        `${root}/products/${encodeURIComponent(sub.product_id)}`,
      );
      if (
        product.app_id !== cfg.rc_app_id ||
        ![cfg.monthly_product_id, cfg.yearly_product_id].includes(
          product.store_identifier,
        )
      )
        throw new Error('BILLING_PROVIDER_PRODUCT_DENIED');
      const entitlements = await list(
        `${root}/subscriptions/${encodeURIComponent(sub.id)}/entitlements`,
      );
      // Dashboard identifier (family_plus) is lookup_key; API id can instead be
      // an entl... identifier. Both are provider facts from this verified chain.
      const mapped = entitlements.some(
        (e) =>
          (e.id === cfg.rc_entitlement_id ||
            e.lookup_key === cfg.rc_entitlement_id) &&
          (e.state === undefined || e.state === 'active'),
      );
      // This endpoint belongs to the already verified subscription, unlike
      // customer active_entitlements, which can aggregate chains/environments.
      const transactions = sub.gives_access
        ? await list(
            `${root}/subscriptions/${encodeURIComponent(sub.id)}/transactions`,
          )
        : [];
      const access = subscriptionAccess(
        sub,
        transactions,
        product.store_identifier,
        mapped,
      );
      return {
        environment,
        store: 'APP_STORE',
        original_transaction_id: originalId,
        rc_subscription_id: sub.id,
        customer_id: sub.customer_id,
        original_customer_id: sub.original_customer_id,
        app_id: product.app_id,
        product_id: product.store_identifier,
        entitlement_id: cfg.rc_entitlement_id,
        ownership: sub.ownership,
        status: sub.status,
        auto_renewal_status: sub.auto_renewal_status,
        gives_access: access.givesAccess,
        started_at: iso(sub.starts_at),
        access_until: iso(access.until),
      };
    },
    async anchors(customerId, cfg) {
      if (
        cfg.rc_project_id !== projectId ||
        (cfg.environment ?? 'SANDBOX') !== environment
      )
        throw new Error('BILLING_PROVIDER_PROJECT_DENIED');
      const events = await list(
        `${root}/customers/${encodeURIComponent(customerId)}/events?environment=${environment.toLowerCase()}`,
      );
      // Event history may not expose a chain identifier. Never invent one from
      // store_subscription_identifier (which can change with renewals).
      return events.flatMap((item) => {
        const b = item.body;
        if (
          !b ||
          b.environment !== environment ||
          b.store !== 'APP_STORE' ||
          item.app_id !== cfg.rc_app_id ||
          b.app_user_id !== customerId ||
          !b.original_transaction_id
        )
          return [];
        return [
          {
            ...b,
            id: `api:${item.id}`,
            app_id: item.app_id,
            type: item.type,
            event_timestamp_ms: b.event_timestamp_ms ?? item.occurred_at,
          },
        ];
      });
    },
  };
}
// RevenueCat v2 transaction.effective_expiration_date includes grace. Only the
// current transaction of this verified chain can provide that boundary. Unknown
// or contradictory provider facts defer reconciliation; they never invent time.
export function subscriptionAccess(
  sub,
  transactions,
  product,
  mapped,
  now = Date.now(),
) {
  const pending = () => {
    throw new Error('BILLING_PROVIDER_ACCESS_PENDING');
  };
  const periodEnd = sub.current_period_ends_at;
  if (!Number.isSafeInteger(periodEnd) || periodEnd <= sub.starts_at)
    return pending();
  if (sub.gives_access === false)
    return { givesAccess: false, until: periodEnd };
  if (
    sub.gives_access !== true ||
    !mapped ||
    !['active', 'trialing', 'in_grace_period', 'cancelled'].includes(sub.status)
  )
    return pending();
  const current = transactions.filter(
    (t) => t.id === sub.store_subscription_identifier,
  );
  if (current.length !== 1) return pending();
  const tx = current[0];
  if (
    tx.product_store_identifier !== product ||
    tx.purchased_at !== sub.current_period_starts_at ||
    tx.expiration_date !== periodEnd ||
    !Number.isSafeInteger(tx.effective_expiration_date) ||
    tx.effective_expiration_date < periodEnd
  )
    return pending();
  const until =
    sub.status === 'in_grace_period' ? tx.effective_expiration_date : periodEnd;
  if (until <= now) return pending();
  return { givesAccess: true, until };
}
export async function reconcileCustomer(
  { rpc, reader },
  customerId,
  event = null,
) {
  const {
    config: cfg,
    chains,
    pending_intent: pendingIntent,
  } = await rpc('get_family_billing_server_context', {
    target_customer_id: customerId,
  });
  if (!cfg?.enabled) throw new Error('BILLING_SANDBOX_NOT_CONFIGURED');
  // Generation is obtained BEFORE the HTTP queries, fencing stale in-flight reads.
  const generation = await rpc('start_family_billing_refresh', {
    target_customer_id: customerId,
  });
  const finish = (result, error_code = null) =>
    rpc('finish_family_billing_recovery', {
      target_customer_id: customerId,
      generation,
      result,
      error_code,
    });
  try {
    const work = new Map(chains.map((c) => [c.original_transaction_id, null]));
    // Minimal anchors already admitted through authenticated webhook ingestion.
    // Do not recreate/re-hash a partial event or trust a client-supplied chain ID.
    const stored = await rpc('get_family_billing_recovery_anchors', {
      target_customer_id: customerId,
    });
    for (const anchor of stored)
      work.set(anchor.original_transaction_id, anchor.event_id);
    // A verified empty payer needs no event-history anchor to begin a first
    // purchase. Conversely pending intents never become "empty" just because
    // provider ingestion is delayed. Known chains recover without event history.
    if (
      !event &&
      !work.size &&
      !pendingIntent &&
      !(await reader.hasSubscriptions(customerId))
    ) {
      await finish('empty');
      return { status: 'empty', updated: 0 };
    }
    const anchors = event
      ? [event]
      : work.size && !pendingIntent
        ? []
        : await reader.anchors(customerId, cfg);
    for (const anchor of anchors) {
      await rpc('receive_family_billing_webhook', {
        event: anchor,
        payload_hash: await eventDigest(anchor),
      });
      work.set(anchor.original_transaction_id, anchor.id);
    }
    if (!work.size) {
      const status =
        pendingIntent || (await reader.hasSubscriptions(customerId))
          ? 'pending_chain_anchor'
          : 'empty';
      await finish(
        status,
        status === 'pending_chain_anchor'
          ? 'BILLING_CHAIN_ANCHOR_REQUIRED'
          : null,
      );
      return { status, updated: 0 };
    }
    let updated = 0;
    for (const [originalId, eventId] of work) {
      const snapshot = await reader.snapshot(customerId, originalId, cfg);
      await rpc('apply_family_billing_snapshot', {
        target_customer_id: customerId,
        generation,
        snapshot,
        source_event_id: eventId,
      });
      updated++;
    }
    await finish('reconciled');
    return { status: 'reconciled', updated };
  } catch (error) {
    const code = billingFailureCode(error);
    await finish(isBillingManualReview(code) ? 'manual_review' : 'retry', code);
    throw error;
  }
}
export function billingFailureCode(error) {
  const value = String(error?.message ?? '');
  return /^BILLING_[A-Z0-9_]{1,80}$/.test(value)
    ? value
    : 'BILLING_TEMPORARY_FAILURE';
}
export const isBillingManualReview = (code) =>
  [
    'BILLING_BINDING_REVIEW_REQUIRED',
    'BILLING_CHAIN_ALREADY_BOUND',
    'BILLING_EVENT_ID_CONFLICT',
    'BILLING_PROVIDER_IDENTITY_DENIED',
    'BILLING_PROVIDER_PRODUCT_DENIED',
    'BILLING_PROVIDER_PROJECT_DENIED',
    'BILLING_CHAIN_LOOKUP_AMBIGUOUS',
    'BILLING_PROVIDER_HTTP_401',
    'BILLING_PROVIDER_HTTP_403',
  ].includes(code);

export async function runBillingRecovery(runtime, { now = Date.now } = {}) {
  const deadline = now() + 45_000;
  const { config } = await runtime.rpc('get_family_billing_server_context');
  if (!config?.enabled) throw new Error('BILLING_SANDBOX_NOT_CONFIGURED');
  const customers = await runtime.rpc(
    'get_family_billing_reconciliation_work',
    { job_limit: 5 },
  );
  const counts = {
    completed: 0,
    pending: 0,
    failed: 0,
    review: 0,
    remaining: 0,
  };
  // Bounded sequential work avoids 25 simultaneous provider query chains.
  for (const id of customers) {
    if (now() >= deadline) break;
    const customerDeadline = Math.min(deadline, now() + 20_000);
    try {
      const result = await reconcileCustomer(
        {
          ...runtime,
          rpc: (name, args) => {
            if (
              name !== 'finish_family_billing_recovery' &&
              now() >= customerDeadline
            )
              throw new Error('BILLING_RECOVERY_TIME_BUDGET');
            return runtime.rpc(name, args);
          },
          reader:
            runtime.reader.withDeadline?.(customerDeadline) ?? runtime.reader,
        },
        id,
      );
      if (result.status === 'pending_chain_anchor') counts.pending++;
      else counts.completed++;
    } catch (error) {
      const code = billingFailureCode(error);
      if (isBillingManualReview(code)) counts.review++;
      else counts.failed++;
      // Provider credentials are shared. Do not quarantine every payer or burn
      // the whole batch when operator action on the credentials is required.
      if (/^BILLING_PROVIDER_HTTP_40[13]$/.test(code)) break;
    }
  }
  counts.remaining =
    customers.length -
    counts.completed -
    counts.pending -
    counts.failed -
    counts.review;
  const health = await runtime.rpc('get_family_billing_recovery_health');
  return { ...counts, health };
}
export async function preflightFamilyPurchase(runtime, userId) {
  const { family_id: familyId, customers } = await runtime.rpc(
    'get_family_billing_purchase_preflight_context',
    { target_user_id: userId },
  );
  for (const customerId of customers) {
    const result = await reconcileCustomer(runtime, customerId);
    if (result.status === 'pending_chain_anchor')
      throw new Error('BILLING_RECONCILIATION_REQUIRED');
  }
  await runtime.rpc('finish_family_billing_purchase_preflight', {
    target_user_id: userId,
    target_family_id: familyId,
  });
  return { status: 'purchase_ready', family_id: familyId };
}
export function createBillingWebhookHandler({ rpc, reader, webhookSecret }) {
  return async (request) => {
    if (request.method !== 'POST')
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    // RevenueCat dashboard configured Authorization header; no invented signature.
    if (
      !(await authorizationMatches(
        request.headers.get('Authorization'),
        webhookSecret,
      ))
    )
      return json({ error: 'UNAUTHORIZED' }, 401);
    let event;
    try {
      const raw = await request.text();
      if (raw.length > 64_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
      event = JSON.parse(raw).event;
      if (
        !event ||
        typeof event.id !== 'string' ||
        !Number.isSafeInteger(event.event_timestamp_ms)
      )
        return json({ error: 'INVALID_EVENT' }, 400);
      const { config: cfg } = await rpc('get_family_billing_server_context');
      if (
        event.environment !== (cfg?.environment ?? 'SANDBOX') ||
        event.app_id !== cfg?.rc_app_id
      )
        return json({ error: 'ENVIRONMENT_DENIED' }, 403);
      // Canonical event digest is shared with reconciliation, not raw transport
      // formatting; retries keep their event id and fields. No event TTL cutoff.
      const status = await rpc('receive_family_billing_webhook', {
        event,
        payload_hash: await eventDigest(event),
      });
      if (status === 'processed') return json({ status: 'duplicate' });
      if (status === 'ignored') return json({ status: 'ignored' });
      if (
        event.store !== 'APP_STORE' ||
        event.type === 'TRANSFER' ||
        !event.original_transaction_id
      ) {
        await rpc('finish_family_billing_webhook', {
          target_event_id: event.id,
          next_status: 'ignored',
          error_code: 'UNSUPPORTED_OR_TRANSFER',
        });
        return json({ status: 'ignored' });
      }
      await reconcileCustomer({ rpc, reader }, event.app_user_id, event);
      return json({ status: 'processed' });
    } catch (error) {
      const code = billingFailureCode(error);
      if (event?.id)
        await rpc('finish_family_billing_webhook', {
          target_event_id: event.id,
          next_status: 'deferred',
          error_code: code,
        }).catch(() => undefined);
      return json({ error: 'BILLING_VERIFICATION_PENDING' }, 503);
    }
  };
}

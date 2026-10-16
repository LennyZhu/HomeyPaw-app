import assert from 'node:assert/strict';
import { withBlankFamilyPlus, quote } from './lib/blank-family-plus.mjs';
import {
  runBillingRecovery,
  createRevenueCatReader,
  createBillingWebhookHandler,
  reconcileCustomer,
  preflightFamilyPurchase,
} from '../supabase/functions/_shared/family-billing-sandbox.mjs';

await withBlankFamilyPlus(async ({ query, auth, id }) => {
  query(
    `update private.family_billing_config set enabled=true,rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';`,
  );
  const cfg = {
    rc_project_id: 'proj_fixture',
    rc_app_id: 'app_fixture',
    rc_entitlement_id: 'ent_fixture',
    monthly_product_id: 'sandbox.monthly',
    yearly_product_id: 'sandbox.yearly',
  };
  const customer = (actor) => {
    auth(actor, 'select public.get_family_billing_customer();');
    return query(
      `select id from private.family_billing_customers where user_id=${quote(id(actor))}::uuid;`,
    );
  };
  const owner = customer('owner');
  const stranger = customer('stranger');
  query(`select public.finish_family_billing_purchase_preflight(${quote(id('owner'))}::uuid,${quote(id('family'))}::uuid);
    select public.finish_family_billing_purchase_preflight(${quote(id('stranger'))}::uuid,${quote(id('other'))}::uuid);`);
  auth(
    'owner',
    `select public.begin_family_billing_purchase(${quote(id('family'))}::uuid,${quote(id('webhook-intent'))}::uuid,'monthly');select public.update_family_billing_intent(${quote(id('webhook-intent'))}::uuid,'store_pending');`,
  );
  auth(
    'stranger',
    `select public.begin_family_billing_purchase(${quote(id('other'))}::uuid,${quote(id('missing-intent'))}::uuid,'yearly');select public.update_family_billing_intent(${quote(id('missing-intent'))}::uuid,'store_pending');`,
  );
  const rpc = async (name, args = {}) => {
    assert.match(
      name,
      /^(?:get|receive|finish|start|apply)_family_billing_[a-z_]+$/u,
    );
    const expression = Object.entries(args)
      .map(([key, value]) => {
        assert.match(key, /^[a-z_]+$/u);
        return `${key}=>${value === null ? 'null' : typeof value === 'number' ? value : typeof value === 'object' ? `${quote(JSON.stringify(value))}::jsonb` : quote(value)}`;
      })
      .join(',');
    return JSON.parse(
      query(
        `select coalesce(to_jsonb(public.${name}(${expression})),'null'::jsonb);`,
      ),
    );
  };
  const stores = new Map();
  const makeSub = (customerId, original, product) => ({
    object: 'subscription',
    id: `sub-${original}`,
    customer_id: customerId,
    original_customer_id: customerId,
    product_id: product === 'sandbox.yearly' ? 'prod_yearly' : 'prod_monthly',
    starts_at: Date.now(),
    current_period_starts_at: Date.now(),
    store_subscription_identifier: `tx-${original}`,
    current_period_ends_at: Date.now() + 3600000,
    gives_access: true,
    environment: 'sandbox',
    store: 'app_store',
    ownership: 'purchased',
    status: 'active',
    auto_renewal_status: 'will_renew',
  });
  stores.set(
    'original-owner',
    makeSub(owner, 'original-owner', 'sandbox.monthly'),
  );
  stores.set(
    'original-stranger',
    makeSub(stranger, 'original-stranger', 'sandbox.yearly'),
  );
  let history = [];
  let unavailable = false;
  let calls = 0;
  const reader = createRevenueCatReader({
    secret: 'synthetic-reader-secret',
    projectId: 'proj_fixture',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(
        options.headers.Authorization,
        'Bearer synthetic-reader-secret',
      );
      assert.equal(new URL(url).origin, 'https://api.revenuecat.com');
      if (unavailable) return new Response('', { status: 503 });
      const u = new URL(url);
      const path = u.pathname;
      let body;
      if (
        path.endsWith('/subscriptions') &&
        u.searchParams.has('store_subscription_identifier')
      )
        body = {
          items: [
            stores.get(u.searchParams.get('store_subscription_identifier')),
          ].filter(Boolean),
          next_page: null,
        };
      else if (path.includes('/products/'))
        body = {
          app_id: 'app_fixture',
          store_identifier: path.endsWith('prod_yearly')
            ? 'sandbox.yearly'
            : 'sandbox.monthly',
        };
      else if (
        path.includes('/subscriptions/') &&
        path.endsWith('/entitlements')
      )
        body = { items: [{ id: 'ent_fixture' }], next_page: null };
      else if (path.endsWith('/transactions')) {
        const sub = [...stores.values()].find(
          (s) => s.id === path.split('/').at(-2),
        );
        body = {
          items: sub
            ? [
                {
                  id: sub.store_subscription_identifier,
                  purchased_at: sub.current_period_starts_at,
                  product_store_identifier:
                    sub.product_id === 'prod_yearly'
                      ? 'sandbox.yearly'
                      : 'sandbox.monthly',
                  expiration_date: sub.current_period_ends_at,
                  effective_expiration_date: sub.omitEffective
                    ? null
                    : (sub.effectiveEnd ?? sub.current_period_ends_at),
                },
              ]
            : [],
          next_page: null,
        };
      } else if (path.endsWith('/events'))
        body = {
          items: history.filter(
            (e) => e.body.app_user_id === path.split('/').at(-2),
          ),
          next_page: null,
        };
      else if (path.endsWith('/subscriptions'))
        body = {
          items: [...stores.values()].filter(
            (s) => s.customer_id === path.split('/').at(-2),
          ),
          next_page: null,
        };
      else throw new Error(`Unexpected provider route: ${path}`);
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
  const secret = 'synthetic-webhook-auth-secret-00000000';
  const handler = createBillingWebhookHandler({
    rpc,
    reader,
    webhookSecret: secret,
  });
  const event = (label, type = 'INITIAL_PURCHASE') => ({
    id: label,
    type,
    app_user_id: owner,
    app_id: 'app_fixture',
    environment: 'SANDBOX',
    store: 'APP_STORE',
    original_transaction_id: 'original-owner',
    product_id: 'sandbox.monthly',
    event_timestamp_ms: Date.now(),
  });
  const send = (body, authHeader = `Bearer ${secret}`) =>
    handler(
      new Request('http://isolated.test/webhook', {
        method: 'POST',
        headers: { Authorization: authHeader },
        body: JSON.stringify({ event: body }),
      }),
    );
  assert.equal((await send(event('bad-auth'), 'Bearer invalid')).status, 401);
  assert.equal(calls, 0);
  assert.equal(
    (await send({ ...event('wrong-env'), environment: 'PRODUCTION' })).status,
    403,
  );
  assert.equal(
    (await send({ ...event('wrong-app'), app_id: 'other_app' })).status,
    403,
  );
  assert.equal(
    Number(query('select count(*) from private.family_billing_webhook_inbox;')),
    0,
  );
  const initial = event('initial');
  unavailable = true;
  assert.equal((await send(initial)).status, 503);
  assert.equal(
    Number(query('select count(*) from private.family_store_subscriptions;')),
    0,
  );
  unavailable = false;
  // First binding recovers an already-authenticated deferred inbox anchor,
  // even when the provider event-history response contains no original ID.
  assert.equal(
    (await reconcileCustomer({ rpc, reader }, owner)).status,
    'reconciled',
  );
  assert.equal(
    query(
      "select status from private.family_billing_webhook_inbox where event_id='initial';",
    ),
    'processed',
  );
  assert.equal((await send(initial)).status, 200);
  const tier = () =>
    JSON.parse(
      auth(
        'member',
        `select public.get_family_billing_state(${quote(id('family'))}::uuid);`,
      )
        .split('\n')
        .at(-1),
    ).tier;
  assert.equal(tier(), 'plus');
  query(`begin;update public.family_members set role='member' where user_id=${quote(id('owner'))}::uuid;
    update public.family_members set role='owner' where user_id=${quote(id('member'))}::uuid;commit;`);
  await preflightFamilyPurchase({ rpc, reader }, id('member'));
  assert.throws(
    () =>
      auth(
        'member',
        `select public.begin_family_billing_purchase(${quote(id('family'))}::uuid,${quote(id('new-owner-rebuy'))}::uuid,'monthly');`,
      ),
    /FAMILY_ALREADY_SUBSCRIBED/u,
  );
  query(`begin;update public.family_members set role='member' where user_id=${quote(id('member'))}::uuid;
    update public.family_members set role='owner' where user_id=${quote(id('owner'))}::uuid;commit;`);
  assert.equal(
    (await send(Object.fromEntries(Object.entries(initial).reverse()))).status,
    200,
  );
  assert.equal(
    Number(query('select count(*) from private.family_store_subscriptions;')),
    1,
  );
  assert.equal(
    Number(query('select count(*) from private.family_media_entitlements;')),
    1,
  );
  assert.equal(
    (await send({ ...initial, product_id: 'tampered' })).status,
    503,
  );
  const snapshot = await reader.snapshot(owner, 'original-owner', cfg);
  assert.equal(
    Date.parse(snapshot.access_until),
    stores.get('original-owner').current_period_ends_at,
  );
  const sub = stores.get('original-owner');
  sub.auto_renewal_status = 'will_not_renew';
  assert.equal((await send(event('cancel-auto', 'CANCELLATION'))).status, 200);
  assert.equal(tier(), 'plus');
  sub.current_period_ends_at = Date.now() - 1000;
  sub.current_period_starts_at = sub.starts_at - 3600000;
  sub.starts_at -= 3600000;
  sub.effectiveEnd = Date.now() + 600000;
  sub.status = 'in_grace_period';
  assert.equal((await send(event('grace', 'BILLING_ISSUE'))).status, 200);
  assert.equal(tier(), 'plus');
  const verifiedEnd = query(
    'select ends_at from private.family_media_entitlements;',
  );
  sub.omitEffective = true;
  const unclearGrace = event('grace-missing-boundary', 'BILLING_ISSUE');
  assert.equal((await send(unclearGrace)).status, 503);
  assert.equal(tier(), 'plus');
  assert.equal(
    query('select ends_at from private.family_media_entitlements;'),
    verifiedEnd,
  );
  sub.omitEffective = false;
  assert.equal((await send(unclearGrace)).status, 200);
  sub.status = 'in_billing_retry';
  sub.gives_access = false;
  assert.equal((await send(event('retry', 'BILLING_ISSUE'))).status, 200);
  assert.equal(tier(), 'free');
  sub.status = 'expired';
  assert.equal((await send(event('refund', 'CANCELLATION'))).status, 200);
  assert.equal(tier(), 'free');
  // Older renewal payload claims an active expiry, but current server authority
  // remains revoked. Event content cannot resurrect the entitlement.
  assert.equal(
    (
      await send({
        ...event('late-renewal', 'RENEWAL'),
        event_timestamp_ms: 1,
        expiration_at_ms: Date.now() + 99999999,
      })
    ).status,
    200,
  );
  assert.equal(tier(), 'free');
  sub.status = 'active';
  sub.gives_access = true;
  sub.current_period_ends_at = Date.now() + 7200000;
  sub.effectiveEnd = sub.current_period_ends_at;
  assert.equal(
    (await reconcileCustomer({ rpc, reader }, owner)).status,
    'reconciled',
  );
  assert.equal(tier(), 'plus');
  let releaseSlow, enteredSlow;
  const blocked = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const entered = new Promise((resolve) => {
    enteredSlow = resolve;
  });
  const older = reconcileCustomer(
    {
      rpc,
      reader: {
        ...reader,
        snapshot: async (...args) => {
          const captured = await reader.snapshot(...args);
          enteredSlow();
          await blocked;
          return captured;
        },
      },
    },
    owner,
  );
  await entered;
  sub.status = 'expired';
  sub.gives_access = false;
  await reconcileCustomer({ rpc, reader }, owner);
  releaseSlow();
  await assert.rejects(older, /BILLING_STALE_REFRESH/);
  assert.equal(tier(), 'free');
  sub.status = 'active';
  sub.gives_access = true;
  await reconcileCustomer({ rpc, reader }, owner);
  unavailable = true;
  const retryEvent = event('provider-down', 'RENEWAL');
  assert.equal((await send(retryEvent)).status, 503);
  assert.equal(tier(), 'plus');
  unavailable = false;
  assert.equal(
    (await reconcileCustomer({ rpc, reader }, owner)).status,
    'reconciled',
  );
  assert.equal(
    query(
      "select status from private.family_billing_webhook_inbox where event_id='provider-down';",
    ),
    'processed',
  );
  assert.equal((await send(retryEvent)).status, 200);
  stores.get('original-owner').environment = 'production';
  await assert.rejects(
    reader.snapshot(owner, 'original-owner', cfg),
    /BILLING_PROVIDER_IDENTITY_DENIED/u,
  );
  stores.get('original-owner').environment = 'sandbox';
  const missing = await reconcileCustomer({ rpc, reader }, stranger);
  assert.equal(missing.status, 'pending_chain_anchor');
  assert.equal(
    Number(
      query(
        `select count(*) from private.family_store_subscriptions where customer_id=${quote(stranger)}::uuid;`,
      ),
    ),
    0,
  );
  query('update private.family_billing_customers set next_retry_at=null;');
  const recovery = await runBillingRecovery({ rpc, reader });
  assert.ok(recovery.pending >= 1);
  history = [
    {
      id: 'recovered-event',
      app_id: 'app_fixture',
      type: 'PURCHASES_INITIAL_PURCHASE',
      occurred_at: Date.now(),
      body: {
        ...event('recovered'),
        app_user_id: stranger,
        product_id: 'sandbox.yearly',
        original_transaction_id: 'original-stranger',
      },
    },
  ];
  assert.equal(
    (await reconcileCustomer({ rpc, reader }, stranger)).status,
    'reconciled',
  );
  assert.equal(
    Number(query('select count(*) from private.family_store_subscriptions;')),
    2,
  );
  console.log(
    'PASS (mock RevenueCat HTTP + real isolated SQL): authenticated delivery, stable digest replay protection, event conflict, out-of-order authority, renewal/cancel/grace/retry/refund, provider outage/retry, known-chain reconciliation, first-anchor missing hold/API-history recovery, Sandbox and target isolation. No Apple or RevenueCat network call performed.',
  );
});

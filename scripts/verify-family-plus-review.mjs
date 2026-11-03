import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const baselineHook = process.argv.includes('--baseline-hook');

// Client-only fixtures: no database, HTTP, StoreKit or provider connections.
const load = (path, dependencies = {}, globals = {}) => {
  const module = { exports: {} };
  const source =
    baselineHook && path.endsWith('/use-family-plus-purchases.ts')
      ? execFileSync(
          'git',
          ['show', '899ca06a434bbce35284699c4360ea817c83f7dc:' + path],
          { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
        )
      : readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  new Script(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).runInNewContext({
    module,
    exports: module.exports,
    Error,
    URL,
    setTimeout,
    clearTimeout,
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
};
const support = load('src/features/billing/billing-purchase-feedback.ts');
assert.equal(
  await support.readBillingStoreMetadata(async () => 'price'),
  'price',
);
await assert.rejects(
  support.readBillingStoreMetadata(() => new Promise(() => {}), 1),
  /BILLING_STORE_METADATA_TIMEOUT/,
);
assert.equal(
  support.billingPurchaseErrorMessage({
    message: 'BILLING_PRODUCTS_UNAVAILABLE',
  }),
  'productsUnavailable',
);
assert.equal(
  support.billingPurchaseErrorMessage(
    new Error('BILLING_RECONCILIATION_REQUIRED'),
  ),
  'preflightFailed',
);

const products = ['monthly', 'yearly'].map((period) => ({
  identifier: period,
  packageType: period === 'yearly' ? 'ANNUAL' : 'MONTHLY',
  product: {
    identifier: `homeypaw.familyplus.${period}`,
    priceString: period === 'yearly' ? 'HK$228.00' : 'HK$32.00',
    price: period === 'yearly' ? 228 : 32,
    currencyCode: 'HKD',
  },
}));
let availableProducts = products;
let preflightFails = false;
let storeOutcome = 'success';
let admissionValid = true;
let tier = 'free';
let pendingIntent = false;
const calls = [];
const logs = [];
const state = () => ({
  tier,
  limit_bytes: 314572800,
  video_limit: null,
  environment: 'SANDBOX',
  sandbox_enabled: true,
  billing_enabled: true,
  has_subscription: false,
  purchase_blocked: false,
  pending_intent: pendingIntent,
});
const transport = {
  auth: { getUser: async () => ({ data: { user: { id: 'review-owner' } } }) },
  rpc: async (name, args) => {
    calls.push(
      name === 'update_family_billing_intent' ? args.next_status : name,
    );
    const data = {
      get_family_plus_summary: {
        family_id: 'review-family',
        viewer_user_id: 'review-owner',
        role: 'owner',
      },
      get_family_billing_state: state(),
      is_pre_cutover_release_locked: false,
      get_family_billing_customer: 'review-owner',
      begin_family_billing_purchase: {
        intent_id: 'fixture-intent',
        customer_id: 'review-owner',
        product_id: `homeypaw.familyplus.${args?.period}`,
        status: 'prepared',
      },
      update_family_billing_intent: null,
    };
    assert.ok(name in data);
    return { data: data[name], error: null };
  },
  functions: {
    invoke: async (_name, args) => {
      calls.push(args.body.operation ?? 'reconcile');
      return {
        data:
          args.body.operation === 'purchase_preflight'
            ? { status: 'purchase_ready', family_id: 'review-family' }
            : { status: 'reconciled' },
        error: preflightFails ? { code: 'fixture-network-error' } : null,
      };
    },
  },
};
const sdk = {
  isConfigured: async () => true,
  getAppUserID: async () => 'review-owner',
  getCustomerInfo: async () => ({ originalAppUserId: 'review-owner' }),
  getOfferings: async () => ({
    all: { default: { availablePackages: availableProducts } },
  }),
  PURCHASES_ERROR_CODE: {
    PAYMENT_PENDING_ERROR: '20',
    PURCHASE_CANCELLED_ERROR: '1',
  },
  purchasePackage: async (item) => {
    calls.push('purchasePackage');
    assert.ok(products.includes(item));
    if (storeOutcome === 'cancelled') throw { code: '1' };
    if (storeOutcome === 'pending') throw { code: '20' };
    if (storeOutcome === 'failed') throw { code: '10' };
    tier = 'plus';
  },
};
const billing = load(
  'src/features/billing/billing-client.ts',
  {
    'expo-application': { getIosApplicationReleaseTypeAsync: async () => 5 },
    'expo-crypto': { randomUUID: () => 'fixture-request' },
    expo: { requireOptionalNativeModule: () => null },
    'react-native': { Platform: { OS: 'ios' } },
    'react-native-purchases': {
      __esModule: true,
      default: sdk,
      STOREKIT_VERSION: { STOREKIT_2: 'STOREKIT_2' },
    },
    '@/features/app-release/minimum-version': {
      getAppVersionHeaders: () => ({}),
    },
    '@/lib/supabase/client': {
      requireSupabase: () => assert.fail('Default/Production transport used'),
    },
    '@/lib/supabase/environment': { supabaseEnvironment: {} },
    '@/lib/logger': { logError: (...args) => logs.push(args) },
    './billing-sandbox-gate': load(
      'src/features/billing/billing-sandbox-gate.ts',
    ),
    './family-plus-environment': { isFamilyPlusRelease: () => false },
    './billing-purchase-feedback': support,
  },
  { __DEV__: false, process: { env: {} } },
).createFamilyBillingClient({
  getClient: () => transport,
  environment: 'SANDBOX',
  enabled: () => true,
  storeBuild: true,
  applePublicKey: () => 'appl_fixture',
  authorize: async () => {
    if (!admissionValid) throw new Error('BILLING_TEST_ACCESS_DENIED');
  },
});
billing.setBillingAuthUser('review-owner');
for (const product of products) {
  calls.length = 0;
  tier = 'free';
  const stages = [];
  assert.equal(
    await billing.purchaseFamilyPlus(
      'review-owner',
      'review-family',
      product,
      (s) => stages.push(s),
    ),
    'confirmed',
  );
  assert.deepEqual(stages, [
    'checking',
    'products',
    'preflight',
    'intent',
    'store',
    'verifying',
  ]);
  assert.ok(calls.indexOf('store_pending') < calls.indexOf('purchasePackage'));
  assert.equal(calls.filter((call) => call === 'purchasePackage').length, 1);
}
for (const outcome of ['cancelled', 'pending', 'failed']) {
  storeOutcome = outcome;
  tier = 'free';
  calls.length = 0;
  assert.equal(
    await billing.purchaseFamilyPlus(
      'review-owner',
      'review-family',
      products[0],
    ),
    outcome,
  );
  assert.equal(calls.includes('cancelled'), outcome === 'cancelled');
  assert.ok(
    !calls.includes('failed'),
    'Ambiguous StoreKit results retain their Intent',
  );
}
storeOutcome = 'success';
tier = 'free';
preflightFails = true;
calls.length = 0;
await assert.rejects(
  billing.purchaseFamilyPlus('review-owner', 'review-family', products[0]),
  /RECONCILIATION_REQUIRED/,
);
assert.ok(!calls.includes('purchasePackage'));
assert.equal(logs.at(-1)[2].stage, 'preflight');
preflightFails = false;
availableProducts = [];
await assert.rejects(
  billing.loadSandboxPackages('review-owner', 'review-family'),
  /PRODUCTS_UNAVAILABLE/,
);
availableProducts = products;
admissionValid = false;
await assert.rejects(
  billing.loadSandboxPackages('review-owner', 'review-family'),
  /TEST_ACCESS_DENIED/,
);
admissionValid = true;
assert.equal(
  (await billing.loadSandboxPackages('review-owner', 'review-family')).length,
  2,
);
pendingIntent = true;
calls.length = 0;
assert.equal(
  (await billing.loadSandboxPackages('review-owner', 'review-family')).length,
  2,
  'Pending does not prevent the existing authenticated product read',
);
assert.ok(!calls.includes('begin_family_billing_purchase'));
assert.ok(!calls.includes('store_pending'));
assert.ok(!calls.includes('purchasePackage'));
await assert.rejects(
  billing.purchaseFamilyPlus('review-owner', 'review-family', products[1]),
  /FAMILY_ALREADY_SUBSCRIBED/,
);
assert.ok(!calls.includes('begin_family_billing_purchase'));
assert.ok(!calls.includes('purchasePackage'));
pendingIntent = false;
console.log(
  'PASS: isolated review-account Monthly/Yearly reach purchasePackage once after Intent; preflight/empty products/expiry deny safely; cancellation/pending/errors remain recoverable (Mock only).',
);

// Execute the actual Hook with deterministic React/Query boundaries. A pending
// cache refresh reproduces the old button lock without any native automation.
let slots = [],
  cursor = 0,
  queryCursor = 0,
  purchaseCalls = 0;
let finishPurchase;
const refreshPending = new Promise(() => {});
const hookClient = {
  isFamilyBillingEnabled: () => true,
  purchaseFamilyPlus: async (_user, _family, _item, onStage) => {
    purchaseCalls++;
    onStage?.('preflight');
    await new Promise((resolve) => {
      finishPurchase = resolve;
    });
    onStage?.('store');
    return 'cancelled';
  },
};
const hook = load('src/features/billing/use-family-plus-purchases.ts', {
  react: {
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] = value;
        },
      ];
    },
    useRef: (initial) => {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useEffect: (effect, dependencies) => {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => value !== previous.dependencies[i])
      ) {
        previous?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      }
    },
  },
  '@tanstack/react-query': {
    useQueryClient: () => ({ invalidateQueries: () => refreshPending }),
    useQuery: () =>
      queryCursor++ % 2 === 0
        ? {
            isError: false,
            isPending: false,
            data: { billing: state(), locked: false },
            refetch: () => refreshPending,
          }
        : { isError: false, isFetching: false, data: products },
  },
  '@/lib/logger': { logError: (...args) => logs.push(args) },
  './billing-client': {},
  './billing-purchase-feedback': support,
  './use-family-plus': { familyPlusKeys: () => ['fixture'] },
});
const renderHook = () => {
  cursor = queryCursor = 0;
  return hook.useFamilyPlusPurchases({
    userId: 'review-owner',
    familyId: 'review-family',
    role: 'owner',
    server: true,
    client: hookClient,
  });
};
let current = renderHook();
const first = current.action('purchase', 'yearly');
current = renderHook();
assert.equal(current.busy, true);
assert.equal(current.message, baselineHook ? null : 'preparing');
await current.action('purchase', 'yearly');
assert.equal(purchaseCalls, 1, 'Repeated taps cannot duplicate a purchase');
finishPurchase();
let completionTimer;
const completion = Promise.race([
  first,
  new Promise(
    (_, reject) =>
      (completionTimer = setTimeout(
        () => reject(new Error('Button remains locked by refresh')),
        100,
      )),
  ),
]);
try {
  if (baselineHook) {
    await assert.rejects(completion, /Button remains locked by refresh/);
    assert.equal(renderHook().busy, true);
    console.log(
      'REPRODUCED: Build 12 source keeps the button locked after purchase cancellation when follow-up refresh is unresolved. This does not prove the App Review root cause.',
    );
  } else {
    await completion;
    current = renderHook();
    assert.equal(current.busy, false);
    assert.equal(current.message, 'cancelled');
    console.log(
      'PASS: tap feedback appears immediately, repeated taps are fenced, and a completed action unlocks even when cache refresh never resolves.',
    );
  }
} finally {
  clearTimeout(completionTimer);
}

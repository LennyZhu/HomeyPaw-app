import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const load = (p, deps = {}, globals = {}) => {
  const module = { exports: {} };
  new Script(
    ts.transpileModule(read(p), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).runInNewContext({
    module,
    exports: module.exports,
    URL,
    Error,
    Date,
    Boolean,
    ...globals,
    require: (n) => {
      assert.ok(n in deps, n);
      return deps[n];
    },
  });
  return module.exports;
};
const gate = load('src/features/billing/billing-sandbox-gate.ts');
const base = {
  development: true,
  platform: 'ios',
  enabled: 'true',
  supabaseUrl: 'http://127.0.0.1:54321',
  targetMode: 'local',
  projectRef: 'local-pawday',
  allowedHost: '',
};
assert.ok(gate.canUseBillingSandbox(base));
for (const diff of [
  { development: false },
  { platform: 'android' },
  { platform: 'web' },
  { enabled: 'false' },
  { targetMode: undefined },
  { projectRef: undefined },
  { supabaseUrl: 'https://tknaobmlwmodsqtpqwkr.supabase.co' },
])
  assert.equal(gate.canUseBillingSandbox({ ...base, ...diff }), false);
const cloud = {
  ...base,
  targetMode: 'cloud',
  projectRef: 'yhxxsawcaffxonpconaq',
  supabaseUrl: 'https://yhxxsawcaffxonpconaq.supabase.co',
  allowedHost: 'yhxxsawcaffxonpconaq.supabase.co',
};
assert.ok(gate.canUseBillingSandbox(cloud));
for (const diff of [
  { projectRef: 'abcdefghijklmnopqrst' },
  { allowedHost: 'wrong' },
  { supabaseUrl: 'https://evil.example' },
  { development: false },
])
  assert.equal(gate.canUseBillingSandbox({ ...cloud, ...diff }), false);
for (const type of [0, 1, 2, 5])
  assert.equal(gate.canUseBillingSigning(true, true, type), false);
for (const type of [3, 4]) {
  assert.equal(gate.canUseBillingSigning(true, true, type), true);
  assert.equal(gate.canUseBillingSigning(false, true, type), false);
  assert.equal(gate.canUseBillingSigning(true, false, type), false);
}
let user = 'owner',
  family = 'family',
  role = 'owner',
  releaseType = 3,
  launcher = true,
  release = false;
let enabled = true,
  chargeEnabled = true,
  locked = false,
  blocked = false,
  pending = false,
  tier = 'free',
  outcome = 'success',
  restorePlus = true,
  reconciliationPending = false,
  legacy = false;
let configured = false,
  sdkUser,
  buys = 0,
  restores = 0,
  manages = 0,
  changeDuringPurchase = false;
let packages,
  offering = 'default';
const calls = [];
const products = {
  monthly: 'homeypaw.familyplus.monthly',
  yearly: 'homeypaw.familyplus.yearly',
};
const monthly = {
  identifier: '$rc_monthly',
  packageType: 'MONTHLY',
  product: {
    identifier: products.monthly,
    priceString: 'HK$28.00',
    price: 28,
    currencyCode: 'HKD',
  },
};
const annual = {
  identifier: '$rc_annual',
  packageType: 'ANNUAL',
  product: {
    identifier: products.yearly,
    priceString: 'HK$228.00',
    price: 228,
    currencyCode: 'HKD',
  },
};
packages = [monthly, annual];
const purchases = {
  PURCHASES_ERROR_CODE: {
    PAYMENT_PENDING_ERROR: '20',
    PURCHASE_CANCELLED_ERROR: '1',
  },
  isConfigured: async () => configured,
  configure: ({ appUserID }) => {
    configured = true;
    sdkUser = appUserID;
  },
  getAppUserID: async () => sdkUser,
  logIn: async (id) => {
    sdkUser = id;
  },
  getCustomerInfo: async () => ({
    originalAppUserId: sdkUser,
    entitlements: { active: { family_plus: {} } },
  }),
  getOfferings: async () => ({
    all: { [offering]: { availablePackages: packages } },
    current: { availablePackages: packages },
  }),
  purchasePackage: async (item) => {
    assert.ok(
      [products.monthly, products.yearly].includes(item.product.identifier),
    );
    buys++;
    if (outcome === 'pending') throw { code: '20' };
    if (outcome === 'cancel') throw { code: '1' };
    if (outcome === 'failure') throw { code: '10' };
    tier = 'plus';
    pending = false;
    if (changeDuringPurchase) {
      user = 'other';
      client.setBillingAuthUser(user);
    }
  },
  restorePurchases: async () => {
    restores++;
    if (restorePlus) tier = 'plus';
  },
  showManageSubscriptions: async () => {
    manages++;
  },
};
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: user } }, error: null }),
  },
  rpc: async (name, args = {}) => {
    calls.push({ name, args });
    if (name === 'get_family_plus_summary')
      return {
        data: { family_id: family, viewer_user_id: user, role },
        error: args.target_family_id === family ? null : { code: '42501' },
      };
    if (name === 'is_pre_cutover_release_locked')
      return { data: locked, error: null };
    if (name === 'get_family_billing_state')
      return {
        data: {
          tier,
          environment: release ? 'PRODUCTION' : 'SANDBOX',
          limit_bytes: tier === 'plus' ? 5368709120 : 314572800,
          sandbox_enabled: enabled && chargeEnabled,
          billing_enabled: enabled,
          has_subscription: tier === 'plus',
          purchase_blocked: blocked || tier === 'plus',
          pending_intent: pending,
        },
        error: null,
      };
    if (name === 'get_family_billing_customer')
      return { data: legacy ? 'old-payer-uuid' : user, error: null };
    if (name === 'begin_family_billing_purchase')
      return {
        data: {
          intent_id: 'intent',
          customer_id: user,
          product_id: products[args.period],
          status: 'prepared',
        },
        error: null,
      };
    if (name === 'update_family_billing_intent') {
      pending = args.next_status === 'store_pending';
      return { data: null, error: null };
    }
    throw new Error('UNEXPECTED_RPC_' + name);
  },
  functions: {
    invoke: async (_name, args) => ({
      data:
        args.body?.operation === 'purchase_preflight'
          ? { status: 'purchase_ready', family_id: family }
          : { status: reconciliationPending ? 'retry' : 'reconciled' },
      error: null,
    }),
  },
};
const env = {
  EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED: 'true',
  EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE: 'local',
  EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF: 'local-pawday',
  EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY: 'appl_synthetic',
  EXPO_PUBLIC_REVENUECAT_APPLE_KEY: 'appl_release_fixture',
};
const deps = {
  'expo-application': {
    getIosApplicationReleaseTypeAsync: async () => releaseType,
  },
  expo: { requireOptionalNativeModule: () => (launcher ? {} : null) },
  'expo-crypto': { randomUUID: () => 'intent' },
  'react-native': { Platform: { OS: 'ios' } },
  'react-native-purchases': {
    __esModule: true,
    default: purchases,
    STOREKIT_VERSION: { STOREKIT_2: 'STOREKIT_2' },
  },
  '@/features/app-release/minimum-version': {
    getAppVersionHeaders: () => ({}),
  },
  '@/lib/supabase/client': { requireSupabase: () => supabase },
  '@/lib/supabase/environment': {
    supabaseEnvironment: { url: base.supabaseUrl },
  },
  './billing-sandbox-gate': gate,
  './family-plus-environment': { isFamilyPlusRelease: () => release },
};
const client = load('src/features/billing/billing-client.ts', deps, {
  __DEV__: true,
  process: { env },
});
const fresh = () => {
  tier = 'free';
  pending = false;
  blocked = false;
  outcome = 'success';
  reconciliationPending = false;
};
for (const r of ['member', 'viewer', null]) {
  role = r;
  await assert.rejects(
    client.purchaseFamilyPlus(user, family, monthly),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    client.restoreFamilyPlus(user, family),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    client.manageAppleSubscription(user, family),
    /OWNER_REQUIRED/,
  );
}
assert.equal(buys + restores + manages, 0);
role = 'owner';
await assert.rejects(client.purchaseFamilyPlus(user, 'other-family', monthly));
enabled = false;
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /NOT_CONFIGURED/,
);
enabled = true;
locked = true;
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /NOT_CONFIGURED/,
);
locked = false;
for (const r of [0, 1, 2, 5]) {
  releaseType = r;
  await assert.rejects(
    client.purchaseFamilyPlus(user, family, monthly),
    /DEVELOPMENT_BUILD_REQUIRED/,
  );
}
releaseType = 4;
launcher = false;
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /DEVELOPMENT_BUILD_REQUIRED/,
);
launcher = true;
delete env.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY;
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /NOT_CONFIGURED/,
  'Sandbox never falls back to a generic release SDK key',
);
env.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY = 'test_bad';
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /NOT_CONFIGURED/,
);
env.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY = 'appl_synthetic';
legacy = true;
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /LEGACY_IDENTITY_REVIEW_REQUIRED/,
);
legacy = false;
assert.equal(buys, 0);
const loaded = await client.loadSandboxPackages(user, family);
assert.equal(loaded.length, 2);
assert.equal(loaded[0].product.priceString, 'HK$28.00');
assert.equal(
  sdkUser,
  user,
  'identified by Auth UUID; no Family ID or random payer ID',
);
assert.equal(
  tier,
  'free',
  'SDK CustomerInfo active entitlement is not Family authority',
);
offering = 'other';
assert.equal((await client.loadSandboxPackages(user, family)).length, 0);
offering = 'default';
await assert.rejects(
  client.purchaseFamilyPlus(user, family, {
    ...monthly,
    product: { ...monthly.product, identifier: 'unexpected' },
  }),
  /PRODUCTS_UNAVAILABLE/,
);
for (const p of [monthly, annual]) {
  fresh();
  assert.equal(await client.purchaseFamilyPlus(user, family, p), 'confirmed');
  assert.equal(
    calls.findLast((c) => c.name === 'begin_family_billing_purchase').args
      .period,
    p === annual ? 'yearly' : 'monthly',
  );
  await assert.rejects(
    client.purchaseFamilyPlus(user, family, p),
    /ALREADY_SUBSCRIBED/,
  );
}
fresh();
releaseType = 3;
assert.equal(
  await client.purchaseFamilyPlus(user, family, monthly),
  'confirmed',
);
fresh();
outcome = 'cancel';
assert.equal(
  await client.purchaseFamilyPlus(user, family, monthly),
  'cancelled',
);
assert.equal(
  calls.findLast((c) => c.name === 'update_family_billing_intent').args
    .next_status,
  'cancelled',
);
fresh();
outcome = 'pending';
assert.equal(await client.purchaseFamilyPlus(user, family, monthly), 'pending');
assert.equal(pending, true);
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /ALREADY_SUBSCRIBED/,
);
fresh();
outcome = 'failure';
const at = calls.length;
assert.equal(await client.purchaseFamilyPlus(user, family, monthly), 'failed');
assert.equal(pending, true);
assert.ok(
  !calls
    .slice(at)
    .some(
      (c) =>
        c.name === 'update_family_billing_intent' &&
        c.args.next_status === 'failed',
    ),
);
fresh();
const restoreAt = calls.length;
const nativeRestoreAt = restores;
const purchaseAtRestore = buys;
restorePlus = true;
assert.equal(await client.restoreFamilyPlus(user, family), 'confirmed');
assert.equal(restores, nativeRestoreAt + 1, 'restore reaches the native SDK');
assert.equal(buys, purchaseAtRestore, 'restore never initiates a purchase');
assert.ok(
  !calls
    .slice(restoreAt)
    .some((c) => c.name === 'begin_family_billing_purchase'),
  'restore cannot create a Family claim',
);
reconciliationPending = true;
const pendingRestoreAt = calls.length;
assert.equal(
  await client.restoreFamilyPlus(user, family),
  'pending',
  'existing Plus does not confirm a restore when fresh reconciliation is pending',
);
assert.ok(
  !calls
    .slice(pendingRestoreAt)
    .some((c) => c.name === 'begin_family_billing_purchase'),
);
fresh();
restorePlus = false;
assert.equal(await client.restoreFamilyPlus(user, family), 'nothingToRestore');
await client.manageAppleSubscription(user, family);
assert.equal(manages, 1);
chargeEnabled = false;
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /NOT_CONFIGURED/,
);
await client.manageAppleSubscription(user, family);
assert.equal(
  manages,
  2,
  'closing checkout does not hide Apple cancellation management',
);
assert.equal(await client.restoreFamilyPlus(user, family), 'nothingToRestore');
chargeEnabled = true;
fresh();
const inFlight = client.purchaseFamilyPlus(user, family, monthly);
await assert.rejects(
  client.purchaseFamilyPlus(user, family, monthly),
  /OPERATION_IN_PROGRESS/,
);
await inFlight;
fresh();
changeDuringPurchase = true;
await assert.rejects(
  client.purchaseFamilyPlus('owner', family, monthly),
  /ACCOUNT_CHANGED/,
);
changeDuringPurchase = false;
fresh();
await assert.rejects(
  client.purchaseFamilyPlus('owner', family, monthly),
  /ACCOUNT_CHANGED/,
);
const otherProducts = await client.loadSandboxPackages('other', family);
assert.equal(otherProducts.length, 2);
assert.equal(sdkUser, 'other');
client.setBillingAuthUser(null);
await assert.rejects(
  client.purchaseFamilyPlus('other', family, monthly),
  /ACCOUNT_CHANGED/,
);
client.setBillingAuthUser('other');
fresh();
// Release path still requires server readiness; a client flag is insufficient.
release = true;
releaseType = 5;
const releaseClient = load('src/features/billing/billing-client.ts', deps, {
  __DEV__: false,
  process: { env },
});
enabled = false;
const buysBefore = buys;
await assert.rejects(
  releaseClient.purchaseFamilyPlus(user, family, monthly),
  /NOT_CONFIGURED/,
);
assert.equal(buys, buysBefore);
enabled = true;
releaseType = 4;
await assert.rejects(
  releaseClient.purchaseFamilyPlus(user, family, monthly),
  /DEVELOPMENT_BUILD_REQUIRED/,
);
releaseType = 5;
assert.equal(
  await releaseClient.purchaseFamilyPlus(user, family, monthly),
  'confirmed',
);
const source = read('src/features/billing/billing-client.ts');
assert.ok(!source.includes('purchases.logOut('));
assert.ok(!source.includes('entitlements.active'));
assert.ok(source.includes('offerings.all.default'));
assert.ok(source.includes('customerId !== userId'));
assert.ok(
  read('src/features/billing/family-plus-sandbox-screen.tsx').includes(
    "role === 'owner'",
  ),
);
console.log(
  'PASS (mock StoreKit only): canonical Owner checks; explicit Sandbox/signing and separate gated release; default Offering/product allowlist; localized HKD prices; Auth UUID identity; logout/account-change fencing; cancellation/pending/failure; no duplicate charge; restore without claim; empty restore is not success; server-only entitlement confirmation. No real purchase.',
);

// The final Production binary's isolated test-account instance never borrows
// its default Production transport, identity or environment assertion.
fresh();
configured = false;
user = 'owner';
family = 'family';
role = 'owner';
release = true;
releaseType = 5;
launcher = false;
const defaultCalls = calls.length;
let authorizations = 0;
const isolatedClient = {
  auth: {
    getUser: async () => ({
      data: { user: { id: 'sandbox-owner' } },
      error: null,
    }),
  },
  rpc: async (name) => {
    if (name === 'get_family_plus_summary')
      return {
        data: {
          family_id: 'sandbox-family',
          viewer_user_id: 'sandbox-owner',
          role: 'owner',
        },
        error: null,
      };
    if (name === 'is_pre_cutover_release_locked')
      return { data: false, error: null };
    if (name === 'get_family_billing_customer')
      return { data: 'sandbox-owner', error: null };
    if (name === 'get_family_billing_state')
      return {
        data: {
          tier: 'free',
          environment: 'SANDBOX',
          limit_bytes: 314572800,
          sandbox_enabled: true,
          billing_enabled: true,
          has_subscription: false,
          purchase_blocked: false,
          pending_intent: false,
        },
        error: null,
      };
    throw new Error('Unexpected isolated RPC');
  },
};
const reviewClient = releaseClient.createFamilyBillingClient({
  getClient: () => isolatedClient,
  environment: 'SANDBOX',
  enabled: () => true,
  storeBuild: true,
  applePublicKey: () => env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY,
  authorize: async () => {
    authorizations++;
  },
});
reviewClient.setBillingAuthUser('sandbox-owner');
assert.equal(
  (await reviewClient.loadSandboxPackages('sandbox-owner', 'sandbox-family'))
    .length,
  2,
);
assert.equal(sdkUser, 'sandbox-owner');
assert.equal(calls.length, defaultCalls);
assert.ok(authorizations > 0);
reviewClient.setBillingAuthUser(null);
await assert.rejects(
  reviewClient.loadSandboxPackages('sandbox-owner', 'sandbox-family'),
  /ACCOUNT_CHANGED/,
);
console.log(
  'PASS: Store-signed approved test-account instance uses only its Sandbox Auth/RPC/RevenueCat UUID; main Production transport untouched; session close invalidates operations.',
);
fresh();
release = false;
configured = false;
user = 'owner';
role = 'owner';
releaseType = 5;
launcher = false;
const rcEnv = {
  ...env,
  EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET: 'billing-rc-sandbox',
  EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE: 'cloud',
  EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF: 'yhxxsawcaffxonpconaq',
  EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_HOST: 'yhxxsawcaffxonpconaq.supabase.co',
};
const signedRC = load(
  'src/features/billing/billing-client.ts',
  {
    ...deps,
    '@/lib/supabase/environment': {
      supabaseEnvironment: { url: 'https://yhxxsawcaffxonpconaq.supabase.co' },
    },
  },
  { __DEV__: false, process: { env: rcEnv } },
);
assert.equal((await signedRC.loadSandboxPackages(user, family)).length, 2);
assert.equal(sdkUser, user);
releaseType = 4;
await assert.rejects(
  signedRC.loadSandboxPackages(user, family),
  /DEVELOPMENT_BUILD_REQUIRED/,
);
console.log(
  'PASS: actual default Billing client supports the explicit Store-signed Sandbox RC without Metro/Dev Launcher, retains Auth UUID and denies wrong signing.',
);

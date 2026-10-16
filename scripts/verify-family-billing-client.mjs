import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const load = (path, dependencies = {}, globals = {}) => {
  const module = { exports: {} };
  new Script(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).runInNewContext({
    exports: module.exports,
    module,
    URL,
    Date,
    Boolean,
    Error,
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
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
  allowedHost: '',
  targetMode: 'local',
  projectRef: 'local-pawday',
};
assert.ok(gate.canUseBillingSandbox(base));
for (const change of [
  { development: false },
  { platform: 'android' },
  { platform: 'web' },
  { enabled: 'false' },
  { targetMode: undefined },
  { targetMode: 'cloud' },
  { projectRef: undefined },
  {
    supabaseUrl: 'https://tknaobmlwmodsqtpqwkr.supabase.co',
    allowedHost: 'tknaobmlwmodsqtpqwkr.supabase.co',
  },
  { supabaseUrl: 'https://unknown.supabase.co' },
])
  assert.equal(gate.canUseBillingSandbox({ ...base, ...change }), false);
const cloudTarget = {
  ...base,
  targetMode: 'cloud',
  projectRef: 'abcdefghijklmnopqrst',
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  allowedHost: 'abcdefghijklmnopqrst.supabase.co',
};
assert.ok(gate.canUseBillingSandbox(cloudTarget));
assert.equal(
  gate.canUseBillingSandbox({
    ...cloudTarget,
    projectRef: 'bcdefghijklmnopqrstu',
  }),
  false,
);
let user = 'owner';
let releaseType = 3;
let tier = 'free';
let outcome = 'success';
let buyCalls = 0;
let restoreCalls = 0;
let configureId;
let devLauncher = true;
const calls = [];
let intent = 'intent';
let configured = false;
const purchases = {
  PURCHASES_ERROR_CODE: {
    PAYMENT_PENDING_ERROR: '20',
    PURCHASE_CANCELLED_ERROR: '1',
  },
  isConfigured: async () => configured,
  configure: ({ appUserID }) => {
    configured = true;
    configureId = appUserID;
  },
  getAppUserID: async () => configureId,
  getCustomerInfo: async () => ({}),
  logIn: async (id) => {
    configureId = id;
  },
  getOfferings: async () => ({ current: { availablePackages: [] } }),
  purchasePackage: async () => {
    buyCalls++;
    if (outcome === 'pending') throw { code: '20' };
    if (outcome === 'cancel') throw { code: '1' };
    if (outcome === 'failure') throw { code: '10' };
    tier = 'plus';
  },
  restorePurchases: async () => {
    restoreCalls++;
  },
  showManageSubscriptions: async () => undefined,
};
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: user } }, error: null }),
  },
  rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_family_billing_customer')
      return { data: 'payer-stable-uuid', error: null };
    if (name === 'get_family_billing_state')
      return {
        data: { tier, limit_bytes: tier === 'plus' ? 5368709120 : 314572800 },
        error: null,
      };
    if (name === 'begin_family_billing_purchase')
      return {
        data: {
          intent_id: intent,
          customer_id: 'payer-stable-uuid',
          product_id: args.period === 'yearly' ? 'annual' : 'monthly',
          status: 'prepared',
        },
        error: null,
      };
    return { data: null, error: null };
  },
  functions: {
    invoke: async (_name, args) => ({
      data:
        args?.body?.operation === 'purchase_preflight'
          ? { status: 'purchase_ready', family_id: 'family' }
          : { status: 'empty' },
      error: null,
    }),
  },
};
const environment = {
  EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED: 'true',
  EXPO_PUBLIC_SUPABASE_URL: base.supabaseUrl,
  EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE: base.targetMode,
  EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF: base.projectRef,
  EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY: 'appl_synthetic',
};
const client = load(
  'src/features/billing/billing-client.ts',
  {
    'expo-application': {
      getIosApplicationReleaseTypeAsync: async () => releaseType,
      ApplicationReleaseType: { DEVELOPMENT: 3 },
    },
    expo: { requireOptionalNativeModule: () => (devLauncher ? {} : null) },
    'expo-crypto': { randomUUID: () => intent },
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
    './billing-sandbox-gate': gate,
  },
  {
    __DEV__: true,
    process: { env: environment },
  },
);
const monthly = {
  packageType: 'MONTHLY',
  product: { identifier: 'monthly', priceString: 'Localized test price' },
};
releaseType = 5;
await assert.rejects(
  client.purchaseFamilyPlus(user, 'family', monthly),
  /DEVELOPMENT_BUILD_REQUIRED/u,
);
assert.equal(buyCalls, 0);
for (const type of [0, 1, 2, 5])
  assert.equal(gate.canUseBillingSigning(true, true, type), false);
for (const type of [3, 4]) {
  assert.equal(gate.canUseBillingSigning(true, true, type), true);
  assert.equal(gate.canUseBillingSigning(false, true, type), false);
  assert.equal(gate.canUseBillingSigning(true, false, type), false);
}
devLauncher = false;
releaseType = 4;
await assert.rejects(
  client.purchaseFamilyPlus(user, 'family', monthly),
  /DEVELOPMENT_BUILD_REQUIRED/,
);
assert.equal(buyCalls, 0);
devLauncher = true;
environment.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY = 'test_synthetic';
await assert.rejects(
  client.purchaseFamilyPlus(user, 'family', monthly),
  /SANDBOX_NOT_CONFIGURED/,
);
assert.equal(buyCalls, 0);
environment.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY = 'appl_synthetic';
assert.equal(
  await client.purchaseFamilyPlus(user, 'family', monthly),
  'confirmed',
);
releaseType = 3;
assert.equal(
  await client.purchaseFamilyPlus(user, 'family', monthly),
  'confirmed',
);
assert.equal(configureId, 'payer-stable-uuid');
assert.ok(
  calls.find(
    (c) =>
      c.name === 'begin_family_billing_purchase' &&
      c.args.target_family_id === 'family',
  ),
);
assert.equal(
  await client.purchaseFamilyPlus(user, 'family', {
    ...monthly,
    packageType: 'ANNUAL',
    product: { identifier: 'annual' },
  }),
  'confirmed',
);
outcome = 'cancel';
assert.equal(
  await client.purchaseFamilyPlus(user, 'family', monthly),
  'cancelled',
);
assert.ok(
  calls.find(
    (c) =>
      c.name === 'update_family_billing_intent' &&
      c.args.next_status === 'cancelled',
  ),
);
outcome = 'pending';
assert.equal(
  await client.purchaseFamilyPlus(user, 'family', monthly),
  'pending',
);
outcome = 'failure';
const failedAt = calls.length;
assert.equal(
  await client.purchaseFamilyPlus(user, 'family', monthly),
  'failed',
);
assert.ok(
  !calls
    .slice(failedAt)
    .some(
      (c) =>
        c.name === 'update_family_billing_intent' &&
        c.args.next_status === 'failed',
    ),
);
outcome = 'success';
const beforeRestore = calls.length;
await client.restoreFamilyPlus(user);
assert.equal(restoreCalls, 1);
assert.ok(
  !calls
    .slice(beforeRestore)
    .some((c) => c.name === 'begin_family_billing_purchase'),
);
const concurrent = client.purchaseFamilyPlus(user, 'family', monthly);
await assert.rejects(
  client.purchaseFamilyPlus(user, 'family', monthly),
  /OPERATION_IN_PROGRESS/u,
);
await concurrent;
user = 'other';
await assert.rejects(
  client.purchaseFamilyPlus('owner', 'family', monthly),
  /ACCOUNT_CHANGED/u,
);
const screen = read('src/features/billing/family-plus-sandbox-screen.tsx');
assert.ok(screen.includes("role === 'owner'"));
assert.ok(screen.includes('item.product.priceString'));
assert.ok(screen.includes('state.data?.purchase_blocked'));
assert.ok(screen.includes('readFamilyBillingState(currentFamilyId!)'));
assert.ok(!screen.includes('currentPetId'));
assert.ok(!read('src/features/billing/billing-client.ts').includes('logOut('));
assert.ok(
  read('src/app/family-plus-sandbox.tsx').includes('isBillingSandboxEnabled()'),
);
console.log(
  'PASS (mock native SDK): release/target gate, stable payer identity, monthly/yearly intent, cancellation, pending/ambiguous failure, restore without Family claim, repeated-tap lock, account-change denial, localized SDK prices and shared Family state. No StoreKit purchase performed.',
);

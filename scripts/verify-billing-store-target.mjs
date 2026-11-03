import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { z } from 'zod';
import ts from 'typescript';
import { checkStoreBuildTarget } from './check-store-build-target.mjs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function load(p, deps = {}, globals = {}) {
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
    atob,
    Date,
    Error,
    process: { env: {} },
    __DEV__: false,
    require: (n) => {
      assert.ok(n in deps, n);
      return deps[n];
    },
    ...globals,
  });
  return module.exports;
}
const environment = load('src/lib/supabase/environment.ts');
const sandbox = 'yhxxsawcaffxonpconaq',
  production = 'tknaobmlwmodsqtpqwkr';
const input = {
  development: false,
  target: 'sandbox-rc',
  buildTarget: 'billing-rc-sandbox',
  sandboxUrl: `https://${sandbox}.supabase.co`,
  sandboxKey: 'sb_publishable_fixture',
  url: `https://${production}.supabase.co`,
  key: 'sb_publishable_production_fixture',
};
assert.equal(environment.resolveSupabaseEnvironment(input).sandbox, true);
for (const change of [
  { buildTarget: undefined },
  { target: undefined },
  { development: true },
  { sandboxKey: undefined },
  { sandboxKey: 'sb_secret_denied' },
  { sandboxUrl: input.url },
  { buildTarget: 'production' },
])
  assert.equal(
    environment.resolveSupabaseEnvironment({ ...input, ...change }).url,
    undefined,
  );
const prod = { ...input, target: 'production', buildTarget: 'production' };
assert.equal(environment.resolveSupabaseEnvironment(prod).url, input.url);
for (const change of [
  { url: undefined },
  { key: undefined },
  { target: undefined },
  { url: input.sandboxUrl },
  { buildTarget: undefined },
])
  assert.equal(
    environment.resolveSupabaseEnvironment({ ...prod, ...change }).url,
    undefined,
  );
const signing = load('src/features/billing/billing-sandbox-gate.ts');
assert.equal(signing.canUseBillingSigning(false, false, 5, true), true);
for (const type of [0, 1, 2, 3, 4])
  assert.equal(signing.canUseBillingSigning(false, false, type, true), false);
assert.equal(signing.canUseBillingSigning(false, false, 5), false);
const guard = {
  development: false,
  buildTarget: 'billing-rc-sandbox',
  platform: 'ios',
  enabled: 'true',
  supabaseUrl: input.sandboxUrl,
  allowedHost: sandbox + '.supabase.co',
  targetMode: 'cloud',
  projectRef: sandbox,
};
assert.equal(signing.canUseBillingSandbox(guard), true);
for (const change of [
  { buildTarget: undefined },
  { buildTarget: 'production' },
  { enabled: 'false' },
  { supabaseUrl: input.url },
  { projectRef: production },
  { platform: 'android' },
  { targetMode: 'local' },
])
  assert.equal(signing.canUseBillingSandbox({ ...guard, ...change }), false);
const eas = JSON.parse(read('eas.json'));
const rc = {
  ...eas.build['billing-rc-sandbox'].env,
  EAS_BUILD_PROFILE: 'billing-rc-sandbox',
  EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY: 'appl_fixture',
};
checkStoreBuildTarget(rc);
assert.equal(eas.build['billing-rc-sandbox'].developmentClient, false);
assert.equal(eas.build['billing-rc-sandbox'].distribution, 'store');
assert.equal(eas.build['billing-rc-sandbox'].extends, undefined);
assert.equal(eas.build['billing-rc-sandbox'].environment, 'preview');
for (const profile of Object.values(eas.build))
  for (const value of Object.values(profile.env ?? {}))
    assert.notEqual(value, '', 'EAS rejects empty environment values');
const prodEnv = {
  ...eas.build.production.env,
  EAS_BUILD_PROFILE: 'production',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_production_fixture',
  EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  EXPO_PUBLIC_REVENUECAT_APPLE_KEY: 'appl_fixture',
};
checkStoreBuildTarget(prodEnv);
for (const change of [
  { EXPO_PUBLIC_HOMEYPAW_TARGET: 'sandbox-rc' },
  { EXPO_PUBLIC_SUPABASE_URL: input.sandboxUrl },
  { EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY: undefined },
  { EXPO_PUBLIC_REVENUECAT_APPLE_KEY: 'test_fixture' },
  { EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED: 'true' },
  { EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED: undefined },
  { EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED: 'false' },
  { HOMEYPAW_IOS_BUILD_NUMBER: rc.HOMEYPAW_IOS_BUILD_NUMBER },
])
  assert.throws(() => checkStoreBuildTarget({ ...prodEnv, ...change }));
for (const change of [
  { EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY: 'test_fixture' },
  { EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_denied' },
  { EAS_BUILD_PROFILE: 'preview' },
  { HOMEYPAW_IOS_BUILD_NUMBER: undefined },
  { HOMEYPAW_IOS_BUILD_NUMBER: prodEnv.HOMEYPAW_IOS_BUILD_NUMBER },
  { EXPO_PUBLIC_SUPABASE_URL: input.url },
  { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: input.key },
  { EXPO_PUBLIC_REVENUECAT_APPLE_KEY: 'appl_wrong_environment' },
])
  assert.throws(() => checkStoreBuildTarget({ ...rc, ...change }));
console.log(
  'PASS: explicit Store Sandbox RC/Production targets, no missing-config fallback, signing without Dev Launcher, profile guard and public-key-only build inputs.',
);

const uid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  family = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
let approved = true,
  closed = false,
  user = uid,
  admissions = 0,
  login = 0,
  factoryOptions,
  authListener;
const binding = () => ({
  user_id: uid,
  family_id: family,
  role: 'owner',
  project_ref: sandbox,
  environment: 'SANDBOX',
  server_time: '2026-10-24T00:00:00Z',
  expires_at: '2026-10-25T00:00:00Z',
});
const candidate = {
  auth: {
    signInWithPassword: async () => {
      login++;
      return { error: null };
    },
    getUser: async () => ({ data: { user: { id: user } }, error: null }),
    onAuthStateChange: (f) => {
      authListener = f;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signOut: async () => {
      closed = true;
      return {};
    },
    stopAutoRefresh: () => {},
  },
  rpc: async (name) => {
    assert.equal(name, 'get_family_billing_test_access');
    admissions++;
    return { data: binding(), error: approved ? null : { code: '42501' } };
  },
};
const deps = {
  '@supabase/supabase-js': {
    createClient: (url, key, options) => {
      assert.equal(url, input.sandboxUrl);
      assert.equal(key, 'sb_publishable_fixture');
      assert.equal(options.auth.persistSession, false);
      assert.equal(options.auth.detectSessionInUrl, false);
      return candidate;
    },
  },
  'react-native': { Platform: { OS: 'ios' } },
  zod: { z },
  '@/lib/network-fetch': {
    fetchWithTimeout: () => {
      throw new Error('No real network permitted');
    },
  },
  '@/lib/supabase/environment': {
    ...environment,
    supabaseEnvironment: {
      url: input.url,
      key: prodEnv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      sandbox: false,
    },
  },
  './billing-client': {
    createFamilyBillingClient: (options) => {
      factoryOptions = options;
      return { setBillingAuthUser: () => {} };
    },
  },
  './family-plus-data': {},
};
const module = load('src/features/billing/billing-test-account.ts', deps, {
  process: { env: prodEnv },
});
assert.equal(module.canUseBillingTestAccount(), true);
assert.equal(
  module.parseBillingTestAdmission(binding(), uid).family_id,
  family,
);
for (const change of [
  { user_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' },
  { environment: 'PRODUCTION' },
  { project_ref: production },
  { expires_at: '2026-10-24T00:00:00Z' },
])
  assert.throws(() =>
    module.parseBillingTestAdmission({ ...binding(), ...change }, uid),
  );
approved = false;
await assert.rejects(
  module.signInBillingTestAccount(
    'synthetic@example.test',
    'synthetic-password',
  ),
  /ACCESS_DENIED/,
);
assert.equal(closed, true);
assert.equal(factoryOptions, undefined);
approved = true;
closed = false;
const account = await module.signInBillingTestAccount(
  'synthetic@example.test',
  'synthetic-password',
);
assert.equal(account.binding.user_id, uid);
assert.equal(factoryOptions.environment, 'SANDBOX');
assert.equal(factoryOptions.getClient(), candidate);
assert.equal(factoryOptions.applePublicKey(), 'appl_fixture');
await factoryOptions.authorize();
approved = false;
await assert.rejects(factoryOptions.authorize(), /ACCESS_DENIED/);
approved = true;
user = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
await assert.rejects(factoryOptions.authorize(), /ACCESS_DENIED/);
authListener('SIGNED_OUT', null);
assert.equal(factoryOptions.enabled(), false);
await account.close();
assert.equal(closed, true);
const denied = load('src/features/billing/billing-test-account.ts', deps, {
  process: {
    env: { ...prodEnv, EXPO_PUBLIC_APP_REVIEW_ACCOUNT_ENABLED: 'false' },
  },
});
assert.equal(denied.canUseBillingTestAccount(), false);
const beforeLogin = login;
await assert.rejects(
  denied.signInBillingTestAccount(
    'synthetic@example.test',
    'synthetic-password',
  ),
  /ACCESS_DENIED/,
);
assert.equal(login, beforeLogin);
assert.ok(admissions >= 3);
assert.match(
  read('src/features/billing/billing-test-account-screen.tsx'),
  /QueryClientProvider/,
);
assert.match(
  read('src/features/billing/family-plus-screen.tsx'),
  /!suppliedBilling/,
);
assert.doesNotMatch(
  read('src/features/billing/billing-test-account.ts'),
  /requireSupabase|isPlus|localStorage|service_role/,
);
console.log(
  'PASS: Production account stays untouched; separate Sandbox Auth/getUser + server-approved Family binding; revoked/expired/mismatched identity denied, no local persistence or fake Plus, private cache and no duplicate default billing query. Mock Auth/RPC only.',
);

import assert from 'node:assert/strict';
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import ts from 'typescript';
import { Buffer } from 'node:buffer';
import {
  assertProductionBillingTarget,
  assertSandboxTarget,
} from '../supabase/functions/_shared/family-billing-target.mjs';
import {
  createBillingWebhookHandler,
  createRevenueCatReader,
  reconcileCustomer,
} from '../supabase/functions/_shared/family-billing-sandbox.mjs';

const load = (p, deps = {}, globals = {}) => {
  const module = { exports: {} };
  const source = readFileSync(new URL('../' + p, import.meta.url), 'utf8');
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
    URL,
    Error,
    atob,
    ...globals,
    require: (n) => {
      assert.ok(n in deps, n);
      return deps[n];
    },
  });
  return module.exports;
};
const sandbox = 'yhxxsawcaffxonpconaq',
  production = 'tknaobmlwmodsqtpqwkr';
const vars = { __DEV__: true, process: { env: {} } };
const config = load('src/lib/supabase/environment.ts', {}, vars);
const preview = load('src/features/billing/family-plus-preview.ts');
const input = {
  development: true,
  target: 'sandbox',
  url: `https://${production}.supabase.co`,
  key: 'sb_publishable_production_fixture',
  sandboxUrl: `https://${sandbox}.supabase.co`,
  sandboxKey: 'sb_publishable_sandbox_fixture',
};
const valid = config.resolveSupabaseEnvironment(input);
assert.equal(valid.url, input.sandboxUrl);
assert.equal(valid.key, input.sandboxKey);
assert.equal(valid.sandbox, true);
for (const change of [
  { target: 'sandobx' },
  { development: false },
  { sandboxKey: undefined },
  { sandboxUrl: input.url },
  { sandboxKey: 'sb_secret_fixture' },
  { sandboxUrl: 'http://127.0.0.1:54321' },
]) {
  const out = config.resolveSupabaseEnvironment({ ...input, ...change });
  assert.equal(out.url, undefined);
  assert.equal(out.key, undefined);
}
const jwt = (ref, role) =>
  'eyJfixture.' +
  Buffer.from(JSON.stringify({ ref, role })).toString('base64url') +
  '.synthetic';
assert.equal(
  config.resolveSupabaseEnvironment({
    ...input,
    sandboxKey: jwt(production, 'anon'),
  }).url,
  undefined,
);
assert.equal(
  config.resolveSupabaseEnvironment({
    ...input,
    sandboxKey: jwt(sandbox, 'service_role'),
  }).url,
  undefined,
);
assert.equal(
  config.resolveSupabaseEnvironment({
    ...input,
    sandboxKey: jwt(sandbox, 'anon'),
  }).sandbox,
  true,
);
const policy = (environment, development, enabled) =>
  load(
    'src/features/billing/family-plus-environment.ts',
    {
      '@/lib/supabase/environment': { supabaseEnvironment: environment },
      './family-plus-preview': preview,
    },
    {
      __DEV__: development,
      process: {
        env: {
          EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED: enabled,
          EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET: development
            ? undefined
            : 'production',
        },
      },
    },
  );
assert.equal(policy(valid, true, 'false').isFamilyPlusAvailable(), true);
assert.equal(policy(valid, true, 'false').isFamilyPlusRelease(), false);
assert.equal(
  policy(
    { url: input.url, sandbox: false },
    false,
    'false',
  ).isFamilyPlusAvailable(),
  false,
);
assert.equal(
  policy(
    { url: input.url, sandbox: false },
    true,
    'true',
  ).isFamilyPlusAvailable(),
  false,
);
assert.equal(
  policy(
    { url: input.url, sandbox: false },
    false,
    'true',
  ).isFamilyPlusRelease(),
  true,
);
assert.equal(
  policy(
    { url: input.sandboxUrl, sandbox: false },
    false,
    'true',
  ).isFamilyPlusAvailable(),
  false,
);

const prod = {
  mode: 'production',
  projectRef: production,
  url: input.url,
  deploymentId: production + '_12345678-1234-4000-a000-123456789abc_1',
  serviceKey: jwt(production, 'service_role'),
  anonKey: jwt(production, 'anon'),
};
assert.equal(assertProductionBillingTarget(prod), input.url);
for (const change of [
  { mode: 'cloud' },
  { projectRef: sandbox },
  { serviceKey: jwt(sandbox, 'service_role') },
  { anonKey: jwt(sandbox, 'anon') },
  { deploymentId: 'missing' },
  { url: input.url + '/evil' },
])
  assert.throws(() => assertProductionBillingTarget({ ...prod, ...change }));
assert.throws(() => assertSandboxTarget({ ...prod, mode: 'cloud' }));
let inboxWrites = 0;
let acceptedEnvironment = 'PRODUCTION';
const endpoint = createBillingWebhookHandler({
  rpc: async (name) => {
    if (name === 'get_family_billing_server_context')
      return {
        config: { environment: acceptedEnvironment, rc_app_id: 'app_fixture' },
      };
    inboxWrites++;
    throw new Error('UNEXPECTED_MUTATION');
  },
  reader: {},
  webhookSecret: 'a'.repeat(40),
});
assert.equal(
  (
    await endpoint(
      new Request('https://example.test', { method: 'POST', body: '{}' }),
    )
  ).status,
  401,
);
assert.equal(
  (
    await endpoint(
      new Request('https://example.test', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + 'a'.repeat(40) },
        body: JSON.stringify({
          event: {
            id: 'wrong-env',
            event_timestamp_ms: 1,
            environment: 'SANDBOX',
            app_id: 'app_fixture',
          },
        }),
      }),
    )
  ).status,
  403,
);
assert.equal(inboxWrites, 0, 'Sandbox events cannot enter Production inbox');
acceptedEnvironment = 'SANDBOX';
assert.equal(
  (
    await endpoint(
      new Request('https://example.test', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + 'a'.repeat(40) },
        body: JSON.stringify({
          event: {
            id: 'wrong-production',
            event_timestamp_ms: 1,
            environment: 'PRODUCTION',
            app_id: 'app_fixture',
          },
        }),
      }),
    )
  ).status,
  403,
);
assert.equal(inboxWrites, 0, 'Production events cannot enter Sandbox inbox');
const cfg = { environment: 'PRODUCTION', rc_project_id: 'proj_fixture' };
let reads = 0;
const reader = createRevenueCatReader({
  secret: 'synthetic',
  projectId: 'proj_fixture',
  environment: 'PRODUCTION',
  fetchImpl: async (url) => {
    reads++;
    assert.ok(url.includes('environment=production'));
    return new Response(
      JSON.stringify({
        items: [{ store: 'app_store', environment: 'sandbox' }],
        next_page: null,
      }),
    );
  },
});
assert.equal(
  await reader.hasSubscriptions('fixture'),
  false,
  'Sandbox subscription never counts as production',
);
await assert.rejects(
  reader.snapshot('fixture', 'original', { ...cfg, environment: 'SANDBOX' }),
  /PROJECT_DENIED/,
);
assert.equal(reads, 1);

for (const mode of ['new', 'pending', 'known']) {
  const applied = [];
  const finished = [];
  const runtime = {
    rpc: async (name, args) => {
      if (name === 'get_family_billing_server_context')
        return {
          config: { enabled: true },
          chains:
            mode === 'known'
              ? [{ original_transaction_id: 'verified-original' }]
              : [],
          pending_intent: mode === 'pending',
        };
      if (name === 'start_family_billing_refresh') return 1;
      if (name === 'get_family_billing_recovery_anchors') return [];
      if (name === 'finish_family_billing_recovery') {
        finished.push(args.result);
        return null;
      }
      if (name === 'apply_family_billing_snapshot') {
        applied.push(args);
        return null;
      }
      throw new Error('unexpected billing RPC');
    },
    reader: {
      hasSubscriptions: async () => false,
      anchors: async () => {
        assert.equal(
          mode,
          'pending',
          'new payer and known chain do not depend on event history',
        );
        return [];
      },
      snapshot: async () => ({}),
    },
  };
  const outcome = await reconcileCustomer(runtime, 'fixture');
  assert.equal(
    outcome.status,
    mode === 'new'
      ? 'empty'
      : mode === 'pending'
        ? 'pending_chain_anchor'
        : 'reconciled',
  );
  assert.equal(applied.length, mode === 'known' ? 1 : 0);
  assert.equal(finished.length, 1);
}

// Real hook control flow, with mocked IAP boundary. No React renderer/library added.
let slots = [],
  cursor = 0,
  productQueries = [],
  billingReady = true,
  checkoutReady = true,
  billingLocked = false,
  billingTier = 'free',
  restoreOutcome = 'nothingToRestore';
let actions = 0,
  finishPurchase,
  finishRestore,
  delayed = false;
const react = {
  useRef: (init) => {
    const i = cursor++;
    return slots[i] ?? (slots[i] = { current: init });
  },
  useState: (init) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = init;
    return [
      slots[i],
      (v) => {
        slots[i] = v;
      },
    ];
  },
  useEffect: (fn, deps) => {
    const i = cursor++;
    const old = slots[i];
    if (!old || JSON.stringify(old.deps) !== JSON.stringify(deps)) {
      old?.cleanup?.();
      slots[i] = { deps, cleanup: fn() };
    }
  },
};
const hooked = load('src/features/billing/use-family-plus-purchases.ts', {
  react,
  '@tanstack/react-query': {
    useQueryClient: () => ({ invalidateQueries: async () => undefined }),
    useQuery: (options) => {
      productQueries.push(options);
      return options.queryKey[0] === 'family-billing'
        ? {
            data: {
              billing: {
                tier: billingTier,
                sandbox_enabled: billingReady && checkoutReady,
                billing_enabled: billingReady,
                purchase_blocked: billingTier === 'plus',
                pending_intent: false,
              },
              locked: billingLocked,
            },
            isError: false,
            isPending: false,
            refetch: async () => undefined,
          }
        : {
            data: [
              { packageType: 'ANNUAL', product: { priceString: 'HK$228.00' } },
            ],
            isError: false,
            isFetching: false,
            refetch: async () => undefined,
          };
    },
  },
  './use-family-plus': {
    familyPlusKeys: (user, family) => ['family', user, family, 'plus-summary'],
  },
  './billing-client': {
    isFamilyBillingEnabled: () => true,
    loadSandboxPackages: async () => [],
    purchaseFamilyPlus: async () => {
      actions++;
      if (delayed)
        return new Promise((r) => {
          finishPurchase = r;
        });
      return 'confirmed';
    },
    readFamilyBillingState: async () => ({}),
    readBillingReleaseLock: async () => true,
    reconcileBilling: async () => 'confirmed',
    restoreFamilyPlus: async () => {
      actions++;
      if (restoreOutcome === 'deferred')
        return new Promise((resolve) => {
          finishRestore = resolve;
        });
      return restoreOutcome;
    },
    manageAppleSubscription: async () => {
      actions++;
    },
  },
});
const context = {
  userId: 'owner',
  familyId: 'family',
  role: 'owner',
  server: true,
};
const render = (changes = {}) => {
  cursor = 0;
  return hooked.useFamilyPlusPurchases({ ...context, ...changes });
};
for (const role of ['member', 'viewer', null]) {
  const h = render({ role });
  await h.action('purchase', 'yearly');
  await h.action('restore', 'yearly');
  assert.equal(productQueries.at(-1).enabled, false);
}
assert.equal(actions, 0);
billingReady = false;
await render().action('purchase', 'yearly');
assert.equal(actions, 0);
billingReady = true;
billingLocked = true;
await render().action('purchase', 'yearly');
assert.equal(actions, 0);
billingLocked = false;
await render().action('purchase', 'yearly');
assert.equal(actions, 1);
assert.equal(render().message, 'confirmed');
delayed = true;
const pending = render().action('purchase', 'yearly');
const switched = render({ userId: 'other', familyId: 'other-family' });
assert.equal(switched.busy, true);
finishPurchase('confirmed');
await pending;
// Clearing the previous operation must not emit a paid confirmation to another scope.
assert.equal(slots[1], null, 'late purchase must not confirm the next account');
assert.equal(actions, 2);
delayed = false;
checkoutReady = false;
const checkoutClosed = render();
assert.equal(checkoutClosed.ready, false);
assert.equal(checkoutClosed.managementReady, true);
await checkoutClosed.action('purchase', 'monthly');
assert.equal(actions, 2, 'closed checkout cannot purchase');
await checkoutClosed.action('manage', 'monthly');
assert.equal(actions, 3, 'closed checkout can still manage Apple subscription');
checkoutReady = true;

// A paid family still needs the real restore action; existing access must not
// turn a restore failure/pending response into a successful restore.
billingTier = 'plus';
restoreOutcome = 'deferred';
const restoring = render().action('restore', 'yearly');
assert.equal(
  render().message,
  'restoring',
  'a real restore has visible progress',
);
assert.equal(render().busy, true);
finishRestore('failed');
await restoring;
assert.equal(render().message, 'failed');
for (const outcome of [
  'failed',
  'pending',
  'cancelled',
  'nothingToRestore',
  'confirmed',
]) {
  restoreOutcome = outcome;
  const active = render();
  assert.equal(active.blocked, true);
  assert.equal(active.managementReady, true);
  await active.action('restore', 'yearly');
  assert.equal(
    render().message,
    outcome === 'confirmed' ? 'restored' : outcome,
  );
}
for (const flag of ['billing', 'lock']) {
  const before = actions;
  billingReady = flag !== 'billing';
  billingLocked = flag === 'lock';
  const closed = render();
  assert.equal(closed.managementReady, false);
  await closed.action('restore', 'yearly');
  assert.equal(actions, before, 'closed windows never call restore');
}
billingReady = true;
billingLocked = false;
billingTier = 'free';

const dir = mkdtempSync(join(tmpdir(), 'homeypaw-client-launch-'));
chmodSync(dir, 0o700);
try {
  const file = join(dir, 'client.json');
  const values = {
    projectRef: sandbox,
    supabaseUrl: input.sandboxUrl,
    publishableKey: input.sandboxKey,
    billingEnabled: false,
  };
  const check = () =>
    spawnSync(
      process.execPath,
      ['scripts/start-family-plus-sandbox.mjs', '--config', file, '--check'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPO_PUBLIC_SUPABASE_URL: input.url,
          EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'never-log-this',
        },
      },
    );
  writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
  let out = check();
  assert.equal(out.status, 0);
  assert.equal(JSON.parse(out.stdout).productionFallback, false);
  assert.ok(!out.stdout.includes(values.publishableKey));
  for (const diff of [
    { projectRef: production },
    { supabaseUrl: input.url },
    { publishableKey: 'sb_secret_do_not_log' },
    { applePublicKey: 'test_wrong' },
    { billingEnabled: true },
  ]) {
    writeFileSync(file, JSON.stringify({ ...values, ...diff }));
    out = check();
    assert.equal(out.status, 1);
    assert.ok(!out.stderr.includes('do_not_log'));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(
  'PASS: explicit Sandbox source with no Production fallback; release opt-in vs preview isolation; platform-bound backend target; wrong-environment webhook/provider denial; Owner-only real hook actions; locked/disabled backend and account-switch fences; secure Metro config rejects service/test keys. Mock provider only.',
);

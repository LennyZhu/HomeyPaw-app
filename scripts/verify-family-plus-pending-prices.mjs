// Client-only: real Query observers, actual Hook and screen, synthetic transport.
// No HTTP, database, native StoreKit or simulator is available to these fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import {
  QueryClient,
  QueryObserver,
  onlineManager,
} from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { z } from 'zod';
import ts from 'typescript';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const load = (path, dependencies = {}) => {
  const module = { exports: {} };
  new Script(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
  ).runInNewContext({
    module,
    exports: module.exports,
    Error,
    URL,
    Intl,
    setTimeout,
    clearTimeout,
    __DEV__: false,
    process: { env: {} },
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
};
const packages = (label = 'HK$') =>
  ['monthly', 'yearly'].map((period) => ({
    identifier: period,
    packageType: period === 'yearly' ? 'ANNUAL' : 'MONTHLY',
    product: {
      identifier: `homeypaw.familyplus.${period}`,
      priceString: label + (period === 'yearly' ? '228.00' : '32.00'),
    },
  }));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fixture = (overrides = {}) => {
  const value = {
    pending: true,
    billing: true,
    charge: true,
    locked: false,
    fail: false,
    loads: 0,
    purchases: 0,
    ...overrides,
  };
  value.client = {
    isFamilyBillingEnabled: () => true,
    readFamilyBillingState: async () => ({
      tier: 'free',
      billing_enabled: value.billing,
      sandbox_enabled: value.charge,
      pending_intent: value.pending,
      purchase_blocked: false,
    }),
    readBillingReleaseLock: async () => value.locked,
    loadSandboxPackages: async (...args) => {
      value.loads++;
      if (value.fail) throw new Error('fixture product read failed');
      return value.load ? value.load(...args) : packages();
    },
    purchaseFamilyPlus: async () => {
      value.purchases++;
      return 'cancelled';
    },
    reconcileBilling: async () => 'confirmed',
    restoreFamilyPlus: async () => 'nothingToRestore',
    manageAppleSubscription: async () => {},
  };
  return value;
};

let active;
const feedback = load('src/features/billing/billing-purchase-feedback.ts');
const hook = load('src/features/billing/use-family-plus-purchases.ts', {
  react: {
    useState: (initial) => {
      const target = active,
        index = target.cursor++;
      if (!(index in target.slots)) target.slots[index] = initial;
      return [
        target.slots[index],
        (value) => {
          target.slots[index] =
            typeof value === 'function' ? value(target.slots[index]) : value;
        },
      ];
    },
    useRef: (initial) => {
      const index = active.cursor++;
      return (active.slots[index] ??= { current: initial });
    },
    useEffect: (effect, dependencies) => {
      const index = active.cursor++,
        previous = active.slots[index];
      if (
        !previous ||
        dependencies.some((v, i) => v !== previous.dependencies[i])
      ) {
        previous?.cleanup?.();
        active.slots[index] = { dependencies, cleanup: effect() };
      }
    },
  },
  '@tanstack/react-query': {
    useQueryClient: () => active.queryClient,
    useQuery: (options) => {
      const index = active.queryCursor++,
        key = JSON.stringify(options.queryKey);
      let entry = active.queries[index];
      if (entry?.key !== key) {
        entry?.unsubscribe();
        entry?.observer.destroy();
        const observer = new QueryObserver(active.queryClient, options);
        entry = { key, observer, unsubscribe: observer.subscribe(() => {}) };
        active.queries[index] = entry;
      } else entry.observer.setOptions(options);
      return entry.observer.getCurrentResult();
    },
  },
  '@/lib/logger': { logError: () => {} },
  './billing-client': {},
  './billing-purchase-feedback': feedback,
  './use-family-plus': {
    familyPlusKeys: (user, family) => ['summary', user, family],
  },
});
class Harness {
  constructor(client) {
    this.slots = [];
    this.queries = [];
    this.input = {
      client,
      userId: 'owner',
      familyId: 'family',
      role: 'owner',
      server: true,
    };
    this.queryClient = new QueryClient();
    this.queryClient.mount();
  }
  render(changes = {}) {
    Object.assign(this.input, changes);
    active = this;
    this.cursor = this.queryCursor = 0;
    return hook.useFamilyPlusPurchases(this.input);
  }
  async until(predicate) {
    for (let i = 0; i < 40; i++) {
      const result = this.render();
      if (predicate(result)) return result;
      await new Promise(setImmediate);
    }
    assert.fail('Fixture did not reach the expected state');
  }
  close() {
    for (const entry of this.queries) {
      entry.unsubscribe();
      entry.observer.destroy();
    }
    for (const slot of this.slots) slot?.cleanup?.();
    this.queryClient.unmount();
    this.queryClient.clear();
  }
}

const pendingFixture = fixture();
const pendingHarness = new Harness(pendingFixture.client);
const pending = await pendingHarness.until(
  (x) => x.productsStatus === 'success',
);
assert.equal(pending.blocked, true);
assert.equal(pending.pendingIntent, true);
assert.deepEqual(
  Array.from(pending.prices, (p) => p.priceString),
  ['HK$32.00', 'HK$228.00'],
);
await pending.action('purchase', 'yearly');
assert.equal(pendingFixture.purchases, 0);
assert.equal(pendingHarness.render().message, 'blocked');
pendingHarness.close();

for (const gate of [{ billing: false }, { charge: false }, { locked: true }]) {
  const f = fixture(gate),
    h = new Harness(f.client);
  const result = await h.until(
    (x) => !h.queries[0].observer.getCurrentResult().isPending,
  );
  assert.equal(result.ready, false);
  assert.equal(result.productsStatus, 'idle');
  await result.reload();
  await result.action('purchase', 'yearly');
  assert.equal(
    f.loads + f.purchases,
    0,
    'Closed Gate/Lock cannot invoke SDK or checkout',
  );
  h.close();
}
for (const scope of [
  { userId: null },
  { familyId: null },
  { role: 'member' },
]) {
  const f = fixture(),
    h = new Harness(f.client);
  h.render(scope);
  await new Promise(setImmediate);
  const result = h.render();
  await result.reload();
  await result.action('purchase', 'yearly');
  assert.equal(f.loads + f.purchases, 0);
  h.close();
}

const retryFixture = fixture({ fail: true });
const retryHarness = new Harness(retryFixture.client);
let result = await retryHarness.until((x) => x.productsStatus === 'error');
for (let i = 0; i < 5; i++) retryHarness.render();
assert.equal(retryFixture.loads, 1, 'No unbounded automatic retry');
retryFixture.fail = false;
await Promise.all([result.reload(), result.reload()]);
result = await retryHarness.until((x) => x.productsStatus === 'success');
assert.equal(
  retryFixture.loads,
  2,
  'Repeated reload taps make one new product read',
);
assert.equal(result.blocked, true);
retryHarness.close();

const reconnectFixture = fixture({ fail: true });
const reconnectHarness = new Harness(reconnectFixture.client);
await reconnectHarness.until((x) => x.productsStatus === 'error');
onlineManager.setOnline(false);
reconnectFixture.fail = false;
onlineManager.setOnline(true);
await reconnectHarness.until((x) => x.productsStatus === 'success');
assert.equal(
  reconnectFixture.loads,
  2,
  'One reconnect recovers a failed product read',
);
reconnectHarness.close();
const reentered = new Harness(reconnectFixture.client);
await reentered.until((x) => x.productsStatus === 'success');
assert.equal(
  reconnectFixture.loads,
  3,
  'Re-entering the page reads prices despite Pending',
);
reentered.close();

const inFlight = deferred();
const flightFixture = fixture({ load: () => inFlight.promise });
const flightHarness = new Harness(flightFixture.client);
result = await flightHarness.until((x) => x.productsStatus === 'loading');
const reloads = [result.reload(), result.reload()];
await new Promise(setImmediate);
assert.equal(flightFixture.loads, 1, 'Reload joins an active product read');
inFlight.resolve(packages());
await Promise.all(reloads);
await flightHarness.until((x) => x.productsStatus === 'success');
flightHarness.close();

for (const change of ['user', 'family', 'environment']) {
  const old = deferred();
  const f = fixture({
    load: (user, family) =>
      user === 'owner' && family === 'family' ? old.promise : packages('NEW$'),
  });
  const h = new Harness(f.client);
  await h.until((x) => x.productsStatus === 'loading');
  const oldKey = h.queries[1].key;
  const replacement = fixture({ load: () => packages('NEW$') });
  const changes =
    change === 'user'
      ? { userId: 'new-owner' }
      : change === 'family'
        ? { familyId: 'new-family' }
        : { client: replacement.client }; // Independent pinned environment/Auth.
  const switched = h.render(changes);
  assert.equal(
    switched.prices.length,
    0,
    'Never display the previous scope while switching',
  );
  result = await h.until((x) => x.productsStatus === 'success');
  assert.notEqual(h.queries[1].key, oldKey);
  assert.equal(result.prices[0].priceString, 'NEW$32.00');
  old.resolve(packages('OLD$'));
  await new Promise(setImmediate);
  assert.equal(
    h.render().prices[0].priceString,
    'NEW$32.00',
    'Late old result cannot overwrite the new scope',
  );
  h.close();
}
const unblockedFixture = fixture({ pending: false });
const unblockedHarness = new Harness(unblockedFixture.client);
result = await unblockedHarness.until((x) => x.productsStatus === 'success');
await result.action('purchase', 'yearly');
assert.equal(unblockedFixture.purchases, 1);
assert.equal(unblockedHarness.render().message, 'cancelled');
unblockedHarness.close();

const gateRecovery = fixture({ billing: false });
const gateHarness = new Harness(gateRecovery.client);
result = await gateHarness.until(
  (x) => !gateHarness.queries[0].observer.getCurrentResult().isPending,
);
gateRecovery.billing = true;
await result.reload();
await gateHarness.until((x) => x.productsStatus === 'success');
assert.equal(
  gateRecovery.loads,
  1,
  'Reload uses the fresh Gate instead of the old disabled render',
);
gateHarness.close();

const oldAction = deferred();
const changingAction = fixture({ pending: false });
changingAction.client.purchaseFamilyPlus = () => oldAction.promise;
const actionHarness = new Harness(changingAction.client);
result = await actionHarness.until((x) => x.productsStatus === 'success');
const finishing = result.action('purchase', 'yearly');
assert.equal(actionHarness.render().busy, true);
actionHarness.render({ familyId: 'new-family' });
await actionHarness.until((x) => x.productsStatus === 'success');
oldAction.resolve('cancelled');
await finishing;
assert.equal(
  actionHarness.render().message,
  null,
  'Old action feedback cannot enter the new Family',
);
actionHarness.render({ familyId: 'family' });
result = await actionHarness.until((x) => x.productsStatus === 'success');
assert.equal(
  result.busy,
  false,
  'Returning to the old Family does not revive a completed lock',
);
actionHarness.close();
console.log(
  'PASS: Pending price reads, checkout denial, Gate/Owner denial, manual retry/dedup, reconnect/re-entry, stale account/Family/environment results, unchanged unblocked purchase dispatch.',
);

// Render the actual TSX with native primitives replaced, checking user-visible
// messages and button availability rather than copies of the render conditions.
const model = load('src/features/billing/family-plus-presentation.ts');
const preview = load('src/features/billing/family-plus-preview.ts');
const data = load('src/features/billing/family-plus-data.ts', {
  zod: { z },
  './family-plus-presentation': model,
});
const translator = createInstance();
await translator.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: Object.fromEntries(
    ['en', 'zh-HK'].map((lang) => [
      lang,
      { translation: JSON.parse(read(`src/i18n/locales/${lang}.json`)) },
    ]),
  ),
  interpolation: { escapeValue: false },
});
const jsx = (type, props) => ({ type, props: props ?? {} });
const screen = load('src/features/billing/family-plus-screen.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  react: { useState: (initial) => [initial, () => {}] },
  'react-native': {
    View: 'View',
    Pressable: 'Pressable',
    ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: (styles) => styles },
    Linking: { openURL: () => assert.fail('No external actions') },
  },
  'expo-router': { useRouter: () => ({ back: () => {} }) },
  'react-i18next': {
    useTranslation: () => ({
      t: translator.t.bind(translator),
      i18n: translator,
    }),
  },
  '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' },
  '@/components/app-button': { AppButton: 'AppButton' },
  '@/components/app-text': { AppText: 'AppText' },
  '@/components/content-container': {
    useContentLayout: () => ({ isWide: true, fontScale: 1 }),
  },
  '@/components/feedback-provider': {
    useFeedback: () => ({ showFeedback: () => {} }),
  },
  '@/components/icon-button': { IconButton: 'IconButton' },
  '@/components/screen': { Screen: 'Screen' },
  '@/features/auth/auth-context': {},
  '@/features/family/use-current-family': {},
  '@/theme': { lightColors: {}, radius: {}, spacing: {} },
  './components/family-storage-summary': {
    FamilyStorageSummary: 'FamilyStorageSummary',
  },
  './components/family-plus-badge': { FamilyPlusBadge: 'FamilyPlusBadge' },
  './use-family-plus': {},
  './family-plus-data': data,
  './family-plus-environment': {
    isFamilyPlusSandbox: () => true,
    isFamilyPlusRelease: () => false,
  },
  './use-family-plus-purchases': { useFamilyPlusPurchases: () => undefined },
  './family-plus-presentation': model,
  './family-plus-preview': preview,
});
const render = (node) =>
  Array.isArray(node)
    ? node.map(render)
    : node && typeof node === 'object'
      ? typeof node.type === 'function'
        ? render(node.type(node.props))
        : {
            ...node,
            props: { ...node.props, children: render(node.props.children) },
          }
      : node;
const nodes = (node) =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [node, ...nodes(node.props.children)]
      : [];
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join(' ')
    : node && typeof node === 'object'
      ? text(node.props.children)
      : node == null || node === false
        ? ''
        : String(node);
for (const lang of ['en', 'zh-HK']) {
  await translator.changeLanguage(lang);
  const t = translator.t.bind(translator);
  for (const status of ['idle', 'loading', 'success', 'error', 'gate']) {
    const billing = {
      ...pending,
      message: null,
      busy: false,
      ready: status !== 'gate',
      productsStatus: status === 'gate' ? 'idle' : status,
      productsLoading: status === 'loading',
      productsError: status === 'error',
      prices: status === 'success' ? pending.prices : [],
    };
    const tree = render(
      screen.FamilyPlusPreview({
        initialRole: 'owner',
        serverRole: 'owner',
        hasFamily: true,
        familyLoading: false,
        familyError: false,
        retryFamily: () => {},
        scene: 'unavailable',
        onSceneChange: () => {},
        mode: 'server',
        serverSnapshot: {
          ...data.emptyFamilyPlusServerSnapshot,
          status: 'expired',
        },
        isolatedTest: true,
        billing,
      }),
    );
    const content = text(tree);
    const buttons = nodes(tree).filter((node) => node.type === 'AppButton');
    const byLabel = (label) =>
      buttons.find((node) => node.props.label === label);
    const buyLabel =
      status === 'success'
        ? t('familyPlus.purchase.subscribe.yearly', { price: 'HK$228.00' })
        : t('familyPlus.purchase.buy');
    assert.equal(byLabel(buyLabel).props.disabled, true);
    assert.ok(
      byLabel(t('familyPlus.purchase.reload')),
      'Pending must retain price reload',
    );
    assert.ok(byLabel(t('familyPlus.purchase.refresh')));
    assert.ok(
      nodes(tree).some(
        (node) => text(node) === t('familyPlus.purchase.restore'),
      ),
    );
    assert.equal(
      content.includes(t('familyPlus.purchase.productsUnavailable')),
      status === 'error',
    );
    assert.equal(
      content.includes(t('familyPlus.purchase.pricesNotLoaded')),
      status === 'idle',
    );
    assert.equal(
      content.includes(t('familyPlus.purchase.loadingPrices')),
      status === 'loading',
    );
    assert.equal(
      content.includes(t('familyPlus.purchase.pendingPurchase')),
      status !== 'gate',
    );
    if (status === 'success') {
      assert.ok(content.includes('HK$32.00') && content.includes('HK$228.00'));
      assert.equal(
        byLabel(t('familyPlus.purchase.refresh')).props.disabled,
        false,
      );
    }
    if (status === 'gate')
      assert.ok(content.includes(t('familyPlus.purchase.notReady')));
  }
}
console.log(
  'PASS: actual EN/zh-HK screen distinguishes idle/loading/success/error/Pending/Gate; real localized prices remain visible with purchase disabled and refresh/restore/reload retained (Mock only).',
);

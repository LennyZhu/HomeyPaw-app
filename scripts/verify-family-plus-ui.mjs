import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createInstance } from 'i18next';
import ts from 'typescript';
import { z } from 'zod';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
let sandboxMode = false;
const load = (path, dependencies = {}, globals = {}) => {
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
    exports: module.exports,
    module,
    URL,
    Intl,
    Math,
    Error,
    ...globals,
    require: (name) => {
      if (name.endsWith('family-plus-environment'))
        return {
          isFamilyPlusAvailable: () =>
            preview.canUseFamilyPlusPreview(
              globals.__DEV__,
              globals.process?.env?.EXPO_PUBLIC_SUPABASE_URL,
            ),
          isFamilyPlusSandbox: () => sandboxMode,
          isFamilyPlusRelease: () => false,
        };
      if (name === './use-family-plus-purchases')
        return { useFamilyPlusPurchases: () => undefined };
      assert.ok(
        name in dependencies,
        `Unexpected dependency: ${name}. No SDK/network fallback is allowed.`,
      );
      return dependencies[name];
    },
  });
  return module.exports;
};
const model = load('src/features/billing/family-plus-presentation.ts');
const preview = load('src/features/billing/family-plus-preview.ts');
const serverData = load('src/features/billing/family-plus-data.ts', {
  zod: { z },
  './family-plus-presentation': model,
});
for (const url of [
  'http://localhost:54321',
  'http://127.0.0.1:54321',
  'http://[::1]:54321',
]) {
  assert.equal(preview.canUseFamilyPlusPreview(true, url), true);
  assert.equal(preview.canUseFamilyPlusPreview(false, url), false);
}
for (const url of [
  undefined,
  'invalid',
  'https://tknaobmlwmodsqtpqwkr.supabase.co',
  'https://abcdefghijklmnopqrst.supabase.co',
  'http://localhost.evil.test',
  'http://user:secret@localhost',
  'http://localhost/?project=production',
])
  assert.equal(preview.canUseFamilyPlusPreview(true, url), false);
assert.throws(
  () => preview.familyPlusPreviewSnapshot(false, 'active'),
  /DISABLED/,
);
for (const action of ['purchase', 'restore', 'manage']) {
  assert.equal(
    preview.familyPlusPreviewAction(false, 'owner', action),
    'disabled',
  );
  assert.equal(
    preview.familyPlusPreviewAction(true, 'owner', action),
    'previewOnly',
  );
  for (const role of ['member', 'viewer', null])
    assert.equal(
      preview.familyPlusPreviewAction(true, role, action),
      'ownerOnly',
    );
}
assert.equal(model.familyPlusPrice([], 'monthly'), null);
assert.equal(
  model.familyPlusPrice(
    [{ period: 'monthly', priceString: 'HK$32.00', source: 'apple' }],
    'monthly',
  ).priceString,
  'HK$32.00',
);
const over = model.storagePresentation(480 * 1024 ** 2, 300 * 1024 ** 2);
assert.equal(over.percent, 100);
assert.equal(over.remainingBytes, 0);
assert.equal(over.overBytes, 180 * 1024 ** 2);
assert.equal(model.formatStorageBytes(5 * 1024 ** 3, 'en'), '5 GiB');
console.log(
  'PASS: Development + loopback isolation; release/cloud/Production denial; preview actions cannot succeed; localized price pass-through and storage boundaries.',
);

for (const scene of preview.familyPlusPreviewScenes) {
  const snapshot = preview.familyPlusPreviewSnapshot(true, scene);
  assert.equal(
    model.familyPlusIdentity(snapshot, true).showBadge,
    ['active', 'grace', 'cancelled'].includes(scene),
  );
  assert.equal(model.familyPlusIdentity(snapshot, false).showBadge, false);
}
const benefitsCases = [
  ['free', 'upgradeTitle', 'offeredTitle'],
  ['active', 'title', 'title'],
  ['grace', 'title', 'title'],
  ['cancelled', 'title', 'title'],
  ['expired', 'resubscribeTitle', 'offeredTitle'],
  ['revoked', 'learnTitle', 'learnTitle'],
  ['unavailable', 'learnTitle', 'learnTitle'],
  ['transition', 'learnTitle', 'learnTitle'],
];
for (const [status, ownerTitle, otherTitle] of benefitsCases) {
  const identity = model.familyPlusIdentity(
    preview.familyPlusPreviewSnapshot(true, status),
    true,
  );
  assert.equal(model.familyPlusBenefitsTitle('owner', identity), ownerTitle);
  for (const role of ['member', 'viewer'])
    assert.equal(model.familyPlusBenefitsTitle(role, identity), otherTitle);
}
for (const scene of ['loading', 'empty', 'error', 'offline']) {
  const identity = model.familyPlusIdentity(
    preview.familyPlusPreviewSnapshot(true, scene),
    true,
  );
  assert.equal(model.familyPlusBenefitsTitle('owner', identity), 'learnTitle');
}
assert.equal(
  model.familyPlusBenefitsTitle(null, { status: 'free', showBadge: false }),
  'learnTitle',
);
const accessNow = Date.parse('2026-10-16T00:00:00Z');
for (const status of ['active', 'grace', 'cancelled']) {
  const verified = {
    ...preview.familyPlusPreviewSnapshot(true, status),
    source: 'server',
    plusAccess: {
      source: 'server-verified',
      givesAccess: true,
      validUntil: '2026-10-16T00:01:00Z',
    },
  };
  assert.equal(
    model.familyPlusIdentity(verified, false, accessNow).showBadge,
    true,
  );
  assert.equal(
    model.familyPlusIdentity(verified, false, accessNow + 60_000).showBadge,
    false,
  );
  assert.equal(
    model.familyPlusBenefitsTitle(
      'owner',
      model.familyPlusIdentity(verified, false, accessNow + 60_000),
    ),
    'learnTitle',
  );
  assert.equal(
    model.familyPlusBenefitsTitle(
      'owner',
      model.familyPlusIdentity(
        {
          ...verified,
          plusAccess: { ...verified.plusAccess, givesAccess: false },
        },
        false,
        accessNow,
      ),
    ),
    'learnTitle',
  );
  assert.equal(
    model.familyPlusIdentity(
      {
        ...verified,
        plusAccess: { ...verified.plusAccess, givesAccess: false },
      },
      false,
      accessNow,
    ).status,
    'unavailable',
  );
  assert.equal(
    model.familyPlusIdentity(
      { ...verified, plusAccess: { ...verified.plusAccess, validUntil: null } },
      false,
      accessNow,
    ).showBadge,
    false,
  );
}
const memory = preview.createFamilyPlusPreviewMemory();
const scopeA = { enabled: true, userId: 'u-a', familyId: 'f-a' };
const scopeB = { enabled: true, userId: 'u-a', familyId: 'f-b' };
assert.equal(memory.read(scopeA), 'unavailable');
memory.synchronize(scopeA);
const oldGeneration = memory.getSnapshot().generation;
let notifications = 0;
const stopMemory = memory.subscribe(() => {
  notifications++;
});
assert.equal(memory.select(scopeA, 'active', oldGeneration), true);
assert.equal(notifications, 1);
memory.synchronize({ ...scopeA, currentPetId: 'another-pet' });
assert.equal(memory.read(scopeA), 'active');
assert.equal(memory.getSnapshot().generation, oldGeneration);
memory.synchronize(scopeB);
assert.equal(memory.read(scopeA), 'unavailable');
assert.equal(memory.read(scopeB), 'unavailable');
assert.equal(memory.select(scopeA, 'active', oldGeneration), false);
memory.synchronize(scopeA);
assert.equal(memory.read(scopeA), 'unavailable');
assert.equal(memory.select(scopeA, 'active', oldGeneration), false);
memory.clear();
memory.synchronize(scopeA);
assert.equal(memory.read(scopeA), 'unavailable');
memory.synchronize({ ...scopeA, enabled: false });
assert.equal(
  memory.select(
    { ...scopeA, enabled: false },
    'active',
    memory.getSnapshot().generation,
  ),
  false,
);
assert.equal(
  preview.createFamilyPlusPreviewMemory().read(scopeA),
  'unavailable',
);
stopMemory();
console.log(
  'PASS: access evidence and expiry boundary, graceful/cancelled access denial, all non-Plus statuses, fresh-app unknown default, Family/Pet isolation, logout reset and stale generation rejection.',
);

const locales = Object.fromEntries(
  ['zh-HK', 'en'].map((lang) => [
    lang,
    { translation: JSON.parse(read(`src/i18n/locales/${lang}.json`)) },
  ]),
);
const translator = createInstance();
await translator.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: locales,
  interpolation: { escapeValue: false },
});
const jsx = (type, props) => ({ type, props: props ?? {} });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
const theme = {
  lightColors: new Proxy({}, { get: (_, key) => key }),
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radius: { md: 16, lg: 22 },
};
const native = {
  View: 'View',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles) => styles, hairlineWidth: 0.5 },
  Linking: {
    openURL: async (url) => {
      opened.push(url);
    },
  },
};
const translate = () => ({
  t: translator.t.bind(translator),
  i18n: translator,
});
const shared = {
  'react/jsx-runtime': jsxRuntime,
  'react-native': native,
  'react-i18next': { useTranslation: translate },
  '@/components/app-text': { AppText: 'AppText' },
  '@/theme': theme,
};
const storage = load(
  'src/features/billing/components/family-storage-summary.tsx',
  { ...shared, '../family-plus-presentation': model },
);
let slots = [],
  cursor = 0,
  wide = false,
  fontScale = 1,
  familyCalls = 0,
  refetches = 0;
const feedback = [],
  opened = [];
const environment = { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };
const globals = { __DEV__: true, process: { env: environment } };
const badge = load(
  'src/features/billing/components/family-plus-badge.tsx',
  {
    ...shared,
    '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' },
    '../family-plus-presentation': model,
    '../family-plus-preview': preview,
  },
  globals,
);
let lifecycleState = {
  currentFamilyId: 'synthetic-family',
  currentFamilyUserId: 'synthetic-owner',
};
const lifecycleListeners = new Set();
const lifecycleCleanups = [];
const hookDeps = {
  react: {
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useLayoutEffect: (effect) => lifecycleCleanups.push(effect()),
  },
  'react-i18next': { useTranslation: translate },
  '@/stores/current-family-store': {
    useCurrentFamilyStore: {
      getState: () => lifecycleState,
      subscribe: (listener) => {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
      },
    },
  },
  './family-plus-preview': preview,
  './family-plus-presentation': model,
};
const display = load(
  'src/features/billing/use-family-plus-preview.tsx',
  hookDeps,
  globals,
);
display.FamilyPlusPreviewLifecycle();
let readQuery = { isPending: true, isError: false, refetch: () => undefined };
const combinedDisplay = load('src/features/billing/use-family-plus.ts', {
  react: hookDeps.react,
  'react-i18next': { useTranslation: translate },
  '@tanstack/react-query': {
    onlineManager: { subscribe: () => () => undefined, isOnline: () => true },
    useQuery: () => readQuery,
  },
  '@/features/family/family-query-keys': load(
    'src/features/family/family-query-keys.ts',
  ),
  './family-plus-api': {
    readFamilyPlusSummary: () => assert.fail('Preview must not read real data'),
  },
  './family-plus-data': serverData,
  './family-plus-presentation': model,
  './use-family-plus-preview': display,
});
const changeIdentity = (userId, familyId) => {
  lifecycleState = { currentFamilyUserId: userId, currentFamilyId: familyId };
  lifecycleListeners.forEach((listener) => listener());
};
const screenDeps = {
  ...shared,
  react: {
    useState: (initial) => {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        (value) => {
          slots[slot] =
            typeof value === 'function' ? value(slots[slot]) : value;
        },
      ];
    },
  },
  'expo-router': { useRouter: () => ({ back: () => undefined }) },
  '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' },
  '@/components/app-button': { AppButton: 'AppButton' },
  '@/components/icon-button': { IconButton: 'IconButton' },
  '@/components/screen': { Screen: 'Screen' },
  '@/components/content-container': {
    useContentLayout: () => ({ isWide: wide, fontScale }),
  },
  '@/components/feedback-provider': {
    useFeedback: () => ({ showFeedback: (message) => feedback.push(message) }),
  },
  '@/features/auth/auth-context': {
    useAuth: () => ({ user: { id: 'synthetic-owner' } }),
  },
  '@/features/family/use-current-family': {
    useCurrentFamily: () => {
      familyCalls++;
      return {
        currentFamilyId: 'synthetic-family',
        currentMembership: { role: 'owner' },
        familiesQuery: {
          isPending: false,
          isError: false,
          refetch: () => {
            refetches++;
          },
        },
      };
    },
  },
  './components/family-storage-summary': storage,
  './components/family-plus-badge': badge,
  './use-family-plus': { useFamilyPlus: combinedDisplay.useFamilyPlus },
  './family-plus-data': serverData,
  './family-plus-presentation': model,
  './family-plus-preview': preview,
};
const screen = load(
  'src/features/billing/family-plus-screen.tsx',
  screenDeps,
  globals,
);
const render = (node) => {
  if (Array.isArray(node)) return node.flatMap(render);
  if (node == null || node === false || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return render(node.type(node.props));
  return {
    ...node,
    props: { ...node.props, children: render(node.props.children) },
  };
};
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
const buttons = (tree) =>
  nodes(tree).filter((node) => ['AppButton', 'Pressable'].includes(node.type));
const label = (node) => node.props.label ?? text(node);
const mount = (props = {}) => {
  slots = [];
  feedback.length = 0;
  const input = {
    initialRole: 'owner',
    hasFamily: true,
    familyLoading: false,
    familyError: false,
    retryFamily: () => {
      refetches++;
    },
    // An explicit unit fixture; the real shared preview defaults to unavailable.
    scene: 'free',
    onSceneChange: (scene) => {
      input.scene = scene;
    },
    ...props,
  };
  let tree;
  const rerender = () => {
    cursor = 0;
    tree = render(screen.FamilyPlusPreview(input));
    return tree;
  };
  const click = (name) => {
    const node = buttons(tree).find((item) => label(item) === name);
    assert.ok(node, `Missing control: ${name}`);
    assert.notEqual(node.props.disabled, true);
    node.props.onPress();
    return rerender();
  };
  rerender();
  return {
    get tree() {
      return tree;
    },
    click,
  };
};

for (const lang of ['zh-HK', 'en']) {
  await translator.changeLanguage(lang);
  const t = translator.t.bind(translator);
  for (const status of [
    'free',
    'active',
    'grace',
    'cancelled',
    'expired',
    'revoked',
    'unavailable',
    'transition',
  ]) {
    const snapshot = preview.familyPlusPreviewSnapshot(true, status);
    for (const role of ['owner', 'member', 'viewer']) {
      const actions = [],
        selected = [];
      const tree = render(
        screen.FamilyPlusDetails({
          snapshot,
          role,
          period: 'yearly',
          onSelectPeriod: (period) => selected.push(period),
          onAction: (action) => actions.push(action),
        }),
      );
      assert.ok(text(tree).includes(t(`familyPlus.status.${status}`)));
      const [, ownerTitle, otherTitle] = benefitsCases.find(
        ([scene]) => scene === status,
      );
      const expectedTitle = role === 'owner' ? ownerTitle : otherTitle;
      const headings = nodes(tree)
        .filter(
          (node) =>
            node.type === 'AppText' &&
            node.props.accessibilityRole === 'header',
        )
        .map(text);
      assert.ok(headings.includes(t(`familyPlus.benefits.${expectedTitle}`)));
      if (expectedTitle !== 'title')
        assert.ok(!headings.includes(t('familyPlus.benefits.title')));
      for (const benefit of ['space', 'video', 'sharing'])
        assert.ok(text(tree).includes(t(`familyPlus.benefits.${benefit}`)));
      if (['revoked', 'unavailable'].includes(status)) {
        assert.equal(snapshot.plusAccess.validUntil, null);
        assert.equal(model.familyPlusIdentity(snapshot, true).showBadge, false);
        assert.ok(!text(tree).includes(t('familyPlus.status.active')));
        assert.ok(text(tree).includes(t(`familyPlus.statusBody.${status}`)));
      }
      const actionButtons = buttons(tree).filter(
        (node) => node.props.accessibilityRole !== 'radio',
      );
      if (role !== 'owner') {
        assert.equal(actionButtons.length, 0);
        assert.ok(text(tree).includes(t('familyPlus.ownerOnly')));
      } else {
        const canBuy = ['free', 'expired', 'transition'].includes(status);
        assert.equal(actionButtons.length, canBuy ? 3 : 2);
        actionButtons.forEach((button) => button.props.onPress());
        assert.deepEqual(
          actions,
          canBuy ? ['purchase', 'restore', 'manage'] : ['restore', 'manage'],
        );
        if (canBuy) {
          const plans = buttons(tree).filter(
            (node) => node.props.accessibilityRole === 'radio',
          );
          assert.equal(plans.length, 2);
          assert.equal(plans[1].props.accessibilityState.checked, true);
          plans[0].props.onPress();
          assert.deepEqual(selected, ['monthly']);
        }
      }
      if (status === 'unavailable') {
        assert.ok(text(tree).includes(t('familyPlus.storage.noData')));
        assert.ok(!text(tree).includes('MiB'));
        assert.equal(
          nodes(tree).filter(
            (node) => node.props.accessibilityRole === 'progressbar',
          ).length,
          0,
        );
      }
      assert.ok(
        !text(tree).includes(t('familyPlus.storage.unlimited')),
        'capacity-only launch does not advertise unlimited monthly videos',
      );
      if (status === 'expired')
        assert.ok(text(tree).includes(t('familyPlus.storage.retained')));
    }
  }
  for (const status of ['active', 'grace', 'cancelled']) {
    const deniedAccess = {
      ...preview.familyPlusPreviewSnapshot(true, status),
      plusAccess: {
        source: 'development-example',
        givesAccess: false,
        validUntil: null,
      },
    };
    const expiredEvidence = {
      ...preview.familyPlusPreviewSnapshot(true, status),
      source: 'server',
      plusAccess: {
        source: 'server-verified',
        givesAccess: true,
        validUntil: '2000-01-01T00:00:00Z',
      },
    };
    for (const snapshot of [deniedAccess, expiredEvidence]) {
      const tree = render(
        screen.FamilyPlusDetails({
          snapshot,
          role: 'owner',
          period: 'yearly',
          onSelectPeriod: () =>
            assert.fail('Unconfirmed access cannot select a plan'),
          onAction: () => undefined,
        }),
      );
      assert.ok(text(tree).includes(t('familyPlus.status.unavailable')));
      assert.ok(
        nodes(tree).some(
          (node) =>
            node.type === 'AppText' &&
            text(node) === t('familyPlus.benefits.learnTitle'),
        ),
      );
      assert.ok(
        !nodes(tree).some(
          (node) =>
            node.props.accessibilityLabel ===
              t('familyPlus.badge.previewLabel') ||
            node.props.accessibilityLabel === t('familyPlus.badge.label'),
        ),
      );
      assert.ok(
        !buttons(tree).some(
          (node) => node.props.label === t('familyPlus.previewPurchase'),
        ),
      );
    }
  }
  const view = mount();
  const ordered = nodes(view.tree);
  const textPosition = (value) =>
    ordered.findIndex(
      (node) => node.type === 'AppText' && text(node) === value,
    );
  assert.ok(
    textPosition(t('familyPlus.headline')) <
      textPosition(t('familyPlus.previewSummary')),
  );
  assert.ok(
    textPosition(t('familyPlus.previewSummary')) <
      textPosition(t('familyPlus.status.free')),
  );
  assert.ok(!text(view.tree).includes(t('familyPlus.previewNotice')));
  const notice = ordered.find(
    (node) =>
      node.type === 'View' &&
      node.props.style?.backgroundColor === 'surfaceSecondary' &&
      text(node).includes(t('familyPlus.previewSummary')),
  );
  assert.equal(notice.props.style.paddingVertical, 4);
  assert.equal(notice.props.style.height, undefined);
  assert.equal(notice.props.style.marginBottom, -8);
  const scenarioTrigger = buttons(view.tree).find(
    (node) => label(node) === t('familyPlus.showScenes'),
  );
  assert.equal(scenarioTrigger.props.style.minHeight, 44);
  const benefits = ['space', 'video', 'sharing'].map((key) =>
    textPosition(t(`familyPlus.benefits.${key}`)),
  );
  const choosePosition = textPosition(t('familyPlus.choosePlan'));
  assert.ok(
    benefits.every(
      (position) =>
        position > textPosition(t('familyPlus.storage.title')) &&
        position < choosePosition,
    ),
  );
  const purchasePosition = ordered.findIndex(
    (node) => node.props.label === t('familyPlus.previewPurchase'),
  );
  assert.ok(
    choosePosition < purchasePosition &&
      purchasePosition < textPosition(t('familyPlus.compareTitle')),
  );
  const legal = ['video', 'subscription', 'payer', 'links'].map((key) =>
    textPosition(t(`familyPlus.legal.${key}`)),
  );
  assert.ok(
    legal.every(
      (position, index) =>
        position > textPosition(t('familyPlus.compareTitle')) &&
        (index === 0 || position > legal[index - 1]),
    ),
  );
  view.click(t('familyPlus.previewPurchase'));
  view.click(t('familyPlus.restore'));
  view.click(t('familyPlus.manage'));
  assert.equal(feedback.length, 3);
  assert.ok(
    feedback.every((message) => message === t('familyPlus.previewOnly')),
  );
  view.click(t('familyPlus.showScenes'));
  assert.ok(text(view.tree).includes(t('familyPlus.previewNotice')));
  view.click(t('familyPlus.scenes.grace'));
  assert.ok(text(view.tree).includes(t('familyPlus.status.grace')));
  view.click(t('family.roles.member'));
  assert.equal(
    nodes(view.tree).filter((node) => node.type === 'AppButton').length,
    0,
  );
  for (const scene of ['loading', 'empty', 'error', 'offline']) {
    const state = mount();
    state.click(t('familyPlus.showScenes'));
    state.click(t(`familyPlus.scenes.${scene}`));
    assert.ok(
      text(state.tree).includes(
        t(
          scene === 'loading'
            ? 'familyPlus.loading'
            : `familyPlus.dataState.${scene}`,
        ),
      ),
    );
    assert.ok(
      !nodes(state.tree).some(
        (node) => node.props.label === t('familyPlus.previewPurchase'),
      ),
    );
    if (['error', 'offline'].includes(scene)) {
      state.click(t('familyPlus.retry'));
      assert.ok(text(state.tree).includes(t('familyPlus.status.unavailable')));
    }
  }
  const empty = mount({ hasFamily: false, initialRole: null });
  assert.ok(text(empty.tree).includes(t('familyPlus.dataState.empty')));
  for (const flags of [
    { familyLoading: true },
    { familyError: true },
    { hasFamily: false },
  ]) {
    const blocked = mount(flags);
    assert.ok(
      !buttons(blocked.tree).some((node) =>
        [
          t('familyPlus.previewPurchase'),
          t('familyPlus.restore'),
          t('familyPlus.manage'),
        ].includes(label(node)),
      ),
    );
    assert.ok(!text(blocked.tree).includes(t('familyPlus.status.free')));
    blocked.click(t('familyPlus.showScenes'));
    assert.ok(
      !buttons(blocked.tree).some(
        (node) => label(node) === t('family.roles.owner'),
      ),
    );
  }
  for (const role of ['member', 'viewer', null]) {
    const restricted = mount({ initialRole: role });
    assert.ok(
      !buttons(restricted.tree).some((node) =>
        [
          t('familyPlus.previewPurchase'),
          t('familyPlus.restore'),
          t('familyPlus.manage'),
        ].includes(label(node)),
      ),
    );
    if (role === null) {
      assert.ok(
        text(restricted.tree).includes(t('familyPlus.status.unavailable')),
      );
      assert.ok(!text(restricted.tree).includes(t('familyPlus.status.free')));
    }
    restricted.click(t('familyPlus.showScenes'));
    assert.ok(
      !buttons(restricted.tree).some(
        (node) => label(node) === t('family.roles.owner'),
      ),
    );
    if (role === 'viewer') {
      for (const scene of ['active', 'free', 'revoked', 'unavailable']) {
        restricted.click(t(`familyPlus.scenes.${scene}`));
        assert.ok(text(restricted.tree).includes(t('familyPlus.compareTitle')));
        assert.ok(
          text(restricted.tree).includes(t(`familyPlus.status.${scene}`)),
        );
        assert.ok(
          text(restricted.tree).includes(t('familyPlus.storage.title')),
        );
        assert.ok(
          !buttons(restricted.tree).some((node) =>
            [
              t('familyPlus.previewPurchase'),
              t('familyPlus.restore'),
              t('familyPlus.manage'),
              t('family.roles.owner'),
            ].includes(label(node)),
          ),
        );
        assert.ok(
          !buttons(restricted.tree).some(
            (node) => node.props.accessibilityRole === 'radio',
          ),
        );
      }
    }
  }
  const failed = mount({ familyError: true });
  failed.click(t('familyPlus.retry'));
  assert.ok(refetches > 0);
  assert.match(
    translator.t('familyPlus.storage.videosUsed', { count: 1 }),
    lang === 'en' ? /1 video published/ : /1 段/,
  );
}

const navigated = [];
const profileDeps = {
  ...shared,
  react: { useCallback: (callback) => callback },
  'react-native': {
    ...native,
    Platform: { OS: 'ios' },
    Alert: { alert: () => undefined },
  },
  'expo-router': {
    useRouter: () => ({ push: (route) => navigated.push(route) }),
    useFocusEffect: () => undefined,
  },
  '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' },
  '@expo/vector-icons/MaterialCommunityIcons': {
    __esModule: true,
    default: 'Icon',
  },
  '@/components/app-button': { AppButton: 'AppButton' },
  '@/components/avatar': { Avatar: 'Avatar' },
  '@/components/loading-view': { LoadingView: 'LoadingView' },
  '@/components/screen': { Screen: 'Screen' },
  '@/components/feedback-provider':
    screenDeps['@/components/feedback-provider'],
  '@/features/auth/auth-context': {
    useAuth: () => ({
      user: { id: 'synthetic-owner', email: 'synthetic@example.test' },
      signOut: async () => undefined,
    }),
  },
  '@/features/family/use-current-family': {
    useCurrentFamily: () => ({
      backendCapability: 'FAMILY_MULTI_PET',
      currentFamilyId: 'synthetic-family',
      currentMembership: { role: 'owner' },
      familiesQuery: { isSuccess: true, isPending: false, isError: false },
    }),
  },
  '@/features/billing/family-plus-preview': preview,
  '@/features/billing/components/family-plus-badge': badge,
  '@/features/billing/use-family-plus': {
    useFamilyPlus: combinedDisplay.useFamilyPlus,
  },
  '@/features/billing/billing-client': { isBillingSandboxEnabled: () => false },
  '@/features/media/storage-signed-url': {
    createStorageImageSource: () => undefined,
  },
  './use-profile': {
    useProfile: () => ({
      profile: {
        display_name: 'Synthetic user',
        locale: 'zh-HK',
        avatar_url: null,
      },
      error: null,
      isLoading: false,
      refetch: async () => undefined,
    }),
  },
  './profile-avatar': {
    profileAvatarBucket: 'profile-avatars',
    useProfileAvatarUrl: () => ({ data: null }),
  },
  './profile-query-state': load('src/features/profile/profile-query-state.ts'),
};
for (const lang of ['zh-HK', 'en']) {
  await translator.changeLanguage(lang);
  const t = translator.t.bind(translator);
  const profile = load(
    'src/features/profile/profile-screen.tsx',
    profileDeps,
    globals,
  );
  const tree = render(profile.default());
  const card = nodes(tree).find(
    (node) =>
      node.type === 'Pressable' &&
      node.props.accessibilityLabel?.startsWith(t('familyPlus.entry')),
  );
  assert.ok(card && text(card).includes(t('familyPlus.identity.unavailable')));
  const cardStyle = Object.assign({}, ...card.props.style({ pressed: false }));
  assert.equal(cardStyle.height, undefined);
  assert.equal(cardStyle.minHeight, undefined);
  assert.equal(cardStyle.padding, 16);
  assert.equal(nodes(card).filter((node) => node.type === 'AppText').length, 2);
  assert.ok(nodes(card).some((node) => node.props.name === 'crown-outline'));
  assert.ok(!nodes(card).some((node) => node.props.name === 'paw-outline'));
  assert.ok(nodes(tree).some((node) => node.props.name === 'paw-outline'));
  assert.equal(
    nodes(card).filter((node) => node.type === 'Pressable').length,
    1,
  );
  assert.ok(nodes(card).some((node) => node.props.name === 'chevron-forward'));
  const all = nodes(tree);
  const menu = all.find(
    (node) =>
      node.type === 'View' &&
      Array.isArray(node.props.style) &&
      node.props.style.some((style) => style?.marginTop === 16),
  );
  assert.ok(menu, 'Preview card-to-menu spacing uses the existing 16pt token.');
  assert.ok(
    all.indexOf(card) >
      all.findIndex(
        (node) => node.props.accessibilityHint === t('profile.editProfile'),
      ),
  );
  assert.ok(
    all.indexOf(card) <
      all.findIndex(
        (node) => node.props.accessibilityLabel === t('profile.myPets'),
      ),
  );
  card.props.onPress();
  assert.equal(navigated.at(-1), '/family-plus');
  for (const [key, route] of [
    ['myPets', '/pets'],
    ['manageFamilies', '/families'],
    ['editProfile', '/edit-profile'],
    ['accountSecurity', '/account-security'],
    ['about', '/about'],
  ]) {
    const entry = nodes(tree).find(
      (node) =>
        node.type === 'Pressable' &&
        node.props.accessibilityLabel === t(`profile.${key}`),
    );
    assert.ok(entry);
    entry.props.onPress();
    assert.equal(navigated.at(-1), route);
  }
  for (const [development, url] of [
    [false, environment.EXPO_PUBLIC_SUPABASE_URL],
    [true, 'https://tknaobmlwmodsqtpqwkr.supabase.co'],
  ]) {
    const denied = load(
      'src/features/profile/profile-screen.tsx',
      profileDeps,
      {
        __DEV__: development,
        process: { env: { EXPO_PUBLIC_SUPABASE_URL: url } },
      },
    );
    assert.ok(
      !nodes(render(denied.default())).some((node) =>
        node.props.accessibilityLabel?.startsWith(t('familyPlus.entry')),
      ),
    );
  }
}
console.log(
  'PASS: compact notice disclosure, benefits before pricing, grouped legal copy, unknown-role denial, non-Owner preview escalation denial, and actual Profile card/menu navigation with Release/Production hiding.',
);

const settingsContext = {
  backendCapability: 'FAMILY_MULTI_PET',
  capabilityQuery: { isPending: false },
  petsQuery: { isPending: false, refetch: () => undefined },
  familiesQuery: {
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: () => undefined,
  },
  families: [
    { family: { id: 'synthetic-family' }, membership: { role: 'owner' } },
  ],
  pets: [],
};
const noopMutation = () => ({ isPending: false });
const longName = 'A very long synthetic Family name 家庭名稱'.repeat(4);
const settingsModule = load(
  'src/features/family/family-settings-screen.tsx',
  {
    ...shared,
    react: {
      ...screenDeps.react,
      useEffect: () => undefined,
      useCallback: (callback) => callback,
    },
    'react-native': profileDeps['react-native'],
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    'expo-router': {
      useRouter: () => ({
        push: (route) => navigated.push(route),
        replace: () => undefined,
      }),
      useFocusEffect: () => undefined,
      useLocalSearchParams: () => ({ id: 'synthetic-family' }),
    },
    '@/components/app-button': { AppButton: 'AppButton' },
    '@/components/avatar': { Avatar: 'Avatar' },
    '@/components/icon-button': { IconButton: 'IconButton' },
    '@/components/loading-view': { LoadingView: 'LoadingView' },
    '@/components/screen': { Screen: 'Screen' },
    '@/components/settings-row': { SettingsRow: 'SettingsRow' },
    '@/features/auth/auth-context': screenDeps['@/features/auth/auth-context'],
    '@/features/billing/family-plus-preview': preview,
    '@/features/billing/components/family-plus-badge': badge,
    '@/features/billing/use-family-plus': {
      useFamilyPlus: combinedDisplay.useFamilyPlus,
    },
    '@/features/media/storage-signed-url':
      profileDeps['@/features/media/storage-signed-url'],
    '@/features/profile/profile-avatar': {
      profileAvatarBucket: 'profile-avatars',
    },
    './family-access-cleanup': { clearRevokedFamilyAccess: () => undefined },
    './family-label': { familyLabel: () => longName },
    './family-member-limit': { familyMemberLimit: 10 },
    './family-queries': {
      deleteFamily: async () => undefined,
      useFamilyMemberSummaries: () => ({ data: [], refetch: () => undefined }),
      useFamilyPets: () => ({
        data: [],
        isSuccess: true,
        refetch: () => undefined,
      }),
      useLeaveFamily: noopMutation,
      useRemoveFamilyMember: noopMutation,
      useTransferFamilyOwnership: noopMutation,
    },
    './use-current-family': { useCurrentFamily: () => settingsContext },
  },
  globals,
);
const countBadge = (tree) =>
  nodes(tree).filter(
    (node) =>
      node.props.accessibilityLabel ===
      translator.t('familyPlus.badge.previewLabel'),
  ).length;
const renderPage = (component) => {
  slots = [];
  cursor = 0;
  return render(component());
};
for (const lang of ['zh-HK', 'en']) {
  await translator.changeLanguage(lang);
  const t = translator.t.bind(translator);
  const profile = load(
    'src/features/profile/profile-screen.tsx',
    profileDeps,
    globals,
  );
  for (const scene of [
    'active',
    'free',
    'grace',
    'cancelled',
    'expired',
    'revoked',
    'unavailable',
    'transition',
  ]) {
    // Drive the real page's scenario control -> shared hook/store -> other pages.
    let page = renderPage(screen.default);
    buttons(page)
      .find((node) => label(node) === t('familyPlus.showScenes'))
      .props.onPress();
    cursor = 0;
    page = render(screen.default());
    buttons(page)
      .find((node) => label(node) === t(`familyPlus.scenes.${scene}`))
      .props.onPress();
    cursor = 0;
    page = render(screen.default());
    const expectedBadge = ['active', 'grace', 'cancelled'].includes(scene)
      ? 1
      : 0;
    assert.equal(countBadge(page), expectedBadge);
    const profilePage = renderPage(profile.default);
    assert.equal(countBadge(profilePage), expectedBadge);
    assert.ok(
      text(profilePage).includes(
        t('familyPlus.identityPreview', {
          status: t(`familyPlus.identity.${scene}`),
        }),
      ),
    );
    for (const role of ['owner', 'member', 'viewer']) {
      settingsContext.families[0].membership.role = role;
      const settingsPage = renderPage(settingsModule.default);
      assert.equal(countBadge(settingsPage), expectedBadge);
      assert.ok(text(settingsPage).includes(longName));
      assert.ok(
        text(settingsPage).includes(
          t('familyPlus.identityPreview', {
            status: t(`familyPlus.identity.${scene}`),
          }),
        ),
      );
      const entry = nodes(settingsPage).find(
        (node) =>
          node.type === 'SettingsRow' &&
          node.props.label === t('familyPlus.entry'),
      );
      entry.props.onPress();
      assert.equal(navigated.at(-1), '/family-plus');
    }
  }
  settingsContext.families[0].membership.role = 'owner';
}
// Real-data mode is explicit and shared; an unready Local never falls back to examples.
let localPage = renderPage(screen.default);
buttons(localPage)
  .find((node) => label(node) === translator.t('familyPlus.showScenes'))
  .props.onPress();
cursor = 0;
localPage = render(screen.default());
buttons(localPage)
  .find((node) => label(node) === translator.t('familyPlus.readLocal'))
  .props.onPress();
cursor = 0;
localPage = render(screen.default());
assert.ok(text(localPage).includes(translator.t('familyPlus.localReadOnly')));
for (const flags of [{ loading: true }, { error: true }, { role: null }]) {
  const guarded = combinedDisplay.useFamilyPlus({
    userId: 'synthetic-owner',
    familyId: 'synthetic-family',
    role: 'owner',
    loading: false,
    error: false,
    ...flags,
  });
  assert.equal(
    guarded.mode,
    'server',
    'temporary context uncertainty must not change data source',
  );
  assert.equal(guarded.snapshot.source, 'server');
  assert.equal(guarded.snapshot.storage, null);
}
assert.equal(countBadge(localPage), 0);
assert.ok(!text(localPage).includes('87.4'));
readQuery = { ...readQuery, isPending: false, isError: true };
cursor = 0;
localPage = render(screen.default());
assert.ok(text(localPage).includes(translator.t('familyPlus.localNotReady')));
assert.ok(
  !buttons(localPage).some((node) =>
    [
      translator.t('familyPlus.previewPurchase'),
      translator.t('familyPlus.restore'),
      translator.t('familyPlus.manage'),
      translator.t('family.roles.owner'),
    ].includes(label(node)),
  ),
);
for (const component of [previewProfileForLocal, settingsModule.default]) {
  // Function below is hoisted so this check can precede the later lifecycle suite.
  const page = renderPage(component);
  assert.equal(countBadge(page), 0);
  assert.ok(!text(page).includes('87.4'));
}
function previewProfileForLocal() {
  return load(
    'src/features/profile/profile-screen.tsx',
    profileDeps,
    globals,
  ).default();
}
const now = Date.now();
readQuery = {
  ...readQuery,
  isError: false,
  data: {
    receivedAt: now,
    summary: {
      family_id: 'synthetic-family',
      viewer_user_id: 'synthetic-owner',
      role: 'viewer',
      server_time: new Date(now).toISOString(),
      entitlement_checked_at: new Date(now).toISOString(),
      status: 'active',
      gives_plus_access: true,
      access_until: new Date(now + 60_000).toISOString(),
      limit_bytes: 5 * 1024 ** 3,
      storage_enforcement_enabled: false,
      usage: {
        status: 'ready',
        used_bytes: 9 * 1024 ** 2,
        reserved_bytes: 0,
        unpublished_bytes: 0,
        cleanup_pending_bytes: 0,
        unsettled_object_count: 0,
      },
      videos: { status: 'not_configured', published: null },
    },
  },
};
for (const component of [
  screen.default,
  previewProfileForLocal,
  settingsModule.default,
]) {
  const page = renderPage(component);
  assert.equal(
    nodes(page).filter(
      (node) =>
        node.props.accessibilityLabel ===
        translator.t('familyPlus.badge.label'),
    ).length,
    1,
  );
  assert.equal(countBadge(page), 0, 'real data never uses Preview badge');
  assert.ok(!text(page).includes('87.4'));
  assert.ok(
    !buttons(page).some(
      (node) => node.props.label === translator.t('familyPlus.previewPurchase'),
    ),
  );
}
buttons(localPage)
  .find((node) => label(node) === translator.t('familyPlus.scenes.unavailable'))
  .props.onPress();
readQuery = { isPending: true, isError: false, refetch: () => undefined };
const selectionScope = {
  enabled: true,
  userId: 'synthetic-owner',
  familyId: 'synthetic-family',
};
const previewProfile = load(
  'src/features/profile/profile-screen.tsx',
  profileDeps,
  globals,
);
const readIdentity = (scope = selectionScope) =>
  display.useFamilyPlusPreview({
    userId: scope.userId,
    familyId: scope.familyId,
    role: 'owner',
    loading: false,
    error: false,
  });
const selectActive = () => {
  const current = readIdentity();
  assert.equal(current.setScene('active'), true);
  assert.equal(readIdentity().scene, 'active');
  return current.setScene;
};
const assertNeutralPages = () => {
  const membership = renderPage(screen.default);
  assert.equal(countBadge(membership), 0);
  assert.ok(
    text(membership).includes(translator.t('familyPlus.status.unavailable')),
  );
  assert.ok(
    !buttons(membership).some(
      (node) => node.props.label === translator.t('familyPlus.previewPurchase'),
    ),
  );
  for (const page of [
    renderPage(previewProfile.default),
    renderPage(settingsModule.default),
  ]) {
    assert.equal(countBadge(page), 0);
    assert.ok(
      text(page).includes(translator.t('familyPlus.identity.unavailable')),
    );
  }
};
for (const [userId, familyId] of [
  ['synthetic-other-account', 'synthetic-family'],
  ['synthetic-owner', 'another-family'],
]) {
  const staleSelect = selectActive();
  changeIdentity(userId, familyId);
  assert.equal(readIdentity({ userId, familyId }).scene, 'unavailable');
  assert.equal(staleSelect('active'), false);
  assertNeutralPages();
  changeIdentity(selectionScope.userId, selectionScope.familyId);
  assert.equal(readIdentity().scene, 'unavailable');
  assertNeutralPages();
}
const beforeLogout = selectActive();
changeIdentity(null, null); // Same event as Auth's existing clearCurrentFamily().
assert.equal(beforeLogout('active'), false);
changeIdentity(selectionScope.userId, selectionScope.familyId);
assertNeutralPages();
selectActive();
const beforePetSwitch =
  preview.familyPlusPreviewMemory.getSnapshot().generation;
// Pet changes leave the canonical Family identity unchanged.
changeIdentity(selectionScope.userId, selectionScope.familyId);
assert.equal(readIdentity().scene, 'active');
assert.equal(
  preview.familyPlusPreviewMemory.getSnapshot().generation,
  beforePetSwitch,
);
const restartedPreview = load('src/features/billing/family-plus-preview.ts');
const restartedDisplay = load(
  'src/features/billing/use-family-plus-preview.tsx',
  {
    ...hookDeps,
    './family-plus-preview': restartedPreview,
  },
  globals,
);
restartedDisplay.FamilyPlusPreviewLifecycle();
assert.equal(
  restartedDisplay.useFamilyPlusPreview({
    ...selectionScope,
    role: 'owner',
    loading: false,
    error: false,
  }).scene,
  'unavailable',
);
assert.equal(
  restartedPreview.familyPlusPreviewMemory.read(selectionScope),
  'unavailable',
);
changeIdentity(null, null);
changeIdentity(selectionScope.userId, selectionScope.familyId);
assertNeutralPages();
for (const [development, url] of [
  [false, environment.EXPO_PUBLIC_SUPABASE_URL],
  [true, 'https://tknaobmlwmodsqtpqwkr.supabase.co'],
]) {
  const deniedGlobals = {
    __DEV__: development,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: url } },
  };
  const deniedHook = load(
    'src/features/billing/use-family-plus-preview.tsx',
    hookDeps,
    deniedGlobals,
  );
  assert.equal(
    deniedHook.useFamilyPlusPreview({
      userId: 'synthetic-owner',
      familyId: 'synthetic-family',
      role: 'owner',
      loading: false,
      error: false,
    }).snapshot,
    null,
  );
  const deniedBadge = load(
    'src/features/billing/components/family-plus-badge.tsx',
    {
      ...shared,
      '@expo/vector-icons/Ionicons': { __esModule: true, default: 'Icon' },
      '../family-plus-presentation': model,
      '../family-plus-preview': preview,
    },
    deniedGlobals,
  );
  assert.equal(
    deniedBadge.FamilyPlusBadge({
      snapshot: preview.familyPlusPreviewSnapshot(true, 'active'),
    }),
    null,
  );
}
console.log(
  'PASS: actual membership scenario clicks synchronize all three pages, all canonical roles see the same Family badge, long names retained, real Family-store lifecycle clears on switch/logout, and Release/Production hooks/badges reject preview identity.',
);
console.log(
  'PASS: bilingual benefits headings distinguish owned/upgrade/resubscribe/offered/neutral states; Viewer cannot escalate or perform billing; account/Family/logout changes clear actual page badges and stale callbacks; a fresh module runtime starts unknown while Pet changes retain the same Family preview.',
);

await translator.changeLanguage('en');
const callsBeforePresentation = familyCalls;
const serverExample = {
  ...preview.familyPlusPreviewSnapshot(true, 'free'),
  source: 'server',
  prices: [
    { period: 'monthly', priceString: 'HK$32.00', source: 'apple' },
    { period: 'yearly', priceString: 'HK$238.00', source: 'apple' },
  ],
};
const localized = render(
  screen.FamilyPlusDetails({
    snapshot: serverExample,
    role: 'owner',
    period: 'monthly',
    onSelectPeriod: () => undefined,
    onAction: () => undefined,
  }),
);
assert.ok(text(localized).includes('HK$32.00'));
assert.ok(!text(localized).includes('US$'));
assert.ok(!text(localized).includes('37%'));
assert.ok(
  !text(localized).includes(translator.t('familyPlus.storage.enforcementOff')),
);
wide = true;
fontScale = 1;
render(
  screen.FamilyPlusDetails({
    snapshot: serverExample,
    role: 'owner',
    period: 'monthly',
    onSelectPeriod: () => undefined,
    onAction: () => undefined,
  }),
);
fontScale = 2;
render(
  screen.FamilyPlusDetails({
    snapshot: serverExample,
    role: 'owner',
    period: 'monthly',
    onSelectPeriod: () => undefined,
    onAction: () => undefined,
  }),
);
assert.equal(familyCalls, callsBeforePresentation);
slots = [];
cursor = 0;
const zeroPetFamily = render(screen.default());
assert.equal(familyCalls, callsBeforePresentation + 1);
assert.ok(
  text(zeroPetFamily).includes(translator.t('familyPlus.status.unavailable')),
);
// The supplied Family context has no Pet data at all.
const existingFamilyCalls = familyCalls;
const releaseScreen = load(
  'src/features/billing/family-plus-screen.tsx',
  screenDeps,
  { ...globals, __DEV__: false },
);
assert.equal(releaseScreen.default(), null);
assert.equal(familyCalls, existingFamilyCalls);
const routeDeps = {
  'react/jsx-runtime': jsxRuntime,
  'expo-router': { Redirect: 'Redirect' },
  '@/features/billing/family-plus-screen': {
    __esModule: true,
    default: screen.default,
  },
  '@/features/billing/family-plus-preview': preview,
};
assert.equal(
  load('src/app/family-plus.tsx', routeDeps, {
    ...globals,
    __DEV__: false,
  }).default().type,
  'Redirect',
);
assert.equal(
  load('src/app/family-plus.tsx', routeDeps, globals).default().type,
  screen.default,
);
assert.equal(
  load('src/app/family-plus.tsx', routeDeps, {
    __DEV__: true,
    process: {
      env: {
        EXPO_PUBLIC_SUPABASE_URL: 'https://tknaobmlwmodsqtpqwkr.supabase.co',
      },
    },
  }).default().type,
  'Redirect',
);
console.log(
  'PASS: actual TSX states/roles, plan selection, preview-only purchase/restore/manage feedback, no-data/offline/retry, localized Store Product display and release route denial. No SDK/network/persistence dependencies loaded.',
);

const settings = read('src/features/family/family-settings-screen.tsx');
const settingsAst = ts.createSourceFile(
  'settings.tsx',
  settings,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let entryGuard;
const findEntry = (node) => {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(settingsAst) === 'SettingsRow' &&
    node.attributes.getText(settingsAst).includes("t('familyPlus.entry')")
  ) {
    let parent = node.parent;
    while (parent && !ts.isConditionalExpression(parent))
      parent = parent.parent;
    entryGuard = parent?.condition;
  }
  ts.forEachChild(node, findEntry);
};
findEntry(settingsAst);
assert.ok(entryGuard && ts.isCallExpression(entryGuard));
assert.equal(
  entryGuard.expression.getText(settingsAst),
  'isFamilyPlusAvailable',
);
assert.equal(entryGuard.arguments.length, 0);
assert.match(settings, /label=\{t\('familyPlus.entry'\)\}/u);
assert.match(settings, /router\.push\('\/family-plus'\)/u);
assert.match(settings, /isOwner \? \(\s*pets\[0\] \?/u);
const layout = read('src/app/_layout.tsx');
const protectedGroup = layout.slice(
  layout.lastIndexOf(
    '<Stack.Protected',
    layout.indexOf('<Stack.Screen name="family-plus"'),
  ),
);
assert.ok(protectedGroup.includes('isFamilyPlusAvailable()'));
assert.ok(
  protectedGroup.indexOf('family-plus') <
    protectedGroup.indexOf('</Stack.Protected>'),
);
const sourcePaths = [
  'src/features/billing/family-plus-screen.tsx',
  'src/features/billing/family-plus-preview.ts',
  'src/features/billing/family-plus-presentation.ts',
  'src/features/billing/components/family-storage-summary.tsx',
  'src/app/family-plus.tsx',
  'src/features/billing/use-family-plus-preview.tsx',
  'src/features/billing/components/family-plus-badge.tsx',
];
for (const path of sourcePaths) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /react-native-purchases|billing-client|requireSupabase|\.rpc\(|\.invoke\(|\bfetch\(|AsyncStorage|currentPet|pet_members/u,
    path,
  );
}
assert.match(
  read('src/features/billing/family-plus-screen.tsx'),
  /<Screen scroll modal/u,
);
assert.doesNotMatch(
  read('src/features/billing/family-plus-screen.tsx'),
  /allowFontScaling=\{false\}|numberOfLines=|position:\s*'absolute'/u,
);
assert.equal(
  screen.familyPlusLegalLinks.terms,
  'https://homeypaw.vercel.app/terms',
);
assert.equal(
  screen.familyPlusLegalLinks.privacy,
  'https://homeypaw.vercel.app/privacy',
);
assert.match(
  read('docs/TERMS_OF_SERVICE.md'),
  /https:\/\/homeypaw\.vercel\.app\/terms/u,
);
assert.match(
  read('docs/PRIVACY_POLICY.md'),
  /https:\/\/homeypaw\.vercel\.app\/privacy/u,
);
console.log(
  'PASS: Family-only navigation, Owner invite visibility retained, protected explicit-target stack, safe-area/scroll/font-scaling structure and existing policy URLs.',
);
assert.match(
  read('src/app/_layout.tsx'),
  /<AuthProvider>\s*<FamilyPlusPreviewLifecycle\s*\/>/u,
);
assert.match(
  read('src/features/auth/auth-context.tsx'),
  /useCurrentFamilyStore\.getState\(\)\.clearCurrentFamily\(\)/u,
);
assert.doesNotMatch(
  read('src/features/billing/family-plus-preview.ts'),
  /localStorage|AsyncStorage|persist\(/u,
);
for (const cleanup of lifecycleCleanups) cleanup?.();
assert.equal(lifecycleListeners.size, 0);

// Real screen integration uses the same layout, with Store Product prices and
// canonical server role. Development scene controls cannot trigger payments.
sandboxMode = true;
await translator.changeLanguage('en');
const purchaseActions = [];
const connected = {
  ready: true,
  managementReady: true,
  blocked: false,
  busy: false,
  message: null,
  productsLoading: false,
  prices: [
    { period: 'monthly', priceString: 'HK$28.00', source: 'apple' },
    { period: 'yearly', priceString: 'HK$228.00', source: 'apple' },
  ],
  action: (action, period) => {
    purchaseActions.push({ action, period });
  },
  reload: () => {},
};
const freeServer = {
  ...serverData.emptyFamilyPlusServerSnapshot,
  status: 'free',
  prices: [],
  quotaEnabled: false,
};
let connectedView = mount({
  mode: 'server',
  serverSnapshot: freeServer,
  serverRole: 'owner',
  billing: connected,
});
assert.ok(text(connectedView.tree).includes('Apple Sandbox testing'));
assert.ok(
  !text(connectedView.tree).includes(translator.t('familyPlus.previewSummary')),
);
assert.ok(text(connectedView.tree).includes('HK$228.00'));
assert.ok(!text(connectedView.tree).includes('US$29.99'));
connectedView.click(translator.t('familyPlus.purchase.buy'));
assert.deepEqual(purchaseActions, [{ action: 'purchase', period: 'yearly' }]);
connectedView.click(translator.t('familyPlus.purchase.restore'));
connectedView.click(translator.t('familyPlus.purchase.manage'));
assert.deepEqual(
  purchaseActions.map((x) => x.action),
  ['purchase', 'restore', 'manage'],
);
for (const role of ['member', 'viewer', null]) {
  const page = mount({
    mode: 'server',
    initialRole: role,
    serverRole: role,
    serverSnapshot: freeServer,
    billing: connected,
  });
  for (const key of [
    'familyPlus.purchase.buy',
    'familyPlus.purchase.restore',
    'familyPlus.purchase.manage',
  ])
    assert.ok(!buttons(page.tree).some((b) => label(b) === translator.t(key)));
}
for (const state of [{ ready: false }, { blocked: true }, { prices: [] }]) {
  const page = mount({
    mode: 'server',
    serverRole: 'owner',
    serverSnapshot: freeServer,
    billing: { ...connected, ...state },
  });
  const buy = buttons(page.tree).find(
    (b) => label(b) === translator.t('familyPlus.purchase.buy'),
  );
  assert.equal(
    buy.props.disabled,
    true,
    'unknown backend/lock/pending/price never opens StoreKit',
  );
}
for (const lang of ['zh-HK', 'en']) {
  await translator.changeLanguage(lang);
  const t = translator.t.bind(translator);
  for (const managementReady of [false, true]) {
    const actions = [];
    const active = mount({
      mode: 'server',
      scene: 'active',
      serverRole: 'owner',
      serverSnapshot: {
        ...preview.familyPlusPreviewSnapshot(true, 'active'),
        source: 'server',
        plusAccess: {
          source: 'server-verified',
          givesAccess: true,
          validUntil: new Date(Date.now() + 3600000).toISOString(),
        },
      },
      billing: {
        ...connected,
        blocked: true,
        ready: managementReady,
        managementReady,
        action: (action) => actions.push(action),
      },
    });
    assert.ok(!text(active.tree).includes(t('familyPlus.restore')));
    assert.ok(!text(active.tree).includes(t('familyPlus.manage')));
    for (const action of ['restore', 'manage']) {
      const button = buttons(active.tree).find(
        (b) => label(b) === t(`familyPlus.purchase.${action}`),
      );
      assert.ok(button);
      assert.equal(button.props.disabled, !managementReady);
      if (managementReady) active.click(t(`familyPlus.purchase.${action}`));
    }
    assert.deepEqual(actions, managementReady ? ['restore', 'manage'] : []);
  }
}
sandboxMode = false;
console.log(
  'PASS: connected Sandbox page uses localized Apple prices; purchase/restore/manage wiring; no preview toolbox; Member/Viewer/unknown role hidden; readiness, pending and missing-product guards. Mock actions only.',
);

const transitionNow = new Date().toISOString();
const transitionEnd = new Date(
  Date.parse(transitionNow) + 15 * 86_400_000,
).toISOString();
for (const lang of ['zh-HK', 'en']) {
  await translator.changeLanguage(lang);
  const date = new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(transitionEnd));
  for (const role of ['owner', 'member', 'viewer']) {
    const page = render(
      screen.FamilyPlusDetails({
        snapshot: {
          ...freeServer,
          status: 'transition',
          serverClock: {
            serverTime: transitionNow,
            receivedAt: model.monotonicNow(),
          },
          transition: { startsAt: transitionNow, endsAt: transitionEnd },
        },
        role,
        period: 'monthly',
        previewActions: false,
        onSelectPeriod: () => assert.fail('Read-only state'),
        onAction: () => assert.fail('No purchase'),
      }),
    );
    assert.ok(
      text(page).includes(
        translator.t('familyPlus.transitionDeadline', { count: 15, date }),
      ),
    );
    assert.ok(!text(page).includes('30 天') && !text(page).includes('30-day'));
  }
}
console.log(
  'PASS: zh-HK/en Transition shows the server-backed 15-day deadline for all Family roles without a paid Plus badge.',
);

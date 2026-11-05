// Offline only: real i18next, actual app modules, mocked device/Auth/registration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { createInstance } from 'i18next';
import ts from 'typescript';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const noop = () => {};
const jsx = (type, props) => ({ type, props });
const hooks = {
  createContext: () => ({}),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, noop],
};
const runtime = { jsx, jsxs: jsx };

function load(path, mocks, globals = {}) {
  const { outputText } = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const context = {
    exports: {},
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
      return mocks[name];
    },
    ...globals,
  };
  new vm.Script(outputText, { filename: path }).runInNewContext(context);
  return context.exports;
}

async function initialize(tags) {
  const locales = tags.map((languageTag) => ({
    languageTag,
    languageCode: new Intl.Locale(languageTag).language,
  }));
  const module = load('src/i18n/index.ts', {
    'expo-localization': { getLocales: () => locales },
    i18next: { createInstance },
    'react-i18next': {
      initReactI18next: { type: '3rdParty', init: noop },
    },
    './locales/en.json': JSON.parse(read('src/i18n/locales/en.json')),
    './locales/zh-HK.json': JSON.parse(read('src/i18n/locales/zh-HK.json')),
  });
  if (!module.default.isInitialized) {
    await new Promise((resolve) => module.default.on('initialized', resolve));
  }
  return module;
}

function authHarness(i18nModule, localeForUser) {
  const effects = [];
  const timers = new Map();
  let nextTimer = 0;
  let listener;
  const store = {
    getState: () => ({ clearCurrentFamily: noop, clearCurrentPet: noop }),
  };
  const auth = load(
    'src/features/auth/auth-context.tsx',
    {
      react: { ...hooks, useEffect: (fn) => effects.push(fn) },
      'react/jsx-runtime': runtime,
      '@tanstack/react-query': { useQueryClient: () => ({ clear: noop }) },
      '@/i18n': i18nModule,
      '@/lib/supabase/client': {
        isSupabaseConfigured: true,
        registerSupabaseAutoRefresh: () => noop,
        supabase: {
          auth: {
            onAuthStateChange: (fn) => {
              listener = fn;
              return { data: { subscription: { unsubscribe: noop } } };
            },
          },
          from: (table) => {
            assert.equal(table, 'profiles');
            return {
              select: (column) => {
                assert.equal(column, 'locale');
                return {
                  eq: (key, userId) => {
                    assert.equal(key, 'id');
                    return { maybeSingle: () => localeForUser(userId) };
                  },
                };
              },
            };
          },
        },
      },
      '@/services/care-task-notifications': {
        cancelCareTaskNotifications: async () => {},
      },
      '@/services/family-push-device': {},
      '@/features/billing/billing-client': { setBillingAuthUser: noop },
      '@/stores/current-family-store': { useCurrentFamilyStore: store },
      '@/stores/current-pet-store': { useCurrentPetStore: store },
      './auth-callback': {},
      './profile-setup-marker': { hasPendingProfileSetup: () => false },
    },
    {
      setTimeout: (fn, delay) => {
        const id = ++nextTimer;
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  auth.AuthProvider({ children: null });
  const cleanup = effects.map((fn) => fn());
  return {
    async emit(event, userId) {
      listener(event, userId ? { user: { id: userId } } : null);
      for (const [id, timer] of timers) {
        if (timer.delay === 0) {
          timers.delete(id);
          timer.fn();
        }
      }
      await setImmediate();
    },
    cleanup: () => cleanup.forEach((fn) => fn?.()),
  };
}

async function registrationLocale(i18n) {
  let submit;
  let request;
  const { default: SignUp } = load('src/features/auth/sign-up-screen.tsx', {
    react: hooks,
    'react/jsx-runtime': runtime,
    'react-native': {},
    'react-hook-form': {
      useForm: () => ({
        handleSubmit: (fn) => {
          submit = fn;
          return noop;
        },
        formState: { isSubmitting: false },
      }),
    },
    '@hookform/resolvers/zod': { zodResolver: noop },
    'expo-linking': { createURL: () => 'pawday://check-email' },
    'expo-router': { useRouter: () => ({ replace: noop }) },
    'react-i18next': { useTranslation: () => ({ i18n, t: i18n.t.bind(i18n) }) },
    '@/components/app-button': {},
    '@/components/app-text': {},
    '@/lib/supabase/client': {
      requireSupabase: () => ({
        auth: {
          signUp: async (value) => {
            request = value;
            return { data: { user: null, session: null }, error: null };
          },
        },
      }),
    },
    './auth-errors': {},
    './auth-schemas': { createSignUpSchema: noop },
    './auth-context': {
      useAuth: () => ({
        beginProfileSetupSignUp: noop,
        cancelProfileSetupSignUp: noop,
        registerPendingProfileSetup: noop,
        isConfigured: true,
      }),
    },
    './components/auth-field': {},
    './components/auth-screen': {},
    './components/form-message': {},
  });
  SignUp();
  await submit({
    email: 'example@example.invalid',
    password: 'synthetic-password',
    displayName: 'Example',
  });
  return request.options.data.locale;
}

for (const [tags, expected] of [
  [['zh-HK'], 'zh-HK'],
  [['zh-Hant-TW'], 'zh-HK'],
  [['zh-Hans-CN'], 'zh-HK'],
  [['en-US'], 'en'],
  [['en-GB'], 'en'],
  [['en-HK'], 'en'],
  [['ja-JP'], 'en'],
  [['fr-FR'], 'en'],
  [['ja-JP', 'zh-HK'], 'en'],
  [[], 'en'],
]) {
  const module = await initialize(tags);
  assert.equal(
    module.default.resolvedLanguage,
    expected,
    `First launch: ${tags}`,
  );
  assert.equal(
    await registrationLocale(module.default),
    expected,
    `Registration: ${tags}`,
  );
  const resources = JSON.parse(read(`src/i18n/locales/${expected}.json`));
  assert.equal(module.default.t('common.save'), resources.common.save);
}

for (const [device, saved, expected] of [
  ['zh-HK', 'en', 'en'],
  ['en-US', 'zh-HK', 'zh-HK'],
  ['en-US', 'en', 'en'],
  ['zh-HK', 'zh-HK', 'zh-HK'],
  ['en-US', null, 'en'],
  ['ja-JP', 'unsupported', 'en'],
]) {
  const module = await initialize([device]);
  const auth = authHarness(module, async () => ({
    data: saved ? { locale: saved } : null,
  }));
  await auth.emit('INITIAL_SESSION', 'existing-user');
  assert.equal(
    module.default.resolvedLanguage,
    expected,
    'Saved profile wins on cold start',
  );
  auth.cleanup();
}

const module = await initialize(['zh-HK']);
let resolveOld;
const auth = authHarness(module, (id) =>
  id === 'old-user'
    ? new Promise((resolve) => {
        resolveOld = resolve;
      })
    : Promise.resolve({ data: { locale: 'en' } }),
);
await auth.emit('SIGNED_IN', 'old-user');
await auth.emit('SIGNED_IN', 'new-user');
resolveOld({ data: { locale: 'zh-HK' } });
await setImmediate();
assert.equal(
  module.default.resolvedLanguage,
  'en',
  'Late previous account cannot override current account',
);
auth.cleanup();

const offline = await initialize(['en-US']);
const failedAuth = authHarness(offline, async () => {
  throw new Error('OFFLINE_FIXTURE');
});
await failedAuth.emit('INITIAL_SESSION', 'existing-user');
assert.equal(
  offline.default.resolvedLanguage,
  'en',
  'Failed preference read retains device fallback',
);
failedAuth.cleanup();
await offline.default.changeLanguage('unsupported');
assert.equal(offline.default.resolvedLanguage, 'en');
assert.deepEqual(
  Object.keys(JSON.parse(read('app.json')).expo.locales).sort(),
  ['en', 'zh-HK'],
);
console.log(
  'PASS: device defaults, real translations, registration metadata, saved profile priority, stale-account isolation and failed-read fallback. Offline mocks only; no Auth/database requests.',
);

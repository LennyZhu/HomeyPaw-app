// Local JSX/interaction verification. All navigation, Auth and native APIs mocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const noop = () => {};
const jsx = (type, props) => ({ type, props });
const runtime = { jsx, jsxs: jsx };
function load(path, mocks, globals = {}) {
  const context = {
    exports: {},
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
      return mocks[name];
    },
    ...globals,
  };
  new vm.Script(
    ts.transpileModule(read(path), {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    { filename: path },
  ).runInNewContext(context);
  return context.exports;
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children), ...nodes(node.props?.footer)];
}
function mount({ available = true, busy = false } = {}) {
  const prompts = [],
    routes = [],
    logins = [];
  let time = 10000,
    focus,
    cleanup,
    submit;
  const react = {
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (current) => ({ current }),
    useState: (value) => [value, noop],
  };
  const { default: SignIn } = load(
    'src/features/auth/sign-in-screen.tsx',
    {
      react,
      'react/jsx-runtime': runtime,
      'react-native': {
        Alert: { alert: (...args) => prompts.push(args) },
        StyleSheet: { create: (x) => x },
        TextInput: 'TextInput',
        View: 'View',
      },
      'expo-router': {
        Link: 'Link',
        useRouter: () => ({ push: (route) => routes.push(route) }),
        useLocalSearchParams: () => ({}),
        useFocusEffect: (fn) => {
          focus = fn;
        },
      },
      'react-hook-form': {
        Controller: 'Controller',
        useForm: () => ({
          handleSubmit: (fn) => {
            submit = fn;
            return noop;
          },
          formState: { isSubmitting: busy },
        }),
      },
      '@hookform/resolvers/zod': { zodResolver: noop },
      'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
      '@/components/app-button': { AppButton: 'AppButton' },
      '@/components/app-text': { AppText: 'AppText' },
      '@/lib/supabase/client': {
        requireSupabase: () => ({
          auth: {
            signInWithPassword: async (value) => {
              logins.push(value);
              return { error: null };
            },
          },
        }),
      },
      '@/theme': { spacing: {} },
      './auth-errors': {},
      './auth-schemas': { createSignInSchema: noop },
      './auth-context': { useAuth: () => ({ isConfigured: true }) },
      './components/auth-field': { AuthField: 'AuthField' },
      './components/auth-screen': { AuthScreen: 'AuthScreen' },
      './components/form-message': { FormMessage: 'FormMessage' },
      '@/features/billing/billing-test-account': {
        canUseBillingTestAccount: () => available,
      },
    },
    { Date: { now: () => time } },
  );
  const tree = SignIn();
  cleanup = focus();
  return {
    tree,
    prompts,
    routes,
    logins,
    tap: (count = 1, gap = 100) => {
      for (let i = 0; i < count; i++) {
        time += gap;
        tree.props.onBrandPress();
      }
    },
    advance: (ms) => {
      time += ms;
    },
    blur: () => cleanup(),
    focus: () => {
      cleanup = focus();
    },
    available: (value) => {
      available = value;
    },
    submit: (values) => submit(values),
  };
}
const normal = mount();
const labels = nodes(normal.tree)
  .map((n) => n.props?.label)
  .filter(Boolean);
assert.deepEqual(
  [...labels].sort(),
  [
    'auth.signIn.createAccount',
    'auth.signIn.submit',
    'auth.signIn.forgotPassword',
  ].sort(),
);
assert.ok(
  !labels.includes('billingTestAccount.title'),
  'No visible test-login button',
);
assert.equal(normal.routes.length, 0);
normal.tap(6);
assert.equal(normal.prompts.length, 0);
normal.tap();
assert.equal(normal.prompts.length, 1);
assert.equal(normal.routes.length, 0, 'Seven taps only request confirmation');
assert.equal(normal.logins.length, 0, 'Discovery creates no Auth request');
assert.equal(normal.prompts[0][0], 'billingTestAccount.title');
assert.equal(normal.prompts[0][1], 'billingTestAccount.body');
normal.tap(10);
assert.equal(normal.prompts.length, 1, 'Only one prompt at a time');
const cancel = normal.prompts[0][2].find((b) => b.text === 'common.cancel');
cancel.onPress();
normal.tap(6);
assert.equal(normal.prompts.length, 1);
normal.tap();
assert.equal(normal.prompts.length, 2);
const confirm = normal.prompts[1][2].find((b) => b.text === 'common.continue');
confirm.onPress();
confirm.onPress();
assert.deepEqual(
  normal.routes,
  ['/billing-test-account'],
  'Explicit confirmation is single-use',
);
assert.equal(normal.logins.length, 0);

const dismissed = mount();
dismissed.tap(7);
dismissed.prompts[0][3].onDismiss();
dismissed.prompts[0][2].find((b) => b.text === 'common.continue').onPress();
assert.equal(dismissed.routes.length, 0, 'Dismissed prompt cannot navigate');

const timeout = mount();
timeout.tap(6);
timeout.advance(5001);
timeout.tap(6);
assert.equal(timeout.prompts.length, 0, 'Old taps expire');
timeout.tap();
assert.equal(timeout.prompts.length, 1);

const navigation = mount();
navigation.tap(6);
navigation.blur();
navigation.focus();
navigation.tap();
assert.equal(navigation.prompts.length, 0, 'Navigation resets tap count');
navigation.tap(6);
const stale = navigation.prompts[0][2].find(
  (b) => b.text === 'common.continue',
);
navigation.blur();
navigation.focus();
stale.onPress();
assert.equal(
  navigation.routes.length,
  0,
  'Previous-focus confirmation cannot navigate',
);

const denied = mount({ available: false });
denied.tap(20);
assert.equal(denied.prompts.length, 0);
assert.equal(denied.routes.length, 0);
const revoked = mount();
revoked.tap(7);
revoked.available(false);
revoked.prompts[0][2].find((b) => b.text === 'common.continue').onPress();
assert.equal(
  revoked.routes.length,
  0,
  'Existing configuration gate is rechecked',
);
const busy = mount({ busy: true });
busy.tap(7);
assert.equal(busy.prompts.length, 0);

await normal.submit({
  email: ' Person@Example.Invalid ',
  password: 'synthetic-password',
});
assert.equal(normal.logins.length, 1);
assert.equal(normal.logins[0].email, 'person@example.invalid');
assert.equal(normal.logins[0].password, 'synthetic-password');

const { AuthScreen } = load('src/features/auth/components/auth-screen.tsx', {
  'react/jsx-runtime': runtime,
  'react-native': {
    Pressable: 'Pressable',
    View: 'View',
    ScrollView: 'ScrollView',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Platform: { OS: 'ios' },
    StyleSheet: { create: (x) => x },
  },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '@/components/content-container': { contentStyles: { auth: {} } },
  '@/components/app-text': { AppText: 'AppText' },
  '@/theme': { lightColors: {}, layout: {}, spacing: {} },
});
assert.equal(
  nodes(AuthScreen({ title: 'Sign up' })).filter((n) => n.type === 'Pressable')
    .length,
  0,
);
const brand = nodes(AuthScreen({ title: 'Sign in', onBrandPress: noop })).find(
  (n) => n.type === 'Pressable',
);
assert.equal(brand.props.accessibilityLabel, 'HomeyPaw');
assert.equal(brand.props.accessibilityRole, 'button');
assert.equal(brand.props.onPress, noop);

assert.match(
  read('src/app/_layout.tsx'),
  /canUseBillingTestAccount\(\) &&\s*!session/,
);
assert.doesNotMatch(
  read('src/features/auth/sign-in-screen.tsx'),
  /__DEV__|EXPO_PUBLIC_|localStorage|createClient|signInBillingTestAccount/,
);
for (const locale of ['en', 'zh-HK']) {
  const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
  assert.ok(
    messages.billingTestAccount.title &&
      messages.billingTestAccount.body &&
      messages.common.cancel &&
      messages.common.continue,
  );
}
console.log(
  'PASS: normal actions only; seven timed taps + explicit confirmation; timeout/cancel/focus/busy/config gates; no gesture Auth; unchanged normal sign-in; accessible wordmark. Local mocks only.',
);

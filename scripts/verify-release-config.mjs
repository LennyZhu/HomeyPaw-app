import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(path, 'utf8');
const expo = JSON.parse(read('app.json')).expo;
const eas = JSON.parse(read('eas.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const production = eas.build.production;
assert.equal(expo.version, '1.3.0');
assert.equal(expo.ios.buildNumber, '10');
assert.equal(expo.ios.version ?? expo.version, expo.version);
assert.equal(pkg.version, expo.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(expo.ios.bundleIdentifier, 'com.zhushunli.homeypaw');
assert.equal(expo.scheme, 'pawday');
assert.equal(eas.cli.appVersionSource, 'local');
assert.equal(production.autoIncrement, false);
assert.equal(production.environment, 'production');
assert.equal(production.distribution, 'store');
assert.equal(production.extends, undefined);
assert.notEqual(production.developmentClient, true);
assert.notEqual(production.ios?.simulator, true);
assert.equal(eas.submit.production.ios.ascAppId, '6806111286');
assert.equal(
  execFileSync('git', ['ls-files', 'ios', 'android'], {
    encoding: 'utf8',
  }).trim(),
  '',
  'EAS must use CNG, not a stale committed native project',
);
assert.equal(existsSync('.easignore'), false, 'Re-audit CNG upload exclusions');
for (const directory of ['ios', 'android'])
  assert.ok(read('.gitignore').split('\n').includes(`/${directory}`));
assert.doesNotMatch(
  JSON.stringify({ expo, production }),
  /localhost|127\.0\.0\.1/u,
);
const client = read('src/lib/supabase/client.ts');
assert.match(client, /process\.env\.EXPO_PUBLIC_SUPABASE_URL/u);
assert.match(client, /process\.env\.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/u);
assert.match(client, /!isPrivilegedKey\(supabaseClientKey\)/u);

// Execute SDK 57's actual config plugins in read-only introspection mode.
// No prebuild, native files, credentials, network or build are produced.
const config = JSON.parse(
  execFileSync(
    process.execPath,
    ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'],
    {
      encoding: 'utf8',
      env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' },
      timeout: 30_000,
    },
  ),
);
const ios = config._internal.modResults.ios;
assert.equal(ios.infoPlist.CFBundleShortVersionString, expo.version);
assert.equal(ios.infoPlist.CFBundleVersion, expo.ios.buildNumber);
assert.equal(ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
assert.ok(
  ios.infoPlist.CFBundleURLTypes.some((entry) =>
    entry.CFBundleURLSchemes.includes('pawday'),
  ),
);
for (const key of [
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
]) {
  assert.match(ios.infoPlist[key], /影片/u);
  assert.match(expo.locales.en.ios[key], /video/u);
}
assert.ok(ios.infoPlist.NSCameraUsageDescription);
for (const key of [
  'NSMicrophoneUsageDescription',
  'NSContactsUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSUserTrackingUsageDescription',
])
  assert.equal(ios.infoPlist[key], undefined);
// Expo's plugin sets development here; Xcode changes it in a signed store
// archive. This verifies entitlement generation, not future signing/APNs.
assert.equal(ios.entitlements['aps-environment'], 'development');
assert.ok(!ios.infoPlist.UIBackgroundModes?.includes('remote-notification'));
console.log(
  'PASS: 1.3.0 (10), package/lock alignment, local EAS store profile, CNG version/permissions/APNs generation and pawday scheme. ASC build availability and signed archive remain manual checks.',
);

function load(path, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Script(source, { filename: path }).runInNewContext({
    exports: module.exports,
    module,
    require: (name) => {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency: ${name}`,
      );
      return dependencies[name];
    },
    ...globals,
  });
  return module.exports;
}
const policyFunctions = load('src/features/app-release/version-policy.ts');
const policy = {
  platform: 'ios',
  minimum_app_version: '1.3.0',
  minimum_build: 10,
  maintenance_mode: false,
  maintenance_message: null,
};
for (const dev of [false, true]) {
  for (const [version, build, maintenance, expected] of [
    ['1.2.0', '9', false, dev ? 'allowed' : 'upgrade'],
    ['1.3.0', '10', false, 'allowed'],
    ['1.3.0', '10', true, 'maintenance'],
  ]) {
    let gateState;
    const gate = load(
      'src/features/app-release/use-app-release-gate.ts',
      {
        react: {
          useCallback: (fn) => fn,
          useEffect: () => undefined,
          useRef: (value) => ({ current: value }),
          useState: (initial) => {
            gateState = initial;
            return [
              initial,
              (next) => {
                gateState = typeof next === 'function' ? next(gateState) : next;
              },
            ];
          },
        },
        'react-native': { AppState: {} },
        '@/lib/supabase/client': {
          supabase: {
            from: (table) => {
              assert.equal(table, 'app_release_policy');
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { ...policy, maintenance_mode: maintenance },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          },
        },
        './minimum-version': {
          getInstalledAppIdentity: () => ({ platform: 'ios', version, build }),
        },
        './version-policy': policyFunctions,
      },
      { __DEV__: dev },
    );
    await gate.useAppReleaseGate().recheck();
    assert.equal(gateState.status, expected);
  }
  const identity = load(
    'src/features/app-release/minimum-version.ts',
    {
      'expo-application': {
        nativeApplicationVersion: '1.2.0',
        nativeBuildVersion: '9',
      },
      'expo-constants': {
        __esModule: true,
        default: { expoConfig: { version: expo.version } },
      },
      'react-native': { Platform: { OS: 'ios' } },
    },
    { __DEV__: dev },
  );
  assert.equal(
    identity.getAppVersionHeaders()['X-HomeyPaw-App-Version'],
    '1.2.0',
  );
  assert.equal(identity.getAppVersionHeaders()['X-HomeyPaw-Build'], '9');
}
console.log(
  'PASS: actual release startup gate blocks an old binary, DEV bypass is UI-only, maintenance remains blocking and request headers retain native identity. No server gate/config is changed.',
);

// Execute real registration in a non-DEV runtime with in-memory adapters.
let permission = 'granted';
const calls = [];
const installationId = '11111111-1111-4111-8111-111111111111';
const storage = new Map([['homeypaw-push-installation-id-v1', installationId]]);
const device = load(
  'src/services/family-push-device.ts',
  {
    'expo-constants': { __esModule: true, default: { expoConfig: expo } },
    'expo-crypto': {
      randomUUID: () => {
        throw new Error('Upgrade must reuse installation');
      },
    },
    'expo-notifications': {
      getExpoPushTokenAsync: async () => ({
        data: 'ExpoPushToken[fixture0000]',
      }),
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/lib/supabase/client': {
      requireSupabase: () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: true, error: null };
        },
      }),
    },
    './care-task-notifications': {
      ensureReminderNotificationChannel: async () => undefined,
      getCareTaskNotificationPermission: async () => permission,
    },
  },
  {
    __DEV__: false,
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  },
);
const first = device.registerFamilyPushDevice();
assert.equal(
  device.registerFamilyPushDevice(),
  first,
  'Concurrent registration shares one request',
);
assert.equal(await first, true);
await device.registerFamilyPushDevice();
assert.equal(calls.length, 2);
for (const { name, args } of calls) {
  assert.equal(name, 'register_push_device');
  assert.equal(Object.keys(args).length, 5);
  assert.equal(args.device_installation_id, installationId);
  assert.equal(args.device_app_version, expo.version);
  assert.equal(args.device_chat_push_v1, true);
}
permission = 'denied';
assert.equal(await device.registerFamilyPushDevice(), false);
assert.equal(calls.length, 2, 'Permission denial never registers');
const coordinator = read('src/features/reminders/family-push-coordinator.tsx');
assert.doesNotMatch(coordinator, /__DEV__/u);
assert.match(coordinator, /void refresh\(\)/u);
assert.match(coordinator, /state === 'active'/u);
assert.match(coordinator, /addPushTokenListener/u);
assert.match(coordinator, /\[canRun, session\]/u);
assert.match(read('src/app/_layout.tsx'), /<FamilyPushCoordinator \/>/u);
const migration = read(
  'supabase/migrations/20260928072854_family_chat_remote_push_v1.sql',
);
assert.match(migration, /on conflict \(installation_id\) do update/iu);
assert.match(migration, /device_platform, device_app_version, false/iu);
for (const path of [
  'src/features/reminders/components/care-task-form.tsx',
  'src/features/reminders/edit-care-task-screen.tsx',
  'src/features/posts/post-read-queries.ts',
])
  assert.doesNotMatch(read(path), /__DEV__/u);
console.log(
  'PASS: actual release registration uses five args/capability true, reuses installation, dedupes concurrent calls and skips denied permission; startup/session/foreground/token-refresh wiring and legacy false/upsert contracts remain. Recurrence/receipts are not DEV-gated.',
);

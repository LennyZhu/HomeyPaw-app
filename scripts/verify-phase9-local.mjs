import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const easProjectId = '3623de2b-5a77-48ec-b2ec-45e8136d9ac7';

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const appConfig = JSON.parse(read('app.json'));
const easConfig = JSON.parse(read('eas.json'));
const expo = appConfig.expo ?? {};
const production = easConfig.build?.production ?? {};
const productionIosSubmit = easConfig.submit?.production?.ios ?? {};
const tabsLayout = read('src/app/(tabs)/_layout.tsx');
const chatRoute = read('src/app/(tabs)/chat.tsx');
const featureFlags = read('src/config/features.ts');

assert(expo.name === 'HomeyPaw', 'Production name must be HomeyPaw.');
assert(expo.version === '1.1.0', 'Production version must be 1.1.0.');
assert(expo.ios?.buildNumber === '2', 'Production build number must be 2.');
assert(
  expo.ios?.bundleIdentifier === 'com.zhushunli.homeypaw',
  'The production Bundle ID must be com.zhushunli.homeypaw.',
);
assert(expo.scheme === 'pawday', 'The compatibility URL scheme must remain.');
assert(
  expo.ios?.config?.usesNonExemptEncryption === false,
  'Export-compliance declaration must remain explicit.',
);
assert(
  production.distribution === 'store',
  'The EAS production profile must create a store build.',
);
assert(
  production.environment === 'production',
  'The EAS production profile must select the production environment.',
);
assert(
  production.developmentClient !== true,
  'The production profile must not enable the development client.',
);
assert(
  productionIosSubmit.ascAppId === '6806111286',
  'The production iOS submit profile must target App Store Connect app 6806111286.',
);
assert(
  Object.keys(productionIosSubmit).every((key) => key === 'ascAppId'),
  'The production iOS submit profile must not contain Apple credentials.',
);
assert(
  expo.extra?.eas?.projectId === easProjectId,
  'The app must remain linked to the approved EAS project.',
);
assert(expo.owner === 'homeypaw', 'Unexpected EAS project owner.');
assert(expo.slug === 'homeypaw', 'Unexpected Expo project slug.');
assert(
  tabsLayout.includes('...(CHAT_ENABLED ? {} : { href: null })') &&
    featureFlags.includes('PRODUCTION_CHAT_ENABLED = true') &&
    featureFlags.includes('__DEV__ && LOCAL_BACKEND') &&
    chatRoute.includes('if (!CHAT_ENABLED)'),
  'Phase 10A Chat must be enabled behind the approved route guard.',
);

const serializedAppConfig = JSON.stringify(appConfig);
assert(
  typeof expo.locales?.en?.ios?.NSCameraUsageDescription === 'string' &&
    expo.locales.en.ios.NSCameraUsageDescription.length > 0 &&
    typeof expo.locales?.['zh-HK']?.ios?.NSCameraUsageDescription ===
      'string' &&
    expo.locales['zh-HK'].ios.NSCameraUsageDescription.length > 0,
  'Camera permission must have English and zh-HK purpose strings.',
);
const imagePickerPlugin = expo.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker',
);
assert(
  typeof imagePickerPlugin?.[1]?.cameraPermission === 'string' &&
    imagePickerPlugin[1].cameraPermission.length > 0,
  'expo-image-picker must declare a camera purpose string.',
);
assert(
  imagePickerPlugin?.[1]?.microphonePermission === false,
  'Journal camera capture must not request microphone permission.',
);

for (const forbiddenPermission of [
  'NSContactsUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSUserTrackingUsageDescription',
]) {
  assert(
    !serializedAppConfig.includes(forbiddenPermission),
    `Unused iOS permission found: ${forbiddenPermission}`,
  );
}

for (const requiredDocument of [
  'docs/APP_STORE_METADATA.md',
  'docs/APP_PRIVACY_DATA_INVENTORY.md',
  'docs/APP_STORE_AGE_RATING.md',
  'docs/TESTFLIGHT_INTERNAL_CHECKLIST.md',
  'docs/PHASE9_LOCAL_PREPARATION.md',
]) {
  assert(
    fs.existsSync(path.join(root, requiredDocument)),
    `Missing Phase 9 document: ${requiredDocument}`,
  );
}

if (fs.existsSync(path.join(root, 'docs/APP_STORE_METADATA.md'))) {
  const metadata = read('docs/APP_STORE_METADATA.md');
  for (const requiredValue of [
    'HomeyPaw',
    'com.zhushunli.homeypaw',
    '1.0.0',
    'HOMEYPAW-IOS-001',
    'https://homeypaw.vercel.app/privacy',
    'https://homeypaw.vercel.app/support',
    'lenny996@163.com',
    'Beta App Description',
    'What to Test',
  ]) {
    assert(
      metadata.includes(requiredValue),
      `App Store metadata is missing: ${requiredValue}`,
    );
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exitCode = 1;
} else {
  console.log('PASS: Phase 9 local app identity and store profile are ready.');
  console.log('PASS: The approved remote EAS project identity is linked.');
  console.log(
    'PASS: Phase 9 metadata, privacy, age-rating, and TestFlight drafts exist.',
  );
}

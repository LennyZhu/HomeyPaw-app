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

assert(expo.name === 'HomeyPaw', 'Production name must be HomeyPaw.');
assert(expo.version === '1.0.0', 'Production version must be 1.0.0.');
assert(
  expo.ios?.buildNumber === '1',
  'Initial production build number must be 1.',
);
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
  expo.extra?.eas?.projectId === easProjectId,
  'The app must remain linked to the approved EAS project.',
);
assert(expo.owner === 'homeypaw', 'Unexpected EAS project owner.');
assert(expo.slug === 'homeypaw', 'Unexpected Expo project slug.');

const serializedAppConfig = JSON.stringify(appConfig);
for (const forbiddenPermission of [
  'NSCameraUsageDescription',
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

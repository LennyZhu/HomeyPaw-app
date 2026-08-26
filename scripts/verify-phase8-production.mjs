import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const supportEmail = 'lenny996@163.com';
const publicWebsiteUrl = 'https://homeypaw.vercel.app/';
const appConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
);
const expo = appConfig.expo ?? {};

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

assert(expo.name === 'HomeyPaw', 'App display name must be HomeyPaw.');
assert(expo.version === '1.0.0', 'App version must be 1.0.0.');
assert(expo.orientation === 'portrait', 'V1 must be portrait-only.');
assert(expo.userInterfaceStyle === 'light', 'V1 must use Light appearance.');
assert(
  expo.ios?.bundleIdentifier === 'com.zhushunli.pawday',
  'Unexpected iOS bundle identifier.',
);
assert(expo.ios?.buildNumber === '1', 'Initial iOS build number must be 1.');
assert(
  expo.android?.package === 'com.zhushunli.pawday',
  'Unexpected Android package.',
);
assert(
  expo.android?.versionCode === 1,
  'Initial Android versionCode must be 1.',
);
assert(
  !expo.extra?.eas?.projectId,
  'Remote EAS project ID was added without approval.',
);

for (const asset of [
  'assets/branding/homeypaw-app-icon.png',
  'assets/branding/homeypaw-mark-transparent.png',
  'assets/branding/homeypaw-splash.png',
  'assets/branding/homeypaw-favicon.png',
]) {
  assert(
    fs.existsSync(path.join(root, asset)),
    `Missing branding asset: ${asset}`,
  );
}

const gitignore = read('.gitignore');
assert(
  /\.env\.\*/u.test(gitignore),
  '.env.local is not covered by Git ignore.',
);
assert(/!\.env\.example/u.test(gitignore), '.env.example must remain tracked.');

const envExample = read('.env.example');
assert(
  envExample.includes('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  'Publishable key variable is missing from .env.example.',
);
assert(
  !envExample.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  'Legacy anon key variable must not be the client contract.',
);

const clientConfigFiles = [
  'app.json',
  'eas.json',
  'package.json',
  '.env.example',
];
if (fs.existsSync(path.join(root, '.env.local')))
  clientConfigFiles.push('.env.local');
const forbiddenSecret =
  /(sb_secret_|service_role|postgres(?:ql)?:\/\/|SUPABASE_DB_PASSWORD|DATABASE_URL\s*=)/iu;
for (const file of clientConfigFiles) {
  assert(
    !forbiddenSecret.test(read(file)),
    `Privileged credential pattern found in ${file}.`,
  );
}

const sourceFiles = walk(path.join(root, 'src')).filter((file) =>
  /\.[cm]?[jt]sx?$/u.test(file),
);
for (const file of sourceFiles) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  if (relative !== 'src/lib/logger.ts') {
    assert(
      !/console\.(?:log|debug|warn|error)\s*\(/u.test(source),
      `Direct production console call found in ${relative}.`,
    );
  }
  assert(
    !/TEST_ONLY|FAILURE_INJECTION/u.test(source),
    `Test hook found in ${relative}.`,
  );
  const emailLiterals =
    source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? [];
  assert(
    emailLiterals.every((email) => email.toLowerCase() === supportEmail),
    `Unapproved hard-coded email found in ${relative}.`,
  );
}

assert(
  !fs.existsSync(path.join(root, 'src/app/(tabs)/chat.tsx')),
  'Chat route must not be exposed in the 1.0 production router.',
);
assert(
  fs.existsSync(path.join(root, 'eas.json')),
  'Missing local EAS profiles.',
);
assert(
  fs.existsSync(path.join(root, 'docs/PRIVACY_POLICY.md')),
  'Missing privacy draft.',
);
assert(
  fs.existsSync(path.join(root, 'docs/TERMS_OF_SERVICE.md')),
  'Missing terms draft.',
);

const appStoreMetadata = read('docs/APP_STORE_METADATA.md');
for (const publicUrl of [
  publicWebsiteUrl,
  `${publicWebsiteUrl}privacy`,
  `${publicWebsiteUrl}terms`,
  `${publicWebsiteUrl}support`,
]) {
  assert(
    appStoreMetadata.includes(publicUrl),
    `Public HomeyPaw URL missing from App Store metadata: ${publicUrl}`,
  );
}
assert(
  appStoreMetadata.includes(supportEmail),
  'Approved support email is missing from App Store metadata.',
);

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    'PASS: App identity, branding, and local build profiles are production-shaped.',
  );
  console.log(
    'PASS: Client environment contract contains only public Supabase configuration.',
  );
  console.log(
    'PASS: Production source has no direct console calls, unapproved emails, or test hooks.',
  );
  console.log('PASS: Chat remains hidden and privacy/terms drafts exist.');
  console.log(
    'PASS: Public HomeyPaw policy/support URLs and support email are recorded in metadata.',
  );
}

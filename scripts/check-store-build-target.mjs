import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function requirePublicKey(key, ref) {
  if (!key || key.startsWith('sb_secret_'))
    throw new Error('STORE_PUBLIC_KEY_REQUIRED');
  if (key.startsWith('sb_publishable_')) return;
  try {
    const c = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString(),
    );
    if (c.role !== 'anon' || c.ref !== ref) throw new Error();
  } catch {
    throw new Error('STORE_PUBLIC_KEY_IDENTITY_DENIED');
  }
}
// Runs before an EAS build, never deploys or loads dotenv/linked credentials.
export function checkStoreBuildTarget(env) {
  const profile = env.EAS_BUILD_PROFILE;
  const production = profile === 'production';
  const rc = profile === 'billing-rc-sandbox';
  if (!production && !rc) {
    if (env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET)
      throw new Error('STORE_BUILD_PROFILE_REQUIRED');
    return;
  }
  const ref = production ? 'tknaobmlwmodsqtpqwkr' : 'yhxxsawcaffxonpconaq';
  const url = production
    ? env.EXPO_PUBLIC_SUPABASE_URL
    : env.EXPO_PUBLIC_SANDBOX_SUPABASE_URL;
  const key = production
    ? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    : env.EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY;
  if (
    env.EXPO_NO_DOTENV !== '1' ||
    env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET !== profile ||
    env.EXPO_PUBLIC_HOMEYPAW_TARGET !==
      (production ? 'production' : 'sandbox-rc') ||
    url !== `https://${ref}.supabase.co`
  )
    throw new Error('STORE_BUILD_TARGET_DENIED');
  requirePublicKey(key, ref);
  const apple = production
    ? env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY
    : env.EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY;
  if (!apple?.startsWith('appl_'))
    throw new Error('APPLE_APP_PUBLIC_KEY_REQUIRED');
  if (production && env.EXPO_PUBLIC_APP_REVIEW_ACCOUNT_ENABLED === 'true') {
    if (
      env.EXPO_PUBLIC_SANDBOX_SUPABASE_URL !==
      'https://yhxxsawcaffxonpconaq.supabase.co'
    )
      throw new Error('REVIEW_SANDBOX_TARGET_DENIED');
    requirePublicKey(
      env.EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY,
      'yhxxsawcaffxonpconaq',
    );
  }
  if (production && env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED !== 'false')
    throw new Error('PRODUCTION_SANDBOX_BILLING_DENIED');
  // This compiles the membership UI into the final binary. Server Billing and
  // checkout readiness still control purchases independently.
  if (production && env.EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED !== 'true')
    throw new Error('PRODUCTION_FAMILY_PLUS_RELEASE_REQUIRED');
  if (
    rc &&
    (env.EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED !== 'false' ||
      env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED !== 'true' ||
      env.EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE !== 'cloud' ||
      env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF !==
        'yhxxsawcaffxonpconaq' ||
      env.EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_HOST !==
        'yhxxsawcaffxonpconaq.supabase.co')
  )
    throw new Error('RC_BILLING_TARGET_DENIED');
  const app = JSON.parse(
    readFileSync(new URL('../app.json', import.meta.url), 'utf8'),
  ).expo;
  if (app.ios.bundleIdentifier !== 'com.zhushunli.homeypaw')
    throw new Error('STORE_BUNDLE_ID_DENIED');
  const profiles = JSON.parse(
    readFileSync(new URL('../eas.json', import.meta.url), 'utf8'),
  ).build;
  const rcNumber = profiles['billing-rc-sandbox'].env.HOMEYPAW_IOS_BUILD_NUMBER;
  const productionNumber = profiles.production.env.HOMEYPAW_IOS_BUILD_NUMBER;
  if (
    !/^[1-9]\d*$/.test(rcNumber ?? '') ||
    !/^[1-9]\d*$/.test(productionNumber ?? '') ||
    rcNumber !== app.ios.buildNumber ||
    Number(productionNumber) <= Number(rcNumber) ||
    env.HOMEYPAW_IOS_BUILD_NUMBER !== (production ? productionNumber : rcNumber)
  )
    throw new Error('STORE_IOS_BUILD_NUMBER_DENIED');
  if (
    rc &&
    (env.EXPO_PUBLIC_SUPABASE_URL ||
      env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY)
  )
    throw new Error('RC_PRODUCTION_INPUT_DENIED');
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    checkStoreBuildTarget(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

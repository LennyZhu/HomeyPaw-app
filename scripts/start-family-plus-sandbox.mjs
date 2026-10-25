import { lstatSync, statSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve, relative, sep, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

const root = resolve(import.meta.dirname, '..');
const ref = 'yhxxsawcaffxonpconaq';
try {
  const args = process.argv.slice(2);
  if (
    args[0] !== '--config' ||
    !isAbsolute(args[1] ?? '') ||
    args.slice(2).some((a) => a !== '--check')
  )
    throw new Error('CONFIG_PATH_REQUIRED');
  const filename = realpathSync(args[1]);
  const relation = relative(root, filename);
  if (!relation.startsWith('..' + sep) || lstatSync(args[1]).isSymbolicLink())
    throw new Error('CONFIG_MUST_BE_OUTSIDE_REPOSITORY');
  const metadata = statSync(filename);
  if ((statSync(dirname(filename)).mode & 0o777) !== 0o700)
    throw new Error('CONFIG_DIRECTORY_REQUIRES_0700');
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.uid !== process.getuid()
  )
    throw new Error('CONFIG_REQUIRES_0600');
  const c = JSON.parse(readFileSync(filename, 'utf8'));
  if (
    Object.keys(c).some(
      (k) =>
        ![
          'projectRef',
          'supabaseUrl',
          'publishableKey',
          'applePublicKey',
          'billingEnabled',
        ].includes(k),
    )
  )
    throw new Error('UNKNOWN_CONFIG_FIELDS');
  if (c.projectRef !== ref || c.supabaseUrl !== `https://${ref}.supabase.co`)
    throw new Error('SANDBOX_TARGET_DENIED');
  if (typeof c.publishableKey !== 'string')
    throw new Error('PUBLISHABLE_KEY_REQUIRED');
  if (c.publishableKey.startsWith('eyJ')) {
    const p = JSON.parse(
      Buffer.from(c.publishableKey.split('.')[1], 'base64url').toString(),
    );
    if (p.role !== 'anon' || p.ref !== ref)
      throw new Error('CLIENT_KEY_IDENTITY_DENIED');
  } else if (!c.publishableKey.startsWith('sb_publishable_'))
    throw new Error('CLIENT_KEY_TYPE_DENIED');
  if (c.applePublicKey && !c.applePublicKey.startsWith('appl_'))
    throw new Error('APPLE_APP_PUBLIC_KEY_REQUIRED');
  if (c.billingEnabled !== undefined && typeof c.billingEnabled !== 'boolean')
    throw new Error('INVALID_BILLING_SETTING');
  if (c.billingEnabled && !c.applePublicKey)
    throw new Error('APPLE_APP_PUBLIC_KEY_REQUIRED');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !/^(EXPO_PUBLIC_|SUPABASE_|REVENUECAT_|FAMILY_BILLING_|PG)/.test(k),
    ),
  );
  Object.assign(env, {
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET: '',
    EXPO_PUBLIC_HOMEYPAW_TARGET: 'sandbox',
    EXPO_PUBLIC_SANDBOX_SUPABASE_URL: c.supabaseUrl,
    EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY: c.publishableKey,
    EXPO_PUBLIC_FAMILY_BILLING_TARGET_MODE: 'cloud',
    EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_PROJECT_REF: ref,
    EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_HOST: ref + '.supabase.co',
    EXPO_PUBLIC_FAMILY_BILLING_SANDBOX_ENABLED: String(
      c.billingEnabled === true,
    ),
    EXPO_PUBLIC_REVENUECAT_APPLE_SANDBOX_KEY: c.applePublicKey ?? '',
    EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED: 'false',
  });
  if (args.includes('--check'))
    console.log(
      JSON.stringify({
        projectRef: ref,
        dotenv: false,
        productionFallback: false,
        remoteIdentityVerified: false,
        launch: false,
      }),
    );
  else {
    console.log(
      'Starting Metro for explicitly configured HomeyPaw Sandbox. Production dotenv is disabled.',
    );
    const child = spawn(
      process.execPath,
      [
        resolve(root, 'node_modules/expo/bin/cli'),
        'start',
        '--dev-client',
        '--clear',
      ],
      { cwd: root, env, stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  }
} catch {
  console.error(
    'Sandbox client configuration rejected. Use an absolute, repository-external 0600 JSON file with the exact Sandbox target and public keys. No credentials were logged.',
  );
  process.exitCode = 1;
}

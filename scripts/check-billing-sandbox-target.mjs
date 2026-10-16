import { readFileSync, statSync, realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { checkSandboxDeployment } from '../supabase/functions/_shared/family-billing-target.mjs';

// Checks only. This command never connects, runs migrations or deploys functions.
try {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--config' ||
    args[2] !== '--confirm-project-ref'
  )
    throw new Error();
  if (!isAbsolute(args[1])) throw new Error();
  const path = realpathSync(args[1]);
  const repository = new URL('../', import.meta.url).pathname;
  const rel = relative(repository, path);
  if (
    !isAbsolute(path) ||
    (!rel.startsWith('../') && rel !== '..') ||
    statSync(path).mode & 0o077
  )
    throw new Error();
  const result = checkSandboxDeployment(
    JSON.parse(readFileSync(path, 'utf8')),
    args[3],
  );
  console.log(
    JSON.stringify({
      ...result,
      status: 'OFFLINE_CONFIG_PASS',
      remoteIdentityVerified: false,
    }),
  );
} catch {
  console.error(
    'BILLING_SANDBOX_PREFLIGHT_DENIED: explicit external 0600 manifest and matching independent project required.',
  );
  process.exitCode = 1;
}

// Read-only CLI. No apply flag, arbitrary SQL input, linked ref or env fallback.
import {
  readProtectedExternal,
  previewSandboxSession,
} from './lib/billing-sandbox-session.mjs';

try {
  const args = process.argv.slice(2);
  if (
    args.length !== 6 ||
    args[0] !== '--config' ||
    args[2] !== '--confirm-project-ref' ||
    args[4] !== '--ca-file'
  )
    throw new Error();
  const config = JSON.parse(readProtectedExternal(args[1]));
  console.log(JSON.stringify(previewSandboxSession(config, args[3], args[5])));
} catch {
  console.error(
    'BILLING_SANDBOX_SESSION_DENIED: protected manifest, exact Sandbox identity, verified TLS and unchanged History required. No migration executed.',
  );
  process.exitCode = 1;
}

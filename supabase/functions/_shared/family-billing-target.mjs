export const productionRef = 'tknaobmlwmodsqtpqwkr';
export function assertBillingSecrets({
  webhook,
  reconcile,
  provider,
  project,
}) {
  if (
    !webhook ||
    webhook.length < 32 ||
    !reconcile ||
    reconcile.length < 32 ||
    webhook === reconcile ||
    !provider ||
    !project
  ) {
    throw new Error('BILLING_SANDBOX_CONFIGURATION_REQUIRED');
  }
}
const fail = () => {
  throw new Error('BILLING_SANDBOX_TARGET_DENIED');
};

// Configuration validation is NOT JWT authentication. Supabase still verifies
// these credentials on every request. Opaque keys cannot be attributed offline,
// so this prototype requires project-attributable legacy keys in cloud mode.
function credential(key, role, ref, local) {
  try {
    const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
    );
    if (
      claims.role !== role ||
      claims.ref === productionRef ||
      (!local && claims.ref !== ref) ||
      (local &&
        claims.ref &&
        !['local-pawday', 'supabase-ref'].includes(claims.ref))
    )
      fail();
  } catch {
    fail();
  }
}

export function assertSandboxTarget({
  mode,
  url,
  projectRef,
  deploymentId,
  serviceKey,
  anonKey,
}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return fail();
  }
  if (
    projectRef === productionRef ||
    target.hostname.includes(productionRef) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/'
  )
    fail();
  if (mode === 'local') {
    if (
      deploymentId ||
      projectRef !== 'local-pawday' ||
      target.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', 'kong', 'supabase_kong_pawday'].includes(
        target.hostname,
      )
    )
      fail();
  } else if (mode === 'cloud') {
    if (
      !/^[a-z]{20}$/.test(projectRef ?? '') ||
      target.protocol !== 'https:' ||
      target.port ||
      target.hostname !== `${projectRef}.supabase.co` ||
      !new RegExp(
        `^${projectRef}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9]+$`,
      ).test(deploymentId ?? '')
    )
      fail();
  } else fail();
  credential(serviceKey, 'service_role', projectRef, mode === 'local');
  credential(anonKey, 'anon', projectRef, mode === 'local');
  return target.origin;
}

// No dotenv, linked-ref or process environment fallback. Future deployment must
// supply an explicit protected manifest and repeat this check at execution time.
export function checkSandboxDeployment(config, confirmedRef) {
  if (config.mode !== 'cloud' || confirmedRef !== config.projectRef) fail();
  assertSandboxTarget({
    ...config,
    // A syntax-only placeholder, never passed to the Edge runtime. The result
    // explicitly reports that remote identity has NOT been verified.
    deploymentId: `${confirmedRef}_00000000-0000-4000-a000-000000000000_0`,
  });
  let db;
  try {
    db = new URL(config.databaseUrl);
  } catch {
    return fail();
  }
  if (
    db.protocol !== 'postgresql:' ||
    db.hostname !== `db.${confirmedRef}.supabase.co` ||
    decodeURIComponent(db.username) !== 'postgres' ||
    !db.password ||
    db.pathname !== '/postgres' ||
    (db.port && db.port !== '5432') ||
    db.hash ||
    [...db.searchParams].length !== 1 ||
    db.searchParams.get('sslmode') !== 'require'
  )
    fail();
  if (
    !config.applePublicKey?.startsWith('appl_') ||
    !config.revenueCatProjectId ||
    !config.revenueCatAppId ||
    !config.entitlementId ||
    !config.monthlyProductId ||
    !config.yearlyProductId ||
    config.monthlyProductId === config.yearlyProductId
  )
    fail();
  // Never emit config: it contains credentials, even on rejection.
  if (JSON.stringify(config).includes(productionRef)) fail();
  return { projectRef: confirmedRef, mode: 'cloud', writesAuthorized: false };
}

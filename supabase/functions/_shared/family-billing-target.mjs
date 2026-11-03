export const productionRef = 'tknaobmlwmodsqtpqwkr';
export const sandboxRef = 'yhxxsawcaffxonpconaq';
// Copied from this project's official Connect panel, not inferred from region.
export const sandboxSessionHost = 'aws-0-ap-southeast-2.pooler.supabase.com';
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
function credential(key, role, ref, local, production = false) {
  try {
    const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
    );
    if (
      claims.role !== role ||
      (!production && claims.ref === productionRef) ||
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

// Separate opt-in release path. Sandbox deployment validation never admits it.
// These checks bind platform/project/credentials; DB readiness and verified
// provider state remain mandatory and cannot be replaced by client build flags.
export function assertProductionBillingTarget(input) {
  let target;
  try {
    target = new URL(input.url);
  } catch {
    return fail();
  }
  if (
    input.mode !== 'production' ||
    input.projectRef !== productionRef ||
    target.origin !== `https://${productionRef}.supabase.co` ||
    target.pathname !== '/' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !new RegExp(
      `^${productionRef}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9]+$`,
    ).test(input.deploymentId ?? '')
  )
    fail();
  credential(input.serviceKey, 'service_role', productionRef, false, true);
  credential(input.anonKey, 'anon', productionRef, false, true);
  return target.origin;
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
  const direct =
    db.hostname === `db.${confirmedRef}.supabase.co` &&
    decodeURIComponent(db.username) === 'postgres' &&
    (!db.port || db.port === '5432');
  const session =
    confirmedRef === sandboxRef &&
    db.hostname === sandboxSessionHost &&
    decodeURIComponent(db.username) === `postgres.${sandboxRef}` &&
    db.port === '5432';
  const query = [...db.searchParams];
  // Preserve the old Direct configuration format. Execution must still upgrade
  // it to verify-full with the independently pinned official CA; require alone
  // is encryption, not server identity verification. Pooler never accepts it.
  const legacyDirectTls =
    direct &&
    query.length === 1 &&
    db.searchParams.get('sslmode') === 'require';
  const verifiedTls =
    query.length === 2 &&
    query.every(([key]) => ['sslmode', 'sslrootcert'].includes(key)) &&
    db.searchParams.getAll('sslmode').length === 1 &&
    db.searchParams.getAll('sslrootcert').length === 1 &&
    db.searchParams.get('sslmode') === 'verify-full' &&
    /^\/(?!\/)[^\0\r\n]+$/.test(db.searchParams.get('sslrootcert') ?? '');
  if (
    db.protocol !== 'postgresql:' ||
    (!direct && !session) ||
    !db.password ||
    db.pathname !== '/postgres' ||
    db.hash ||
    (!legacyDirectTls && !verifiedTls)
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
  return {
    projectRef: confirmedRef,
    mode: 'cloud',
    connectionMode: session ? 'session' : 'direct',
    writesAuthorized: false,
  };
}

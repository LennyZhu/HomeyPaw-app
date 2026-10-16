import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSandboxTarget,
  checkSandboxDeployment,
  productionRef,
  assertBillingSecrets,
} from '../supabase/functions/_shared/family-billing-target.mjs';

const ref = 'abcdefghijklmnopqrst';
const secrets = {
  webhook: 'synthetic-webhook-secret-000000000000',
  reconcile: 'synthetic-reconcile-secret-0000000000',
  provider: 'synthetic-reader',
  project: 'proj_fixture',
};
assertBillingSecrets(secrets);
for (const change of [
  { webhook: '' },
  { reconcile: 'short' },
  { reconcile: secrets.webhook },
  { provider: '' },
  { project: '' },
])
  assert.throws(
    () => assertBillingSecrets({ ...secrets, ...change }),
    /CONFIGURATION_REQUIRED/,
  );
const key = (role, project = ref) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, ref: project })).toString('base64url')}.synthetic`;
const cloud = {
  mode: 'cloud',
  projectRef: ref,
  url: `https://${ref}.supabase.co`,
  deploymentId: `${ref}_00000000-0000-4000-a000-000000000000_1`,
  serviceKey: key('service_role'),
  anonKey: key('anon'),
};
assertSandboxTarget(cloud);
for (const change of [
  { mode: undefined },
  { projectRef: undefined },
  { deploymentId: undefined },
  { deploymentId: `${ref}__` },
  { deploymentId: 'anotherproject_fixture_1' },
  { projectRef: productionRef },
  { url: `https://${productionRef}.supabase.co` },
  { url: 'http://kong:8000' },
  { url: 'https://unapproved.invalid' },
  { url: cloud.url + '/rest/v1' },
  { serviceKey: undefined },
  { anonKey: undefined },
  { serviceKey: 'sb_secret_opaque' },
  { serviceKey: key('service_role', productionRef) },
  { anonKey: key('anon', productionRef) },
  { anonKey: key('service_role') },
  { serviceKey: key('service_role', 'other') },
])
  assert.throws(
    () => assertSandboxTarget({ ...cloud, ...change }),
    /TARGET_DENIED/,
  );
const local = {
  mode: 'local',
  projectRef: 'local-pawday',
  url: 'http://kong:8000',
  serviceKey: key('service_role', 'supabase-ref'),
  anonKey: key('anon', 'supabase-ref'),
};
assertSandboxTarget(local);
for (const change of [
  { deploymentId: cloud.deploymentId },
  { projectRef: ref },
  { url: cloud.url },
  { serviceKey: cloud.serviceKey },
  { anonKey: key('anon', productionRef) },
])
  assert.throws(() => assertSandboxTarget({ ...local, ...change }));
const manifest = {
  ...cloud,
  databaseUrl: `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
  applePublicKey: 'appl_synthetic',
  revenueCatProjectId: 'proj_fixture',
  revenueCatAppId: 'app_fixture',
  entitlementId: 'entl_fixture',
  monthlyProductId: 'sandbox.monthly',
  yearlyProductId: 'sandbox.yearly',
};
assert.equal(checkSandboxDeployment(manifest, ref).writesAuthorized, false);
for (const change of [
  { applePublicKey: 'test_synthetic' },
  { applePublicKey: '' },
  { revenueCatProjectId: '' },
  {
    databaseUrl: `postgresql://postgres:synthetic@db.${productionRef}.supabase.co/postgres?sslmode=require`,
  },
  {
    databaseUrl: manifest.databaseUrl.replace(
      'sslmode=require',
      'sslmode=disable',
    ),
  },
  { databaseUrl: manifest.databaseUrl + '&host=db.wrong.supabase.co' },
  { yearlyProductId: manifest.monthlyProductId },
  { unrelated: productionRef },
])
  assert.throws(() => checkSandboxDeployment({ ...manifest, ...change }, ref));
assert.throws(() => checkSandboxDeployment(manifest, 'wrong'));
const temp = mkdtempSync(join(tmpdir(), 'homeypaw-target-test-'));
try {
  const path = join(temp, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest), { mode: 0o600 });
  const out = execFileSync(
    process.execPath,
    [
      'scripts/check-billing-sandbox-target.mjs',
      '--config',
      path,
      '--confirm-project-ref',
      ref,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(JSON.parse(out).remoteIdentityVerified, false);
  assert.ok(!out.includes('synthetic'));
  const rejected = spawnSync(
    process.execPath,
    ['scripts/check-billing-sandbox-target.mjs'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: cloud.url,
        SUPABASE_SERVICE_ROLE_KEY: 'do-not-echo',
      },
    },
  );
  assert.equal(rejected.status, 1);
  assert.ok(!rejected.stderr.includes('do-not-echo'));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
const runtime = readFileSync(
  'supabase/functions/_shared/family-billing-runtime.ts',
  'utf8',
);
assert.ok(!runtime.includes("get('SUPABASE_SERVICE_ROLE_KEY')"));
assert.ok(!runtime.includes("get('SUPABASE_URL')"));
console.log(
  'PASS: explicit local/cloud identity, hosted deployment ref, role/ref credentials, Production/missing/wrong targets denied, test_ key rejected, offline preflight never authorizes writes or loads env/linked credentials.',
);

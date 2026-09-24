import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { evaluateAppReleasePolicy } from '../src/features/app-release/version-policy.ts';
import {
  compareClientToMinimum,
  evaluateClientRelease,
} from '../supabase/functions/_shared/app-release-gate.mjs';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
if (
  !url ||
  !anonKey ||
  !serviceKey ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
) {
  throw new Error(
    'SAFETY STOP: R3 verifier requires local Supabase credentials.',
  );
}
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const policy = {
  platform: 'ios',
  minimum_app_version: '1.2.0',
  minimum_build: 6,
  recommended_app_version: null,
  maintenance_mode: false,
  enforce_mutation_gate: true,
  maintenance_message: null,
  updated_at: new Date().toISOString(),
};
function pass(label, condition) {
  assert.ok(condition, label);
  console.log(`PASS: ${label}`);
}
function sql(statement) {
  return execFileSync(
    'docker',
    [
      'exec',
      'supabase_db_pawday',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}
function newClient(headers = {}) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers },
  });
}
function request(headers = {}) {
  return { headers: new Headers(headers) };
}
const old = { platform: 'ios', version: '1.1.1', build: '5' };
const equal = { platform: 'ios', version: '1.2.0', build: '6' };
pass(
  'current Production 1.1.1 build 5 is unsupported for future rollout policy',
  evaluateAppReleasePolicy(old, policy) === 'upgrade',
);
pass(
  'equal version/build allowed',
  evaluateAppReleasePolicy(equal, policy) === 'allowed',
);
pass(
  'lower build blocked',
  evaluateAppReleasePolicy({ ...equal, build: '5' }, policy) === 'upgrade',
);
pass(
  'numeric semver compares 1.10.0 above 1.2.0',
  evaluateAppReleasePolicy(
    { ...equal, version: '1.10.0', build: '1' },
    policy,
  ) === 'allowed' && compareClientToMinimum('1.10.0', '1', '1.2.0', 6) > 0,
);
pass(
  'missing/malformed policy is fail-safe on client',
  evaluateAppReleasePolicy(old, null) === 'allowed' &&
    evaluateAppReleasePolicy(old, { ...policy, minimum_app_version: 'bad' }) ===
      'invalid',
);
pass(
  'maintenance and unsupported Edge decisions',
  evaluateClientRelease({ ...policy, maintenance_mode: true }, request())
    ?.error === 'APP_MAINTENANCE' &&
    evaluateClientRelease(policy, request())?.status === 426 &&
    evaluateClientRelease(
      policy,
      request({
        'X-HomeyPaw-Platform': 'ios',
        'X-HomeyPaw-App-Version': '1.2.0',
        'X-HomeyPaw-Build': '6',
      }),
    ) === null,
);

const root = readFileSync('src/app/_layout.tsx', 'utf8');
const block = readFileSync(
  'src/features/app-release/app-release-block-screen.tsx',
  'utf8',
);
const hook = readFileSync(
  'src/features/app-release/use-app-release-gate.ts',
  'utf8',
);
const client = readFileSync('src/lib/supabase/client.ts', 'utf8');
pass(
  'blocking UI precedes routes and coordinators and has no dismiss',
  root.indexOf("appRelease.status === 'upgrade'") < root.indexOf('<Stack') &&
    root.includes('<AppReleaseBlockScreen') &&
    !block.includes('router.') &&
    !block.includes('dismiss'),
);
pass(
  'gate checks before normal mutations and refreshes on foreground',
  root.includes("appRelease.status === 'checking'") &&
    root.indexOf('<AppReleaseBlockScreen') <
      root.indexOf('<FamilyContextCoordinator') &&
    hook.includes("AppState.addEventListener('change'"),
);
pass(
  'all Supabase RPC and Edge requests carry native version headers',
  client.includes('headers: getAppVersionHeaders()') &&
    ['delete-account', 'delete-pet', 'delete-post'].every((name) =>
      readFileSync(`supabase/functions/${name}/index.ts`, 'utf8').includes(
        'checkAppReleaseGate(adminClient, request)',
      ),
    ),
);

let userId = null;
let familyId = null;
try {
  const { data: initialPolicy, error: initialError } = await newClient()
    .from('app_release_policy')
    .select('*')
    .eq('platform', 'ios')
    .single();
  if (initialError) throw initialError;
  pass(
    'anonymous policy read-only baseline',
    initialPolicy.minimum_app_version === '1.1.1' &&
      initialPolicy.minimum_build === 5 &&
      !initialPolicy.enforce_mutation_gate,
  );
  const forbiddenAnonymousUpdate = await newClient()
    .from('app_release_policy')
    .update({ minimum_build: 1 })
    .eq('platform', 'ios');
  pass(
    'anonymous cannot update release policy',
    Boolean(forbiddenAnonymousUpdate.error),
  );
  const email = `r3-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error('Could not create local user');
  userId = created.data.user.id;
  const oldClient = newClient();
  const signed = await oldClient.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session)
    throw signed.error ?? new Error('Could not sign in');
  const token = signed.data.session.access_token;
  const forbiddenMemberUpdate = await oldClient
    .from('app_release_policy')
    .update({ minimum_build: 1 })
    .eq('platform', 'ios');
  pass(
    'authenticated user cannot update release policy',
    Boolean(forbiddenMemberUpdate.error),
  );
  const forbiddenInsert = await oldClient.from('app_release_policy').insert({
    platform: 'ios',
    minimum_app_version: '0.0.0',
    minimum_build: 1,
  });
  pass(
    'authenticated user cannot insert release policy',
    Boolean(forbiddenInsert.error),
  );

  sql(
    "update public.app_release_policy set minimum_app_version='1.2.0', minimum_build=6, enforce_mutation_gate=true where platform='ios';",
  );
  const createArgs = { pet_name: 'R3 Pet', pet_species: 'other' };
  const oldCreate = await oldClient.rpc('create_pet', createArgs);
  pass(
    'old direct create_pet is blocked by DB gate',
    oldCreate.error?.message.includes('APP_UPDATE_REQUIRED'),
  );
  const lowBuild = newClient({
    'X-HomeyPaw-Platform': 'ios',
    'X-HomeyPaw-App-Version': '1.2.0',
    'X-HomeyPaw-Build': '5',
    Authorization: `Bearer ${token}`,
  });
  const lowCreate = await lowBuild.rpc('create_pet', createArgs);
  pass(
    'lower build direct RPC is blocked',
    lowCreate.error?.message.includes('APP_UPDATE_REQUIRED'),
  );
  const supported = newClient({
    'X-HomeyPaw-Platform': 'ios',
    'X-HomeyPaw-App-Version': '1.2.0',
    'X-HomeyPaw-Build': '6',
    Authorization: `Bearer ${token}`,
  });
  const goodCreate = await supported.rpc('create_pet', createArgs);
  if (goodCreate.error) throw goodCreate.error;
  familyId = goodCreate.data.family_id;
  pass('equal version/build direct RPC is allowed', Boolean(familyId));
  const oldAddPet = await oldClient.rpc('create_family_pet', {
    target_family_id: familyId,
    pet_name: 'Old app second Pet',
    pet_species: 'other',
  });
  pass(
    'old direct Add Pet is blocked',
    oldAddPet.error?.message.includes('APP_UPDATE_REQUIRED'),
  );
  const oldInvite = await oldClient.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  pass(
    'old direct Family invite is blocked',
    oldInvite.error?.message.includes('APP_UPDATE_REQUIRED'),
  );
  const supportedAddPet = await supported.rpc('create_family_pet', {
    target_family_id: familyId,
    pet_name: 'Supported second Pet',
    pet_species: 'other',
  });
  pass(
    'supported Add Pet is allowed',
    !supportedAddPet.error && supportedAddPet.data?.family_id === familyId,
  );
  const secondPet = await supported.rpc('create_pet', createArgs);
  pass(
    'C4I still blocks second create_pet',
    secondPet.error?.message.includes('ALREADY_IN_FAMILY'),
  );

  for (const name of ['delete-account', 'delete-pet', 'delete-post']) {
    const body =
      name === 'delete-account'
        ? { confirmation: 'DELETE_MY_ACCOUNT' }
        : name === 'delete-pet'
          ? { petId: randomUUID() }
          : { postId: randomUUID() };
    const response = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    pass(
      `${name} rejects unsupported old client`,
      response.status === 426 &&
        (await response.json()).error === 'APP_UPDATE_REQUIRED',
    );
  }
  sql(
    "update public.app_release_policy set maintenance_mode=true where platform='ios';",
  );
  const maintenancePet = await supported.rpc('create_family_pet', {
    target_family_id: familyId,
    pet_name: 'Maintenance blocked',
    pet_species: 'other',
  });
  pass(
    'maintenance blocks canonical direct RPC',
    maintenancePet.error?.message.includes('APP_MAINTENANCE'),
  );
  const maintenance = await fetch(`${url}/functions/v1/delete-pet`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ petId: randomUUID() }),
  });
  pass(
    'maintenance blocks destructive Edge',
    maintenance.status === 503 &&
      (await maintenance.json()).error === 'APP_MAINTENANCE',
  );
} finally {
  sql(
    "update public.app_release_policy set minimum_app_version='1.1.1', minimum_build=5, enforce_mutation_gate=false, maintenance_mode=false where platform='ios';",
  );
  if (familyId) {
    sql(
      `delete from public.pets where family_id='${familyId}'::uuid; delete from public.families where id='${familyId}'::uuid;`,
    );
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
}
console.log('PASS: R3 minimum-client-version gate verification complete.');

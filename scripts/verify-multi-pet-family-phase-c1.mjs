import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');
const state = await import(
  `${pathToFileURL(resolve(process.cwd(), 'src/features/family/family-context-state.ts')).href}?v=${Date.now()}`
);

const family = (id, createdAt) => ({ created_at: createdAt, id });
const pet = (id, familyId, createdAt) => ({
  created_at: createdAt,
  family_id: familyId,
  id,
});
const familyA = family('family-a', '2026-09-19T00:00:00.000Z');
const familyB = family('family-b', '2026-09-19T00:01:00.000Z');
const petA1 = pet('pet-a1', familyA.id, '2026-09-19T00:00:00.000Z');
const petA2 = pet('pet-a2', familyA.id, '2026-09-19T00:01:00.000Z');
const petB1 = pet('pet-b1', familyB.id, '2026-09-19T00:00:00.000Z');

function reconcile(overrides = {}) {
  return state.reconcileFamilyContext({
    families: [],
    pets: [],
    storedFamilyId: null,
    storedFamilyUserId: 'user-a',
    storedPetId: null,
    storedPetUserId: 'user-a',
    userId: 'user-a',
    ...overrides,
  });
}

let result = reconcile();
assert.equal(result.currentFamily, null);
assert.equal(result.currentPet, null);

result = reconcile({ families: [familyA] });
assert.equal(result.currentFamily?.id, familyA.id);
assert.equal(result.currentPet, null);

result = reconcile({ families: [familyA], pets: [petA1] });
assert.equal(result.currentFamily?.id, familyA.id);
assert.equal(result.currentPet?.id, petA1.id);

result = reconcile({ families: [familyA], pets: [petA2, petA1] });
assert.equal(result.currentFamily?.id, familyA.id);
assert.equal(result.currentPet?.id, petA1.id);
assert.deepEqual(
  result.familyPets.map((item) => item.id),
  [petA1.id, petA2.id],
);
console.log('PASS: zero, one, and multiple Pet Family contexts reconcile.');

result = reconcile({
  families: [familyA, familyB],
  pets: [petA1, petA2, petB1],
  storedFamilyId: familyB.id,
  storedPetId: petA1.id,
});
assert.equal(result.currentFamily?.id, familyB.id);
assert.equal(result.currentPet?.id, petB1.id);

result = reconcile({
  families: [familyA],
  pets: [petA1],
  storedFamilyId: 'removed-family',
  storedPetId: petA1.id,
});
assert.equal(result.currentFamily?.id, familyA.id);
assert.equal(result.currentPet?.id, petA1.id);

result = reconcile({
  families: [familyA],
  pets: [petA1],
  storedFamilyId: familyA.id,
  storedPetId: 'removed-pet',
});
assert.equal(result.currentFamily?.id, familyA.id);
assert.equal(result.currentPet?.id, petA1.id);

result = reconcile({
  families: [familyA],
  pets: [petA1],
  storedFamilyId: null,
  storedFamilyUserId: null,
  storedPetId: petA1.id,
});
assert.equal(result.currentFamily?.id, familyA.id);
assert.equal(result.currentPet?.id, petA1.id);
console.log(
  'PASS: Family switches and stale Family/Pet selections repair without cross-Family combinations.',
);

result = reconcile({
  families: [familyA],
  pets: [petA1],
  userId: undefined,
});
assert.equal(result.currentFamily, null);
assert.equal(result.currentPet, null);

result = reconcile({
  families: [familyB],
  pets: [petB1],
  storedFamilyId: familyA.id,
  storedFamilyUserId: 'user-a',
  storedPetId: petA1.id,
  storedPetUserId: 'user-a',
  userId: 'user-b',
});
assert.equal(result.currentFamily?.id, familyB.id);
assert.equal(result.currentPet?.id, petB1.id);

result = reconcile({
  families: [familyB],
  pets: [petA1, petB1],
  storedFamilyId: familyA.id,
  storedPetId: petA1.id,
});
assert.equal(result.currentFamily?.id, familyB.id);
assert.equal(result.currentPet?.id, petB1.id);
console.log(
  'PASS: logout, account switch, and removed-Family membership cannot leak prior context.',
);

assert.equal(
  state.shouldClearFamilyQuery(
    ['families', 'user-a', 'pets', familyA.id],
    'user-a',
    familyA.id,
  ),
  true,
);
assert.equal(
  state.shouldClearFamilyQuery(
    ['families', 'user-b', 'pets', familyA.id],
    'user-a',
    familyA.id,
  ),
  false,
);
assert.equal(
  state.shouldClearFamilyQuery(
    ['families', 'user-a', 'pets', familyB.id],
    'user-a',
    familyA.id,
  ),
  false,
);

const [
  keys,
  queries,
  familyStore,
  petStore,
  currentFamily,
  cleanup,
  auth,
  layout,
  chatQueries,
  scheduleQueries,
  postsQueries,
  careQueries,
  healthScreen,
  packageJson,
] = await Promise.all([
  read('src/features/family/family-query-keys.ts'),
  read('src/features/family/family-queries.ts'),
  read('src/stores/current-family-store.ts'),
  read('src/stores/current-pet-store.ts'),
  read('src/features/family/use-current-family.ts'),
  read('src/features/family/family-access-cleanup.ts'),
  read('src/features/auth/auth-context.tsx'),
  read('src/app/_layout.tsx'),
  read('src/features/chat/chat-queries.ts'),
  read('src/features/schedule/care-schedule-queries.ts'),
  read('src/features/posts/post-queries.ts'),
  read('src/features/care/care-queries.ts'),
  read('src/features/home/home-screen.tsx'),
  read('package.json'),
]);

for (const key of ['all', 'list', 'detail', 'members', 'pets']) {
  assert.match(keys, new RegExp(`${key}:`));
}
assert.match(keys, /\['families', userId\]/u);
assert.match(queries, /\.from\('family_members'\)/u);
assert.match(queries, /\.eq\('user_id', userId\)/u);
assert.match(queries, /\.from\('pets'\)/u);
assert.match(queries, /\.eq\('family_id', familyId\)/u);
assert.match(queries, /\.order\('created_at'/u);
assert.match(queries, /\.order\('id'/u);
console.log(
  'PASS: user-scoped Family keys and RLS-backed Families/Pets-by-Family queries are stable.',
);

assert.match(familyStore, /pawday-current-family/u);
assert.match(familyStore, /currentFamilyUserId/u);
assert.match(petStore, /clearCurrentPet/u);
assert.match(currentFamily, /reconcileFamilyContext/u);
assert.match(currentFamily, /setStoredFamilyId\(pet\.family_id, user\.id\)/u);
assert.match(layout, /FamilyContextCoordinator/u);
assert.match(auth, /clearCurrentFamilyAndPet\(\)/u);
assert.match(cleanup, /removeFamilyQueries/u);
assert.match(cleanup, /familyKeys\.list\(userId\)/u);
console.log(
  'PASS: persisted stores, app-wide reconciliation, logout, and revoked-Family cleanup are wired.',
);

assert.match(chatQueries, /petId/u);
assert.doesNotMatch(chatQueries, /familyKeys/u);
assert.match(scheduleQueries, /petId/u);
assert.doesNotMatch(scheduleQueries, /familyKeys/u);
assert.match(postsQueries, /petId/u);
assert.match(careQueries, /petId/u);
assert.match(healthScreen, /currentPet/u);
assert.match(packageJson, /verify:multi-pet-family-phase-c1/u);
console.log(
  'PASS: Chat, Schedule, Journal, Care, and Health remain Pet-scoped.',
);

const localUrl = process.env.SUPABASE_LOCAL_URL?.trim();
const localAnonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (localUrl && localAnonKey && localServiceRoleKey) {
  const parsedUrl = new URL(localUrl);
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname),
    'SAFETY STOP: Phase C1 live verification is local only.',
  );
  const admin = createClient(localUrl, localServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `phase-c1-${randomUUID()}@example.test`;
  const password = `C1-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: 'Phase C1', locale: 'en' },
  });
  assert.ifError(created.error);
  assert.ok(created.data.user);

  try {
    const client = createClient(localUrl, localAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signedIn.error);
    const createdPet = await client.rpc('create_pet', {
      pet_adoption_date: null,
      pet_birthday: null,
      pet_breed: null,
      pet_description: null,
      pet_gender: 'unknown',
      pet_name: 'Phase C1 Pet',
      pet_species: 'other',
      pet_weight: null,
    });
    assert.ifError(createdPet.error);
    assert.ok(createdPet.data?.family_id);

    const families = await client
      .from('family_members')
      .select('created_at, family_id, role, user_id, families!inner(*)')
      .eq('user_id', created.data.user.id);
    assert.ifError(families.error);
    assert.equal(families.data?.length, 1);
    assert.equal(families.data?.[0]?.family_id, createdPet.data.family_id);

    const familyPets = await client
      .from('pets')
      .select('*')
      .eq('family_id', createdPet.data.family_id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    assert.ifError(familyPets.error);
    assert.deepEqual(
      familyPets.data?.map((item) => item.id),
      [createdPet.data.id],
    );
    await client.auth.signOut();
    console.log(
      'PASS: authenticated client reads Families and Pets-by-Family through local RLS.',
    );
  } finally {
    await admin.auth.admin.deleteUser(created.data.user.id);
  }
} else {
  console.log(
    'SKIP: local Supabase keys not provided for C1 query integration.',
  );
}

console.log(
  'PASS: Multi-Pet Family Phase C1 client context verification complete.',
);

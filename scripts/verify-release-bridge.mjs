import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const source = (path) => readFileSync(resolve(path), 'utf8');
const state = await import(
  pathToFileURL(resolve('src/features/family/backend-capability-state.ts')).href
);
const family = await import(
  pathToFileURL(resolve('src/features/family/family-context-state.ts')).href
);
const legacyPet = {
  id: 'pet-a',
  created_at: '2026-01-01T00:00:00Z',
  name: 'A',
};
const newPet = { ...legacyPet, family_id: 'family-a' };
const secondPet = {
  id: 'pet-b',
  family_id: 'family-a',
  created_at: '2026-01-02T00:00:00Z',
  name: 'B',
};

// Read-only Production GET /rest/v1/family_members?select=family_id&limit=1:
// HTTP 404, PGRST205, while the same HEAD returns an empty body.
const productionMissingFamily = {
  code: 'PGRST205',
  message:
    "Could not find the table 'public.family_members' in the schema cache",
  details: null,
  hint: "Perhaps you meant the table 'public.pet_members'",
};
assert.equal(
  state.classifyBackendCapability(productionMissingFamily),
  'LEGACY_PET',
);
assert.equal(
  state.classifyBackendCapability({
    code: '42P01',
    message: 'relation family_members does not exist',
  }),
  'LEGACY_PET',
);
assert.equal(state.classifyBackendCapability(null), 'FAMILY_MULTI_PET');
for (const error of [
  { code: 'PGRST301', message: 'JWT expired' },
  { code: '42501', message: 'permission denied' },
  { code: '503', message: 'temporary backend failure' },
  { message: 'network timeout' },
  { code: '42P01', message: 'unrelated relation is missing' },
  { code: 'PGRST205', message: 'unrelated table is missing' },
  { code: 'PGRST205' },
])
  assert.throws(() => state.classifyBackendCapability(error));
console.log(
  'PASS: real Production PGRST205 selects legacy; network/auth/unrelated errors do not.',
);

assert.deepEqual(state.getBackendQueryRouting(false, undefined), {
  familyQueriesEnabled: false,
  petQueryEnabled: false,
});
assert.deepEqual(state.getBackendQueryRouting(true, undefined), {
  familyQueriesEnabled: false,
  petQueryEnabled: false,
});
assert.deepEqual(state.getBackendQueryRouting(true, 'LEGACY_PET'), {
  familyQueriesEnabled: false,
  petQueryEnabled: true,
});
assert.deepEqual(state.getBackendQueryRouting(true, 'FAMILY_MULTI_PET'), {
  familyQueriesEnabled: true,
  petQueryEnabled: true,
});
console.log('PASS: unknown, legacy and new backend query routing.');

assert.equal(
  state.reconcileLegacyPet([legacyPet], null, null, 'user-a')?.id,
  'pet-a',
);
assert.equal(
  state.reconcileLegacyPet([legacyPet], 'pet-a', 'user-a', 'user-a')?.id,
  'pet-a',
);
assert.equal(
  state.reconcileLegacyPet([legacyPet], 'removed', 'user-a', 'user-a')?.id,
  'pet-a',
);
assert.equal(
  state.reconcileLegacyPet([legacyPet], 'pet-a', 'user-a', undefined),
  null,
);
const migrated = family.reconcileFamilyContext({
  families: [{ id: 'family-a', created_at: '2026-01-01T00:00:00Z' }],
  pets: [newPet, secondPet],
  storedFamilyId: null,
  storedFamilyUserId: 'user-a',
  storedPetId: 'pet-a',
  storedPetUserId: 'user-a',
  userId: 'user-a',
});
assert.equal(migrated.currentFamily?.id, 'family-a');
assert.equal(migrated.currentPet?.id, 'pet-a');
assert.deepEqual(
  migrated.familyPets.map((pet) => pet.id),
  ['pet-a', 'pet-b'],
);
console.log(
  'PASS: legacy Pet selection reconciles to new Family plus multiple Pets without clearing storage.',
);

const capability = source('src/features/family/backend-capability.ts');
const context = source('src/features/family/use-current-family.ts');
const coordinator = source(
  'src/features/family/family-context-coordinator.tsx',
);
const queries = source('src/features/family/family-queries.ts');
const creation = source('src/features/pets/new-pet-screen.tsx');
const petQueries = source('src/features/pets/pet-queries.ts');
const members = source('src/features/family/pet-members-screen.tsx');
const settings = source('src/features/family/family-settings-screen.tsx');
const pets = source('src/features/pets/pets-screen.tsx');
const familyScreen = source('src/features/family/families-screen.tsx');
const postEdge = source('supabase/functions/delete-post/index.ts');
const petEdge = source('supabase/functions/delete-pet/index.ts');
const accountEdge = source('supabase/functions/delete-account/index.ts');
const old = (path) =>
  execFileSync(
    'git',
    ['show', `df8ba7018b1bec8b8ede7eb92ac5b378b33b2bf1:${path}`],
    { encoding: 'utf8' },
  );
const oldQueries = old('src/features/family/family-queries.ts');
const oldPetQueries = old('src/features/pets/pet-queries.ts');
for (const rpc of [
  'get_pet_members',
  'create_pet_invite',
  'join_pet_with_invite',
  'remove_pet_member',
])
  assert.ok(
    oldQueries.includes(`'${rpc}'`),
    `old release contract missing ${rpc}`,
  );
assert.match(oldPetQueries, /rpc\('create_pet'/);
for (const [name, requestField] of [
  ['delete-post', 'postId'],
  ['delete-pet', 'petId'],
  ['delete-account', 'DELETE_MY_ACCOUNT'],
]) {
  const oldEdge = old(`supabase/functions/${name}/index.ts`);
  assert.ok(
    oldEdge.includes(requestField),
    `old ${name} request contract changed`,
  );
  assert.match(oldEdge, /deleted: true/);
}
console.log(
  'PASS: legacy RPC and destructive Edge request/response contracts match the 1.1.1 release commit.',
);

assert.match(capability, /\.from\('family_members'\)/);
assert.match(capability, /\.select\('family_id'\)/);
assert.doesNotMatch(capability, /head:\s*true/);
assert.match(
  queries,
  /getBackendQueryRouting\(Boolean\(user\), capability\.data\)/,
);
assert.match(
  petQueries,
  /getBackendQueryRouting\(Boolean\(user\), capability\.data\)/,
);
assert.match(
  source('src/features/pets/use-current-pet.ts'),
  /backendCapability === 'LEGACY_PET'/,
);
assert.match(capability, /refetchOnMount: 'always'/);
assert.match(capability, /data: query\.isError \? undefined : query\.data/);
assert.match(context, /reconcileLegacyPet/);
assert.match(context, /backendCapability: capabilityQuery\.data/);
assert.match(coordinator, /previousCapability\.current !== capability/);
assert.match(coordinator, /invalidateQueries/);
for (const rpc of [
  'get_pet_members',
  'create_pet_invite',
  'revoke_pet_invite',
  'join_pet_with_invite',
  'remove_pet_member',
  'get_family_members',
  'create_family_invite',
  'revoke_family_invite',
  'join_family_with_invite',
  'remove_family_member',
])
  assert.ok(queries.includes(`'${rpc}'`), `${rpc} bridge missing`);
assert.match(queries, /capability === 'LEGACY_PET'/);
assert.match(creation, /LEGACY_SECOND_PET_UNAVAILABLE/);
assert.match(creation, /createExistingFamilyPet\.mutateAsync/);
assert.match(petQueries, /rpc\('create_pet'/);
assert.match(petQueries, /rpc\('create_family_pet'/);
assert.match(members, /usePetMembers/);
assert.match(settings, /backendCapability === 'LEGACY_PET'/);
assert.match(pets, /backendCapability === 'LEGACY_PET'/);
assert.match(familyScreen, /backendCapability === 'LEGACY_PET'/);
for (const edge of [postEdge, petEdge, accountEdge])
  assert.match(edge, /checkAppReleaseGate/);
for (const screen of [
  'src/features/home/home-screen.tsx',
  'src/features/journal/journal-screen.tsx',
  'src/features/care/care-history-screen.tsx',
  'src/features/chat/chat-screen.tsx',
  'src/features/schedule/schedule-screen.tsx',
])
  assert.match(source(screen), /useCurrentPet/);
console.log(
  'PASS: shared Home/Journal/Care/Chat/Schedule Pet path, guarded Family UI, legacy and canonical mutations, and Edge contracts.',
);

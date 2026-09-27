import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(path, 'utf8');
const settings = read('src/features/family/family-settings-screen.tsx');
const pets = read('src/features/pets/pets-screen.tsx');
const home = read('src/features/home/home-screen.tsx');
const petDetail = read('src/features/pets/pet-detail-screen.tsx');

// Evaluate the actual screen predicates; source checks below bind them to UI.
const ownerExpression = settings.match(/const isOwner = ([^;]+);/u)?.[1];
const addPetExpression = pets.match(
  /const canAddPet = Boolean\(([\s\S]*?)\n  \);/u,
)?.[1];
const homeActionExpression = home.match(
  /const canUseEmptyPetAction =\s*([^;]+);/u,
)?.[1];
assert.ok(ownerExpression && addPetExpression && homeActionExpression);
for (const role of ['owner', 'member', 'viewer', undefined]) {
  const expected = role === 'owner';
  assert.equal(runInNewContext(ownerExpression, { role }), expected);
  assert.equal(
    Boolean(
      runInNewContext(`Boolean(${addPetExpression})`, {
        backendCapability: 'FAMILY_MULTI_PET',
        currentFamilyId: 'family-a',
        currentMembership: { role },
      }),
    ),
    expected,
  );
  for (const familyId of ['family-a', null]) {
    assert.equal(
      runInNewContext(homeActionExpression, {
        currentMembership: { role },
        petsState: { currentFamilyId: familyId },
      }),
      !familyId || expected,
    );
  }
}
assert.match(settings, /\{isOwner \? \(\s*pets\[0\] \? \(/u);
assert.match(
  pets,
  /\{\.\.\.\(!currentFamilyId \|\| canAddPet\s*\? \{\s*actionLabel:/u,
);
assert.match(pets, /canAddPet=\{canAddPet\}/u);
assert.match(home, /\{\.\.\.\(canUseEmptyPetAction\s*\? \{\s*actionLabel:/u);
assert.match(
  petDetail,
  /\{isOwner \? \(\s*<View style=\{styles.editSection\}/u,
);
assert.match(petDetail, /\{isOwner \? \(\s*<View style=\{styles.dangerZone\}/u);
console.log(
  'PASS: Owner-only invitation and empty-Pet actions stay hidden for Member/Viewer/unknown roles; Pet edit/delete remain guarded.',
);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const settings = read('src/features/family/family-settings-screen.tsx');
const list = read('src/features/family/families-screen.tsx');
const queries = read('src/features/family/family-queries.ts');
const account = read('src/features/profile/account-security-screen.tsx');
const cleanup = read('src/features/family/family-access-cleanup.ts');
const labels = read('src/features/family/family-label.ts');
const pet = read('src/features/pets/pet-detail-screen.tsx');
const petQueries = read('src/features/pets/pet-queries.ts');
const newPet = read('src/features/pets/new-pet-screen.tsx');
const memberScreen = read('src/features/family/pet-members-screen.tsx');
const familyCreationRoute = read('src/app/families/new.tsx');
const petsScreen = read('src/features/pets/pets-screen.tsx');
const petsModal = read(
  'src/features/pets/components/pets-create-actions-modal.tsx',
);
const homeScreen = read('src/features/home/home-screen.tsx');
const c3Migration = read(
  'supabase/migrations/20260920153000_multi_pet_family_phase_c3_pet_lifecycle.sql',
);
const en = JSON.parse(read('src/i18n/locales/en.json'));
const zh = JSON.parse(read('src/i18n/locales/zh-HK.json'));

function check(label, condition) {
  assert.ok(condition, label);
  console.log(`PASS: ${label}`);
}

check(
  'Family list is based on memberships, including zero-pet families',
  list.includes('families.map') &&
    list.includes('familyLabel(family, pets, t)') &&
    labels.includes('emptyFamily'),
);
check(
  'Each Family is one accessible card with identity, role, pet count, and the existing route',
  list.includes('<Pressable') &&
    list.includes('accessibilityRole="button"') &&
    list.includes('familyLabel(family, pets, t)') &&
    list.includes('family.lifecycle.petCount') &&
    list.includes('chevron-forward') &&
    list.includes("pathname: '/families/[id]'") &&
    !list.includes("label={t('family.lifecycle.manage')}"),
);
check(
  'Family management uses canonical family membership role',
  settings.includes('familyAccess?.membership.role') &&
    queries.includes(".from('family_members')") &&
    queries.includes("'get_family_members'") &&
    queries.includes(".from('family_members')"),
);
check(
  'Owner alone sees family deletion and cannot directly leave',
  settings.includes('isOwner ?') &&
    settings.includes('styles.dangerZone') &&
    settings.includes('deleteAction') &&
    settings.includes('ownerLeaveGuidance') &&
    settings.includes('leaveAction'),
);
check(
  'Transfer is offered to Members, not Viewers',
  settings.includes("member.role === 'member'") &&
    queries.includes("'transfer_family_ownership'"),
);
check(
  'Owner may remove Members and Viewers, excluding self',
  settings.includes('member.userId !== user?.id') &&
    settings.includes("member.role === 'viewer'") &&
    queries.includes("'remove_family_member'"),
);
check(
  'Family deletion uses one canonical RPC without Pet or Storage loops',
  queries.includes("rpc('delete_family'") &&
    !settings.includes('delete_family_pet') &&
    !settings.includes('storage.') &&
    !settings.includes('deletePet'),
);
check(
  'Family exit reconciles scoped query cache and current Family/Pet',
  settings.includes('clearRevokedFamilyAccess') &&
    cleanup.includes('setCurrentFamilyId(null)') &&
    cleanup.includes('setCurrentPetId(null)'),
);
check(
  'Account 409 maps stable error field to owned-family resolution',
  account.includes('context?.status === 409') &&
    account.includes("payload.error === 'ACCOUNT_OWNS_FAMILY'") &&
    account.includes("access.membership.role === 'owner'"),
);
check(
  'Pet deletion remains distinct from Family deletion',
  pet.includes('useDeletePet') &&
    pet.includes('pets.delete.body') &&
    en.pets.delete.body.includes('family') &&
    zh.pets.delete.body.includes('家庭'),
);
check(
  'Pet edit and Family navigation are setting rows above a separate danger zone',
  pet.includes("label={t('pets.edit.action')}") &&
    pet.includes("label={t('family.lifecycle.manage')}") &&
    pet.includes('styles.settingsCard') &&
    pet.includes('styles.dangerZone'),
);
check(
  'Deleted Pet caches are scoped and cleared',
  petQueries.includes('shouldClearRevokedPetQuery') &&
    petQueries.includes('queryClient.removeQueries(revokedQueries)'),
);
check(
  'Zero-pet Family can receive a new Pet without creating a new Family',
  newPet.includes('useCurrentFamily()') &&
    newPet.includes('useCreateFamilyPet(currentFamilyId)') &&
    newPet.includes('createExistingFamilyPet.mutateAsync(values)') &&
    settings.includes('context.setCurrentFamilyId(id)') &&
    settings.includes("router.push('/pets/new')"),
);
check(
  'New Family is an explicit separate route and the only new-Family client path',
  familyCreationRoute.includes('NewFamilyScreen') &&
    newPet.includes('createNewFamily ?') &&
    newPet.includes('createNewFamilyWithPet.mutateAsync(values)') &&
    petsScreen.includes("router.push('/families/new')") &&
    petsModal.includes('onCreateFamily'),
);
check(
  'Add Pet entry points use the current Family and no-Family Home offers explicit creation',
  petsScreen.includes("router.push('/pets/new')") &&
    homeScreen.includes('petsState.currentFamilyId') &&
    homeScreen.includes("'/families/new'") &&
    newPet.includes('if (!createNewFamily && !currentFamilyId)'),
);
check(
  'Adding a Pet preserves Family selection and selects the new Pet',
  /if \(createNewFamily\) \{[\s\S]*?setCurrentFamilyId\(pet\.family_id/.test(
    newPet,
  ) && newPet.includes('setCurrentPetId(pet.id'),
);
check(
  'Family Members presentation uses canonical Family membership and direct Remove action',
  memberScreen.includes('useFamilyMemberSummaries') &&
    memberScreen.includes('useFamilies') &&
    !memberScreen.includes('usePetMembers') &&
    !memberScreen.includes(".from('pet_members')") &&
    memberScreen.includes("label={t('family.members.remove')}") &&
    memberScreen.includes('styles.inviteCard'),
);
check(
  'A second Pet stays in the Family and inherits every canonical member',
  c3Migration.includes('target_family_id') &&
    c3Migration.includes(
      'insert into public.pet_members (pet_id, user_id, role, created_at)',
    ) &&
    c3Migration.includes('from public.family_members as membership') &&
    c3Migration.includes('where membership.family_id = target_family_id') &&
    list.includes('pets.filter((pet) => pet.family_id === family.id)') &&
    petsScreen.includes('petsQuery.data.map((pet)'),
);
for (const locale of [en, zh]) {
  for (const key of [
    'deleteAction',
    'leaveAction',
    'transferAction',
    'removeBody',
    'zeroPets',
    'emptyFamily',
  ]) {
    check(
      `Lifecycle translation ${key}`,
      Boolean(locale.family.lifecycle[key]),
    );
  }
  check(
    'Account ownership translation',
    Boolean(locale.accountSecurity.ownsFamilyBody),
  );
}

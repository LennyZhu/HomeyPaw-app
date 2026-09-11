import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getProfilePresentationState,
  profileKeys,
} from '../src/features/profile/profile-query-state.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

assert.deepEqual(
  getProfilePresentationState({
    hasError: false,
    hasProfile: false,
    isPending: true,
  }),
  {
    showContent: false,
    showInitialError: false,
    showInitialLoading: true,
  },
);
assert.deepEqual(
  getProfilePresentationState({
    hasError: false,
    hasProfile: true,
    isPending: false,
  }),
  {
    showContent: true,
    showInitialError: false,
    showInitialLoading: false,
  },
);
assert.deepEqual(
  getProfilePresentationState({
    hasError: true,
    hasProfile: true,
    isPending: false,
  }),
  {
    showContent: true,
    showInitialError: false,
    showInitialLoading: false,
  },
);
assert.deepEqual(profileKeys.detail('user-a'), ['profile', 'user-a']);
assert.deepEqual(profileKeys.detail('user-a'), profileKeys.detail('user-a'));
assert.notDeepEqual(profileKeys.detail('user-a'), profileKeys.detail('user-b'));
console.log(
  'PASS: initial loading/error are gated by missing data; cached content survives refetch failures.',
);

const [
  packageText,
  profileScreen,
  useProfile,
  editProfile,
  profileAvatar,
  authContext,
  petsScreen,
  petsActions,
  accountSecurity,
  joinFamily,
  aboutScreen,
  enText,
  zhText,
] = await Promise.all([
  read('package.json'),
  read('src/features/profile/profile-screen.tsx'),
  read('src/features/profile/use-profile.ts'),
  read('src/features/profile/edit-profile-screen.tsx'),
  read('src/features/profile/profile-avatar.ts'),
  read('src/features/auth/auth-context.tsx'),
  read('src/features/pets/pets-screen.tsx'),
  read('src/features/pets/components/pets-create-actions-modal.tsx'),
  read('src/features/profile/account-security-screen.tsx'),
  read('src/features/family/join-family-screen.tsx'),
  read('src/features/profile/about-screen.tsx'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
]);

const packageJson = JSON.parse(packageText);
assert.equal(
  packageJson.scripts['verify:profile-ui'],
  'node --experimental-strip-types scripts/verify-profile-ui.mjs',
);
assert(useProfile.includes('queryKey: profileKeys.detail(user?.id)'));
assert(useProfile.includes('profileQuery.isPending && !profileQuery.data'));
assert(useProfile.includes('queryClient.cancelQueries({ queryKey })'));
assert(
  useProfile.includes('queryClient.setQueryData<Profile>(queryKey, data)'),
);
assert(!useProfile.includes('setIsLoading(true)'));
assert(!useProfile.includes('setProfile(null)'));
assert(!useProfile.includes('Date.now()'));
assert(!useProfile.includes('setTimeout'));
assert(profileScreen.includes('presentation.showInitialLoading'));
assert(profileScreen.includes('presentation.showInitialError'));
assert(profileScreen.includes('presentation.showContent && profile'));
assert(profileScreen.includes('useFocusEffect'));
console.log(
  'PASS: My keeps cached profile content during focus refetch and initial-only failures remain recoverable.',
);

assert(profileScreen.includes('const profileEmail ='));
assert(profileScreen.includes('accessibilityLabel={profileEmail}'));
assert(profileScreen.includes('profile.display_name'));
assert(profileScreen.includes('profileLanguage'));
assert(profileScreen.includes('ellipsizeMode="tail"'));
assert(profileScreen.includes('numberOfLines={1}'));
assert(profileScreen.includes('minWidth: 0'));
assert(profileScreen.includes('email: { flexShrink: 1 }'));
console.log(
  'PASS: long email is one line with tail truncation while accessibility retains the full value.',
);

assert(editProfile.includes('profileAvatarKeys.signed(user.id, uploadedPath)'));
assert(editProfile.includes('selectedAvatar.uri'));
assert(
  profileAvatar.includes(
    'queryKey: profileAvatarKeys.signed(user?.id, objectPath)',
  ),
);
assert(profileAvatar.includes('staleTime: 3_000_000'));
assert(!profileAvatar.includes('Date.now()'));
assert(useProfile.includes("Object.hasOwn(values, 'avatar_url')"));
console.log(
  'PASS: edit saves prime the new avatar cache and signed URL refresh remains resource-scoped.',
);

for (const route of [
  "router.push('/pets')",
  "router.push('/join-family' as Href)",
  "router.push('/edit-profile')",
  "router.push('/account-security')",
  "router.push('/about' as Href)",
]) {
  assert(profileScreen.includes(route));
}
assert(!profileScreen.match(/router\.replace/u));
assert(aboutScreen.includes('router.back()'));
assert(joinFamily.includes('if (router.canGoBack())'));
assert(joinFamily.includes('router.back()'));
assert(joinFamily.includes("router.replace('/profile')"));
assert(!petsScreen.match(/router\.replace\(['"]\/profile/u));
console.log(
  'PASS: My child routes preserve navigation history; Join Family only replaces My as a deep-link fallback.',
);

assert(authContext.includes('queryClient.clear()'));
assert(authContext.includes('previousUserId !== nextUserId'));
assert(useProfile.includes('profileKeys.detail(user.id)'));
console.log(
  'PASS: Profile cache is stable, user-scoped, and cleared across account changes.',
);

assert.equal(petsScreen.match(/icon="add"/gu)?.length, 1);
assert(petsScreen.includes('<PetsCreateActionsModal'));
assert(!petsScreen.includes('styles.headerActions'));
assert(!petsScreen.includes("t('pets.list.subtitle')"));
assert(petsScreen.includes("router.push('/pets/new')"));
assert(petsScreen.includes("router.push('/join-family' as Href)"));
assert(petsScreen.includes('onCancel={() => setIsCreateMenuOpen(false)}'));
assert(petsActions.includes("t('pets.list.addPet')"));
assert(petsActions.includes("t('pets.list.joinFamily')"));
assert(petsActions.includes("t('common.cancel')"));
assert(!petsActions.includes('destructive'));
assert(petsActions.includes('minHeight: 56'));
assert(petsActions.includes("useContentLayout('modal')"));
assert(petsActions.includes('contentStyles.modal'));
assert(petsActions.includes("animationType={isWide ? 'fade' : 'slide'}"));
console.log(
  'PASS: My Pets has one accessible + entry with Add Pet, Join Family, and responsive Cancel actions.',
);

assert(accountSecurity.includes("'delete-account'"));
assert(accountSecurity.includes("confirmation: 'DELETE_MY_ACCOUNT'"));
assert(accountSecurity.includes('onPress: confirmDeletionAgain'));
assert(accountSecurity.includes('variant="danger"'));
assert(accountSecurity.includes('backgroundColor: lightColors.surface'));
assert(accountSecurity.includes('borderColor: lightColors.border'));
assert(!accountSecurity.includes("backgroundColor: '#F9E7E7'"));
assert(accountSecurity.includes('tone="secondary"'));
assert(accountSecurity.includes('tone="error" variant="footnote"'));
assert(accountSecurity.includes('accountSecurity.dangerZone'));
assert(accountSecurity.includes('accountSecurity.deleteAction'));
console.log(
  'PASS: Account Security uses a restrained surface while preserving destructive action and confirmation semantics.',
);

assert(joinFamily.includes('.slice(0, 8)'));
assert(joinFamily.includes('maxLength={8}'));
assert(editProfile.includes('await updateProfile({'));
assert(editProfile.includes('router.back()'));
assert(aboutScreen.includes("t('about.version', { build, version })"));
const en = JSON.parse(enText);
const zh = JSON.parse(zhText);
assert.equal(en.pets.list.addPet, 'Add Pet');
assert.equal(en.pets.list.joinFamily, 'Join Family');
assert.equal(zh.pets.list.addPet, '新增毛孩');
assert.equal(zh.pets.list.joinFamily, '加入家庭');
console.log(
  'PASS: Join Family, Edit Profile, About, bilingual actions, and eight-character invites remain intact.',
);

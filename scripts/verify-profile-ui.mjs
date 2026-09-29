import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getProfilePresentationState,
  profileKeys,
} from '../src/features/profile/profile-query-state.ts';
import {
  compareNumericVersions,
  HOMEYPAW_APP_STORE_ID,
  HOMEYPAW_APP_STORE_LOOKUP_URL,
  HOMEYPAW_APP_STORE_URL,
  lookupLatestAppStoreVersion,
  parseAppStoreVersion,
} from '../src/features/profile/about-update.ts';

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

assert.equal(compareNumericVersions('1.1.1', '1.1.1'), 0);
assert.equal(compareNumericVersions('1.1.1', '1.1.2'), 1);
assert.equal(compareNumericVersions('1.9.9', '1.10.0'), 1);
assert.equal(compareNumericVersions('1.10.0', '1.9.9'), -1);
assert.equal(compareNumericVersions('1.1', '1.1.2'), null);
assert.equal(parseAppStoreVersion({ resultCount: 0, results: [] }), null);
assert.equal(
  parseAppStoreVersion({ resultCount: 1, results: [{ version: 'latest' }] }),
  null,
);
assert.equal(HOMEYPAW_APP_STORE_ID, '6806111286');
assert.equal(
  HOMEYPAW_APP_STORE_LOOKUP_URL,
  'https://itunes.apple.com/lookup?id=6806111286&country=hk',
);
assert(HOMEYPAW_APP_STORE_LOOKUP_URL.includes('id=6806111286'));
assert(HOMEYPAW_APP_STORE_LOOKUP_URL.includes('country=hk'));
assert.equal(HOMEYPAW_APP_STORE_URL, 'https://apps.apple.com/app/id6806111286');
assert(!HOMEYPAW_APP_STORE_URL.includes('country='));
await assert.rejects(
  lookupLatestAppStoreVersion({
    fetcher: async () => {
      throw new Error('offline');
    },
  }),
  /offline/u,
);
await assert.rejects(
  lookupLatestAppStoreVersion({
    fetcher: async () => ({
      json: async () => ({ resultCount: 1, results: [{ version: 'latest' }] }),
      ok: true,
      status: 200,
    }),
  }),
  /invalid version/u,
);
console.log(
  'PASS: About compares numeric App Store versions and handles malformed or failed lookups.',
);

const [
  packageText,
  profileScreen,
  useProfile,
  editProfile,
  profileForm,
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
  read('src/features/profile/components/profile-form.tsx'),
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
assert.equal(packageJson.dependencies['expo-application'], '~57.0.3');
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

assert(profileForm.includes('selectedAvatar.uri'));
assert(profileForm.includes('createStorageImageSource('));
assert(profileAvatar.includes('useStorageSignedUrl(profileAvatarBucket'));
assert(profileAvatar.includes('getStorageSignedUrls('));
assert(!profileAvatar.includes('Date.now()'));
assert(!useProfile.includes('profileAvatarKeys.all'));
console.log(
  'PASS: profile avatars use stable image identity and the shared resource-scoped signed URL cache.',
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
assert(editProfile.includes('<ProfileForm'));
assert(profileForm.includes('await updateProfile(updates)'));
assert(editProfile.includes('router.back()'));
assert(aboutScreen.includes('Application.nativeApplicationVersion'));
assert(aboutScreen.includes('lookupLatestAppStoreVersion()'));
assert(aboutScreen.includes('HOMEYPAW_APP_STORE_URL'));
assert(aboutScreen.includes('Linking.openURL(HOMEYPAW_APP_STORE_URL)'));
assert(aboutScreen.includes("t('about.appStoreOpenError')"));
assert(aboutScreen.includes("t('about.currentVersion')"));
assert(aboutScreen.includes("t('about.checkForUpdates')"));
assert(!aboutScreen.includes('requireSupabase'));
const en = JSON.parse(enText);
const zh = JSON.parse(zhText);
assert.equal(en.pets.list.addPet, 'Add Pet');
assert.equal(en.pets.list.joinFamily, 'Join Family');
assert.equal(zh.pets.list.addPet, '新增毛孩');
assert.equal(zh.pets.list.joinFamily, '加入家庭');
assert.equal(en.about.currentVersion, 'Current Version');
assert.equal(en.about.openAppStore, 'Open App Store');
assert.equal(zh.about.currentVersion, '目前版本');
assert.equal(zh.about.openAppStore, '前往 App Store');
console.log(
  'PASS: Join Family, Edit Profile, About, bilingual actions, and eight-character invites remain intact.',
);

const legal = await read('src/features/profile/legal-screen.tsx');
assert.match(
  await read('src/app/privacy-policy.tsx'),
  /<LegalScreen kind="privacy"/u,
);
assert.ok(legal.includes('t(`about.${kind}Body`)'));
assert.ok(
  legal.includes(
    "kind === 'privacy' ? 'about.privacyUpdated' : 'about.updated'",
  ),
  'Privacy gets its own date without redating unchanged Terms',
);
assert.equal(en.about.privacyUpdated, 'Updated September 29, 2026');
assert.equal(zh.about.privacyUpdated, '更新日期：2026 年 9 月 29 日');
for (const [copy, required, forbidden] of [
  [
    en.about.privacyBody,
    [
      /short videos/u,
      /choose to take a photo/u,
      /does not record video or use the microphone/u,
      /first-view time/u,
      /Passive Feed browsing and preloading do not count/u,
      /app functionality/u,
      /cross-app tracking/u,
      /Chat notifications/u,
      /sender's display name/u,
      /never include message text/u,
    ],
    /does not use[^.]*camera|Chat does not send|policy URL will be added/u,
  ],
  [
    zh.about.privacyBody,
    [
      /短影片/u,
      /選擇拍照/u,
      /不錄製影片，也不使用麥克風/u,
      /首次查看時間/u,
      /Feed 瀏覽或預載媒體不算查看/u,
      /App 功能/u,
      /跨 App 追蹤/u,
      /聊天通知/u,
      /發訊者暱稱/u,
      /不包含聊天正文/u,
    ],
    /不使用[^。]*相機|Chat 不發送|公開政策網址會在/u,
  ],
]) {
  for (const fact of required) assert.match(copy, fact);
  assert.doesNotMatch(copy, forbidden);
  assert.ok(copy.includes('https://homeypaw.vercel.app/privacy'));
  assert.ok(copy.includes('\n\n'), 'Privacy remains readable in paragraphs');
}
console.log(
  'PASS: bundled bilingual privacy UI covers photo-only Camera, library Video/save, first intentional Journal views and privacy-safe Chat Push; no stale camera/push claims, and Terms date is independent.',
);

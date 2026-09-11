import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  clearPendingProfileSetup,
  getPendingProfileSetupUserIds,
  hasPendingProfileSetup,
  markPendingProfileSetup,
} from '../src/features/auth/profile-setup-marker.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
markPendingProfileSetup('user-a', storage);
assert.equal(hasPendingProfileSetup('user-a', storage), true);
assert.equal(hasPendingProfileSetup('user-b', storage), false);
markPendingProfileSetup('user-b', storage);
assert.deepEqual(getPendingProfileSetupUserIds(storage), ['user-a', 'user-b']);
clearPendingProfileSetup('user-a', storage);
assert.equal(hasPendingProfileSetup('user-a', storage), false);
assert.equal(hasPendingProfileSetup('user-b', storage), true);
clearPendingProfileSetup('user-b', storage);
assert.deepEqual(getPendingProfileSetupUserIds(storage), []);
console.log(
  'PASS: the pending profile marker is durable, user-scoped, and independently clearable.',
);

const [
  packageText,
  signUp,
  signIn,
  authContext,
  deepLinkCoordinator,
  rootLayout,
  setupScreen,
  setupRoute,
  profileForm,
  authScreen,
  avatarImage,
  enText,
  zhText,
] = await Promise.all([
  read('package.json'),
  read('src/features/auth/sign-up-screen.tsx'),
  read('src/features/auth/sign-in-screen.tsx'),
  read('src/features/auth/auth-context.tsx'),
  read('src/features/auth/auth-deep-link-coordinator.tsx'),
  read('src/app/_layout.tsx'),
  read('src/features/auth/profile-setup-screen.tsx'),
  read('src/app/profile-setup.tsx'),
  read('src/features/profile/components/profile-form.tsx'),
  read('src/features/auth/components/auth-screen.tsx'),
  read('src/features/media/avatar-image.ts'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
]);

const packageJson = JSON.parse(packageText);
assert.equal(
  packageJson.scripts['verify:auth-ui'],
  'node --experimental-strip-types scripts/verify-auth-ui.mjs',
);
for (const field of ['displayName', 'email', 'password', 'confirmPassword']) {
  assert(signUp.includes(`name="${field}"`));
}
assert.equal((signUp.match(/<Controller/gu) ?? []).length, 4);
assert(!signUp.includes('pickAndPrepareAvatarImage'));
assert(
  signUp.indexOf('beginProfileSetupSignUp()') < signUp.indexOf('.auth.signUp'),
);
assert(signUp.includes('registerPendingProfileSetup(data.user.id)'));
assert(signUp.includes('data.user?.identities?.length'));
assert(signUp.includes("pathname: '/check-email'"));
console.log(
  'PASS: signup remains four fields and marks only a real new user across immediate and email-confirmation sessions.',
);

assert(authContext.includes('profileSetupSignUpIntent.current'));
assert(authContext.includes('hasPendingProfileSetup(nextUserId)'));
assert(authContext.includes('markPendingProfileSetup(nextUserId)'));
assert(authContext.includes('isProfileSetupSignUpSession ||'));
assert(authContext.includes("event === 'INITIAL_SESSION'"));
assert(authContext.includes("event === 'SIGNED_IN'"));
assert(authContext.includes('clearPendingProfileSetup(userId)'));
assert(rootLayout.includes('name="profile-setup"'));
assert(rootLayout.includes('isProfileSetupPending'));
assert(rootLayout.includes('!isProfileSetupPending'));
assert(rootLayout.includes('options={{ gestureEnabled: false }}'));
assert(!signIn.includes('ProfileSetup'));
assert(!signIn.includes('markPendingProfileSetup'));
assert(
  deepLinkCoordinator.includes(
    "isProfileSetupPending ? '/profile-setup' : '/'",
  ),
);
console.log(
  'PASS: session restoration and callbacks honor the marker while ordinary existing-user login remains on the app route.',
);

assert(setupRoute.includes('profile-setup-screen'));
assert(setupScreen.includes('<AuthScreen'));
assert(setupScreen.includes('<ProfileForm'));
assert(setupScreen.includes('onSaved={finishSetup}'));
assert(setupScreen.includes('onSecondaryAction={finishSetup}'));
assert(
  setupScreen.indexOf('completeProfileSetup(user.id)') <
    setupScreen.indexOf("router.replace('/')"),
);
assert(authScreen.includes('contentStyles.auth'));
assert(profileForm.includes('uploadProfileAvatar({'));
assert(profileForm.includes('profileAvatarKeys.signed(user.id, uploadedPath)'));
assert(profileForm.includes('await updateProfile(updates)'));
assert(profileForm.includes('Object.keys(updates).length > 0'));
assert(profileForm.includes('pickAndPrepareAvatarImage()'));
assert(profileForm.includes('secondaryLabel'));
assert(profileForm.includes("t('profile.avatarWithName'"));
assert(profileForm.includes('accessibilityRole="radiogroup"'));
assert(profileForm.includes('accessibilityRole="radio"'));
assert(avatarImage.includes('requestMediaLibraryPermissionsAsync()'));
assert(
  avatarImage.indexOf('requestMediaLibraryPermissionsAsync()') <
    avatarImage.indexOf('launchImageLibraryAsync'),
);
console.log(
  'PASS: Done and Skip remove setup history; the shared optional-avatar form retains picker, upload, cache, fallback, and accessible language behavior.',
);

const en = JSON.parse(enText);
const zh = JSON.parse(zhText);
assert.deepEqual(en.profileSetup, {
  title: 'Complete Your Profile',
  addPhoto: 'Add Photo',
  nickname: 'Nickname',
  done: 'Done',
  skip: 'Skip for Now',
});
assert.deepEqual(zh.profileSetup, {
  title: '完善個人資料',
  addPhoto: '加入相片',
  nickname: '暱稱',
  done: '完成',
  skip: '稍後再說',
});
console.log('PASS: first-profile setup copy is complete in English and zh-HK.');

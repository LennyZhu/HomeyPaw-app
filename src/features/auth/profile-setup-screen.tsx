import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ProfileForm } from '@/features/profile/components/profile-form';

import { useAuth } from './auth-context';
import { AuthScreen } from './components/auth-screen';

export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { completeProfileSetup, user } = useAuth();
  const isFinishing = useRef(false);

  const finishSetup = useCallback(() => {
    if (!user || isFinishing.current) return;

    isFinishing.current = true;
    completeProfileSetup(user.id);
    requestAnimationFrame(() => router.replace('/'));
  }, [completeProfileSetup, router, user]);

  return (
    <AuthScreen title={t('profileSetup.title')}>
      <ProfileForm
        emptyAvatarActionLabel={t('profileSetup.addPhoto')}
        nicknameLabel={t('profileSetup.nickname')}
        onSaved={finishSetup}
        onSecondaryAction={finishSetup}
        primaryLabel={t('profileSetup.done')}
        secondaryLabel={t('profileSetup.skip')}
      />
    </AuthScreen>
  );
}

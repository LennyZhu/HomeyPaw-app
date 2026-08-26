import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { spacing } from '@/theme';

import { AuthScreen } from './components/auth-screen';

export default function CheckEmailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();

  return (
    <AuthScreen
      subtitle={t('auth.checkEmail.subtitle')}
      title={t('auth.checkEmail.title')}
    >
      {email ? (
        <AppText style={styles.email} variant="headline">
          {email}
        </AppText>
      ) : null}
      <AppText tone="secondary">{t('auth.checkEmail.body')}</AppText>
      <AppButton
        label={t('auth.checkEmail.backToSignIn')}
        onPress={() => router.replace('/sign-in')}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  email: {
    marginBottom: spacing.xs,
  },
});

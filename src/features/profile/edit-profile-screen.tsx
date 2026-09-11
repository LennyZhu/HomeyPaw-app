import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { Screen } from '@/components/screen';
import { spacing } from '@/theme';

import { ProfileForm } from './components/profile-form';

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('profile.edit.title')}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {t('profile.edit.subtitle')}
      </AppText>

      <View style={styles.form}>
        <ProfileForm
          onSaved={() => {
            showFeedback(t('profile.edit.saved'));
            router.back();
          }}
          primaryLabel={t('common.save')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md },
  subtitle: { marginTop: spacing.sm },
  form: { marginTop: spacing.huge },
});

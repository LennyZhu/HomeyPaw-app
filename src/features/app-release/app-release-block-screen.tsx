import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import { HOMEYPAW_APP_STORE_URL } from '@/features/profile/about-update';
import { lightColors, radius, spacing } from '@/theme';

type Props = {
  mode: 'upgrade' | 'maintenance';
  message: string | null;
  recheck: () => Promise<void>;
};

export function AppReleaseBlockScreen({ mode, message, recheck }: Props) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const openStore = async () => {
    try {
      await Linking.openURL(HOMEYPAW_APP_STORE_URL);
    } catch {
      Alert.alert(t('common.error'), t('about.appStoreOpenError'));
    }
  };
  const checkAgain = async () => {
    setChecking(true);
    try {
      await recheck();
    } finally {
      setChecking(false);
    }
  };
  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t(`appRelease.${mode}.title`)}
        </AppText>
        <AppText tone="secondary">
          {message || t(`appRelease.${mode}.body`)}
        </AppText>
        {mode === 'upgrade' ? (
          <AppButton
            label={t('about.openAppStore')}
            onPress={() => void openStore()}
          />
        ) : null}
        <AppButton
          label={t('appRelease.checkAgain')}
          loading={checking}
          onPress={() => void checkAgain()}
          variant="secondary"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center' },
  card: {
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    padding: spacing.xl,
  },
});

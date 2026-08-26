import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import i18n from '@/i18n';
import { logError } from '@/lib/logger';
import { lightColors, layout, spacing } from '@/theme';

type GlobalErrorScreenProps = {
  error: Error;
  retry: () => void;
};

export function GlobalErrorScreen({ error, retry }: GlobalErrorScreenProps) {
  useEffect(() => {
    logError('root-render-boundary', error);
    void SplashScreen.hideAsync();
  }, [error]);

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <AppText accessibilityRole="header" variant="title1">
          {i18n.t('globalError.title')}
        </AppText>
        <AppText tone="secondary">{i18n.t('globalError.body')}</AppText>
        <AppButton label={i18n.t('common.retry')} onPress={retry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: lightColors.background,
    flex: 1,
    justifyContent: 'center',
    padding: layout.screenPadding,
  },
  content: {
    gap: spacing.lg,
    maxWidth: 420,
    width: '100%',
  },
});

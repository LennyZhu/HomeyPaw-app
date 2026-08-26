import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { spacing } from '@/theme';

type LegalScreenProps = { kind: 'privacy' | 'terms' };

export function LegalScreen({ kind }: LegalScreenProps) {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <AppText
          accessibilityRole="header"
          style={styles.title}
          variant="title1"
        >
          {t(`about.${kind}Title`)}
        </AppText>
      </View>
      <AppText tone="tertiary" variant="footnote">
        {t('about.updated')}
      </AppText>
      <AppText style={styles.body}>{t(`about.${kind}Body`)}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row' },
  title: { flex: 1, marginLeft: spacing.md },
  body: { lineHeight: 28 },
});

import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { spacing } from '@/theme';

import { useCurrentFamily } from './use-current-family';

export default function FamiliesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { familiesQuery, petsQuery } = useCurrentFamily();
  const access = familiesQuery.data?.[0];
  const soleFamilyId =
    familiesQuery.data?.length === 1 ? access?.family.id : null;

  useEffect(() => {
    if (familiesQuery.isSuccess && petsQuery.isSuccess && soleFamilyId) {
      router.replace({
        pathname: '/families/[id]',
        params: { id: soleFamilyId },
      });
    }
  }, [familiesQuery.isSuccess, petsQuery.isSuccess, router, soleFamilyId]);

  if (
    familiesQuery.isPending ||
    petsQuery.isPending ||
    (soleFamilyId && familiesQuery.isSuccess && petsQuery.isSuccess)
  ) {
    return <LoadingView label={t('family.lifecycle.loading')} />;
  }

  if (
    familiesQuery.isError ||
    petsQuery.isError ||
    (familiesQuery.data?.length ?? 0) > 1
  ) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('family.lifecycle.loadError')}</AppText>
        <AppButton
          label={t('common.retry')}
          onPress={() => {
            void familiesQuery.refetch();
            void petsQuery.refetch();
          }}
          variant="secondary"
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('family.lifecycle.noFamilies')}
        </AppText>
        <AppText tone="secondary">{t('family.single.noFamilyBody')}</AppText>
      </View>
      <AppButton
        label={t('family.create.action')}
        onPress={() => router.push('/families/new')}
      />
      <AppButton
        label={t('family.join.action')}
        onPress={() => router.push('/join-family')}
        variant="secondary"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.huge,
    paddingTop: spacing.xl,
  },
  heading: { gap: spacing.sm },
});

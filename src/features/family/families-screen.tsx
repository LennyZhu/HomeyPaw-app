import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { SettingsRow } from '@/components/settings-row';
import { lightColors, radius, spacing } from '@/theme';

import { familyLabel } from './family-label';
import { useCurrentFamily } from './use-current-family';

export default function FamiliesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { families, familiesQuery, pets, petsQuery } = useCurrentFamily();

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('family.lifecycle.listTitle')}
      </AppText>
      <AppText tone="secondary">{t('family.lifecycle.listSubtitle')}</AppText>
      {familiesQuery.isPending || petsQuery.isPending ? (
        <LoadingView label={t('family.lifecycle.loading')} />
      ) : null}
      {familiesQuery.isError || petsQuery.isError ? (
        <View style={styles.section}>
          <AppText tone="error">{t('family.lifecycle.loadError')}</AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => {
              void familiesQuery.refetch();
              void petsQuery.refetch();
            }}
            variant="secondary"
          />
        </View>
      ) : null}
      {familiesQuery.isSuccess &&
      petsQuery.isSuccess &&
      families.length === 0 ? (
        <View style={styles.section}>
          <AppText>{t('family.lifecycle.noFamilies')}</AppText>
          <AppButton
            label={t('family.create.action')}
            onPress={() => router.push('/families/new')}
          />
        </View>
      ) : null}
      {families.map(({ family, membership }) => (
        <Pressable
          accessibilityLabel={`${familyLabel(family, pets, t)}, ${t(`family.roles.${membership.role}`)}, ${t('family.lifecycle.petCount', { count: pets.filter((pet) => pet.family_id === family.id).length })}`}
          accessibilityRole="button"
          key={family.id}
          onPress={() =>
            router.push({
              pathname: '/families/[id]',
              params: { id: family.id },
            })
          }
          style={({ pressed }) => [
            styles.familyCard,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.familyCopy}>
            <AppText variant="headline">{familyLabel(family, pets, t)}</AppText>
            <AppText tone="secondary" variant="subheadline">
              {t(`family.roles.${membership.role}`)}
            </AppText>
            <AppText tone="secondary" variant="footnote">
              {t('family.lifecycle.petCount', {
                count: pets.filter((pet) => pet.family_id === family.id).length,
              })}
            </AppText>
          </View>
          <Ionicons
            color={lightColors.textTertiary}
            name="chevron-forward"
            size={19}
          />
        </Pressable>
      ))}
      {familiesQuery.isSuccess && families.length > 0 ? (
        <View style={styles.createCard}>
          <SettingsRow
            icon="add-circle-outline"
            label={t('family.create.action')}
            last
            onPress={() => router.push('/families/new')}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
  section: { gap: spacing.sm, paddingVertical: spacing.md },
  familyCard: {
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 96,
    padding: spacing.lg,
  },
  familyCopy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  pressed: { opacity: 0.62 },
  createCard: {
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
});

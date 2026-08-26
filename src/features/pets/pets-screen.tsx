import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { lightColors, spacing } from '@/theme';

import { PetAvatar } from './components/pet-avatar';
import { getPetSummaryLabel } from './pet-display';
import { usePets } from './pet-queries';

export default function PetsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const petsQuery = usePets();

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText accessibilityRole="header" variant="largeTitle">
            {t('pets.list.title')}
          </AppText>
          <AppText tone="secondary">{t('pets.list.subtitle')}</AppText>
        </View>
        <View style={styles.headerActions}>
          <AppButton
            label={t('family.join.action')}
            onPress={() => router.push('/join-family' as Href)}
            style={styles.headerButton}
            variant="secondary"
          />
          <AppButton
            label={t('pets.list.add')}
            onPress={() => router.push('/pets/new')}
            style={styles.headerButton}
            variant="secondary"
          />
        </View>
      </View>

      {petsQuery.isPending ? (
        <LoadingView label={t('pets.loading.list')} />
      ) : null}

      {petsQuery.isError ? (
        <View style={styles.state}>
          <AppText tone="error">{t('pets.errors.load')}</AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => void petsQuery.refetch()}
            variant="secondary"
          />
        </View>
      ) : null}

      {petsQuery.isSuccess && petsQuery.data.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            actionLabel={t('pets.empty.action')}
            body={t('pets.empty.body')}
            icon="paw-outline"
            onActionPress={() => router.push('/pets/new')}
            title={t('pets.empty.title')}
          />
          <AppButton
            label={t('family.join.action')}
            onPress={() => router.push('/join-family' as Href)}
            variant="secondary"
          />
        </View>
      ) : null}

      {petsQuery.data?.length ? (
        <View style={styles.list}>
          {petsQuery.data.map((pet) => (
            <Pressable
              accessibilityRole="button"
              key={pet.id}
              onPress={() =>
                router.push({ pathname: '/pets/[id]', params: { id: pet.id } })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <PetAvatar
                accessibilityLabel={t('pets.avatar.accessibility', {
                  name: pet.name,
                })}
                avatarPath={pet.avatar_path}
                name={pet.name}
                size={64}
              />
              <View style={styles.rowCopy}>
                <AppText variant="headline">{pet.name}</AppText>
                <AppText tone="secondary" variant="subheadline">
                  {getPetSummaryLabel(pet, t)}
                </AppText>
              </View>
              <Ionicons
                color={lightColors.textTertiary}
                name="chevron-forward"
                size={19}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.lg,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.sm,
  },
  headerActions: {
    gap: spacing.sm,
  },
  headerButton: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  state: {
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.huge,
  },
  list: {
    marginTop: spacing.xxxl,
  },
  emptyWrap: {
    gap: spacing.lg,
  },
  row: {
    minHeight: 88,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.62,
  },
});

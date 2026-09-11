import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { lightColors, spacing } from '@/theme';

import { PetAvatar } from './components/pet-avatar';
import { PetsCreateActionsModal } from './components/pets-create-actions-modal';
import { getPetSummaryLabel } from './pet-display';
import { usePets } from './pet-queries';

export default function PetsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const petsQuery = usePets();
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <AppText
          accessibilityRole="header"
          style={styles.headerTitle}
          variant="largeTitle"
        >
          {t('pets.list.title')}
        </AppText>
        <IconButton
          accessibilityLabel={t('pets.list.createActions')}
          icon="add"
          onPress={() => setIsCreateMenuOpen(true)}
        />
      </View>

      <PetsCreateActionsModal
        onAddPet={() => {
          setIsCreateMenuOpen(false);
          router.push('/pets/new');
        }}
        onCancel={() => setIsCreateMenuOpen(false)}
        onJoinFamily={() => {
          setIsCreateMenuOpen(false);
          router.push('/join-family' as Href);
        }}
        visible={isCreateMenuOpen}
      />

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
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
  },
  headerTitle: { flex: 1 },
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

import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { usePetMembers } from '@/features/family/family-queries';
import { useCurrentPetStore } from '@/stores/current-pet-store';
import { lightColors, radius, spacing } from '@/theme';

import { PetAvatar } from './components/pet-avatar';
import { formatDateOnly, getCompanionDays } from './pet-dates';
import { getPetAgeLabel, getPetBreedSpeciesLabel } from './pet-display';
import { useDeletePet, usePet } from './pet-queries';

export default function PetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petQuery = usePet(id);
  const membersQuery = usePetMembers(id);
  const deletePet = useDeletePet();
  const currentPetId = useCurrentPetStore((state) => state.currentPetId);
  const setCurrentPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const [showWebConfirmation, setShowWebConfirmation] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const performDelete = async () => {
    setDeleteError(null);

    try {
      const result = await deletePet.mutateAsync(id);
      if (currentPetId === id) {
        setCurrentPetId(null);
      }
      router.replace('/pets');

      if (result.avatarCleanupPending) {
        showFeedback(t('pets.errors.avatarCleanupPending'), 'error');
      }
    } catch {
      setDeleteError(t('pets.errors.delete'));
    }
  };

  const confirmDelete = () => {
    const pet = petQuery.data;

    if (!pet) {
      return;
    }

    if (Platform.OS === 'web') {
      setShowWebConfirmation(true);
      return;
    }

    Alert.alert(
      t('pets.delete.title', { name: pet.name }),
      t('pets.delete.body', { name: pet.name }),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          style: 'destructive',
          text: t('pets.delete.action'),
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  if (petQuery.isPending) {
    return <LoadingView label={t('pets.loading.detail')} />;
  }

  if (membersQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('pets.errors.notFound')}</AppText>
        <AppButton
          label={t('common.back')}
          onPress={() => router.replace('/pets')}
          variant="secondary"
        />
      </Screen>
    );
  }

  const pet = petQuery.data;

  if (!pet) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('pets.errors.notFound')}</AppText>
        <AppButton
          label={t('common.back')}
          onPress={() => router.replace('/pets')}
          variant="secondary"
        />
      </Screen>
    );
  }

  const age = getPetAgeLabel(pet, t);
  const companionDays = getCompanionDays(pet.adoption_date);
  const birthday = formatDateOnly(pet.birthday, i18n.language);
  const adoptionDate = formatDateOnly(pet.adoption_date, i18n.language);
  const members = membersQuery.data ?? [];
  const isOwner = members.some(
    (member) => member.userId === user?.id && member.role === 'owner',
  );

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.hero}>
        <PetAvatar
          accessibilityLabel={t('pets.avatar.accessibility', {
            name: pet.name,
          })}
          avatarPath={pet.avatar_path}
          name={pet.name}
          size={144}
        />
        <AppText accessibilityRole="header" variant="largeTitle">
          {pet.name}
        </AppText>
        <AppText tone="secondary" variant="headline">
          {getPetBreedSpeciesLabel(pet, t)} · {t(`pets.codes.${pet.gender}`)}
        </AppText>
        <View style={styles.metrics}>
          {age ? (
            <View style={styles.metric}>
              <AppText variant="title2">{age}</AppText>
              <AppText tone="secondary" variant="footnote">
                {t('pets.fields.age')}
              </AppText>
            </View>
          ) : null}
          {companionDays !== null ? (
            <View style={styles.metric}>
              <AppText variant="title2">
                {new Intl.NumberFormat(i18n.language).format(companionDays)}
              </AppText>
              <AppText tone="secondary" variant="footnote">
                {t('pets.detail.companionDays')}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.details}>
        <DetailRow
          label={t('pets.fields.species')}
          value={t(`pets.codes.${pet.species}`)}
        />
        <DetailRow label={t('pets.fields.breed')} value={pet.breed} />
        <DetailRow
          label={t('pets.fields.gender')}
          value={t(`pets.codes.${pet.gender}`)}
        />
        <DetailRow label={t('pets.fields.birthday')} value={birthday} />
        <DetailRow label={t('pets.fields.adoptionDate')} value={adoptionDate} />
        <DetailRow
          label={t('pets.fields.weight')}
          value={
            pet.weight === null
              ? null
              : t('pets.detail.weightValue', { weight: pet.weight })
          }
        />
        <DetailRow
          label={t('pets.fields.description')}
          value={pet.description}
        />
      </View>

      <AppButton
        label={t('family.members.detailAction', {
          count: membersQuery.isSuccess ? members.length : '…',
        })}
        onPress={() => router.push(`/pets/${pet.id}/members` as Href)}
        variant="secondary"
      />

      {isOwner ? (
        <View style={styles.actions}>
          <AppButton
            label={t('pets.edit.action')}
            onPress={() =>
              router.push({
                pathname: '/pets/[id]/edit',
                params: { id: pet.id },
              })
            }
          />
          {showWebConfirmation ? (
            <View style={styles.webConfirmation}>
              <AppText variant="headline">
                {t('pets.delete.title', { name: pet.name })}
              </AppText>
              <AppText>{t('pets.delete.body', { name: pet.name })}</AppText>
              <AppButton
                disabled={deletePet.isPending}
                label={t('common.cancel')}
                onPress={() => setShowWebConfirmation(false)}
                variant="secondary"
              />
              <AppButton
                label={t('pets.delete.action')}
                loading={deletePet.isPending}
                onPress={() => void performDelete()}
                variant="danger"
              />
            </View>
          ) : (
            <AppButton
              label={t('pets.delete.action')}
              loading={deletePet.isPending}
              onPress={confirmDelete}
              variant="danger"
            />
          )}
          {deleteError ? <AppText tone="error">{deleteError}</AppText> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }

  return (
    <View style={styles.detailRow}>
      <AppText tone="secondary" variant="subheadline">
        {label}
      </AppText>
      <AppText style={styles.detailValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.huge,
    paddingTop: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  metrics: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  metric: {
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.lg,
    flex: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  details: {
    marginTop: spacing.xxxl,
  },
  detailRow: {
    minHeight: 58,
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  detailValue: {
    lineHeight: 23,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.xxxl,
  },
  webConfirmation: {
    backgroundColor: '#F9E7E7',
    borderColor: lightColors.error,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.lg,
  },
});

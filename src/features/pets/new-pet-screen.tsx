import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { AppButton } from '@/components/app-button';
import { useFeedback } from '@/components/feedback-provider';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { familyLabel } from '@/features/family/family-label';
import { isAlreadyInFamilyError } from '@/features/family/family-single-membership';
import { familyKeys } from '@/features/family/family-queries';
import { useCurrentFamily } from '@/features/family/use-current-family';
import { useCurrentFamilyStore } from '@/stores/current-family-store';
import { useCurrentPetStore } from '@/stores/current-pet-store';
import { spacing } from '@/theme';

import { removePetAvatar, uploadPetAvatar } from './pet-avatar';
import { PetForm, type PetAvatarChange } from './components/pet-form';
import {
  petKeys,
  updatePetAvatarPath,
  useCreateFamilyPet,
  useCreateFamilyWithFirstPet,
} from './pet-queries';
import type { PetFormValues } from './pet-schema';

export default function NewPetScreen() {
  return <PetCreationScreen createNewFamily={false} />;
}

export function NewFamilyScreen() {
  return <PetCreationScreen createNewFamily />;
}

function PetCreationScreen({ createNewFamily }: { createNewFamily: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const familyContext = useCurrentFamily();
  const currentFamilyId = familyContext.currentFamilyId;
  const createNewFamilyWithPet = useCreateFamilyWithFirstPet();
  const createExistingFamilyPet = useCreateFamilyPet(currentFamilyId);
  const setCurrentFamilyId = useCurrentFamilyStore(
    (state) => state.setCurrentFamilyId,
  );
  const setCurrentPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (
    values: PetFormValues,
    avatarChange: PetAvatarChange,
  ) => {
    setSubmitError(null);

    try {
      if (createNewFamily && currentFamilyId) {
        throw new Error('ALREADY_IN_FAMILY');
      }
      if (
        !createNewFamily &&
        (!currentFamilyId || familyContext.currentMembership?.role !== 'owner')
      ) {
        throw new Error('FAMILY_OWNER_REQUIRED');
      }
      const pet = createNewFamily
        ? await createNewFamilyWithPet.mutateAsync(values)
        : await createExistingFamilyPet.mutateAsync(values);
      if (createNewFamily) {
        await queryClient.invalidateQueries({
          queryKey: familyKeys.list(user?.id),
        });
        setCurrentFamilyId(pet.family_id, user?.id ?? null);
      }
      setCurrentPetId(pet.id, user?.id ?? null);
      let avatarWarning = false;

      if (avatarChange.type === 'replace' && user) {
        let uploadedPath: string | null = null;

        try {
          uploadedPath = await uploadPetAvatar({
            avatar: avatarChange.avatar,
            petId: pet.id,
            userId: user.id,
          });
          const petWithAvatar = await updatePetAvatarPath(pet.id, uploadedPath);
          queryClient.setQueryData(
            petKeys.detail(user.id, pet.id),
            petWithAvatar,
          );
        } catch {
          if (uploadedPath) {
            await removePetAvatar(uploadedPath).catch(() => undefined);
          }
          avatarWarning = true;
        }
      }

      await queryClient.invalidateQueries({ queryKey: petKeys.all(user?.id) });
      showFeedback(
        avatarWarning
          ? t('pets.errors.avatarUploadAfterCreate')
          : t(createNewFamily ? 'family.create.saved' : 'pets.create.saved'),
        avatarWarning ? 'error' : 'success',
      );
      router.replace({ pathname: '/pets/[id]', params: { id: pet.id } });
    } catch (error) {
      setSubmitError(
        t(
          isAlreadyInFamilyError(error)
            ? 'family.single.alreadyInFamily'
            : 'pets.errors.create',
        ),
      );
    }
  };

  if (
    familyContext.familiesQuery.isPending ||
    familyContext.petsQuery.isPending
  ) {
    return <LoadingView label={t('family.lifecycle.loading')} />;
  }

  if (familyContext.familiesQuery.isError || familyContext.petsQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('family.lifecycle.loadError')}</AppText>
        <AppButton
          label={t('common.retry')}
          onPress={() => {
            void familyContext.familiesQuery.refetch();
            void familyContext.petsQuery.refetch();
          }}
          variant="secondary"
        />
      </Screen>
    );
  }

  if (createNewFamily && currentFamilyId) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('family.create.title')}
        </AppText>
        <AppText tone="secondary">{t('family.single.alreadyInFamily')}</AppText>
        <AppButton
          label={t('family.lifecycle.manage')}
          onPress={() => router.replace('/families')}
          variant="secondary"
        />
      </Screen>
    );
  }

  if (!createNewFamily && !currentFamilyId) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('pets.create.title')}
        </AppText>
        <AppText tone="secondary">{t('pets.create.noFamily')}</AppText>
        <AppButton
          label={t('family.create.action')}
          onPress={() => router.replace('/families/new')}
        />
        <AppButton
          label={t('family.join.action')}
          onPress={() => router.push('/join-family')}
          variant="secondary"
        />
      </Screen>
    );
  }

  if (!createNewFamily && familyContext.currentMembership?.role !== 'owner') {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('pets.create.title')}
        </AppText>
        <AppText tone="secondary">{t('pets.create.ownerOnly')}</AppText>
        <AppButton
          label={t('profile.manageFamilies')}
          onPress={() => router.replace('/families')}
          variant="secondary"
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t(createNewFamily ? 'family.create.title' : 'pets.create.title')}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {createNewFamily
          ? t('family.create.subtitle')
          : t('pets.create.existingFamilySubtitle', {
              name: familyContext.currentFamily
                ? familyLabel(
                    familyContext.currentFamily,
                    familyContext.pets,
                    t,
                  )
                : '',
            })}
      </AppText>
      <PetForm
        onSubmit={handleSubmit}
        submitError={submitError}
        submitLabel={t(
          createNewFamily ? 'family.create.submit' : 'pets.create.submit',
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
  subtitle: {
    marginTop: -spacing.md,
  },
});

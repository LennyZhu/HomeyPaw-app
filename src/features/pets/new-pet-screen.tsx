import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { useCurrentPetStore } from '@/stores/current-pet-store';
import { spacing } from '@/theme';

import { removePetAvatar, uploadPetAvatar } from './pet-avatar';
import { PetForm, type PetAvatarChange } from './components/pet-form';
import { petKeys, updatePetAvatarPath, useCreatePet } from './pet-queries';
import type { PetFormValues } from './pet-schema';

export default function NewPetScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const createPet = useCreatePet();
  const setCurrentPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (
    values: PetFormValues,
    avatarChange: PetAvatarChange,
  ) => {
    setSubmitError(null);

    try {
      const pet = await createPet.mutateAsync(values);
      setCurrentPetId(pet.id);
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
          : t('pets.create.saved'),
        avatarWarning ? 'error' : 'success',
      );
      router.replace({ pathname: '/pets/[id]', params: { id: pet.id } });
    } catch {
      setSubmitError(t('pets.errors.create'));
    }
  };

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('pets.create.title')}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {t('pets.create.subtitle')}
      </AppText>
      <PetForm
        onSubmit={handleSubmit}
        submitError={submitError}
        submitLabel={t('pets.create.submit')}
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

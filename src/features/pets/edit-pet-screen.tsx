import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { usePetMembers } from '@/features/family/family-queries';
import { spacing } from '@/theme';

import { PetForm, type PetAvatarChange } from './components/pet-form';
import { removePetAvatar, uploadPetAvatar } from './pet-avatar';
import {
  petKeys,
  updatePetAvatarPath,
  usePet,
  useUpdatePet,
} from './pet-queries';
import type { PetFormValues } from './pet-schema';

export default function EditPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const petQuery = usePet(id);
  const membersQuery = usePetMembers(id);
  const updatePet = useUpdatePet(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const initialValues = useMemo<PetFormValues | undefined>(() => {
    const pet = petQuery.data;

    if (!pet) {
      return undefined;
    }

    return {
      adoptionDate: pet.adoption_date ?? '',
      birthday: pet.birthday ?? '',
      breed: pet.breed ?? '',
      description: pet.description ?? '',
      gender: pet.gender,
      name: pet.name,
      species: pet.species,
      weight: pet.weight === null ? '' : String(pet.weight),
    };
  }, [petQuery.data]);

  const handleSubmit = async (
    values: PetFormValues,
    avatarChange: PetAvatarChange,
  ) => {
    const originalAvatarPath = petQuery.data?.avatar_path ?? null;
    let uploadedPath: string | null = null;
    setSubmitError(null);

    try {
      await updatePet.mutateAsync(values);

      if (avatarChange.type === 'replace' && user) {
        uploadedPath = await uploadPetAvatar({
          avatar: avatarChange.avatar,
          petId: id,
          userId: user.id,
        });
        await updatePetAvatarPath(id, uploadedPath);

        if (originalAvatarPath) {
          await removePetAvatar(originalAvatarPath).catch(() => undefined);
        }
      } else if (avatarChange.type === 'remove' && originalAvatarPath) {
        await updatePetAvatarPath(id, null);
        await removePetAvatar(originalAvatarPath).catch(() => undefined);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: petKeys.all(user?.id) }),
        queryClient.invalidateQueries({
          queryKey: petKeys.detail(user?.id, id),
        }),
      ]);
      router.back();
    } catch {
      if (uploadedPath) {
        await removePetAvatar(uploadedPath).catch(() => undefined);
      }
      setSubmitError(t('pets.errors.update'));
    }
  };

  if (petQuery.isPending || membersQuery.isPending) {
    return <LoadingView label={t('pets.loading.detail')} />;
  }

  if (!petQuery.data || !initialValues) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('pets.errors.notFound')}</AppText>
      </Screen>
    );
  }

  const isOwner = membersQuery.data?.some(
    (member) => member.userId === user?.id && member.role === 'owner',
  );

  if (!isOwner) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('pets.errors.ownerOnly')}</AppText>
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('pets.edit.title', { name: petQuery.data.name })}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {t('pets.edit.subtitle')}
      </AppText>
      <PetForm
        avatarPath={petQuery.data.avatar_path}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitError={submitError}
        submitLabel={t('common.save')}
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

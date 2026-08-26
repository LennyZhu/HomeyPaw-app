import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { logError } from '@/lib/logger';
import { lightColors, radius, spacing } from '@/theme';

import type { CareFormValues } from './care-schema';
import { isCareType } from './care-types';
import { useCreateCareLog } from './care-queries';
import { CareForm } from './components/care-form';

function createCareSession() {
  return {
    careId: Crypto.randomUUID(),
    initialValues: {
      durationMinutes: '',
      note: '',
      occurredAt: new Date().toISOString(),
    } satisfies CareFormValues,
  };
}

export default function NewCareScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const petsState = useCurrentPet();
  const createCare = useCreateCareLog();
  const [session, setSession] = useState(createCareSession);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setSession(createCareSession());
      setSubmitError(null);
    }, []),
  );

  if (petsState.isPending)
    return <LoadingView label={t('pets.loading.list')} />;

  if (!isCareType(type)) {
    return (
      <Screen contentContainerStyle={styles.empty}>
        <AppText tone="error">{t('care.errors.invalidType')}</AppText>
        <AppButton label={t('common.back')} onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!petsState.currentPet) {
    return (
      <Screen contentContainerStyle={styles.empty}>
        <EmptyState
          actionLabel={t('pets.empty.action')}
          body={t('care.empty.noPetBody')}
          icon="paw-outline"
          onActionPress={() => router.push('/pets/new')}
          title={t('care.empty.noPetTitle')}
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <View style={styles.headerCopy}>
          <AppText accessibilityRole="header" variant="title1">
            {t('care.create.title')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t('care.create.subtitle')}
          </AppText>
        </View>
      </View>
      {petsState.pets.length > 1 ? (
        <Pressable
          accessibilityLabel={t('care.form.changePet')}
          accessibilityRole="button"
          onPress={() => setIsSwitcherOpen(true)}
          style={({ pressed }) => [
            styles.petSelector,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={lightColors.secondary}
            name="paw-outline"
            size={20}
          />
          <View style={styles.petSelectorCopy}>
            <AppText tone="secondary" variant="footnote">
              {t('care.form.forPet')}
            </AppText>
            <AppText variant="headline">{petsState.currentPet.name}</AppText>
          </View>
          <AppText tone="brand" variant="footnote">
            {t('care.form.changePet')}
          </AppText>
        </Pressable>
      ) : null}
      <CareForm
        careType={type}
        initialValues={session.initialValues}
        key={session.careId}
        onSubmit={async (values) => {
          setSubmitError(null);
          try {
            await createCare.mutateAsync({
              careId: session.careId,
              careType: type,
              petId: petsState.currentPet!.id,
              values,
            });
            showFeedback(t('care.create.saved'));
            router.replace('/');
          } catch (error) {
            logError('care-create', error);
            setSubmitError(t('care.errors.create'));
          }
        }}
        petName={petsState.currentPet.name}
        submitError={submitError}
        submitLabel={t('care.create.submit')}
      />
      <PetSwitcherModal
        currentPetId={petsState.currentPetId}
        onAddPet={() => {
          setIsSwitcherOpen(false);
          router.push('/pets/new');
        }}
        onClose={() => setIsSwitcherOpen(false)}
        onSelectPet={(petId) => {
          petsState.setCurrentPetId(petId);
          setSession(createCareSession());
          setSubmitError(null);
          setIsSwitcherOpen(false);
        }}
        pets={petsState.pets}
        visible={isSwitcherOpen}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xxl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.sm,
  },
  empty: {
    gap: spacing.lg,
    justifyContent: 'center',
    paddingBottom: spacing.huge,
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xxs },
  petSelector: {
    minHeight: 62,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  petSelectorCopy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.62 },
});

import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { getDeviceTimeZone, getLocalDateOnly } from '@/features/care/care-date';
import { PetAvatar } from '@/features/pets/components/pet-avatar';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import {
  getCareTaskNotificationPermission,
  requestCareTaskNotificationPermission,
  syncCareTaskNotifications,
} from '@/services/care-task-notifications';
import {
  hasShownCareTaskNotificationPreprompt,
  markCareTaskNotificationPrepromptShown,
} from '@/services/care-task-notification-store';
import { lightColors, radius, spacing } from '@/theme';

import { useCreateCareTask } from './care-task-queries';
import type { CareTaskFormValues } from './care-task-schema';
import { CareTaskForm } from './components/care-task-form';
import { useAuth } from '../auth/auth-context';

function defaultValues(): CareTaskFormValues {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5, 0, 0);
  return {
    careType: 'feeding',
    date: getLocalDateOnly(next),
    localTime: `${next.getHours().toString().padStart(2, '0')}:${next
      .getMinutes()
      .toString()
      .padStart(2, '0')}`,
    monthDay: String(next.getDate()),
    note: '',
    scheduleType: 'once',
    title: '',
    weekDay: String(next.getDay() === 0 ? 7 : next.getDay()),
  };
}

export default function NewCareTaskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const createTask = useCreateCareTask();
  const [selectedPetId, setSelectedPetId] = useState<string | null>(
    petsState.currentPetId,
  );
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [timeZone] = useState(() => getDeviceTimeZone());
  const [values] = useState(() => defaultValues());
  const [taskId] = useState(() => Crypto.randomUUID());
  const effectivePetId = selectedPetId ?? petsState.currentPetId;
  const selectedPet =
    petsState.pets.find((pet) => pet.id === effectivePetId) ??
    petsState.currentPet;

  const finish = () => router.replace('/reminders');

  const submit = async (formValues: CareTaskFormValues) => {
    if (!selectedPet) return;
    setSubmitError(null);
    try {
      await createTask.mutateAsync({
        petId: selectedPet.id,
        taskId,
        timeZone,
        values: formValues,
      });
      const permission = await getCareTaskNotificationPermission();
      const hasShownPreprompt = user
        ? await hasShownCareTaskNotificationPreprompt(user.id)
        : true;
      if (permission === 'undetermined' && user && !hasShownPreprompt) {
        setShowPermissionPrompt(true);
      } else {
        finish();
      }
    } catch {
      setSubmitError(t('reminders.errors.save'));
    }
  };

  const allowNotifications = async () => {
    if (user) {
      await markCareTaskNotificationPrepromptShown(user.id).catch(
        () => undefined,
      );
    }
    await requestCareTaskNotificationPermission().catch(() => 'denied');
    if (user) {
      await syncCareTaskNotifications(user.id).catch(() => undefined);
    }
    setShowPermissionPrompt(false);
    finish();
  };

  const deferNotifications = async () => {
    if (user) {
      await markCareTaskNotificationPrepromptShown(user.id).catch(
        () => undefined,
      );
    }
    setShowPermissionPrompt(false);
    finish();
  };

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <View style={styles.headerCopy}>
          <AppText accessibilityRole="header" variant="largeTitle">
            {t('reminders.new.title')}
          </AppText>
          <AppText tone="secondary">{t('reminders.new.subtitle')}</AppText>
        </View>
      </View>

      {selectedPet ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsSwitcherOpen(true)}
          style={({ pressed }) => [
            styles.petSelector,
            pressed && styles.pressed,
          ]}
        >
          <PetAvatar
            accessibilityLabel={selectedPet.name}
            avatarPath={selectedPet.avatar_path}
            name={selectedPet.name}
            size={46}
          />
          <View style={styles.petCopy}>
            <AppText variant="headline">{selectedPet.name}</AppText>
            <AppText tone="secondary" variant="footnote">
              {t('reminders.new.choosePet')}
            </AppText>
          </View>
        </Pressable>
      ) : null}

      {selectedPet ? (
        <CareTaskForm
          initialValues={values}
          onSubmit={submit}
          submitError={submitError}
          submitLabel={t('common.save')}
          timeZone={timeZone}
        />
      ) : (
        <AppButton
          label={t('pets.empty.action')}
          onPress={() => router.push('/pets/new')}
        />
      )}

      <PetSwitcherModal
        currentPetId={selectedPet?.id ?? null}
        onAddPet={() => {
          setIsSwitcherOpen(false);
          router.push('/pets/new');
        }}
        onClose={() => setIsSwitcherOpen(false)}
        onSelectPet={(petId) => {
          setSelectedPetId(petId);
          petsState.setCurrentPetId(petId);
          setIsSwitcherOpen(false);
        }}
        pets={petsState.pets}
        visible={isSwitcherOpen}
      />

      <Modal animationType="fade" transparent visible={showPermissionPrompt}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.permissionCard}>
            <AppText accessibilityRole="header" variant="title1">
              {t('reminders.permission.promptTitle')}
            </AppText>
            <AppText tone="secondary">
              {t('reminders.permission.promptBody')}
            </AppText>
            <View style={styles.promptActions}>
              <AppButton
                label={t('reminders.permission.later')}
                onPress={() => void deferNotifications()}
                variant="secondary"
              />
              <AppButton
                label={t('reminders.permission.allow')}
                onPress={() => void allowNotifications()}
              />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.md },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  petSelector: {
    minHeight: 70,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  petCopy: { flex: 1 },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: lightColors.overlay,
    padding: spacing.xl,
  },
  permissionCard: {
    gap: spacing.lg,
    backgroundColor: lightColors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  promptActions: { gap: spacing.md },
  pressed: { opacity: 0.68 },
});

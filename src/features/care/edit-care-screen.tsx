import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { usePets } from '@/features/pets/pet-queries';
import { logError } from '@/lib/logger';
import { spacing } from '@/theme';

import type { CareFormValues } from './care-schema';
import { useCareLog, useUpdateCareLog } from './care-queries';
import { CareForm } from './components/care-form';

export default function EditCareScreen() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const logQuery = useCareLog(id);
  const petsQuery = usePets();
  const updateCare = useUpdateCareLog(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const log = logQuery.data;
  const pet = petsQuery.data?.find((candidate) => candidate.id === log?.pet_id);
  const initialValues = useMemo<CareFormValues | null>(
    () =>
      log
        ? {
            durationMinutes: log.duration_minutes
              ? String(log.duration_minutes)
              : '',
            note: log.note ?? '',
            occurredAt: log.occurred_at,
          }
        : null,
    [log],
  );

  if (logQuery.isPending || petsQuery.isPending) {
    return <LoadingView label={t('care.loading.edit')} />;
  }

  if (!log || !pet || log.performed_by !== user?.id || !initialValues) {
    return (
      <Screen contentContainerStyle={styles.empty}>
        <AppText tone="error">{t('care.errors.authorOnly')}</AppText>
        <AppButton label={t('common.back')} onPress={() => router.back()} />
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
        <AppText
          accessibilityRole="header"
          style={styles.headerTitle}
          variant="title1"
        >
          {t('care.edit.title')}
        </AppText>
      </View>
      <CareForm
        careType={log.care_type}
        initialValues={initialValues}
        onSubmit={async (values) => {
          setSubmitError(null);
          try {
            await updateCare.mutateAsync(values);
            showFeedback(t('care.edit.saved'));
            router.replace('/care');
          } catch (error) {
            logError('care-update', error);
            setSubmitError(t('care.errors.update'));
          }
        }}
        petName={pet.name}
        submitError={submitError}
        submitLabel={t('common.save')}
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
  headerTitle: { flex: 1 },
});

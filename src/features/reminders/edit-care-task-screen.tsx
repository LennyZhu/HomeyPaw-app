import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { getDateOnlyInZone } from '@/features/reminders/care-task-recurrence';
import { spacing } from '@/theme';
import type { CareTask } from '@/types/database';

import { useCareTask, useUpdateCareTask } from './care-task-queries';
import type { CareTaskFormValues } from './care-task-schema';
import { CareTaskForm } from './components/care-task-form';

function timeInZone(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone,
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.hour}:${values.minute}`;
}

function taskToValues(task: CareTask): CareTaskFormValues {
  const onceDate = task.scheduled_at
    ? getDateOnlyInZone(new Date(task.scheduled_at), task.time_zone)
    : '';
  return {
    careType:
      task.care_type === null || task.care_type === 'other'
        ? 'custom'
        : task.care_type,
    date: task.schedule_type === 'once' ? onceDate : (task.starts_on ?? ''),
    localTime:
      task.schedule_type === 'once' && task.scheduled_at
        ? timeInZone(task.scheduled_at, task.time_zone)
        : (task.local_time?.slice(0, 5) ?? ''),
    monthDay: String(task.month_day ?? 1),
    note: task.note ?? '',
    scheduleType: task.schedule_type,
    title: task.title,
    weekDay: String(task.week_day ?? 1),
  };
}

export default function EditCareTaskScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const taskQuery = useCareTask(id);
  const updateTask = useUpdateCareTask(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const initialValues = useMemo(
    () => (taskQuery.data ? taskToValues(taskQuery.data) : null),
    [taskQuery.data],
  );

  if (taskQuery.isPending) {
    return <LoadingView label={t('common.loading')} />;
  }

  if (!taskQuery.data || !initialValues) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('reminders.errors.notFound')}</AppText>
      </Screen>
    );
  }
  const task = taskQuery.data;

  const submit = async (values: CareTaskFormValues) => {
    setSubmitError(null);
    try {
      await updateTask.mutateAsync({
        timeZone: task.time_zone,
        values,
      });
      router.replace(`/reminders/${id}`);
    } catch {
      setSubmitError(t('reminders.errors.save'));
    }
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
            {t('reminders.edit.title')}
          </AppText>
          <AppText tone="secondary">{t('reminders.edit.subtitle')}</AppText>
        </View>
      </View>
      <CareTaskForm
        initialValues={initialValues}
        onSubmit={submit}
        submitError={submitError}
        submitLabel={t('common.save')}
        timeZone={task.time_zone}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.md },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
});

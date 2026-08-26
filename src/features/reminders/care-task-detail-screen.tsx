import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { careTypeIcons } from '@/features/care/care-types';
import { usePetMembers } from '@/features/family/family-queries';
import { usePet } from '@/features/pets/pet-queries';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatTaskDateTime,
  getCareTaskStatus,
  getScheduleLabel,
  taskKindLabel,
} from './care-task-display';
import {
  useCareTask,
  useCareTaskOccurrences,
  useCompleteCareTask,
  useDeactivateCareTask,
  useUndoCareTaskCompletion,
} from './care-task-queries';
import { getDateOnlyInZone } from './care-task-recurrence';
import type { CareTaskOccurrence } from './care-task-types';
import { TaskCompletionModal } from './components/task-completion-modal';

function occurrenceWindow(task: ReturnType<typeof useCareTask>['data']) {
  if (task?.schedule_type === 'once' && task.scheduled_at) {
    const scheduled = new Date(task.scheduled_at);
    return {
      end: new Date(scheduled.getTime() + 60_000),
      start: new Date(scheduled.getTime() - 60_000),
    };
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 34);
  return { end, start };
}

export default function CareTaskDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const taskQuery = useCareTask(id);
  const task = taskQuery.data;
  const window = useMemo(() => occurrenceWindow(task), [task]);
  const occurrencesQuery = useCareTaskOccurrences(
    task?.pet_id ?? null,
    window.start,
    window.end,
  );
  const petQuery = usePet(task?.pet_id ?? '');
  const membersQuery = usePetMembers(task?.pet_id ?? null);
  const deactivateTask = useDeactivateCareTask();
  const completeTask = useCompleteCareTask();
  const undoCompletion = useUndoCareTaskCompletion();
  const [completionTarget, setCompletionTarget] =
    useState<CareTaskOccurrence | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const occurrence = useMemo(() => {
    const candidates = (occurrencesQuery.data ?? []).filter(
      (item) => item.task_id === id,
    );
    if (!task) return null;
    const today = getDateOnlyInZone(new Date(), task.time_zone);
    return (
      candidates.find(
        (item) =>
          getDateOnlyInZone(new Date(item.scheduled_for), task.time_zone) ===
          today,
      ) ??
      candidates.find((item) => new Date(item.scheduled_for) > new Date()) ??
      candidates.at(-1) ??
      null
    );
  }, [id, occurrencesQuery.data, task]);

  if (taskQuery.isPending) {
    return <LoadingView label={t('common.loading')} />;
  }

  if (!task) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('reminders.errors.notFound')}</AppText>
      </Screen>
    );
  }

  const currentMembership = membersQuery.data?.find(
    (member) => member.userId === user?.id,
  );
  const canEdit =
    task.is_active &&
    (task.created_by === user?.id || currentMembership?.role === 'owner');
  const creator = membersQuery.data?.find(
    (member) => member.userId === task.created_by,
  );
  const status = occurrence ? getCareTaskStatus(occurrence, currentTime) : null;
  const canComplete = status === 'due' || status === 'overdue';

  const deactivate = () => {
    Alert.alert(
      t('reminders.deactivate.title'),
      t('reminders.deactivate.body'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          style: 'destructive',
          text: t('reminders.deactivate.action'),
          onPress: async () => {
            try {
              await deactivateTask.mutateAsync(task.id);
              router.replace('/reminders');
            } catch {
              showFeedback(t('reminders.errors.deactivate'), 'error');
            }
          },
        },
      ],
    );
  };

  const complete = async (
    input: {
      durationMinutes: number | null;
      note: string | null;
    },
    target = completionTarget,
  ) => {
    if (!target) return;
    try {
      await completeTask.mutateAsync({
        ...input,
        scheduledFor: target.scheduled_for,
        taskId: target.task_id,
      });
      setCompletionTarget(null);
    } catch {
      showFeedback(t('reminders.errors.complete'), 'error');
    }
  };

  const completeNow = () => {
    if (!occurrence) return;
    if (
      occurrence.care_type === 'feeding' ||
      occurrence.care_type === 'bath' ||
      occurrence.care_type === 'grooming'
    ) {
      void complete({ durationMinutes: null, note: null }, occurrence);
    } else {
      setCompletionTarget(occurrence);
    }
  };

  const undo = () => {
    if (!occurrence?.completion_id) return;
    Alert.alert(t('reminders.undo.title'), t('reminders.undo.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        style: 'destructive',
        text: t('reminders.undo.action'),
        onPress: async () => {
          try {
            await undoCompletion.mutateAsync(occurrence.completion_id!);
          } catch {
            showFeedback(t('reminders.errors.undo'), 'error');
          }
        },
      },
    ]);
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
            {task.title}
          </AppText>
          <AppText tone="secondary">{petQuery.data?.name}</AppText>
        </View>
        {canEdit ? (
          <IconButton
            accessibilityLabel={t('common.edit')}
            icon="settings-outline"
            onPress={() => router.push(`/reminders/${task.id}/edit` as Href)}
          />
        ) : null}
      </View>

      <View style={styles.hero}>
        <View style={styles.icon}>
          <Ionicons
            color={lightColors.secondary}
            name={careTypeIcons[task.care_type ?? 'other']}
            size={32}
          />
        </View>
        <AppText variant="title2">{taskKindLabel(task.care_type, t)}</AppText>
        {status ? (
          <View style={styles.status}>
            <AppText tone="brand" variant="footnote">
              {t(`reminders.status.${status}`)}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.details}>
        <DetailRow
          label={t('reminders.fields.repeat')}
          value={getScheduleLabel(task, i18n.language, t)}
        />
        <DetailRow
          label={t('reminders.fields.timeZone')}
          value={task.time_zone}
        />
        <DetailRow
          label={t('reminders.createdByLabel')}
          value={creator?.displayName ?? t('family.members.formerMember')}
        />
        {task.note ? (
          <DetailRow label={t('reminders.fields.note')} value={task.note} />
        ) : null}
        {occurrence?.completion_id ? (
          <DetailRow
            label={t('reminders.completedLabel')}
            value={t('reminders.completedBy', {
              name:
                occurrence.completer_display_name ??
                t('family.members.formerMember'),
              time: occurrence.completed_at
                ? formatTaskDateTime(
                    occurrence.completed_at,
                    occurrence.time_zone,
                    i18n.language,
                  )
                : '',
            })}
          />
        ) : occurrence ? (
          <DetailRow
            label={t('reminders.nextOccurrence')}
            value={formatTaskDateTime(
              occurrence.scheduled_for,
              occurrence.time_zone,
              i18n.language,
            )}
          />
        ) : null}
      </View>

      {canComplete ? (
        <AppButton
          label={t('reminders.complete.action')}
          loading={completeTask.isPending}
          onPress={completeNow}
        />
      ) : null}
      {occurrence?.completion_id && occurrence.can_undo ? (
        <AppButton
          label={t('reminders.undo.action')}
          loading={undoCompletion.isPending}
          onPress={undo}
          variant="secondary"
        />
      ) : null}
      {canEdit ? (
        <AppButton
          label={t('reminders.deactivate.action')}
          loading={deactivateTask.isPending}
          onPress={deactivate}
          variant="danger"
        />
      ) : null}

      {completionTarget && !completeTask.isPending ? (
        <TaskCompletionModal
          careType={completionTarget.care_type}
          isCompleting={completeTask.isPending}
          onClose={() => setCompletionTarget(null)}
          onComplete={complete}
          title={completionTarget.title}
          visible
        />
      ) : null}
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText tone="secondary" variant="footnote">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.md },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  icon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  status: {
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  details: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  detailRow: {
    gap: spacing.xs,
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
  },
});

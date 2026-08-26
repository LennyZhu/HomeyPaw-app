import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { careTypeIcons } from '@/features/care/care-types';
import { PetAvatar } from '@/features/pets/components/pet-avatar';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import {
  getCareTaskNotificationPermission,
  requestCareTaskNotificationPermission,
  syncCareTaskNotifications,
  type CareTaskNotificationPermission,
} from '@/services/care-task-notifications';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatTaskDayLabel,
  formatTaskTime,
  getCareTaskStatus,
  taskKindLabel,
} from './care-task-display';
import {
  useCareTaskOccurrences,
  useCompleteCareTask,
  useUndoCareTaskCompletion,
} from './care-task-queries';
import type { CareTaskOccurrence } from './care-task-types';
import { TaskCompletionModal } from './components/task-completion-modal';

function createOccurrenceWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 31);
  return { end, start, tomorrow };
}

export default function RemindersScreen() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const pet = petsState.currentPet;
  const [window, setWindow] = useState(createOccurrenceWindow);
  const occurrencesQuery = useCareTaskOccurrences(
    pet?.id ?? null,
    window.start,
    window.end,
  );
  const completeTask = useCompleteCareTask();
  const undoCompletion = useUndoCareTaskCompletion();
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [completionTarget, setCompletionTarget] =
    useState<CareTaskOccurrence | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [permission, setPermission] =
    useState<CareTaskNotificationPermission>('unsupported');

  useFocusEffect(
    useCallback(() => {
      let isFocused = true;

      const refreshPermission = () => {
        void getCareTaskNotificationPermission()
          .then((nextPermission) => {
            if (isFocused) setPermission(nextPermission);
          })
          .catch(() => {
            if (isFocused) setPermission('unsupported');
          });
      };

      setWindow(createOccurrenceWindow());
      refreshPermission();

      const subscription = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') refreshPermission();
      });

      return () => {
        isFocused = false;
        subscription.remove();
      };
    }, []),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      setWindow((current) =>
        now >= current.tomorrow ? createOccurrenceWindow() : current,
      );
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const occurrences = useMemo(
    () => occurrencesQuery.data ?? [],
    [occurrencesQuery.data],
  );
  const today = useMemo(
    () =>
      occurrences.filter((occurrence) => {
        const date = new Date(occurrence.scheduled_for);
        return date >= window.start && date < window.tomorrow;
      }),
    [occurrences, window.start, window.tomorrow],
  );
  const upcoming = useMemo(
    () =>
      occurrences.filter(
        (occurrence) =>
          !occurrence.completion_id &&
          new Date(occurrence.scheduled_for) >= window.tomorrow,
      ),
    [occurrences, window.tomorrow],
  );

  const complete = async (
    occurrence: CareTaskOccurrence,
    input: { durationMinutes: number | null; note: string | null } = {
      durationMinutes: null,
      note: null,
    },
  ) => {
    try {
      await completeTask.mutateAsync({
        ...input,
        scheduledFor: occurrence.scheduled_for,
        taskId: occurrence.task_id,
      });
      setCompletionTarget(null);
    } catch {
      showFeedback(t('reminders.errors.complete'), 'error');
    }
  };

  const beginCompletion = (occurrence: CareTaskOccurrence) => {
    if (
      occurrence.care_type === 'walk' ||
      occurrence.care_type === 'medicine' ||
      occurrence.care_type === 'other' ||
      !occurrence.care_type
    ) {
      setCompletionTarget(occurrence);
    } else {
      void complete(occurrence);
    }
  };

  const undo = (occurrence: CareTaskOccurrence) => {
    if (!occurrence.completion_id) return;
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

  const refresh = async () => {
    setWindow(createOccurrenceWindow());
    await Promise.all([occurrencesQuery.refetch(), petsState.refetch()]);
  };

  const enableNotifications = async () => {
    if (permission === 'denied') {
      await Linking.openSettings();
      return;
    }
    const nextPermission = await requestCareTaskNotificationPermission().catch(
      () => 'denied' as const,
    );
    setPermission(nextPermission);
    if (nextPermission === 'granted' && user) {
      void syncCareTaskNotifications(user.id).catch(() => undefined);
    }
  };

  return (
    <Screen
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          onRefresh={() => void refresh()}
          refreshing={occurrencesQuery.isRefetching}
          tintColor={lightColors.primary}
        />
      }
      scroll
    >
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <View style={styles.headerCopy}>
          <AppText accessibilityRole="header" variant="largeTitle">
            {t('reminders.title')}
          </AppText>
          <AppText tone="secondary">{t('reminders.subtitle')}</AppText>
        </View>
        <IconButton
          accessibilityLabel={t('reminders.add')}
          icon="add"
          onPress={() => router.push('/reminders/new')}
        />
      </View>

      {permission === 'denied' || permission === 'undetermined' ? (
        <View style={styles.permissionBanner}>
          <Ionicons
            color={lightColors.warning}
            name="notifications-off-outline"
            size={22}
          />
          <View style={styles.bannerCopy}>
            <AppText variant="headline">
              {t('reminders.permission.deniedTitle')}
            </AppText>
            <AppText tone="secondary" variant="footnote">
              {t('reminders.permission.deniedBody')}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void enableNotifications()}
          >
            <AppText tone="brand" variant="footnote">
              {permission === 'denied'
                ? t('reminders.permission.settings')
                : t('reminders.permission.allow')}
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {pet ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsSwitcherOpen(true)}
          style={({ pressed }) => [
            styles.petSelector,
            pressed && styles.pressed,
          ]}
        >
          <PetAvatar
            accessibilityLabel={pet.name}
            avatarPath={pet.avatar_path}
            name={pet.name}
            size={46}
          />
          <View style={styles.petCopy}>
            <AppText variant="headline">{pet.name}</AppText>
            <AppText tone="secondary" variant="footnote">
              {t('reminders.petFamily')}
            </AppText>
          </View>
          <Ionicons
            color={lightColors.textSecondary}
            name="chevron-down"
            size={20}
          />
        </Pressable>
      ) : null}

      {!pet && petsState.isSuccess ? (
        <EmptyState
          actionLabel={t('pets.empty.action')}
          body={t('care.empty.noPetBody')}
          icon="paw-outline"
          onActionPress={() => router.push('/pets/new')}
          title={t('care.empty.noPetTitle')}
        />
      ) : occurrencesQuery.isPending ? (
        <View style={styles.loadingCard}>
          <AppText tone="secondary">{t('common.loading')}</AppText>
        </View>
      ) : occurrencesQuery.isError ? (
        <View style={styles.loadingCard}>
          <AppText tone="error">{t('reminders.errors.load')}</AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => void occurrencesQuery.refetch()}
            variant="secondary"
          />
        </View>
      ) : (
        <>
          <TaskSection title={t('reminders.today')}>
            {today.length > 0 ? (
              today.map((occurrence) => (
                <OccurrenceCard
                  key={`${occurrence.task_id}-${occurrence.scheduled_for}`}
                  currentTime={currentTime}
                  locale={i18n.language}
                  occurrence={occurrence}
                  onComplete={() => beginCompletion(occurrence)}
                  onPress={() =>
                    router.push(`/reminders/${occurrence.task_id}` as Href)
                  }
                  onUndo={() => undo(occurrence)}
                />
              ))
            ) : (
              <AppText tone="secondary">{t('reminders.todayEmpty')}</AppText>
            )}
          </TaskSection>

          <TaskSection title={t('reminders.upcoming')}>
            {upcoming.length > 0 ? (
              upcoming.map((occurrence) => (
                <OccurrenceCard
                  key={`${occurrence.task_id}-${occurrence.scheduled_for}`}
                  currentTime={currentTime}
                  locale={i18n.language}
                  occurrence={occurrence}
                  onComplete={() => undefined}
                  onPress={() =>
                    router.push(`/reminders/${occurrence.task_id}` as Href)
                  }
                  onUndo={() => undefined}
                />
              ))
            ) : (
              <EmptyState
                actionLabel={t('reminders.add')}
                body={t('reminders.emptyBody')}
                icon="notifications-outline"
                onActionPress={() => router.push('/reminders/new')}
                title={t('reminders.emptyTitle')}
              />
            )}
          </TaskSection>
        </>
      )}

      <AppButton
        label={t('reminders.add')}
        onPress={() => router.push('/reminders/new')}
      />

      <PetSwitcherModal
        currentPetId={pet?.id ?? null}
        onAddPet={() => {
          setIsSwitcherOpen(false);
          router.push('/pets/new');
        }}
        onClose={() => setIsSwitcherOpen(false)}
        onSelectPet={(petId) => {
          petsState.setCurrentPetId(petId);
          setIsSwitcherOpen(false);
        }}
        pets={petsState.pets}
        visible={isSwitcherOpen}
      />

      {completionTarget ? (
        <TaskCompletionModal
          careType={completionTarget.care_type}
          isCompleting={completeTask.isPending}
          onClose={() => setCompletionTarget(null)}
          onComplete={(input) => complete(completionTarget, input)}
          title={completionTarget.title}
          visible
        />
      ) : null}
    </Screen>
  );
}

function TaskSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <AppText variant="title2">{title}</AppText>
      {children}
    </View>
  );
}

function OccurrenceCard({
  currentTime,
  locale,
  occurrence,
  onComplete,
  onPress,
  onUndo,
}: {
  currentTime: Date;
  locale: string;
  occurrence: CareTaskOccurrence;
  onComplete: () => void;
  onPress: () => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const status = getCareTaskStatus(occurrence, currentTime);
  const canComplete = status === 'due' || status === 'overdue';
  const dayLabel = formatTaskDayLabel(
    occurrence.scheduled_for,
    occurrence.time_zone,
    locale,
    t,
  );
  return (
    <View style={styles.taskCard}>
      <Pressable
        accessibilityLabel={t('reminders.rowAccessibility', {
          petName: occurrence.pet_name,
          status: t(`reminders.status.${status}`),
          time: `${dayLabel} ${formatTaskTime(
            occurrence.scheduled_for,
            occurrence.time_zone,
            locale,
          )}`,
          title: occurrence.title,
        })}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.taskMain, pressed && styles.pressed]}
      >
        <View style={styles.taskIcon}>
          <Ionicons
            color={lightColors.secondary}
            name={careTypeIcons[occurrence.care_type ?? 'other']}
            size={22}
          />
        </View>
        <View style={styles.taskCopy}>
          <View style={styles.taskTitleRow}>
            <AppText style={styles.taskTitle} variant="headline">
              {occurrence.title}
            </AppText>
            <View style={[styles.status, styles[`status_${status}`]]}>
              <AppText variant="caption">
                {t(`reminders.status.${status}`)}
              </AppText>
            </View>
          </View>
          <AppText tone="secondary" variant="footnote">
            {dayLabel} ·{' '}
            {formatTaskTime(
              occurrence.scheduled_for,
              occurrence.time_zone,
              locale,
            )}{' '}
            · {taskKindLabel(occurrence.care_type, t)}
          </AppText>
          <AppText tone="tertiary" variant="caption">
            {occurrence.completion_id
              ? t('reminders.completedBy', {
                  name:
                    occurrence.completer_display_name ??
                    t('family.members.formerMember'),
                  time: occurrence.completed_at
                    ? formatTaskTime(
                        occurrence.completed_at,
                        occurrence.time_zone,
                        locale,
                      )
                    : '',
                })
              : t('reminders.createdBy', {
                  name:
                    occurrence.creator_display_name ??
                    t('family.members.formerMember'),
                })}
          </AppText>
        </View>
      </Pressable>
      <View style={styles.taskActions}>
        {canComplete ? (
          <AppButton
            label={t('reminders.complete.action')}
            onPress={onComplete}
            style={styles.inlineButton}
            variant="secondary"
          />
        ) : null}
        {occurrence.completion_id && occurrence.can_undo ? (
          <AppButton
            label={t('reminders.undo.action')}
            onPress={onUndo}
            style={styles.inlineButton}
            variant="ghost"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.md },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  permissionBanner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: '#FFF4DD',
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  bannerCopy: { flex: 1, gap: spacing.xxs },
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
  section: { gap: spacing.md },
  loadingCard: { gap: spacing.md, paddingVertical: spacing.xl },
  taskCard: {
    gap: spacing.sm,
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  taskMain: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  taskIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  taskCopy: { flex: 1, gap: spacing.xs },
  taskActions: { alignItems: 'flex-start', marginLeft: 42 + spacing.md },
  taskTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  taskTitle: { flex: 1 },
  status: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  status_completed: { backgroundColor: lightColors.secondarySoft },
  status_due: { backgroundColor: lightColors.primarySoft },
  status_overdue: { backgroundColor: '#F9E7E7' },
  status_upcoming: { backgroundColor: lightColors.surfaceSecondary },
  inlineButton: { alignSelf: 'flex-start', marginTop: spacing.xs },
  pressed: { opacity: 0.68 },
});

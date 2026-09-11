import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import {
  type Href,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  FlatList,
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
import { getLocalDateOnly } from '@/features/care/care-date';
import { usePetMembers } from '@/features/family/family-queries';
import { PetAvatar } from '@/features/pets/components/pet-avatar';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { TaskCompletionModal } from '@/features/reminders/components/task-completion-modal';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatCalendarDate,
  getSixWeekCalendarRange,
  parseCalendarDate,
  shiftCalendarMonth,
  startOfCalendarMonth,
} from './calendar-date';
import {
  getScheduleRole,
  groupCareScheduleByAssignee,
  groupCareScheduleByShift,
  isCareShiftAlreadyClaimed,
  isScheduleAccessDenied,
  shouldExpandScheduleGroup,
  type CareScheduleAssigneeGroup,
  type CareScheduleShift,
} from './care-schedule-model';
import { isScheduleBackendUnavailable } from './care-schedule-api';
import {
  clearCareSchedulePetCache,
  useCareScheduleRange,
  useClaimCareShift,
  useCompleteCareShiftTask,
} from './care-schedule-queries';
import type { CareScheduleItem } from './care-schedule-types';
import { ScheduleAssigneeGroup } from './components/schedule-assignee-group';
import { ScheduleMonthCalendar } from './components/schedule-month-calendar';

function validInitialDate(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && parseCalendarDate(candidate)
    ? candidate
    : getLocalDateOnly();
}

export default function ScheduleScreen() {
  const { date } = useLocalSearchParams<{ date?: string | string[] }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const pet = petsState.currentPet;
  const petId = pet?.id ?? null;
  const [selectedDate, setSelectedDate] = useState(() =>
    validInitialDate(date),
  );
  const [month, setMonth] = useState(() => startOfCalendarMonth(selectedDate));
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [completionTarget, setCompletionTarget] =
    useState<CareScheduleItem | null>(null);
  const [groupExpansion, setGroupExpansion] = useState<Record<string, boolean>>(
    {},
  );
  const range = useMemo(() => getSixWeekCalendarRange(month), [month]);
  const scheduleQuery = useCareScheduleRange({
    endLocalDate: range.end,
    petId,
    startLocalDate: range.start,
  });
  const membersQuery = usePetMembers(petId);
  const refetchSchedule = scheduleQuery.refetch;
  const refetchMembers = membersQuery.refetch;
  const refetchPets = petsState.refetch;
  const claimShift = useClaimCareShift(petId ?? '');
  const completeTask = useCompleteCareShiftTask(petId ?? '');
  const role = getScheduleRole(membersQuery.data ?? [], user?.id);
  const selectedShifts = useMemo(
    () =>
      groupCareScheduleByShift(
        (scheduleQuery.data ?? []).filter(
          (item) => item.local_date === selectedDate,
        ),
      ),
    [scheduleQuery.data, selectedDate],
  );
  const selectedGroups = useMemo(
    () => groupCareScheduleByAssignee(selectedShifts),
    [selectedShifts],
  );

  const expansionKey = useCallback(
    (group: CareScheduleAssigneeGroup) =>
      `${petId ?? 'no-pet'}:${selectedDate}:${group.key}`,
    [petId, selectedDate],
  );
  const isGroupExpanded = useCallback(
    (group: CareScheduleAssigneeGroup) =>
      groupExpansion[expansionKey(group)] ?? shouldExpandScheduleGroup(group),
    [expansionKey, groupExpansion],
  );
  const toggleGroup = useCallback(
    (group: CareScheduleAssigneeGroup) => {
      const key = expansionKey(group);
      setGroupExpansion((current) => ({
        ...current,
        [key]: !(current[key] ?? shouldExpandScheduleGroup(group)),
      }));
    },
    [expansionKey],
  );

  const handleAccessLoss = useCallback(async () => {
    if (petId) {
      await clearCareSchedulePetCache(queryClient, user?.id, petId);
    }
    await refetchPets();
    showFeedback(t('schedule.errors.accessLost'), 'error');
    router.replace('/');
  }, [petId, queryClient, refetchPets, router, showFeedback, t, user?.id]);

  const refresh = useCallback(async () => {
    await Promise.all([refetchSchedule(), refetchMembers(), refetchPets()]);
  }, [refetchMembers, refetchPets, refetchSchedule]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (scheduleQuery.error && isScheduleAccessDenied(scheduleQuery.error)) {
      void handleAccessLoss();
    }
  }, [handleAccessLoss, scheduleQuery.error]);

  const moveMonth = (amount: number) => {
    const nextMonth = shiftCalendarMonth(month, amount);
    setMonth(nextMonth);
    setSelectedDate(nextMonth);
  };

  const claim = async (shift: CareScheduleShift) => {
    try {
      await claimShift.mutateAsync(shift.shiftId);
      showFeedback(t('schedule.feedback.claimed'));
    } catch (error) {
      if (isCareShiftAlreadyClaimed(error)) {
        await scheduleQuery.refetch();
        showFeedback(t('schedule.errors.alreadyClaimed'), 'info');
      } else if (isScheduleAccessDenied(error)) {
        await handleAccessLoss();
      } else {
        showFeedback(t('schedule.errors.claim'), 'error');
      }
    }
  };

  const complete = async (input: {
    durationMinutes: number | null;
    note: string | null;
  }) => {
    if (!completionTarget) return;
    try {
      await completeTask.mutateAsync({
        careLogId: Crypto.randomUUID(),
        completionDurationMinutes: input.durationMinutes,
        completionId: Crypto.randomUUID(),
        completionNote: input.note,
        shiftTaskId: completionTarget.shift_task_id,
      });
      setCompletionTarget(null);
      showFeedback(t('schedule.feedback.completed'));
    } catch (error) {
      if (isScheduleAccessDenied(error)) {
        await handleAccessLoss();
      } else {
        showFeedback(t('schedule.errors.complete'), 'error');
      }
    }
  };

  const header = (
    <View style={styles.headerContent}>
      <View style={styles.topBar}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <View style={styles.titleCopy}>
          <AppText
            accessibilityRole="header"
            maxFontSizeMultiplier={1.5}
            variant="largeTitle"
          >
            {t('schedule.title')}
          </AppText>
          <AppText maxFontSizeMultiplier={1.6} tone="secondary">
            {t('schedule.subtitle')}
          </AppText>
        </View>
      </View>

      {pet ? (
        <Pressable
          accessibilityLabel={t('home.changePet')}
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
            <AppText maxFontSizeMultiplier={1.5} variant="headline">
              {pet.name}
            </AppText>
            <AppText
              maxFontSizeMultiplier={1.5}
              tone="secondary"
              variant="footnote"
            >
              {t('schedule.petFamily')}
            </AppText>
          </View>
          <Ionicons
            color={lightColors.textSecondary}
            name="chevron-down"
            size={20}
          />
        </Pressable>
      ) : null}

      {pet ? (
        <View style={styles.calendarCard}>
          <ScheduleMonthCalendar
            fixedSixWeeks
            items={scheduleQuery.data ?? []}
            month={month}
            onNextMonth={() => moveMonth(1)}
            onPreviousMonth={() => moveMonth(-1)}
            onSelectDate={setSelectedDate}
            selectedDate={selectedDate}
            today={getLocalDateOnly()}
          />
        </View>
      ) : null}

      {pet ? (
        <View style={styles.dayHeading}>
          <View style={styles.dayHeadingCopy}>
            <AppText accessibilityRole="header" variant="title2">
              {formatCalendarDate(selectedDate, i18n.language)}
            </AppText>
            <AppText tone="secondary" variant="footnote">
              {t('schedule.dayItemCount', {
                count: selectedGroups.reduce(
                  (total, group) => total + group.items.length,
                  0,
                ),
              })}
            </AppText>
          </View>
          <AppButton
            label={t('schedule.add')}
            onPress={() =>
              router.push(
                `/schedule/new?date=${encodeURIComponent(selectedDate)}` as Href,
              )
            }
            style={styles.addButton}
            variant="secondary"
          />
        </View>
      ) : null}

      {scheduleQuery.isError && !isScheduleAccessDenied(scheduleQuery.error) ? (
        <View style={styles.errorState}>
          <AppText tone="error">
            {__DEV__ && isScheduleBackendUnavailable(scheduleQuery.error)
              ? t('schedule.errors.localBackendRequired')
              : t('schedule.errors.load')}
          </AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => void refresh()}
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen
      contentWidth="schedule"
      contentContainerStyle={styles.screenContent}
    >
      {!pet && petsState.isSuccess ? (
        <View style={styles.noPetWrap}>
          {header}
          <EmptyState
            actionLabel={t('pets.empty.action')}
            body={t('schedule.noPetBody')}
            icon="paw-outline"
            onActionPress={() => router.push('/pets/new')}
            title={t('schedule.noPetTitle')}
          />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={scheduleQuery.isError ? [] : selectedGroups}
          keyExtractor={(group) => group.key}
          ListEmptyComponent={
            scheduleQuery.isPending ? (
              <View
                accessibilityLabel={t('schedule.loading')}
                style={styles.loadingList}
              >
                {[0, 1].map((index) => (
                  <View key={index} style={styles.skeletonCard} />
                ))}
              </View>
            ) : !scheduleQuery.isError ? (
              <EmptyState
                actionLabel={t('schedule.add')}
                body={t('schedule.emptyDateBody')}
                icon="calendar-clear-outline"
                onActionPress={() =>
                  router.push(
                    `/schedule/new?date=${encodeURIComponent(selectedDate)}` as Href,
                  )
                }
                title={t('schedule.emptyDate')}
              />
            ) : null
          }
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl
              onRefresh={() => void refresh()}
              refreshing={
                scheduleQuery.isRefetching || membersQuery.isRefetching
              }
              tintColor={lightColors.primary}
            />
          }
          renderItem={({ item }) => (
            <ScheduleAssigneeGroup
              currentRole={role}
              currentUserId={user?.id}
              expanded={isGroupExpanded(item)}
              group={item}
              isClaimingShiftId={
                claimShift.isPending ? (claimShift.variables ?? null) : null
              }
              isCompletingId={
                completeTask.isPending
                  ? completeTask.variables?.shiftTaskId
                  : null
              }
              onClaim={(shift) => void claim(shift)}
              onComplete={setCompletionTarget}
              onEdit={(shift) =>
                router.push(
                  `/schedule/${encodeURIComponent(shift.shiftId)}/edit?date=${encodeURIComponent(shift.localDate)}` as Href,
                )
              }
              onToggle={() => toggleGroup(item)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}

      <PetSwitcherModal
        currentPetId={petId}
        onAddPet={() => {
          setIsSwitcherOpen(false);
          router.push('/pets/new');
        }}
        onClose={() => setIsSwitcherOpen(false)}
        onSelectPet={(nextPetId) => {
          petsState.setCurrentPetId(nextPetId);
          const today = getLocalDateOnly();
          setMonth(startOfCalendarMonth(today));
          setSelectedDate(today);
          setIsSwitcherOpen(false);
        }}
        pets={petsState.pets}
        visible={isSwitcherOpen}
      />

      {completionTarget ? (
        <TaskCompletionModal
          careType={completionTarget.task_care_type}
          isCompleting={completeTask.isPending}
          onClose={() => setCompletionTarget(null)}
          onComplete={complete}
          title={completionTarget.task_title}
          visible
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1 },
  listContent: { gap: spacing.md, paddingBottom: spacing.huge },
  headerContent: {
    gap: spacing.xl,
    paddingBottom: spacing.sm,
    paddingTop: spacing.md,
  },
  topBar: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  titleCopy: { flex: 1, gap: spacing.xs },
  petSelector: {
    minHeight: 70,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  petCopy: { flex: 1 },
  calendarCard: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  dayHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  dayHeadingCopy: { flex: 1, gap: spacing.xxs },
  addButton: { minHeight: 44, paddingHorizontal: spacing.md },
  errorState: { alignItems: 'flex-start', gap: spacing.md },
  loadingList: { gap: spacing.md },
  skeletonCard: {
    height: 148,
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.lg,
  },
  noPetWrap: { flex: 1, gap: spacing.xl, paddingTop: spacing.md },
  pressed: { opacity: 0.68 },
});

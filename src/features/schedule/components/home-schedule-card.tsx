import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatCalendarDate,
  formatScheduleTime,
  getCalendarMonthRange,
} from '../calendar-date';
import {
  groupCareScheduleByShift,
  isCareScheduleItemCompleted,
  isScheduleAccessDenied,
  type CareScheduleShift,
} from '../care-schedule-model';
import {
  clearCareSchedulePetCache,
  useCareScheduleRange,
} from '../care-schedule-queries';
import { ScheduleMonthCalendar } from './schedule-month-calendar';

const homeItemLimit = 6;

type Props = {
  onAccessLoss: () => void;
  petId: string;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  today: string;
};

export function HomeScheduleCard({
  onAccessLoss,
  petId,
  selectedDate,
  setSelectedDate,
  today,
}: Props) {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const previousPetId = useRef(petId);
  const range = useMemo(() => getCalendarMonthRange(today), [today]);
  const scheduleQuery = useCareScheduleRange({
    endLocalDate: range.end,
    petId,
    startLocalDate: range.start,
  });
  const refetchSchedule = scheduleQuery.refetch;
  const selectedShifts = useMemo(
    () =>
      groupCareScheduleByShift(
        (scheduleQuery.data ?? []).filter(
          (item) => item.local_date === selectedDate,
        ),
      ),
    [scheduleQuery.data, selectedDate],
  );
  const visibleShiftItems = useMemo(() => {
    return selectedShifts.reduce<{
      remaining: number;
      shifts: CareScheduleShift[];
    }>(
      (result, shift) => {
        const items = shift.items.slice(0, result.remaining);
        return {
          remaining: result.remaining - items.length,
          shifts:
            items.length > 0
              ? [...result.shifts, { ...shift, items }]
              : result.shifts,
        };
      },
      { remaining: homeItemLimit, shifts: [] },
    ).shifts;
  }, [selectedShifts]);
  const totalItems = selectedShifts.reduce(
    (count, shift) => count + shift.items.length,
    0,
  );

  useEffect(() => {
    const previous = previousPetId.current;
    if (previous !== petId) {
      void clearCareSchedulePetCache(queryClient, user?.id, previous);
      previousPetId.current = petId;
      setSelectedDate(today);
    }
  }, [petId, queryClient, setSelectedDate, today, user?.id]);

  useEffect(() => {
    if (scheduleQuery.error && isScheduleAccessDenied(scheduleQuery.error)) {
      void clearCareSchedulePetCache(queryClient, user?.id, petId);
      onAccessLoss();
    }
  }, [onAccessLoss, petId, queryClient, scheduleQuery.error, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void refetchSchedule();
    }, [refetchSchedule]),
  );

  const openSchedule = (date = selectedDate) =>
    router.push(`/schedule?date=${encodeURIComponent(date)}` as Href);

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText variant="title2">{t('schedule.title')}</AppText>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => openSchedule()}
          style={styles.seeAll}
        >
          <AppText tone="brand" variant="footnote">
            {t('schedule.seeAll')}
          </AppText>
        </Pressable>
      </View>

      <View style={styles.calendarCard}>
        <ScheduleMonthCalendar
          items={scheduleQuery.data ?? []}
          month={range.start}
          onSelectDate={setSelectedDate}
          selectedDate={selectedDate}
          today={today}
        />

        <View style={styles.summaryDivider} />
        <AppText accessibilityRole="header" variant="headline">
          {formatCalendarDate(selectedDate, i18n.language)}
        </AppText>

        {scheduleQuery.isPending ? (
          <View
            accessibilityLabel={t('schedule.loading')}
            style={styles.loading}
          >
            <View style={[styles.skeleton, styles.skeletonTitle]} />
            <View style={[styles.skeleton, styles.skeletonLine]} />
          </View>
        ) : scheduleQuery.isError ? (
          <View style={styles.messageState}>
            <AppText tone="error">{t('schedule.errors.load')}</AppText>
            <AppButton
              label={t('common.retry')}
              onPress={() => void scheduleQuery.refetch()}
              variant="secondary"
            />
          </View>
        ) : visibleShiftItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              color={lightColors.textTertiary}
              name="calendar-clear-outline"
              size={22}
            />
            <AppText tone="secondary">{t('schedule.emptyDate')}</AppText>
          </View>
        ) : (
          <View style={styles.shiftList}>
            {visibleShiftItems.map((shift) => {
              const name = !shift.assigneeUserId
                ? t('schedule.unassigned')
                : (shift.assigneeDisplayName ??
                  t('family.members.formerMember'));
              return (
                <View key={shift.shiftId} style={styles.shiftSummary}>
                  <View style={styles.shiftHeading}>
                    <View style={styles.avatar}>
                      {!shift.assigneeUserId ? (
                        <Ionicons
                          color={lightColors.warning}
                          name="hand-left-outline"
                          size={16}
                        />
                      ) : (
                        <AppText variant="caption">
                          {name.trim().charAt(0).toUpperCase() || '?'}
                        </AppText>
                      )}
                    </View>
                    <AppText style={styles.shiftName} variant="headline">
                      {name}
                    </AppText>
                  </View>
                  {shift.items.map((item) => {
                    const completed = isCareScheduleItemCompleted(item);
                    const canceled =
                      shift.status === 'canceled' ||
                      item.shift_task_status === 'canceled';
                    return (
                      <View key={item.shift_task_id} style={styles.itemRow}>
                        <AppText style={styles.time} variant="subheadline">
                          {formatScheduleTime(
                            item.source_scheduled_for,
                            item.task_time_zone,
                            i18n.language,
                          )}
                        </AppText>
                        <AppText
                          numberOfLines={2}
                          style={[
                            styles.taskTitle,
                            canceled && styles.canceled,
                          ]}
                          variant="subheadline"
                        >
                          {item.task_title}
                        </AppText>
                        <View style={styles.state}>
                          <Ionicons
                            color={
                              canceled
                                ? lightColors.textTertiary
                                : completed
                                  ? lightColors.success
                                  : lightColors.warning
                            }
                            name={
                              canceled
                                ? 'close-circle-outline'
                                : completed
                                  ? 'checkmark-circle'
                                  : 'time-outline'
                            }
                            size={15}
                          />
                          <AppText
                            tone={
                              completed && !canceled ? 'success' : 'secondary'
                            }
                            variant="caption"
                          >
                            {t(
                              `schedule.status.${
                                canceled
                                  ? 'canceled'
                                  : completed
                                    ? 'completed'
                                    : 'pending'
                              }`,
                            )}
                          </AppText>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}

        {totalItems > homeItemLimit ? (
          <AppButton
            label={t('schedule.remainingItems', {
              count: totalItems - homeItemLimit,
            })}
            onPress={() => openSchedule()}
            variant="ghost"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md, marginTop: spacing.xxxl },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  seeAll: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
  calendarCard: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.md,
  },
  summaryDivider: {
    backgroundColor: lightColors.border,
    height: StyleSheet.hairlineWidth,
  },
  loading: { gap: spacing.sm, paddingVertical: spacing.md },
  skeleton: {
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.sm,
  },
  skeletonTitle: { height: 18, width: '48%' },
  skeletonLine: { height: 54, width: '100%' },
  messageState: { alignItems: 'flex-start', gap: spacing.md },
  emptyState: {
    minHeight: 64,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  shiftList: { gap: spacing.lg },
  shiftSummary: { gap: spacing.sm },
  shiftHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  avatar: {
    width: 30,
    height: 30,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  shiftName: { flex: 1 },
  itemRow: {
    minHeight: 44,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingLeft: spacing.xs,
  },
  time: { fontVariant: ['tabular-nums'], fontWeight: '600', minWidth: 48 },
  taskTitle: { flex: 1 },
  canceled: { textDecorationLine: 'line-through' },
  state: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/features/auth/auth-context';
import { lightColors, radius, spacing } from '@/theme';

import {
  formatCalendarDate,
  formatScheduleTime,
  getCalendarMonthRange,
} from '../calendar-date';
import {
  groupCareScheduleByAssignee,
  groupCareScheduleByShift,
  isCareScheduleItemCompleted,
  isScheduleAccessDenied,
  truncateCareScheduleGroups,
} from '../care-schedule-model';
import {
  clearCareSchedulePetCache,
  useCareScheduleRange,
} from '../care-schedule-queries';
import { isScheduleBackendUnavailable } from '../care-schedule-api';
import { ScheduleMonthCalendar } from './schedule-month-calendar';

const homeItemLimit = 4;

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
  const selectedGroups = useMemo(
    () => groupCareScheduleByAssignee(selectedShifts),
    [selectedShifts],
  );
  const homeSummary = useMemo(() => {
    return truncateCareScheduleGroups(selectedGroups, homeItemLimit);
  }, [selectedGroups]);

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
        <AppText style={styles.headingTitle} variant="title2">
          {t('schedule.title')}
        </AppText>
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
          fixedSixWeeks
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
            <AppText tone="error">
              {__DEV__ && isScheduleBackendUnavailable(scheduleQuery.error)
                ? t('schedule.errors.localBackendRequired')
                : t('schedule.errors.load')}
            </AppText>
            <AppButton
              label={t('common.retry')}
              onPress={() => void scheduleQuery.refetch()}
              variant="secondary"
            />
          </View>
        ) : homeSummary.visibleGroups.length === 0 ? (
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
            {homeSummary.visibleGroups.map((group) => {
              const name = !group.assigneeUserId
                ? t('schedule.unassigned')
                : (group.assigneeDisplayName ??
                  t('family.members.formerMember'));
              return (
                <View key={group.key} style={styles.shiftSummary}>
                  <View style={styles.shiftHeading}>
                    {!group.assigneeUserId ? (
                      <View style={[styles.avatar, styles.unassignedAvatar]}>
                        <Ionicons
                          color={lightColors.warning}
                          name="hand-left-outline"
                          size={16}
                        />
                      </View>
                    ) : (
                      <Avatar
                        accessibilityLabel={name}
                        name={name}
                        size={30}
                        source={
                          group.assigneeAvatarUrl
                            ? { uri: group.assigneeAvatarUrl }
                            : undefined
                        }
                      />
                    )}
                    <AppText style={styles.shiftName} variant="headline">
                      {name}
                    </AppText>
                  </View>
                  {group.items.map((item) => {
                    const completed = isCareScheduleItemCompleted(item);
                    const canceled =
                      item.shift_status === 'canceled' ||
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
                        <View style={styles.taskCopy}>
                          <AppText
                            numberOfLines={2}
                            style={canceled && styles.canceled}
                            variant="subheadline"
                          >
                            {item.task_title}
                          </AppText>
                          {completed ? (
                            <AppText
                              numberOfLines={1}
                              tone="tertiary"
                              variant="caption"
                            >
                              {t('schedule.completedBy', {
                                name:
                                  item.completer_display_name ??
                                  t('family.members.formerMember'),
                              })}
                            </AppText>
                          ) : null}
                        </View>
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

        {homeSummary.hiddenCount > 0 ? (
          <Pressable
            accessibilityLabel={`${t('schedule.overflowCount', {
              count: homeSummary.hiddenCount,
            })}. ${t('schedule.seeAll')}`}
            accessibilityRole="button"
            onPress={() => openSchedule()}
            style={({ pressed }) => [
              styles.overflowAction,
              pressed && styles.pressed,
            ]}
          >
            <AppText style={styles.overflowCopy} tone="secondary">
              {t('schedule.overflowCount', {
                count: homeSummary.hiddenCount,
              })}
            </AppText>
            <View style={styles.overflowLink}>
              <AppText tone="brand" variant="headline">
                {t('schedule.seeAll')}
              </AppText>
              <Ionicons
                color={lightColors.primary}
                name="chevron-forward"
                size={18}
              />
            </View>
          </Pressable>
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
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headingTitle: { flex: 1 },
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
  unassignedAvatar: {
    backgroundColor: '#FFF4DD',
    borderColor: lightColors.warning,
    borderWidth: StyleSheet.hairlineWidth,
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
  taskCopy: { flex: 1, gap: spacing.xxs },
  canceled: { textDecorationLine: 'line-through' },
  state: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  overflowAction: {
    minHeight: 52,
    alignItems: 'center',
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  overflowCopy: { flex: 1 },
  overflowLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  pressed: { opacity: 0.66 },
});

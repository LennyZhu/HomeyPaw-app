import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { IconButton } from '@/components/icon-button';
import { lightColors, radius, spacing } from '@/theme';

import {
  buildCalendarMonth,
  formatCalendarDate,
  formatCalendarMonth,
  getCalendarWeekdayLabels,
} from '../calendar-date';
import {
  scheduleItemsByDate,
  summarizeScheduleDay,
} from '../care-schedule-model';
import type { CareScheduleItem } from '../care-schedule-types';

type Props = {
  fixedSixWeeks?: boolean;
  items: CareScheduleItem[];
  month: string;
  onNextMonth?: (() => void) | undefined;
  onPreviousMonth?: (() => void) | undefined;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  today: string;
};

export function ScheduleMonthCalendar({
  fixedSixWeeks = false,
  items,
  month,
  onNextMonth,
  onPreviousMonth,
  onSelectDate,
  selectedDate,
  today,
}: Props) {
  const { i18n, t } = useTranslation();
  const cells = buildCalendarMonth(month, { fixedSixWeeks });
  const weekdays = getCalendarWeekdayLabels(i18n.language);
  const itemsByDate = scheduleItemsByDate(items);

  return (
    <View style={styles.calendar}>
      <View style={styles.monthHeader}>
        <AppText
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          style={styles.monthTitle}
          variant="title3"
        >
          {formatCalendarMonth(month, i18n.language)}
        </AppText>
        {onPreviousMonth && onNextMonth ? (
          <View style={styles.monthActions}>
            <IconButton
              accessibilityLabel={t('schedule.previousMonth')}
              icon="chevron-back"
              onPress={onPreviousMonth}
            />
            <IconButton
              accessibilityLabel={t('schedule.nextMonth')}
              icon="chevron-forward"
              onPress={onNextMonth}
            />
          </View>
        ) : null}
      </View>

      <View accessibilityRole="header" style={styles.weekdays}>
        {weekdays.map((weekday, index) => (
          <View key={`${weekday}-${index}`} style={styles.weekdayCell}>
            <AppText
              maxFontSizeMultiplier={1.4}
              tone="tertiary"
              variant="caption"
            >
              {weekday}
            </AppText>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell) => {
          const summary = summarizeScheduleDay(itemsByDate[cell.date] ?? []);
          const isSelected = selectedDate === cell.date;
          const isToday = today === cell.date;
          const overflow = Math.max(summary.members.length - 2, 0);
          const disabled = !cell.inMonth;
          const accessibilityLabel = t('schedule.calendar.dateAccessibility', {
            completedCount: summary.completedCount,
            date: formatCalendarDate(cell.date, i18n.language),
            itemCount: summary.itemCount,
            memberCount: summary.memberIds.length,
            today: isToday ? t('schedule.calendar.todaySuffix') : '',
            unassignedCount: summary.unassignedCount,
          });

          return (
            <View key={cell.date} style={styles.cellFrame}>
              <Pressable
                accessibilityLabel={accessibilityLabel}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected: isSelected }}
                disabled={disabled}
                hitSlop={2}
                onPress={() => onSelectDate(cell.date)}
                style={({ pressed }) => [
                  styles.cell,
                  isSelected && styles.selectedCell,
                  disabled && styles.disabledCell,
                  pressed && styles.pressedCell,
                ]}
              >
                <AppText
                  maxFontSizeMultiplier={1.35}
                  style={[
                    styles.dayNumber,
                    isToday && styles.todayNumber,
                    isSelected && styles.selectedNumber,
                    !cell.inMonth && styles.outsideNumber,
                  ]}
                  variant="footnote"
                >
                  {cell.day}
                </AppText>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.markerArea}
                >
                  <View style={styles.memberCluster}>
                    {summary.members.slice(0, 2).map((member, index) => (
                      <View
                        key={member.userId}
                        style={[
                          styles.avatarRing,
                          index > 0 && styles.overlapAvatar,
                          isSelected && styles.selectedAvatarRing,
                        ]}
                      >
                        <Avatar
                          accessibilityLabel={member.displayName ?? ''}
                          name={member.displayName ?? ''}
                          size={18}
                          source={
                            member.avatarUrl
                              ? { uri: member.avatarUrl }
                              : undefined
                          }
                        />
                      </View>
                    ))}
                    {overflow > 0 ? (
                      <AppText
                        allowFontScaling
                        maxFontSizeMultiplier={1.15}
                        style={styles.overflowCount}
                        variant="caption"
                      >
                        +{overflow}
                      </AppText>
                    ) : null}
                  </View>
                  {summary.unassignedCount > 0 ? (
                    <View style={styles.unassignedMarker}>
                      <Ionicons
                        color={lightColors.warning}
                        name="hand-left-outline"
                        size={10}
                      />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: spacing.sm },
  monthHeader: {
    minHeight: 48,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monthTitle: { flex: 1 },
  monthActions: { flexDirection: 'row', gap: spacing.xs },
  weekdays: { flexDirection: 'row' },
  weekdayCell: { alignItems: 'center', width: `${100 / 7}%` },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellFrame: { padding: 2, width: `${100 / 7}%` },
  cell: {
    height: 58,
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 2,
    gap: 2,
    justifyContent: 'center',
    paddingHorizontal: 1,
    paddingVertical: 3,
  },
  selectedCell: {
    backgroundColor: lightColors.primarySoft,
    borderColor: lightColors.primary,
  },
  disabledCell: { opacity: 0.3 },
  pressedCell: { opacity: 0.62 },
  dayNumber: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  todayNumber: { textDecorationLine: 'underline' },
  selectedNumber: { color: lightColors.primary, fontWeight: '700' },
  outsideNumber: { color: lightColors.textTertiary },
  markerArea: {
    width: '100%',
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  memberCluster: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  avatarRing: {
    borderColor: lightColors.surface,
    borderRadius: radius.full,
    borderWidth: 1.5,
  },
  overlapAvatar: { marginLeft: -4 },
  selectedAvatarRing: {
    borderColor: lightColors.primary,
  },
  overflowCount: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
    marginLeft: 1,
  },
  unassignedMarker: {
    width: 14,
    height: 14,
    alignItems: 'center',
    backgroundColor: '#FFF4DD',
    borderColor: lightColors.warning,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: -22,
  },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
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
            <AppText tone="tertiary" variant="caption">
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
          const overflow = Math.max(summary.memberIds.length - 2, 0);
          const disabled = !cell.inMonth && !fixedSixWeeks;
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
                  isToday && styles.todayCell,
                  isSelected && styles.selectedCell,
                  disabled && styles.disabledCell,
                  pressed && styles.pressedCell,
                ]}
              >
                <AppText
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
                {summary.itemCount > 0 ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.markers}
                  >
                    {summary.memberIds.slice(0, 2).map((memberId, index) => (
                      <View
                        key={memberId}
                        style={[
                          styles.memberMarker,
                          index === 1 && styles.overlapMarker,
                          isSelected && styles.selectedMarker,
                        ]}
                      />
                    ))}
                    {overflow > 0 ? (
                      <AppText
                        style={isSelected && styles.selectedMarkerText}
                        variant="caption"
                      >
                        +{overflow}
                      </AppText>
                    ) : null}
                    {summary.unassignedCount > 0 ? (
                      <Ionicons
                        color={
                          isSelected
                            ? lightColors.onPrimary
                            : lightColors.warning
                        }
                        name="hand-left-outline"
                        size={11}
                      />
                    ) : null}
                    {summary.completedCount > 0 ? (
                      <Ionicons
                        color={
                          isSelected
                            ? lightColors.onPrimary
                            : lightColors.success
                        }
                        name="checkmark-circle"
                        size={11}
                      />
                    ) : null}
                  </View>
                ) : null}
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
    minHeight: 52,
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 2,
    gap: 2,
    justifyContent: 'center',
    paddingHorizontal: 1,
    paddingVertical: 3,
  },
  todayCell: { borderColor: lightColors.secondary },
  selectedCell: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  disabledCell: { opacity: 0.3 },
  pressedCell: { opacity: 0.62 },
  dayNumber: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  todayNumber: { textDecorationLine: 'underline' },
  selectedNumber: { color: lightColors.onPrimary },
  outsideNumber: { color: lightColors.textTertiary },
  markers: {
    minHeight: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  memberMarker: {
    width: 9,
    height: 9,
    backgroundColor: lightColors.secondary,
    borderColor: lightColors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  overlapMarker: { marginLeft: -2 },
  selectedMarker: {
    backgroundColor: lightColors.onPrimary,
    borderColor: lightColors.primary,
  },
  selectedMarkerText: { color: lightColors.onPrimary },
});

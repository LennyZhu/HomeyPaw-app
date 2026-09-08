import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { careTypeIcons } from '@/features/care/care-types';
import type { CareTaskOccurrence } from '@/features/reminders/care-task-types';
import { lightColors, radius, spacing } from '@/theme';

import { formatScheduleTime } from '../calendar-date';

export function occurrenceKey(
  occurrence: Pick<CareTaskOccurrence, 'scheduled_for' | 'task_id'>,
) {
  return `${occurrence.task_id}|${occurrence.scheduled_for}`;
}

type Props = {
  assignedKeys: Set<string>;
  occurrences: CareTaskOccurrence[];
  onToggle: (occurrence: CareTaskOccurrence) => void;
  selectedKeys: Set<string>;
};

export function CareTaskOccurrencePicker({
  assignedKeys,
  occurrences,
  onToggle,
  selectedKeys,
}: Props) {
  const { i18n, t } = useTranslation();

  if (occurrences.length === 0) {
    return (
      <AppText tone="secondary">{t('schedule.form.noOccurrences')}</AppText>
    );
  }

  return (
    <View style={styles.list}>
      {occurrences.map((occurrence) => {
        const key = occurrenceKey(occurrence);
        const assigned = assignedKeys.has(key);
        const completed = Boolean(occurrence.completion_id);
        const disabled = assigned || completed;
        const selected = selectedKeys.has(key);
        return (
          <Pressable
            accessibilityLabel={t('schedule.form.occurrenceAccessibility', {
              state: assigned
                ? t('schedule.scheduled')
                : completed
                  ? t('schedule.completed')
                  : selected
                    ? t('schedule.form.selected')
                    : t('schedule.form.available'),
              time: formatScheduleTime(
                occurrence.scheduled_for,
                occurrence.time_zone,
                i18n.language,
              ),
              title: occurrence.title,
            })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            key={key}
            onPress={() => onToggle(occurrence)}
            style={({ pressed }) => [
              styles.row,
              selected && styles.selectedRow,
              disabled && styles.disabledRow,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.check, selected && styles.selectedCheck]}>
              {selected ? (
                <Ionicons
                  color={lightColors.onPrimary}
                  name="checkmark"
                  size={17}
                />
              ) : disabled ? (
                <Ionicons
                  color={lightColors.textTertiary}
                  name={completed ? 'checkmark-circle' : 'lock-closed-outline'}
                  size={17}
                />
              ) : null}
            </View>
            <View style={styles.timeIcon}>
              <Ionicons
                color={lightColors.secondary}
                name={careTypeIcons[occurrence.care_type ?? 'other']}
                size={20}
              />
              <AppText style={styles.time} variant="footnote">
                {formatScheduleTime(
                  occurrence.scheduled_for,
                  occurrence.time_zone,
                  i18n.language,
                )}
              </AppText>
            </View>
            <View style={styles.copy}>
              <AppText variant="headline">{occurrence.title}</AppText>
              {disabled ? (
                <AppText tone="tertiary" variant="footnote">
                  {completed
                    ? t('schedule.completed')
                    : t('schedule.scheduled')}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    minHeight: 64,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  selectedRow: { borderColor: lightColors.primary, borderWidth: 2 },
  disabledRow: { opacity: 0.55 },
  pressed: { opacity: 0.68 },
  check: {
    width: 28,
    height: 28,
    alignItems: 'center',
    borderColor: lightColors.border,
    borderRadius: radius.sm,
    borderWidth: 2,
    justifyContent: 'center',
  },
  selectedCheck: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  timeIcon: { alignItems: 'center', gap: spacing.xxs, minWidth: 46 },
  time: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  copy: { flex: 1, gap: spacing.xxs },
});

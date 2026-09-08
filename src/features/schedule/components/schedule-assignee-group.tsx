import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import type { PetMemberSummary } from '@/features/family/family-queries';
import { lightColors, radius, spacing } from '@/theme';

import type {
  CareScheduleAssigneeGroup,
  CareScheduleShift,
} from '../care-schedule-model';
import type { CareScheduleItem } from '../care-schedule-types';
import { ScheduleShiftCard } from './schedule-shift-card';

type Props = {
  currentRole: PetMemberSummary['role'] | null;
  currentUserId: string | undefined;
  expanded: boolean;
  group: CareScheduleAssigneeGroup;
  isClaimingShiftId: string | null;
  isCompletingId: string | null;
  onClaim: (shift: CareScheduleShift) => void;
  onComplete: (item: CareScheduleItem) => void;
  onEdit: (shift: CareScheduleShift) => void;
  onToggle: () => void;
};

export function ScheduleAssigneeGroup({
  currentRole,
  currentUserId,
  expanded,
  group,
  isClaimingShiftId,
  isCompletingId,
  onClaim,
  onComplete,
  onEdit,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const isUnassigned = group.assigneeUserId === null;
  const name = isUnassigned
    ? t('schedule.unassigned')
    : (group.assigneeDisplayName ?? t('family.members.formerMember'));
  const statusSummary = [
    group.pendingCount > 0
      ? t('schedule.groupStatusCount', {
          count: group.pendingCount,
          status: t('schedule.pending'),
        })
      : null,
    group.completedCount > 0
      ? t('schedule.groupStatusCount', {
          count: group.completedCount,
          status: t('schedule.completed'),
        })
      : null,
    group.canceledCount > 0
      ? t('schedule.groupStatusCount', {
          count: group.canceledCount,
          status: t('schedule.canceled'),
        })
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(t('schedule.groupStatusSeparator'));

  return (
    <View style={styles.group}>
      <Pressable
        accessibilityLabel={`${name}, ${t('schedule.groupItemCount', {
          count: group.items.length,
        })}. ${statusSummary}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        {isUnassigned ? (
          <View style={styles.unassignedAvatar}>
            <Ionicons
              color={lightColors.warning}
              name="hand-left-outline"
              size={20}
            />
          </View>
        ) : (
          <Avatar
            accessibilityLabel={name}
            name={name}
            size={42}
            source={
              group.assigneeAvatarUrl
                ? { uri: group.assigneeAvatarUrl }
                : undefined
            }
          />
        )}
        <View style={styles.headerCopy}>
          <View style={styles.nameRow}>
            <AppText
              maxFontSizeMultiplier={1.6}
              numberOfLines={2}
              style={styles.name}
              variant="headline"
            >
              {name}
            </AppText>
            <AppText
              maxFontSizeMultiplier={1.6}
              tone="secondary"
              variant="footnote"
            >
              {t('schedule.groupItemCount', { count: group.items.length })}
            </AppText>
          </View>
          <AppText
            maxFontSizeMultiplier={1.6}
            numberOfLines={2}
            tone="secondary"
            variant="footnote"
          >
            {statusSummary}
          </AppText>
        </View>
        <Ionicons
          color={lightColors.textSecondary}
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={20}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.shifts}>
          {group.shifts.map((shift, index) => (
            <View key={shift.shiftId} style={index > 0 && styles.shiftDivider}>
              <ScheduleShiftCard
                currentRole={currentRole}
                currentUserId={currentUserId}
                embedded
                isClaiming={isClaimingShiftId === shift.shiftId}
                isCompletingId={isCompletingId}
                onClaim={onClaim}
                onComplete={onComplete}
                onEdit={onEdit}
                shift={shift}
                showAssigneeHeader={false}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  header: {
    minHeight: 72,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  unassignedAvatar: {
    width: 42,
    height: 42,
    alignItems: 'center',
    backgroundColor: '#FFF4DD',
    borderColor: lightColors.warning,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, gap: spacing.xxs },
  nameRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  name: { flexShrink: 1 },
  shifts: {
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  shiftDivider: {
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.66 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import type { PetMemberSummary } from '@/features/family/family-queries';
import { lightColors, radius, spacing } from '@/theme';

import { formatScheduleTime } from '../calendar-date';
import {
  canCompleteCareScheduleItem,
  canManageCareShift,
  isCareScheduleItemCompleted,
  isCareScheduleItemMutable,
  type CareScheduleShift,
} from '../care-schedule-model';
import type { CareScheduleItem } from '../care-schedule-types';

type Props = {
  currentRole: PetMemberSummary['role'] | null;
  currentUserId: string | undefined;
  isClaiming?: boolean;
  isCompletingId?: string | null;
  onClaim: (shift: CareScheduleShift) => void;
  onComplete: (item: CareScheduleItem) => void;
  onEdit: (shift: CareScheduleShift) => void;
  shift: CareScheduleShift;
};

export function ScheduleShiftCard({
  currentRole,
  currentUserId,
  isClaiming = false,
  isCompletingId = null,
  onClaim,
  onComplete,
  onEdit,
  shift,
}: Props) {
  const { i18n, t } = useTranslation();
  const isUnassigned = !shift.assigneeUserId;
  const assigneeName = isUnassigned
    ? t('schedule.unassigned')
    : (shift.assigneeDisplayName ?? t('family.members.formerMember'));
  const hasMutableItem = shift.items.some((item) =>
    isCareScheduleItemMutable(item),
  );
  const canManage =
    canManageCareShift(shift, currentRole, currentUserId) && hasMutableItem;
  const canClaim =
    isUnassigned &&
    shift.status === 'scheduled' &&
    hasMutableItem &&
    (currentRole === 'owner' || currentRole === 'member');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.avatar, isUnassigned && styles.unassignedAvatar]}>
          {isUnassigned ? (
            <Ionicons
              color={lightColors.warning}
              name="hand-left-outline"
              size={20}
            />
          ) : (
            <AppText variant="headline">
              {assigneeName.trim().charAt(0).toUpperCase() || '?'}
            </AppText>
          )}
        </View>
        <View style={styles.headerCopy}>
          <AppText style={styles.assigneeName} variant="headline">
            {assigneeName}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {shift.status === 'canceled'
              ? t('schedule.canceled')
              : isUnassigned
                ? t('schedule.claimable')
                : shift.claimedAt
                  ? t('schedule.claimed')
                  : t('schedule.assigned')}
          </AppText>
        </View>
        {canManage ? (
          <AppButton
            label={t('schedule.edit')}
            onPress={() => onEdit(shift)}
            style={styles.smallAction}
            variant="ghost"
          />
        ) : null}
      </View>

      {shift.note ? (
        <View style={styles.note}>
          <Ionicons
            color={lightColors.textTertiary}
            name="document-text-outline"
            size={16}
          />
          <AppText style={styles.noteCopy} tone="secondary" variant="footnote">
            {shift.note}
          </AppText>
        </View>
      ) : null}

      <View style={styles.items}>
        {shift.items.map((item) => {
          const completed = isCareScheduleItemCompleted(item);
          const canceled =
            shift.status === 'canceled' ||
            item.shift_task_status === 'canceled';
          const canComplete =
            (currentRole === 'owner' || currentRole === 'member') &&
            canCompleteCareScheduleItem(item);
          const state = canceled
            ? 'canceled'
            : completed
              ? 'completed'
              : 'pending';

          return (
            <View key={item.shift_task_id} style={styles.itemRow}>
              <View style={styles.timeBlock}>
                <AppText style={styles.time} variant="subheadline">
                  {formatScheduleTime(
                    item.source_scheduled_for,
                    item.task_time_zone,
                    i18n.language,
                  )}
                </AppText>
                <Ionicons
                  color={
                    state === 'completed'
                      ? lightColors.success
                      : state === 'canceled'
                        ? lightColors.textTertiary
                        : lightColors.secondary
                  }
                  name={
                    state === 'completed'
                      ? 'checkmark-circle'
                      : state === 'canceled'
                        ? 'close-circle-outline'
                        : 'time-outline'
                  }
                  size={18}
                />
              </View>
              <View style={styles.itemCopy}>
                <AppText
                  style={canceled && styles.canceledText}
                  variant="headline"
                >
                  {item.task_title}
                </AppText>
                <AppText
                  tone={state === 'completed' ? 'success' : 'secondary'}
                  variant="footnote"
                >
                  {t(`schedule.status.${state}`)}
                </AppText>
                {completed ? (
                  <AppText tone="tertiary" variant="caption">
                    {canceled
                      ? t('schedule.status.completedOutsideSchedule', {
                          name:
                            item.completer_display_name ??
                            t('family.members.formerMember'),
                        })
                      : t('schedule.completedBy', {
                          name:
                            item.completer_display_name ??
                            t('family.members.formerMember'),
                        })}
                  </AppText>
                ) : null}
              </View>
              {canComplete ? (
                <AppButton
                  label={t('schedule.complete')}
                  loading={isCompletingId === item.shift_task_id}
                  onPress={() => onComplete(item)}
                  style={styles.completeAction}
                  variant="secondary"
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {canClaim ? (
        <AppButton
          icon={
            <Ionicons
              color={lightColors.onPrimary}
              name="hand-left-outline"
              size={20}
            />
          }
          label={t('schedule.claim')}
          loading={isClaiming}
          onPress={() => onClaim(shift)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.lg,
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
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
  headerCopy: { flex: 1, gap: spacing.xxs },
  assigneeName: { flexShrink: 1 },
  smallAction: { minHeight: 44, paddingHorizontal: spacing.md },
  note: {
    alignItems: 'flex-start',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noteCopy: { flex: 1 },
  items: { gap: spacing.xs },
  itemRow: {
    minHeight: 68,
    alignItems: 'center',
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  timeBlock: { alignItems: 'center', gap: spacing.xs, minWidth: 52 },
  time: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  itemCopy: { flex: 1, gap: spacing.xxs },
  canceledText: { textDecorationLine: 'line-through' },
  completeAction: { minHeight: 44, paddingHorizontal: spacing.md },
});

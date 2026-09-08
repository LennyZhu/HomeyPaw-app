import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import {
  type Href,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { usePetMembers } from '@/features/family/family-queries';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { useCareTaskOccurrences } from '@/features/reminders/care-task-queries';
import type { CareTaskOccurrence } from '@/features/reminders/care-task-types';
import { lightColors, radius, spacing, typography } from '@/theme';

import {
  addCalendarDays,
  formatCalendarDate,
  formatScheduleTime,
  getLocalDateInTimeZone,
  getOccurrenceSearchWindow,
  parseCalendarDate,
} from './calendar-date';
import {
  canManageCareShift,
  getScheduleRole,
  groupCareScheduleByShift,
  isCareScheduleItemCompleted,
  isCareScheduleItemMutable,
  isScheduleAccessDenied,
} from './care-schedule-model';
import {
  clearCareSchedulePetCache,
  useAddCareShiftTasks,
  useCancelCareShift,
  useCancelCareShiftTask,
  useCareScheduleRange,
  useUpdateCareShift,
} from './care-schedule-queries';
import {
  CareTaskOccurrencePicker,
  occurrenceKey,
} from './components/care-task-occurrence-picker';

export default function EditScheduleScreen() {
  const params = useLocalSearchParams<{
    date?: string | string[];
    id?: string | string[];
  }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const petId = petsState.currentPetId;
  const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
  const date = dateParam && parseCalendarDate(dateParam) ? dateParam : null;
  const shiftId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rangeQuery = useCareScheduleRange({
    endLocalDate: date ? addCalendarDays(date, 1) : '1970-01-02',
    petId: date ? petId : null,
    startLocalDate: date ?? '1970-01-01',
  });
  const membersQuery = usePetMembers(petId);
  const role = getScheduleRole(membersQuery.data ?? [], user?.id);
  const shift = useMemo(
    () =>
      groupCareScheduleByShift(rangeQuery.data ?? []).find(
        (candidate) => candidate.shiftId === shiftId,
      ) ?? null,
    [rangeQuery.data, shiftId],
  );
  const [noteOverride, setNoteOverride] = useState<string | null>(null);
  const [assigneeOverride, setAssigneeOverride] = useState<
    string | null | undefined
  >(undefined);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const occurrenceWindow = useMemo(
    () => getOccurrenceSearchWindow(date ?? '1970-01-01'),
    [date],
  );
  const occurrencesQuery = useCareTaskOccurrences(
    date ? petId : null,
    occurrenceWindow.start,
    occurrenceWindow.end,
  );
  const refetchRange = rangeQuery.refetch;
  const refetchMembers = membersQuery.refetch;
  const refetchOccurrences = occurrencesQuery.refetch;
  const refetchPets = petsState.refetch;
  const updateShift = useUpdateCareShift(petId ?? '');
  const addTasks = useAddCareShiftTasks(petId ?? '');
  const cancelTask = useCancelCareShiftTask(petId ?? '');
  const cancelShift = useCancelCareShift(petId ?? '');
  const currentMembers = useMemo(
    () =>
      (membersQuery.data ?? []).filter(
        (member) => member.role === 'owner' || member.role === 'member',
      ),
    [membersQuery.data],
  );
  const occurrences = useMemo(
    () =>
      (occurrencesQuery.data ?? []).filter(
        (occurrence) =>
          occurrence.is_active &&
          date &&
          getLocalDateInTimeZone(
            occurrence.scheduled_for,
            occurrence.time_zone,
          ) === date,
      ),
    [date, occurrencesQuery.data],
  );
  const assignedKeys = useMemo(
    () =>
      new Set(
        (rangeQuery.data ?? []).map(
          (item) => `${item.care_task_id}|${item.source_scheduled_for}`,
        ),
      ),
    [rangeQuery.data],
  );
  const selectedOccurrences = occurrences.filter((occurrence) =>
    selectedKeys.has(occurrenceKey(occurrence)),
  );
  const note = noteOverride ?? shift?.note ?? '';
  const assigneeUserId =
    assigneeOverride === undefined
      ? (shift?.assigneeUserId ?? null)
      : assigneeOverride;
  const canManage = Boolean(
    shift &&
    shift.items.some((item) => isCareScheduleItemMutable(item)) &&
    canManageCareShift(shift, role, user?.id),
  );

  const handleAccessLoss = useCallback(async () => {
    if (petId) {
      await clearCareSchedulePetCache(queryClient, user?.id, petId);
    }
    await refetchPets();
    showFeedback(t('schedule.errors.accessLost'), 'error');
    router.replace('/');
  }, [petId, queryClient, refetchPets, router, showFeedback, t, user?.id]);

  useEffect(() => {
    const error =
      rangeQuery.error ?? membersQuery.error ?? occurrencesQuery.error;
    if (error && isScheduleAccessDenied(error)) void handleAccessLoss();
  }, [
    handleAccessLoss,
    membersQuery.error,
    occurrencesQuery.error,
    rangeQuery.error,
  ]);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        refetchRange(),
        refetchMembers(),
        refetchOccurrences(),
      ]);
    }, [refetchMembers, refetchOccurrences, refetchRange]),
  );

  const handleMutationError = async (error: unknown, fallback: string) => {
    if (isScheduleAccessDenied(error)) await handleAccessLoss();
    else showFeedback(fallback, 'error');
  };

  const saveDetails = async () => {
    if (!shift) return;
    try {
      await updateShift.mutateAsync({
        assigneeUserId: role === 'member' ? user!.id : assigneeUserId,
        note: note.trim() || null,
        shiftId: shift.shiftId,
      });
      showFeedback(t('schedule.feedback.updated'));
    } catch (error) {
      await handleMutationError(error, t('schedule.errors.save'));
    }
  };

  const addSelected = async () => {
    if (!shift || selectedOccurrences.length === 0) return;
    try {
      await addTasks.mutateAsync({
        shiftId: shift.shiftId,
        taskItems: selectedOccurrences.map((occurrence) => ({
          care_task_id: occurrence.task_id,
          source_scheduled_for: occurrence.scheduled_for,
        })),
      });
      setSelectedKeys(new Set());
      showFeedback(t('schedule.feedback.itemsAdded'));
    } catch (error) {
      await handleMutationError(error, t('schedule.errors.save'));
    }
  };

  const cancelItem = (shiftTaskId: string) => {
    Alert.alert(t('schedule.cancelItem.title'), t('schedule.cancelItem.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        style: 'destructive',
        text: t('schedule.cancelItem.action'),
        onPress: async () => {
          try {
            await cancelTask.mutateAsync(shiftTaskId);
            showFeedback(t('schedule.feedback.itemCanceled'));
          } catch (error) {
            await handleMutationError(error, t('schedule.errors.cancel'));
          }
        },
      },
    ]);
  };

  const cancelEntireShift = () => {
    if (!shift) return;
    Alert.alert(
      t('schedule.cancelShift.title'),
      t('schedule.cancelShift.body'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          style: 'destructive',
          text: t('schedule.cancelShift.action'),
          onPress: async () => {
            try {
              await cancelShift.mutateAsync(shift.shiftId);
              showFeedback(t('schedule.feedback.canceled'));
              router.replace(
                `/schedule?date=${encodeURIComponent(date ?? '')}` as Href,
              );
            } catch (error) {
              await handleMutationError(error, t('schedule.errors.cancel'));
            }
          },
        },
      ],
    );
  };

  const toggleOccurrence = (occurrence: CareTaskOccurrence) => {
    const key = occurrenceKey(occurrence);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
            {t('schedule.edit')}
          </AppText>
          {date ? (
            <AppText tone="secondary">
              {formatCalendarDate(date, i18n.language)}
            </AppText>
          ) : null}
        </View>
      </View>

      {rangeQuery.isPending || membersQuery.isPending ? (
        <AppText tone="secondary">{t('schedule.loading')}</AppText>
      ) : !date || !shift || !canManage ? (
        <View style={styles.errorState}>
          <AppText tone="error">{t('schedule.errors.notMutable')}</AppText>
          <AppButton
            label={t('common.back')}
            onPress={() => router.back()}
            variant="secondary"
          />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <AppText variant="title2">{t('schedule.form.details')}</AppText>
            {role === 'owner' ? (
              <View style={styles.field}>
                <AppText variant="subheadline">
                  {t('schedule.form.assignee')}
                </AppText>
                <View accessibilityRole="radiogroup" style={styles.chips}>
                  <AssigneeChip
                    label={t('schedule.unassigned')}
                    onPress={() => setAssigneeOverride(null)}
                    selected={assigneeUserId === null}
                  />
                  {currentMembers.map((member) => (
                    <AssigneeChip
                      key={member.userId}
                      label={member.displayName}
                      onPress={() => setAssigneeOverride(member.userId)}
                      selected={assigneeUserId === member.userId}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.fixedAssignee}>
                <Ionicons
                  color={lightColors.secondary}
                  name="person-circle-outline"
                  size={22}
                />
                <AppText>{t('schedule.form.assignedToSelf')}</AppText>
              </View>
            )}
            <View style={styles.field}>
              <AppText variant="subheadline">{t('schedule.form.note')}</AppText>
              <TextInput
                accessibilityLabel={t('schedule.form.note')}
                maxLength={300}
                multiline
                onChangeText={setNoteOverride}
                placeholder={t('schedule.form.notePlaceholder')}
                placeholderTextColor={lightColors.textTertiary}
                style={styles.noteInput}
                textAlignVertical="top"
                value={note}
              />
            </View>
            <AppButton
              label={t('common.save')}
              loading={updateShift.isPending}
              onPress={() => void saveDetails()}
            />
          </View>

          <View style={styles.section}>
            <AppText variant="title2">
              {t('schedule.form.currentTasks')}
            </AppText>
            {shift.items.map((item) => {
              const completed = isCareScheduleItemCompleted(item);
              const canceled = item.shift_task_status === 'canceled';
              const mutable = isCareScheduleItemMutable(item);
              return (
                <View key={item.shift_task_id} style={styles.currentItem}>
                  <View style={styles.itemCopy}>
                    <AppText variant="headline">{item.task_title}</AppText>
                    <AppText tone="secondary" variant="footnote">
                      {formatScheduleTime(
                        item.source_scheduled_for,
                        item.task_time_zone,
                        i18n.language,
                      )}{' '}
                      ·{' '}
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
                  {mutable ? (
                    <AppButton
                      label={t('schedule.cancelItem.action')}
                      onPress={() => cancelItem(item.shift_task_id)}
                      style={styles.itemAction}
                      variant="ghost"
                    />
                  ) : (
                    <Ionicons
                      color={
                        completed
                          ? lightColors.success
                          : lightColors.textTertiary
                      }
                      name={completed ? 'lock-closed' : 'close-circle-outline'}
                      size={20}
                    />
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <AppText style={styles.sectionTitle} variant="title2">
                {t('schedule.form.addTasks')}
              </AppText>
              <AppButton
                label={t('schedule.addCareTask')}
                onPress={() =>
                  router.push({
                    pathname: '/reminders/new',
                    params: {
                      date,
                      petId: petId ?? '',
                      returnTo: `/schedule/${shift.shiftId}/edit?date=${date}`,
                    },
                  } as Href)
                }
                style={styles.itemAction}
                variant="ghost"
              />
            </View>
            <CareTaskOccurrencePicker
              assignedKeys={assignedKeys}
              occurrences={occurrences}
              onToggle={toggleOccurrence}
              selectedKeys={selectedKeys}
            />
            <AppButton
              disabled={selectedOccurrences.length === 0}
              label={t('schedule.form.addSelected')}
              loading={addTasks.isPending}
              onPress={() => void addSelected()}
              variant="secondary"
            />
          </View>

          <View style={styles.dangerSection}>
            <AppText variant="title2">
              {t('schedule.cancelShift.title')}
            </AppText>
            <AppText tone="secondary">{t('schedule.cancelShift.body')}</AppText>
            <AppButton
              label={t('schedule.cancelShift.action')}
              loading={cancelShift.isPending}
              onPress={cancelEntireShift}
              variant="danger"
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function AssigneeChip({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selectedChip,
        pressed && styles.pressed,
      ]}
    >
      {selected ? (
        <Ionicons color={lightColors.onPrimary} name="checkmark" size={16} />
      ) : null}
      <AppText tone={selected ? 'onPrimary' : 'primary'} variant="subheadline">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingTop: spacing.md },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  errorState: { alignItems: 'flex-start', gap: spacing.md },
  section: { gap: spacing.lg },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  sectionTitle: { flex: 1 },
  field: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 48,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  selectedChip: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  fixedAssignee: {
    minHeight: 52,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noteInput: {
    minHeight: 112,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    color: lightColors.textPrimary,
    padding: spacing.lg,
    ...typography.body,
  },
  currentItem: {
    minHeight: 68,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  itemCopy: { flex: 1, gap: spacing.xxs },
  itemAction: { minHeight: 44, paddingHorizontal: spacing.md },
  dangerSection: {
    backgroundColor: '#FBEAEA',
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.lg,
  },
  pressed: { opacity: 0.68 },
});

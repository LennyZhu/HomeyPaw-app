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
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
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
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { useCareTaskOccurrences } from '@/features/reminders/care-task-queries';
import type { CareTaskOccurrence } from '@/features/reminders/care-task-types';
import { lightColors, radius, spacing, typography } from '@/theme';

import {
  addCalendarDays,
  formatCalendarDate,
  getLocalDateInTimeZone,
  getOccurrenceSearchWindow,
  parseCalendarDate,
} from './calendar-date';
import { getScheduleRole, isScheduleAccessDenied } from './care-schedule-model';
import {
  clearCareSchedulePetCache,
  useCareScheduleRange,
  useCreateCareShift,
} from './care-schedule-queries';
import {
  CareTaskOccurrencePicker,
  occurrenceKey,
} from './components/care-task-occurrence-picker';
import { ScheduleDateField } from './components/schedule-date-field';

function initialDate(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && parseCalendarDate(candidate)
    ? candidate
    : getLocalDateOnly();
}

export default function NewScheduleScreen() {
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const pet = petsState.currentPet;
  const petId = pet?.id ?? null;
  const [date, setDate] = useState(() => initialDate(params.date));
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(
    user?.id ?? null,
  );
  const [note, setNote] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const membersQuery = usePetMembers(petId);
  const role = getScheduleRole(membersQuery.data ?? [], user?.id);
  const occurrenceWindow = useMemo(
    () => getOccurrenceSearchWindow(date),
    [date],
  );
  const occurrencesQuery = useCareTaskOccurrences(
    petId,
    occurrenceWindow.start,
    occurrenceWindow.end,
  );
  const assignedQuery = useCareScheduleRange({
    endLocalDate: addCalendarDays(date, 1),
    petId,
    startLocalDate: date,
  });
  const refetchOccurrences = occurrencesQuery.refetch;
  const refetchAssigned = assignedQuery.refetch;
  const refetchMembers = membersQuery.refetch;
  const refetchPets = petsState.refetch;
  const createShift = useCreateCareShift(petId ?? '');
  const occurrences = useMemo(
    () =>
      (occurrencesQuery.data ?? []).filter(
        (occurrence) =>
          occurrence.is_active &&
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
        (assignedQuery.data ?? []).map(
          (item) => `${item.care_task_id}|${item.source_scheduled_for}`,
        ),
      ),
    [assignedQuery.data],
  );
  const selectedOccurrences = useMemo(
    () =>
      occurrences.filter((occurrence) =>
        selectedKeys.has(occurrenceKey(occurrence)),
      ),
    [occurrences, selectedKeys],
  );
  const currentMembers = useMemo(
    () =>
      (membersQuery.data ?? []).filter(
        (member) => member.role === 'owner' || member.role === 'member',
      ),
    [membersQuery.data],
  );
  const dateError =
    !parseCalendarDate(date) || date < getLocalDateOnly()
      ? t('schedule.form.dateInvalid')
      : undefined;

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
      occurrencesQuery.error ?? assignedQuery.error ?? membersQuery.error;
    if (error && isScheduleAccessDenied(error)) void handleAccessLoss();
  }, [
    assignedQuery.error,
    handleAccessLoss,
    membersQuery.error,
    occurrencesQuery.error,
  ]);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        refetchOccurrences(),
        refetchAssigned(),
        refetchMembers(),
      ]);
    }, [refetchAssigned, refetchMembers, refetchOccurrences]),
  );

  const toggleOccurrence = (occurrence: CareTaskOccurrence) => {
    const key = occurrenceKey(occurrence);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async () => {
    if (!petId || dateError || selectedOccurrences.length === 0) return;
    setSubmitError(null);
    try {
      await createShift.mutateAsync({
        assigneeUserId: role === 'member' ? user!.id : assigneeUserId,
        localDate: date,
        note: note.trim() || null,
        petId,
        shiftId: Crypto.randomUUID(),
        taskItems: selectedOccurrences.map((occurrence) => ({
          care_task_id: occurrence.task_id,
          source_scheduled_for: occurrence.scheduled_for,
        })),
      });
      showFeedback(t('schedule.feedback.created'));
      router.replace(`/schedule?date=${encodeURIComponent(date)}` as Href);
    } catch (error) {
      if (isScheduleAccessDenied(error)) await handleAccessLoss();
      else setSubmitError(t('schedule.errors.save'));
    }
  };

  if (!pet && petsState.isSuccess) {
    return (
      <Screen contentContainerStyle={styles.content} scroll>
        <ScreenHeader onBack={() => router.back()} title={t('schedule.add')} />
        <EmptyState
          actionLabel={t('pets.empty.action')}
          body={t('schedule.noPetBody')}
          icon="paw-outline"
          onActionPress={() => router.push('/pets/new')}
          title={t('schedule.noPetTitle')}
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <ScreenHeader onBack={() => router.back()} title={t('schedule.add')} />
      <AppText tone="secondary">{t('schedule.form.createSubtitle')}</AppText>

      <ScheduleDateField
        error={dateError}
        label={t('schedule.form.date')}
        onChange={(value) => {
          setDate(value);
          setSelectedKeys(new Set());
        }}
        value={date}
      />

      <View style={styles.field}>
        <AppText variant="subheadline">{t('schedule.form.assignee')}</AppText>
        {role === 'member' ? (
          <View style={styles.fixedAssignee}>
            <Ionicons
              color={lightColors.secondary}
              name="person-circle-outline"
              size={22}
            />
            <AppText>{t('schedule.form.assignedToSelf')}</AppText>
          </View>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.chips}>
            <AssigneeChip
              label={t('schedule.unassigned')}
              onPress={() => setAssigneeUserId(null)}
              selected={assigneeUserId === null}
            />
            {currentMembers.map((member) => (
              <AssigneeChip
                key={member.userId}
                label={member.displayName}
                onPress={() => setAssigneeUserId(member.userId)}
                selected={assigneeUserId === member.userId}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.field}>
        <View style={styles.fieldHeading}>
          <View style={styles.fieldHeadingCopy}>
            <AppText variant="subheadline">{t('schedule.form.tasks')}</AppText>
            <AppText tone="secondary" variant="footnote">
              {formatCalendarDate(date, i18n.language)}
            </AppText>
          </View>
          <AppButton
            label={t('schedule.addCareTask')}
            onPress={() =>
              router.push({
                pathname: '/reminders/new',
                params: {
                  date,
                  petId: petId ?? '',
                  returnTo: `/schedule/new?date=${date}`,
                },
              } as Href)
            }
            style={styles.addTaskButton}
            variant="ghost"
          />
        </View>
        {occurrencesQuery.isPending || assignedQuery.isPending ? (
          <AppText tone="secondary">{t('schedule.loadingOccurrences')}</AppText>
        ) : occurrencesQuery.isError || assignedQuery.isError ? (
          <View style={styles.errorState}>
            <AppText tone="error">{t('schedule.errors.occurrences')}</AppText>
            <AppButton
              label={t('common.retry')}
              onPress={() =>
                void Promise.all([
                  occurrencesQuery.refetch(),
                  assignedQuery.refetch(),
                ])
              }
              variant="secondary"
            />
          </View>
        ) : (
          <CareTaskOccurrencePicker
            assignedKeys={assignedKeys}
            occurrences={occurrences}
            onToggle={toggleOccurrence}
            selectedKeys={selectedKeys}
          />
        )}
      </View>

      <View style={styles.field}>
        <AppText variant="subheadline">{t('schedule.form.note')}</AppText>
        <TextInput
          accessibilityLabel={t('schedule.form.note')}
          maxLength={300}
          multiline
          onChangeText={setNote}
          placeholder={t('schedule.form.notePlaceholder')}
          placeholderTextColor={lightColors.textTertiary}
          style={styles.noteInput}
          textAlignVertical="top"
          value={note}
        />
      </View>

      {submitError ? <AppText tone="error">{submitError}</AppText> : null}
      <AppButton
        disabled={Boolean(dateError) || selectedOccurrences.length === 0}
        label={t('schedule.form.create')}
        loading={createShift.isPending}
        onPress={() => void submit()}
      />
    </Screen>
  );
}

function ScreenHeader({
  onBack,
  title,
}: {
  onBack: () => void;
  title: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <IconButton
        accessibilityLabel={t('common.back')}
        icon="chevron-back"
        onPress={onBack}
      />
      <AppText
        accessibilityRole="header"
        style={styles.headerTitle}
        variant="largeTitle"
      >
        {title}
      </AppText>
    </View>
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
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerTitle: { flex: 1 },
  field: { gap: spacing.sm },
  fixedAssignee: {
    minHeight: 52,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
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
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  selectedChip: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  pressed: { opacity: 0.68 },
  fieldHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  fieldHeadingCopy: { flex: 1, gap: spacing.xxs },
  addTaskButton: { minHeight: 44, paddingHorizontal: spacing.md },
  errorState: { alignItems: 'flex-start', gap: spacing.md },
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
});

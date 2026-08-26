import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { careKeys } from '@/features/care/care-queries';
import { useAuth } from '@/features/auth/auth-context';
import { getDeviceTimeZone } from '@/features/care/care-date';
import { requireSupabase } from '@/lib/supabase/client';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import type { CareTask } from '@/types/database';

import { localDateTimeToInstant } from './care-task-recurrence';
import type { CareTaskFormValues } from './care-task-schema';
import type { CareTaskCompletionResult } from './care-task-types';
import { fetchCareTaskOccurrences } from './care-task-api';

export const careTaskKeys = {
  all: (userId: string | undefined) => ['care-tasks', userId] as const,
  detail: (userId: string | undefined, taskId: string) =>
    ['care-tasks', userId, 'detail', taskId] as const,
  occurrences: (
    userId: string | undefined,
    petId: string | null,
    windowStart: string,
    windowEnd: string,
  ) =>
    [
      'care-tasks',
      userId,
      'occurrences',
      petId,
      windowStart,
      windowEnd,
    ] as const,
};

function valuesToTaskRpc(values: CareTaskFormValues, timeZone: string) {
  const isOnce = values.scheduleType === 'once';
  const scheduledAt = isOnce
    ? localDateTimeToInstant(values.date, values.localTime, timeZone)
    : null;
  if (isOnce && !scheduledAt) throw new Error('INVALID_LOCAL_TASK_TIME');

  return {
    task_care_type: values.careType === 'custom' ? null : values.careType,
    task_local_time: isOnce ? null : `${values.localTime}:00`,
    task_month_day:
      values.scheduleType === 'monthly' ? Number(values.monthDay) : null,
    task_note: values.note.trim() || null,
    task_schedule_type: values.scheduleType,
    task_scheduled_at: scheduledAt?.toISOString() ?? null,
    task_starts_on: isOnce ? null : values.date,
    task_time_zone: timeZone,
    task_title: values.title.trim(),
    task_week_day:
      values.scheduleType === 'weekly' ? Number(values.weekDay) : null,
  };
}

async function fetchCareTask(taskId: string) {
  const { data, error } = await requireSupabase()
    .from('care_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createCareTask(input: {
  petId: string;
  taskId: string;
  timeZone?: string;
  values: CareTaskFormValues;
}) {
  const { data, error } = await requireSupabase().rpc('create_care_task', {
    target_pet_id: input.petId,
    task_id: input.taskId,
    ...valuesToTaskRpc(input.values, input.timeZone ?? getDeviceTimeZone()),
  });
  if (error) throw error;
  return data;
}

async function updateCareTask(input: {
  taskId: string;
  timeZone: string;
  values: CareTaskFormValues;
}) {
  const { data, error } = await requireSupabase().rpc('update_care_task', {
    target_task_id: input.taskId,
    ...valuesToTaskRpc(input.values, input.timeZone),
  });
  if (error) throw error;
  return data;
}

async function deactivateCareTask(taskId: string) {
  const { data, error } = await requireSupabase().rpc('deactivate_care_task', {
    target_task_id: taskId,
  });
  if (error) throw error;
  return data;
}

async function completeCareTask(input: {
  durationMinutes?: number | null;
  note?: string | null;
  scheduledFor: string;
  taskId: string;
}) {
  const { data, error } = await requireSupabase().rpc('complete_care_task', {
    care_log_id: Crypto.randomUUID(),
    completion_duration_minutes: input.durationMinutes ?? null,
    completion_id: Crypto.randomUUID(),
    completion_note: input.note?.trim() || null,
    occurrence_scheduled_for: input.scheduledFor,
    target_task_id: input.taskId,
  });
  if (error || !data[0]) throw error ?? new Error('TASK_COMPLETE_FAILED');
  return data[0];
}

async function undoCareTaskCompletion(completionId: string) {
  const { data, error } = await requireSupabase().rpc(
    'undo_care_task_completion',
    { target_completion_id: completionId },
  );
  if (error) throw error;
  if (data !== 'undone') throw new Error('TASK_UNDO_NOT_APPLIED');
  return data;
}

export function useCareTaskOccurrences(
  petId: string | null,
  windowStart: Date,
  windowEnd: Date,
) {
  const { user } = useAuth();
  const start = windowStart.toISOString();
  const end = windowEnd.toISOString();
  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchCareTaskOccurrences({ petId, windowEnd, windowStart }),
    queryKey: careTaskKeys.occurrences(user?.id, petId, start, end),
  });
}

export function useCareTask(taskId: string) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && taskId),
    queryFn: () => fetchCareTask(taskId),
    queryKey: careTaskKeys.detail(user?.id, taskId),
  });
}

function useInvalidateCareTasks() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: careTaskKeys.all(user?.id) }),
      queryClient.invalidateQueries({ queryKey: careKeys.all(user?.id) }),
    ]);
    if (user) {
      void syncCareTaskNotifications(user.id).catch(() => undefined);
    }
  };
}

export function useCreateCareTask() {
  const invalidate = useInvalidateCareTasks();
  return useMutation({ mutationFn: createCareTask, onSuccess: invalidate });
}

export function useUpdateCareTask(taskId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCareTasks();
  return useMutation({
    mutationFn: (input: { timeZone: string; values: CareTaskFormValues }) =>
      updateCareTask({ taskId, ...input }),
    onSuccess: async (task) => {
      queryClient.setQueryData<CareTask>(
        careTaskKeys.detail(user?.id, taskId),
        task,
      );
      await invalidate();
    },
  });
}

export function useDeactivateCareTask() {
  const invalidate = useInvalidateCareTasks();
  return useMutation({ mutationFn: deactivateCareTask, onSuccess: invalidate });
}

export function useCompleteCareTask() {
  const invalidate = useInvalidateCareTasks();
  return useMutation<
    CareTaskCompletionResult,
    Error,
    Parameters<typeof completeCareTask>[0]
  >({
    mutationFn: completeCareTask,
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => undefined,
      );
      await invalidate();
    },
  });
}

export function useUndoCareTaskCompletion() {
  const invalidate = useInvalidateCareTasks();
  return useMutation({
    mutationFn: undoCareTaskCompletion,
    onSuccess: invalidate,
  });
}

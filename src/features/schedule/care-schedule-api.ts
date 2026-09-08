import { requireSupabase } from '@/lib/supabase/client';

import type {
  CareScheduleItem,
  CareShiftTaskInput,
  CompleteCareShiftTaskInput,
} from './care-schedule-types';

export async function fetchCareScheduleRange(input: {
  endLocalDate: string;
  petId: string;
  startLocalDate: string;
}): Promise<CareScheduleItem[]> {
  const { data, error } = await requireSupabase().rpc(
    'get_care_schedule_range',
    {
      range_end: input.endLocalDate,
      range_start: input.startLocalDate,
      target_pet_id: input.petId,
    },
  );
  if (error) throw error;
  return data;
}

export async function createCareShift(input: {
  assigneeUserId: string | null;
  localDate: string;
  note?: string | null;
  petId: string;
  shiftId: string;
  taskItems: CareShiftTaskInput[];
}) {
  const { data, error } = await requireSupabase().rpc('create_care_shift', {
    shift_id: input.shiftId,
    shift_local_date: input.localDate,
    shift_note: input.note ?? null,
    target_assignee_user_id: input.assigneeUserId,
    target_pet_id: input.petId,
    task_items: input.taskItems,
  });
  if (error) throw error;
  return data;
}

export async function addCareShiftTasks(input: {
  shiftId: string;
  taskItems: CareShiftTaskInput[];
}) {
  const { data, error } = await requireSupabase().rpc('add_care_shift_tasks', {
    target_shift_id: input.shiftId,
    task_items: input.taskItems,
  });
  if (error) throw error;
  return data;
}

export async function updateCareShift(input: {
  assigneeUserId: string | null;
  note?: string | null;
  shiftId: string;
}) {
  const { data, error } = await requireSupabase().rpc('update_care_shift', {
    shift_note: input.note ?? null,
    target_assignee_user_id: input.assigneeUserId,
    target_shift_id: input.shiftId,
  });
  if (error) throw error;
  return data;
}

export async function claimCareShift(shiftId: string) {
  const { data, error } = await requireSupabase().rpc('claim_care_shift', {
    target_shift_id: shiftId,
  });
  if (error) throw error;
  return data;
}

export async function cancelCareShift(shiftId: string) {
  const { data, error } = await requireSupabase().rpc('cancel_care_shift', {
    target_shift_id: shiftId,
  });
  if (error) throw error;
  return data;
}

export async function cancelCareShiftTask(shiftTaskId: string) {
  const { data, error } = await requireSupabase().rpc(
    'cancel_care_shift_task',
    { target_shift_task_id: shiftTaskId },
  );
  if (error) throw error;
  return data;
}

export async function completeCareShiftTask(input: CompleteCareShiftTaskInput) {
  const { data, error } = await requireSupabase().rpc(
    'complete_care_shift_task',
    {
      care_log_id: input.careLogId,
      completion_duration_minutes: input.completionDurationMinutes ?? null,
      completion_id: input.completionId,
      completion_note: input.completionNote ?? null,
      target_shift_task_id: input.shiftTaskId,
    },
  );
  if (error) throw error;
  return data[0];
}

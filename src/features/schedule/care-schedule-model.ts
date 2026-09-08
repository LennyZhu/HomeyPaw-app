import type { PetMemberSummary } from '@/features/family/family-queries';

import { getLocalDateInTimeZone } from './calendar-date';
import type { CareScheduleItem } from './care-schedule-types';

export type CareScheduleShift = {
  assigneeDisplayName: string | null;
  assigneeUserId: string | null;
  claimedAt: string | null;
  items: CareScheduleItem[];
  localDate: string;
  note: string | null;
  shiftCanceledAt: string | null;
  shiftId: string;
  splitFromShiftId: string | null;
  status: CareScheduleItem['shift_status'];
};

export type ScheduleDaySummary = {
  completedCount: number;
  itemCount: number;
  memberIds: string[];
  unassignedCount: number;
};

export function groupCareScheduleByShift(items: CareScheduleItem[]) {
  const shifts = new Map<string, CareScheduleShift>();

  for (const item of items) {
    const existing = shifts.get(item.shift_id);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    shifts.set(item.shift_id, {
      assigneeDisplayName: item.assignee_display_name,
      assigneeUserId: item.assignee_user_id,
      claimedAt: item.claimed_at,
      items: [item],
      localDate: item.local_date,
      note: item.shift_note,
      shiftCanceledAt: item.shift_canceled_at,
      shiftId: item.shift_id,
      splitFromShiftId: item.split_from_shift_id,
      status: item.shift_status,
    });
  }

  return [...shifts.values()].map((shift) => ({
    ...shift,
    items: [...shift.items].sort((left, right) =>
      left.source_scheduled_for === right.source_scheduled_for
        ? left.shift_task_id.localeCompare(right.shift_task_id)
        : left.source_scheduled_for.localeCompare(right.source_scheduled_for),
    ),
  }));
}

export function scheduleItemsByDate(items: CareScheduleItem[]) {
  const result: Record<string, CareScheduleItem[]> = {};
  for (const item of items) {
    (result[item.local_date] ??= []).push(item);
  }
  return result;
}

export function summarizeScheduleDay(
  items: CareScheduleItem[],
): ScheduleDaySummary {
  return {
    completedCount: items.filter(isCareScheduleItemCompleted).length,
    itemCount: items.length,
    memberIds: [
      ...new Set(
        items
          .map((item) => item.assignee_user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
    unassignedCount: items.filter(
      (item) => !item.assignee_user_id && item.shift_status === 'scheduled',
    ).length,
  };
}

export function getScheduleRole(
  members: PetMemberSummary[],
  userId: string | undefined,
) {
  return members.find((member) => member.userId === userId)?.role ?? null;
}

export function canManageCareShift(
  shift: CareScheduleShift,
  role: PetMemberSummary['role'] | null,
  userId: string | undefined,
) {
  return (
    role === 'owner' || (role === 'member' && shift.assigneeUserId === userId)
  );
}

export function isCareScheduleItemCompleted(item: CareScheduleItem) {
  return Boolean(item.completion_id);
}

export function isCareScheduleItemMutable(
  item: CareScheduleItem,
  now = new Date(),
) {
  return (
    item.shift_status === 'scheduled' &&
    item.shift_task_status === 'scheduled' &&
    !isCareScheduleItemCompleted(item) &&
    item.local_date >= getLocalDateInTimeZone(now, item.task_time_zone)
  );
}

export function canCompleteCareScheduleItem(
  item: CareScheduleItem,
  now = new Date(),
) {
  return (
    item.shift_status === 'scheduled' &&
    item.shift_task_status === 'scheduled' &&
    !isCareScheduleItemCompleted(item) &&
    new Date(item.source_scheduled_for) <= now
  );
}

export function isScheduleAccessDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === '42501' ||
    (typeof candidate.message === 'string' &&
      /pet not found|permission denied|not a current family member/iu.test(
        candidate.message,
      ))
  );
}

export function isCareShiftAlreadyClaimed(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string' &&
    (error as { message: string }).message.includes('already_claimed')
  );
}

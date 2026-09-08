import type { PetMemberSummary } from '@/features/family/family-queries';

import { getLocalDateInTimeZone } from './calendar-date';
import type { CareScheduleItem } from './care-schedule-types';

export type CareScheduleShift = {
  assigneeAvatarPath: string | null;
  assigneeAvatarUrl: string | null;
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
  members: ScheduleMemberSummary[];
  memberIds: string[];
  unassignedCount: number;
};

export type ScheduleMemberSummary = {
  avatarPath: string | null;
  avatarUrl: string | null;
  displayName: string | null;
  userId: string;
};

export type CareScheduleAssigneeGroup = {
  assigneeAvatarPath: string | null;
  assigneeAvatarUrl: string | null;
  assigneeDisplayName: string | null;
  assigneeUserId: string | null;
  canceledCount: number;
  completedCount: number;
  items: CareScheduleItem[];
  key: string;
  pendingCount: number;
  shifts: CareScheduleShift[];
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
      assigneeAvatarPath: item.assignee_avatar_path,
      assigneeAvatarUrl: item.assignee_avatar_url,
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

function getScheduleItemState(item: CareScheduleItem) {
  if (
    item.shift_status === 'canceled' ||
    item.shift_task_status === 'canceled'
  ) {
    return 'canceled' as const;
  }
  return isCareScheduleItemCompleted(item)
    ? ('completed' as const)
    : ('pending' as const);
}

export function groupCareScheduleByAssignee(shifts: CareScheduleShift[]) {
  const groups = new Map<string, CareScheduleAssigneeGroup>();

  for (const shift of shifts) {
    const key = shift.assigneeUserId ?? 'unassigned';
    const existing = groups.get(key);
    if (existing) {
      existing.shifts.push(shift);
      existing.items.push(...shift.items);
      continue;
    }

    groups.set(key, {
      assigneeAvatarPath: shift.assigneeAvatarPath,
      assigneeAvatarUrl: shift.assigneeAvatarUrl,
      assigneeDisplayName: shift.assigneeDisplayName,
      assigneeUserId: shift.assigneeUserId,
      canceledCount: 0,
      completedCount: 0,
      items: [...shift.items],
      key,
      pendingCount: 0,
      shifts: [shift],
    });
  }

  return [...groups.values()].map((group) => {
    const counts = group.items.reduce(
      (result, item) => {
        result[getScheduleItemState(item)] += 1;
        return result;
      },
      { canceled: 0, completed: 0, pending: 0 },
    );
    return {
      ...group,
      canceledCount: counts.canceled,
      completedCount: counts.completed,
      pendingCount: counts.pending,
    };
  });
}

export function truncateCareScheduleGroups(
  groups: CareScheduleAssigneeGroup[],
  limit: number,
) {
  let remaining = Math.max(limit, 0);
  const visibleGroups: CareScheduleAssigneeGroup[] = [];

  for (const group of groups) {
    if (remaining === 0) break;
    const visibleItems = group.items.slice(0, remaining);
    if (visibleItems.length === 0) continue;

    const shiftItems = new Set(visibleItems.map((item) => item.shift_task_id));
    const shifts = group.shifts
      .map((shift) => ({
        ...shift,
        items: shift.items.filter((item) => shiftItems.has(item.shift_task_id)),
      }))
      .filter((shift) => shift.items.length > 0);
    const visibleGroup = groupCareScheduleByAssignee(shifts)[0];
    if (visibleGroup) visibleGroups.push(visibleGroup);
    remaining -= visibleItems.length;
  }

  const totalItems = groups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  return {
    hiddenCount: Math.max(totalItems - Math.max(limit, 0), 0),
    visibleGroups,
  };
}

export function shouldExpandScheduleGroup(group: CareScheduleAssigneeGroup) {
  return group.assigneeUserId === null || group.pendingCount > 0;
}

export function summarizeScheduleDay(
  items: CareScheduleItem[],
): ScheduleDaySummary {
  const members = new Map<string, ScheduleMemberSummary>();
  for (const item of items) {
    if (item.assignee_user_id && !members.has(item.assignee_user_id)) {
      members.set(item.assignee_user_id, {
        avatarPath: item.assignee_avatar_path,
        avatarUrl: item.assignee_avatar_url,
        displayName: item.assignee_display_name,
        userId: item.assignee_user_id,
      });
    }
  }

  return {
    completedCount: items.filter(isCareScheduleItemCompleted).length,
    itemCount: items.length,
    members: [...members.values()],
    memberIds: [...members.keys()],
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

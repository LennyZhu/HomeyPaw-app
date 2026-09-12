import type { CareTaskOccurrence } from '@/features/reminders/care-task-types';

export function occurrenceKey(
  occurrence: Pick<CareTaskOccurrence, 'scheduled_for' | 'task_id'>,
) {
  return `${occurrence.task_id}|${occurrence.scheduled_for}`;
}

export type ScheduleReminderReturn = {
  draftId: string;
  petId: string;
  scheduleDate: string;
  taskId: string;
};

type SelectionResult =
  | { kind: 'ineligible'; selectedKeys: Set<string> }
  | {
      kind: 'selected';
      occurrence: CareTaskOccurrence;
      selectedKeys: Set<string>;
    };

const pendingReturns = new Map<string, ScheduleReminderReturn>();

export function stageScheduleReminderReturn(result: ScheduleReminderReturn) {
  pendingReturns.set(result.draftId, result);
}

export function takeScheduleReminderReturn(draftId: string) {
  const result = pendingReturns.get(draftId) ?? null;
  pendingReturns.delete(draftId);
  return result;
}

export function mergeScheduleReminderSelection(input: {
  assignedKeys: Set<string>;
  currentSelectedKeys: Set<string>;
  occurrences: CareTaskOccurrence[];
  petId: string | null;
  scheduleDate: string;
  result: ScheduleReminderReturn;
}): SelectionResult {
  if (
    input.result.petId !== input.petId ||
    input.result.scheduleDate !== input.scheduleDate
  ) {
    return { kind: 'ineligible', selectedKeys: input.currentSelectedKeys };
  }

  const occurrence = input.occurrences.find(
    (candidate) =>
      candidate.task_id === input.result.taskId &&
      candidate.is_active &&
      !candidate.completion_id &&
      !input.assignedKeys.has(occurrenceKey(candidate)),
  );
  if (!occurrence) {
    return { kind: 'ineligible', selectedKeys: input.currentSelectedKeys };
  }

  const selectedKeys = new Set(input.currentSelectedKeys);
  selectedKeys.add(occurrenceKey(occurrence));
  return { kind: 'selected', occurrence, selectedKeys };
}

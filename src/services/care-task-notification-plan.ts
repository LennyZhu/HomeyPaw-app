// The OS receives concrete instants; recurrence remains owned by the RPC.
export const rollingWindowDays = 30;
export const maximumScheduledNotifications = 48;

type NotificationOccurrence = {
  task_id: string;
  scheduled_for: string;
  completion_id: string | null;
};

export function occurrenceKey(taskId: string, scheduledFor: string) {
  return `${taskId}|${scheduledFor}`;
}

export function planCareTaskNotifications<T extends NotificationOccurrence>(
  occurrences: T[],
  now: Date,
) {
  const end = now.getTime() + rollingWindowDays * 86_400_000;
  const sorted = occurrences
    .filter((item) => {
      const instant = new Date(item.scheduled_for).getTime();
      return (
        !item.completion_id && instant > now.getTime() + 5_000 && instant < end
      );
    })
    .sort(
      (a, b) =>
        new Date(a.scheduled_for).getTime() -
          new Date(b.scheduled_for).getTime() ||
        a.task_id.localeCompare(b.task_id),
    );
  const unique = new Map<string, T>();
  for (const item of sorted) {
    const key = occurrenceKey(item.task_id, item.scheduled_for);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, maximumScheduledNotifications);
}

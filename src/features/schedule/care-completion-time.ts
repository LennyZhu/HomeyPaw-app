import {
  getDateOnlyInZone,
  localDateTimeToInstant,
} from '../reminders/care-task-recurrence';

export function needsCareTimeConfirmation(scheduledFor: string, now: Date) {
  const planned = Date.parse(scheduledFor);
  return (
    !Number.isFinite(planned) || Math.abs(now.getTime() - planned) > 30 * 60_000
  );
}

export function isValidActualCareTime(value: string, now = new Date()) {
  const instant = Date.parse(value);
  return Number.isFinite(instant) && instant <= now.getTime();
}

export function careTimeFields(value: Date, timeZone: string) {
  return {
    date: getDateOnlyInZone(value, timeZone),
    time: new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(value),
  };
}

export function actualCareTimeFromFields(
  date: string,
  time: string,
  timeZone: string,
) {
  return localDateTimeToInstant(date, time, timeZone)?.toISOString() ?? null;
}

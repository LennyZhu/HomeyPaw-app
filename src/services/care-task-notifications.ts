import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchCareTaskOccurrences } from '@/features/reminders/care-task-api';
import i18n from '@/i18n';

import {
  clearStoredCareTaskNotifications,
  listStoredCareTaskNotifications,
  removeStoredCareTaskNotification,
  storeCareTaskNotification,
} from './care-task-notification-store';

export type CareTaskNotificationPermission =
  'granted' | 'denied' | 'undetermined' | 'unsupported';

const channelId = 'pawday-reminders';
const rollingWindowDays = 30;
const maximumScheduledNotifications = 48;
const activeSyncs = new Map<string, Promise<CareTaskNotificationSyncResult>>();

export type CareTaskNotificationSyncResult = {
  canceled: number;
  errors: number;
  scheduled: number;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function isIosPermissionGranted(
  permissions: Notifications.NotificationPermissionsStatus,
) {
  return (
    permissions.ios?.status ===
      Notifications.IosAuthorizationStatus.AUTHORIZED ||
    permissions.ios?.status ===
      Notifications.IosAuthorizationStatus.PROVISIONAL ||
    permissions.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

export async function getCareTaskNotificationPermission(): Promise<CareTaskNotificationPermission> {
  if (Platform.OS === 'web') return 'unsupported';
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted || isIosPermissionGranted(permissions)) {
    return 'granted';
  }
  return permissions.status === 'denied' ? 'denied' : 'undetermined';
}

async function ensureReminderChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(channelId, {
    importance: Notifications.AndroidImportance.HIGH,
    name: 'HomeyPaw Reminders',
    sound: 'default',
  });
}

export async function requestCareTaskNotificationPermission() {
  if (Platform.OS === 'web') return 'unsupported' as const;
  await ensureReminderChannel();
  await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return getCareTaskNotificationPermission();
}

function occurrenceKey(taskId: string, scheduledFor: string) {
  return `${taskId}|${scheduledFor}`;
}

async function cancelStoredNotifications(userId: string) {
  const mappings = await listStoredCareTaskNotifications(userId);
  let canceled = 0;
  for (const mapping of mappings) {
    await Notifications.cancelScheduledNotificationAsync(
      mapping.notificationId,
    ).catch(() => undefined);
    canceled += 1;
  }
  await clearStoredCareTaskNotifications(userId);
  return canceled;
}

export async function cancelCareTaskNotifications(userId: string) {
  if (Platform.OS === 'web') return;
  await activeSyncs.get(userId)?.catch(() => undefined);
  await Notifications.cancelAllScheduledNotificationsAsync().catch(
    () => undefined,
  );
  await clearStoredCareTaskNotifications(userId);
}

async function runSync(
  userId: string,
): Promise<CareTaskNotificationSyncResult> {
  if (Platform.OS === 'web') return { canceled: 0, errors: 0, scheduled: 0 };
  const permission = await getCareTaskNotificationPermission();
  if (permission !== 'granted') {
    return {
      canceled: await cancelStoredNotifications(userId),
      errors: 0,
      scheduled: 0,
    };
  }
  await ensureReminderChannel();

  const now = new Date();
  const windowEnd = new Date(
    now.getTime() + rollingWindowDays * 24 * 60 * 60_000,
  );
  const occurrences = await fetchCareTaskOccurrences({
    windowEnd,
    windowStart: now,
  });
  const desired = occurrences
    .filter(
      (occurrence) =>
        !occurrence.completion_id &&
        new Date(occurrence.scheduled_for).getTime() > now.getTime() + 5_000,
    )
    .slice(0, maximumScheduledNotifications);
  const desiredByKey = new Map(
    desired.map((occurrence) => [
      occurrenceKey(occurrence.task_id, occurrence.scheduled_for),
      occurrence,
    ]),
  );
  const mappings = await listStoredCareTaskNotifications(userId);
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const pendingIds = new Set(pending.map((request) => request.identifier));
  const mappedByKey = new Map(
    mappings.map((mapping) => [
      occurrenceKey(mapping.taskId, mapping.scheduledFor),
      mapping,
    ]),
  );
  let canceled = 0;
  let errors = 0;
  let scheduled = 0;

  for (const mapping of mappings) {
    const key = occurrenceKey(mapping.taskId, mapping.scheduledFor);
    if (!desiredByKey.has(key) || !pendingIds.has(mapping.notificationId)) {
      await Notifications.cancelScheduledNotificationAsync(
        mapping.notificationId,
      ).catch(() => undefined);
      await removeStoredCareTaskNotification(
        userId,
        mapping.taskId,
        mapping.scheduledFor,
      );
      mappedByKey.delete(key);
      canceled += 1;
    }
  }

  for (const occurrence of desired) {
    const key = occurrenceKey(occurrence.task_id, occurrence.scheduled_for);
    if (mappedByKey.has(key)) continue;
    let notificationId: string | null = null;
    try {
      const scheduledDate = new Date(occurrence.scheduled_for);
      const timeLabel = new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: occurrence.time_zone,
      }).format(scheduledDate);
      notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          body: i18n.t('reminders.notification.body', { time: timeLabel }),
          data: {
            petId: occurrence.pet_id,
            scheduledFor: occurrence.scheduled_for,
            taskId: occurrence.task_id,
            url: `/reminders/${occurrence.task_id}`,
          },
          sound: 'default',
          title: i18n.t('reminders.notification.title', {
            petName: occurrence.pet_name,
            taskTitle: occurrence.title,
          }),
        },
        trigger: {
          ...(Platform.OS === 'android' ? { channelId } : {}),
          date: scheduledDate,
          type: Notifications.SchedulableTriggerInputTypes.DATE,
        },
      });
      await storeCareTaskNotification({
        notificationId,
        petId: occurrence.pet_id,
        scheduledFor: occurrence.scheduled_for,
        taskId: occurrence.task_id,
        userId,
      });
      scheduled += 1;
    } catch {
      if (notificationId) {
        await Notifications.cancelScheduledNotificationAsync(
          notificationId,
        ).catch(() => undefined);
      }
      errors += 1;
    }
  }

  return { canceled, errors, scheduled };
}

export function syncCareTaskNotifications(
  userId: string,
): Promise<CareTaskNotificationSyncResult> {
  const existing = activeSyncs.get(userId);
  if (existing) {
    return existing.then(() => syncCareTaskNotifications(userId));
  }
  const sync = runSync(userId).finally(() => {
    activeSyncs.delete(userId);
  });
  activeSyncs.set(userId, sync);
  return sync;
}

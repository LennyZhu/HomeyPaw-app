import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

export type StoredCareTaskNotification = {
  notificationId: string;
  petId: string;
  scheduledFor: string;
  taskId: string;
  userId: string;
};

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

async function getDatabase() {
  if (Platform.OS === 'web') return null;
  databasePromise ??= SQLite.openDatabaseAsync('pawday-notifications.db');
  const database = await databasePromise;
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS care_task_notification_mappings (
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      pet_id TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      notification_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, task_id, scheduled_for)
    );
    CREATE INDEX IF NOT EXISTS care_task_notification_user_idx
      ON care_task_notification_mappings (user_id, scheduled_for);
    CREATE TABLE IF NOT EXISTS care_task_notification_preferences_v2 (
      user_id TEXT PRIMARY KEY,
      preprompt_shown INTEGER NOT NULL DEFAULT 0
        CHECK (preprompt_shown IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

export async function hasShownCareTaskNotificationPreprompt(userId: string) {
  const database = await getDatabase();
  if (!database) return true;
  const row = await database.getFirstAsync<{ preprompt_shown: number }>(
    `SELECT preprompt_shown
     FROM care_task_notification_preferences_v2
     WHERE user_id = ?`,
    userId,
  );
  return row?.preprompt_shown === 1;
}

export async function markCareTaskNotificationPrepromptShown(userId: string) {
  const database = await getDatabase();
  if (!database) return;
  await database.runAsync(
    `INSERT INTO care_task_notification_preferences_v2 (
       user_id, preprompt_shown, updated_at
     ) VALUES (?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       preprompt_shown = 1,
       updated_at = CURRENT_TIMESTAMP`,
    userId,
  );
}

export async function listStoredCareTaskNotifications(userId: string) {
  const database = await getDatabase();
  if (!database) return [];
  const rows = await database.getAllAsync<{
    notification_id: string;
    pet_id: string;
    scheduled_for: string;
    task_id: string;
    user_id: string;
  }>(
    `SELECT user_id, task_id, pet_id, scheduled_for, notification_id
     FROM care_task_notification_mappings
     WHERE user_id = ?
     ORDER BY scheduled_for`,
    userId,
  );
  return rows.map((row) => ({
    notificationId: row.notification_id,
    petId: row.pet_id,
    scheduledFor: row.scheduled_for,
    taskId: row.task_id,
    userId: row.user_id,
  }));
}

export async function storeCareTaskNotification(
  mapping: StoredCareTaskNotification,
) {
  const database = await getDatabase();
  if (!database) return;
  await database.runAsync(
    `INSERT INTO care_task_notification_mappings (
       user_id, task_id, pet_id, scheduled_for, notification_id
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, task_id, scheduled_for) DO UPDATE SET
       pet_id = excluded.pet_id,
       notification_id = excluded.notification_id`,
    mapping.userId,
    mapping.taskId,
    mapping.petId,
    mapping.scheduledFor,
    mapping.notificationId,
  );
}

export async function removeStoredCareTaskNotification(
  userId: string,
  taskId: string,
  scheduledFor: string,
) {
  const database = await getDatabase();
  if (!database) return;
  await database.runAsync(
    `DELETE FROM care_task_notification_mappings
     WHERE user_id = ? AND task_id = ? AND scheduled_for = ?`,
    userId,
    taskId,
    scheduledFor,
  );
}

export async function clearStoredCareTaskNotifications(userId: string) {
  const database = await getDatabase();
  if (!database) return;
  await database.runAsync(
    'DELETE FROM care_task_notification_mappings WHERE user_id = ?',
    userId,
  );
}

import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase/client';

import {
  ensureReminderNotificationChannel,
  getCareTaskNotificationPermission,
} from './care-task-notifications';

const installationStorageKey = 'homeypaw-push-installation-id-v1';
const promptStorageKey = 'homeypaw-family-push-preprompt-users-v1';
let activeRegistration: Promise<boolean> | null = null;

function getStoredPromptUserIds() {
  try {
    const value = globalThis.localStorage?.getItem(promptStorageKey);
    const parsed = value ? (JSON.parse(value) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function hasShownFamilyPushPreprompt(userId: string) {
  return getStoredPromptUserIds().includes(userId);
}

export function markFamilyPushPrepromptShown(userId: string) {
  try {
    globalThis.localStorage?.setItem(
      promptStorageKey,
      JSON.stringify([...new Set([...getStoredPromptUserIds(), userId])]),
    );
  } catch {
    // The prompt is optional and must never block the app.
  }
}

export function getOrCreatePushInstallationId() {
  const existing = globalThis.localStorage?.getItem(installationStorageKey);
  if (existing && /^[0-9a-f-]{36}$/iu.test(existing)) return existing;
  const installationId = Crypto.randomUUID();
  globalThis.localStorage?.setItem(installationStorageKey, installationId);
  return installationId;
}

export async function hasSharedFamilyForPush() {
  const { data, error } = await requireSupabase().rpc(
    'has_shared_family_for_push',
  );
  if (error) throw error;
  return data;
}

function getProjectId() {
  const extra = Constants.expoConfig?.extra as
    { eas?: { projectId?: unknown } } | undefined;
  const projectId = extra?.eas?.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('EAS_PROJECT_ID_MISSING');
  }
  return projectId;
}

async function runRegistration() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  if ((await getCareTaskNotificationPermission()) !== 'granted') return false;
  await ensureReminderNotificationChannel();
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: getProjectId(),
  });
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const { error } = await requireSupabase().rpc('register_push_device', {
    device_app_version: appVersion,
    device_expo_push_token: token.data,
    device_installation_id: getOrCreatePushInstallationId(),
    device_platform: Platform.OS,
  });
  if (error) throw error;
  return true;
}

export function registerFamilyPushDevice() {
  if (activeRegistration) return activeRegistration;
  activeRegistration = runRegistration().finally(() => {
    activeRegistration = null;
  });
  return activeRegistration;
}

export async function unregisterFamilyPushDevice() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  const installationId = globalThis.localStorage?.getItem(
    installationStorageKey,
  );
  if (!installationId) return false;
  const { data, error } = await requireSupabase().rpc(
    'unregister_push_device',
    { device_installation_id: installationId },
  );
  if (error) throw error;
  return data;
}

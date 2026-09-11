const pendingProfileSetupStorageKey = 'homeypaw-pending-profile-setup-users-v1';

export type ProfileSetupStorage = Pick<
  Storage,
  'getItem' | 'removeItem' | 'setItem'
>;

function getStorage() {
  return globalThis.localStorage as ProfileSetupStorage | undefined;
}

export function getPendingProfileSetupUserIds(
  storage: ProfileSetupStorage | undefined = getStorage(),
) {
  if (!storage) return [];

  try {
    const value = storage.getItem(pendingProfileSetupStorageKey);
    const parsed = value ? (JSON.parse(value) as unknown) : [];
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter((item): item is string => typeof item === 'string'),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

export function hasPendingProfileSetup(
  userId: string,
  storage: ProfileSetupStorage | undefined = getStorage(),
) {
  return getPendingProfileSetupUserIds(storage).includes(userId);
}

export function markPendingProfileSetup(
  userId: string,
  storage: ProfileSetupStorage | undefined = getStorage(),
) {
  if (!storage) return;

  try {
    storage.setItem(
      pendingProfileSetupStorageKey,
      JSON.stringify([
        ...new Set([...getPendingProfileSetupUserIds(storage), userId]),
      ]),
    );
  } catch {
    // A live signup intent still covers the current runtime.
  }
}

export function clearPendingProfileSetup(
  userId: string,
  storage: ProfileSetupStorage | undefined = getStorage(),
) {
  if (!storage) return;

  try {
    const remaining = getPendingProfileSetupUserIds(storage).filter(
      (pendingUserId) => pendingUserId !== userId,
    );
    if (remaining.length === 0) {
      storage.removeItem(pendingProfileSetupStorageKey);
    } else {
      storage.setItem(pendingProfileSetupStorageKey, JSON.stringify(remaining));
    }
  } catch {
    // The context state is still cleared for the current runtime.
  }
}

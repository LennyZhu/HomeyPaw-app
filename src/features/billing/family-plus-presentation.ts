// Presentation contract only. A future adapter must supply verified server
// status and quota facts; RevenueCat CustomerInfo is not Family authority.
export type FamilyPlusStatus =
  | 'free'
  | 'active'
  | 'grace'
  | 'cancelled'
  | 'expired'
  | 'revoked'
  | 'unavailable'
  | 'transition';
export type FamilyPlusRole = 'owner' | 'member' | 'viewer' | null;
export type FamilyPlusPeriod = 'monthly' | 'yearly';
export type FamilyPlusAction = 'purchase' | 'restore' | 'manage';
export type FamilyPlusPrice = {
  period: FamilyPlusPeriod;
  priceString: string;
  source: 'apple' | 'development-reference';
};
export type FamilyPlusSnapshot = {
  source: 'server' | 'development-preview';
  serverClock?: { serverTime: string; receivedAt: number };
  confirmedAt?: string;
  transition?: { startsAt: string; endsAt: string } | null;
  quotaEnabled?: boolean;
  usageDetails?: {
    status: 'ready' | 'uninitialized' | 'pending';
    reservedBytes: number | null;
    unpublishedBytes: number | null;
    cleanupPendingBytes: number | null;
    unsettledObjects: number;
    videoStatus: string;
  };
  status: FamilyPlusStatus;
  // Display evidence only; this contract grants no upload or purchase rights.
  plusAccess: {
    source: 'server-verified' | 'development-example';
    givesAccess: boolean;
    validUntil: string | null;
  } | null;
  storage: { usedBytes: number; limitBytes: number } | null;
  videos: { uploaded: number; limit: number | null } | null;
  prices: readonly FamilyPlusPrice[];
};

export function familyPlusIdentity(
  snapshot: FamilyPlusSnapshot,
  previewAllowed: boolean,
  now = snapshot.serverClock
    ? Date.parse(snapshot.serverClock.serverTime) +
      Math.max(0, monotonicNow() - snapshot.serverClock.receivedAt)
    : Date.now(),
) {
  const access = snapshot.plusAccess;
  const eligible = ['active', 'grace', 'cancelled'].includes(snapshot.status);
  const verified =
    snapshot.source === 'server' &&
    access?.source === 'server-verified' &&
    access.validUntil !== null &&
    Date.parse(access.validUntil) > now;
  const example =
    previewAllowed &&
    snapshot.source === 'development-preview' &&
    access?.source === 'development-example';
  const showBadge =
    eligible && access?.givesAccess === true && (verified || example);
  return {
    showBadge,
    status: eligible && !showBadge ? ('unavailable' as const) : snapshot.status,
  };
}

export function familyPlusTransition(
  snapshot: FamilyPlusSnapshot,
  now = snapshot.serverClock
    ? Date.parse(snapshot.serverClock.serverTime) +
      Math.max(0, monotonicNow() - snapshot.serverClock.receivedAt)
    : NaN,
) {
  const window = snapshot.transition;
  if (
    snapshot.source !== 'server' ||
    snapshot.status !== 'transition' ||
    !window ||
    !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(window.endsAt)) ||
    Date.parse(window.startsAt) > now
  )
    return null;
  const remaining = Math.max(0, Date.parse(window.endsAt) - now);
  return {
    endsAt: window.endsAt,
    remainingDays: Math.ceil(remaining / 86_400_000),
    expired: remaining === 0,
  };
}

export const monotonicNow = () => globalThis.performance?.now() ?? Date.now();

export function storagePresentation(usedBytes: number, limitBytes: number) {
  return {
    percent: Math.min(100, Math.max(0, (usedBytes / limitBytes) * 100)),
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    overBytes: Math.max(0, usedBytes - limitBytes),
  };
}

export function formatStorageBytes(bytes: number, locale: string) {
  const gibibyte = 1024 ** 3;
  const unit = bytes >= gibibyte ? 'GiB' : 'MiB';
  const amount = bytes / (unit === 'GiB' ? gibibyte : 1024 ** 2);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount)} ${unit}`;
}

export function canSelectFamilyPlusPlan(
  role: FamilyPlusRole,
  status: FamilyPlusStatus,
) {
  return role === 'owner' && ['free', 'expired', 'transition'].includes(status);
}

export function familyPlusBenefitsTitle(
  role: FamilyPlusRole,
  identity: ReturnType<typeof familyPlusIdentity>,
) {
  if (identity.showBadge) return 'title';
  if (canSelectFamilyPlusPlan(role, identity.status)) {
    if (identity.status === 'free') return 'upgradeTitle';
    if (identity.status === 'expired') return 'resubscribeTitle';
  }
  if (
    (role === 'member' || role === 'viewer') &&
    (identity.status === 'free' || identity.status === 'expired')
  )
    return 'offeredTitle';
  return 'learnTitle';
}

export function familyPlusPrice(
  prices: readonly FamilyPlusPrice[],
  period: FamilyPlusPeriod,
) {
  // No hardcoded USD fallback for a missing Store Product.
  return prices.find((price) => price.period === period) ?? null;
}

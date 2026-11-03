import { z } from 'zod';

import {
  monotonicNow,
  type FamilyPlusSnapshot,
} from './family-plus-presentation';

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime({ offset: true });
export const familyPlusSummarySchema = z.object({
  schema_version: z.literal(1),
  family_id: z.uuid(),
  viewer_user_id: z.uuid(),
  role: z.enum(['owner', 'member', 'viewer']),
  server_time: instant,
  status: z.enum([
    'free',
    'active',
    'grace',
    'cancelled',
    'expired',
    'revoked',
    'unavailable',
    'transition',
  ]),
  gives_plus_access: z.boolean(),
  access_until: instant.nullable(),
  // Optional while an older server still returns the version-1 Summary shape.
  transition: z
    .object({ starts_at: instant, ends_at: instant })
    .nullable()
    .optional(),
  entitlement_checked_at: instant.nullable(),
  billing_environment: z.enum(['SANDBOX', 'PRODUCTION']),
  limit_bytes: bytes.nullable(),
  storage_enforcement_enabled: z.boolean(),
  usage: z.object({
    status: z.enum(['ready', 'uninitialized', 'pending']),
    used_bytes: bytes.nullable(),
    reserved_bytes: bytes.nullable(),
    unpublished_bytes: bytes.nullable(),
    cleanup_pending_bytes: bytes.nullable(),
    unsettled_object_count: bytes,
    reconciled_at: instant.nullable(),
  }),
  videos: z.object({
    status: z.enum([
      'ready',
      'not_configured',
      'partial',
      'invalid',
      'pending',
    ]),
    published: bytes.nullable(),
    limit: bytes.nullable(),
    calendar_time_zone: z.string().nullable(),
    counting_scope: z.enum(['all_successful', 'free_only']).nullable(),
    period_start: instant.nullable(),
    policy_is_candidate: z.literal(true),
  }),
});
export type FamilyPlusSummary = z.infer<typeof familyPlusSummarySchema>;

export function parseFamilyPlusSummary(
  raw: unknown,
  userId: string,
  familyId: string,
  expectedEnvironment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX',
) {
  const result = familyPlusSummarySchema.parse(raw);
  if (result.billing_environment !== expectedEnvironment)
    throw new Error('FAMILY_PLUS_ENVIRONMENT_MISMATCH');
  if (result.family_id !== familyId || result.viewer_user_id !== userId)
    throw new Error('FAMILY_PLUS_SCOPE_CHANGED');
  if (
    result.gives_plus_access &&
    (!['active', 'grace', 'cancelled'].includes(result.status) ||
      !result.access_until ||
      Date.parse(result.access_until) <= Date.parse(result.server_time))
  )
    throw new Error('FAMILY_PLUS_INVALID_ACCESS');
  if (
    ['active', 'grace', 'cancelled'].includes(result.status) &&
    !result.gives_plus_access
  )
    throw new Error('FAMILY_PLUS_UNCONFIRMED_ACCESS');
  if (
    result.transition &&
    (result.status !== 'transition' ||
      Date.parse(result.transition.starts_at) >
        Date.parse(result.server_time) ||
      Date.parse(result.transition.ends_at) <= Date.parse(result.server_time) ||
      Date.parse(result.transition.ends_at) <=
        Date.parse(result.transition.starts_at))
  )
    throw new Error('FAMILY_PLUS_INVALID_TRANSITION');
  return result;
}

export function familyPlusServerSnapshot(
  data: FamilyPlusSummary,
  receivedAt = monotonicNow(),
): FamilyPlusSnapshot {
  return {
    source: 'server',
    serverClock: { serverTime: data.server_time, receivedAt },
    // Last successful read confirmation, separate from provider/grant history.
    confirmedAt: data.server_time,
    transition: data.transition
      ? {
          startsAt: data.transition.starts_at,
          endsAt: data.transition.ends_at,
        }
      : null,
    status: data.status,
    plusAccess: {
      source: 'server-verified',
      givesAccess: data.gives_plus_access,
      validUntil: data.access_until,
    },
    quotaEnabled: data.storage_enforcement_enabled,
    storage:
      data.usage.status === 'ready' &&
      data.usage.used_bytes !== null &&
      data.limit_bytes !== null
        ? { usedBytes: data.usage.used_bytes, limitBytes: data.limit_bytes }
        : null,
    videos:
      data.videos.status === 'ready' && data.videos.published !== null
        ? { uploaded: data.videos.published, limit: data.videos.limit }
        : null,
    usageDetails: {
      status: data.usage.status,
      reservedBytes: data.usage.reserved_bytes,
      unpublishedBytes: data.usage.unpublished_bytes,
      cleanupPendingBytes: data.usage.cleanup_pending_bytes,
      unsettledObjects: data.usage.unsettled_object_count,
      videoStatus: data.videos.status,
    },
    // Real purchase UI and Store Products are outside Phase 4D-1.
    prices: [],
  };
}

export const emptyFamilyPlusServerSnapshot: FamilyPlusSnapshot = {
  source: 'server',
  status: 'unavailable',
  plusAccess: null,
  storage: null,
  videos: null,
  prices: [],
};

import { z } from 'zod';

export const freeFamilyMemberLimit = 2;
export const plusFamilyMemberLimit = 10;

const capacitySchema = z.object({
  schema_version: z.literal(1),
  family_id: z.uuid(),
  viewer_user_id: z.uuid(),
  server_time: z.iso.datetime({ offset: true }),
  member_count: z.number().int().nonnegative(),
  member_limit: z.union([z.literal(2), z.literal(10)]),
  plus_until: z.iso.datetime({ offset: true }).nullable(),
  can_create_invite: z.boolean(),
  reserved_seats: z.number().int().min(0).max(5),
  invite_expires_at: z.iso.datetime({ offset: true }).nullable(),
  legacy_invite_remaining: z.number().int().min(0).max(5),
});
export type FamilyMemberCapacity = z.infer<typeof capacitySchema>;

export function parseFamilyMemberCapacity(
  data: unknown,
  userId: string,
  familyId: string,
) {
  const result = capacitySchema.parse(data);
  if (
    result.viewer_user_id !== userId ||
    result.family_id !== familyId ||
    (result.member_limit === 10) !== (result.plus_until !== null)
  )
    throw new Error('FAMILY_CAPACITY_IDENTITY_MISMATCH');
  return result;
}

// Display only. All creation/join decisions are repeated by the server.
export function familyMemberCapacityView(
  capacity: FamilyMemberCapacity,
  serverNow: number,
) {
  const plus =
    capacity.member_limit === 10 &&
    capacity.plus_until !== null &&
    Date.parse(capacity.plus_until) > serverNow;
  const limit = plus ? plusFamilyMemberLimit : freeFamilyMemberLimit;
  const inviteActive =
    capacity.invite_expires_at !== null &&
    Date.parse(capacity.invite_expires_at) > serverNow;
  return {
    count: capacity.member_count,
    limit,
    plus,
    full: capacity.member_count >= limit,
    canCreate: capacity.can_create_invite && capacity.member_count < limit,
    reserved: inviteActive ? capacity.reserved_seats : 0,
    legacyRemaining: inviteActive ? capacity.legacy_invite_remaining : 0,
  };
}

export function isFamilyMemberLimitError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'message' in error &&
    String(error.message).includes('family_member_limit_reached'),
  );
}

export function isFreeFamilyMemberLimitError(error: unknown) {
  return (
    isFamilyMemberLimitError(error) &&
    error !== null &&
    typeof error === 'object' &&
    'details' in error &&
    String(error.details).includes('plan=free')
  );
}

export function isFamilyInvitePermissionError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '42501',
  );
}

export const familyMemberLimit = 10;

export function isFamilyMemberLimitError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'message' in error &&
    String(error.message).includes('family_member_limit_reached'),
  );
}

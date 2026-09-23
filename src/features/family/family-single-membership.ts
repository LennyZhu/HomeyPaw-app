export function isAlreadyInFamilyError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'message' in error &&
    String(error.message).includes('ALREADY_IN_FAMILY'),
  );
}

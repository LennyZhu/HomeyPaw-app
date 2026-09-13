export function isJournalInitialLoading(
  hasActivePet: boolean,
  hasCachedData: boolean,
  isPending: boolean,
) {
  return hasActivePet && !hasCachedData && isPending;
}

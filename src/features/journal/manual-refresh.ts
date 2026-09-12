export function isJournalInitialLoading(
  hasCachedData: boolean,
  isPending: boolean,
) {
  return !hasCachedData && isPending;
}

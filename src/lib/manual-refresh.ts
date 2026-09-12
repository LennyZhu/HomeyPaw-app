export async function runManualRefresh(
  setRefreshing: (refreshing: boolean) => void,
  refresh: () => Promise<unknown>,
) {
  setRefreshing(true);
  try {
    await refresh();
  } finally {
    setRefreshing(false);
  }
}

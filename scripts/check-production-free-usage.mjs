// Offline operator snapshot assessment, not a collector, notifier or Billing gate.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ref = 'tknaobmlwmodsqtpqwkr';
const limits = {
  databaseBytes: 500_000_000,
  organizationDatabaseBytes: 500_000_000,
  diskUsedBytes: 2_000_000_000,
  storageBytes: 1_000_000_000,
  egressBytes: 5_000_000_000,
  cachedEgressBytes: 5_000_000_000,
  mau: 50_000,
  functionInvocations: 500_000,
  realtimeMessages: 2_000_000,
  realtimePeakConnections: 200,
};

export function assessFreeUsage(snapshot, now = Date.now()) {
  const observed = Date.parse(snapshot?.observedAt);
  if (
    snapshot?.projectRef !== ref ||
    snapshot?.plan !== 'free' ||
    snapshot?.verified !== true ||
    !Number.isFinite(observed) ||
    observed > now ||
    now - observed > 24 * 3600_000
  )
    throw new Error('FREE_USAGE_SNAPSHOT_REQUIRED');
  const metrics = Object.entries(limits).map(([name, limit]) => {
    const used = snapshot.usage?.[name];
    if (!Number.isSafeInteger(used) || used < 0)
      throw new Error('FREE_USAGE_METRIC_REQUIRED');
    const ratio = used / limit;
    return {
      name,
      used,
      limit,
      percent: Math.round(ratio * 1000) / 10,
      status:
        ratio >= 0.95
          ? 'CRITICAL'
          : ratio >= 0.85
            ? 'UPGRADE_NOW'
            : ratio >= 0.7
              ? 'WARN'
              : 'OK',
    };
  });
  const start = Date.parse(snapshot.cycleStartedAt);
  const end = Date.parse(snapshot.cycleEndsAt);
  if (!(start < observed && observed < end))
    throw new Error('FREE_USAGE_CYCLE_REQUIRED');
  const elapsed = observed - start;
  const forecast = [
    'egressBytes',
    'cachedEgressBytes',
    'functionInvocations',
    'realtimeMessages',
  ].map((name) => {
    const projected = Math.ceil(
      (snapshot.usage[name] * (end - start)) / elapsed,
    );
    return { name, projected, exceedsLimit: projected >= limits[name] };
  });
  const upgradeNow =
    metrics.some((x) => ['UPGRADE_NOW', 'CRITICAL'].includes(x.status)) ||
    forecast.some((x) => x.exceedsLimit);
  return {
    projectRef: ref,
    observedAt: snapshot.observedAt,
    plan: 'free',
    status: metrics.some((x) => x.status === 'CRITICAL')
      ? 'CRITICAL'
      : upgradeNow
        ? 'UPGRADE_NOW'
        : metrics.some((x) => x.status === 'WARN')
          ? 'WARN'
          : 'OK',
    metrics,
    forecast,
    paidServiceOnFree: 'OPERATOR_RISK_ACCEPTANCE_REQUIRED',
    automaticNotificationsInstalled: false,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === '--help') {
    console.log(
      'Offline only: node scripts/check-production-free-usage.mjs /absolute/private/usage.json\nUse fresh verified Dashboard/authorized read-only statistics. 70% WARN, 85% upgrade, 95% critical; projected monthly exhaustion also requests upgrade. Exit: 0 OK, 2 WARN, 3 upgrade/critical, 1 invalid/stale. Does not collect data, send alerts or change any gate.',
    );
  } else {
    try {
      if (process.argv.length !== 3 || !process.argv[2].startsWith('/'))
        throw new Error();
      const result = assessFreeUsage(
        JSON.parse(readFileSync(process.argv[2], 'utf8')),
      );
      console.log(JSON.stringify(result, null, 2));
      process.exitCode =
        result.status === 'OK' ? 0 : result.status === 'WARN' ? 2 : 3;
    } catch {
      console.error(
        'Free usage check blocked: require a fresh verified Production snapshot with every metric and billing cycle. No input content was printed.',
      );
      process.exitCode = 1;
    }
  }
}

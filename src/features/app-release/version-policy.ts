const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/u;
const buildPattern = /^\d{1,9}$/u;

export type AppReleasePolicy = {
  platform: 'ios';
  minimum_app_version: string;
  minimum_build: number;
  recommended_app_version: string | null;
  maintenance_mode: boolean;
  enforce_mutation_gate: boolean;
  maintenance_message: string | null;
  updated_at: string;
};

function compareVersions(installed: string, minimum: string) {
  if (!versionPattern.test(installed) || !versionPattern.test(minimum))
    return null;
  const currentParts = installed.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((currentParts[index] ?? 0) < (minimumParts[index] ?? 0)) return -1;
    if ((currentParts[index] ?? 0) > (minimumParts[index] ?? 0)) return 1;
  }
  return 0;
}

export function evaluateAppReleasePolicy(
  identity: { platform: string; version: string | null; build: string | null },
  policy: AppReleasePolicy | null,
): 'allowed' | 'upgrade' | 'maintenance' | 'invalid' {
  if (!policy) return 'allowed';
  if (
    policy.platform !== 'ios' ||
    !versionPattern.test(policy.minimum_app_version) ||
    !Number.isSafeInteger(policy.minimum_build) ||
    policy.minimum_build <= 0
  )
    return 'invalid';
  if (policy.maintenance_mode) return 'maintenance';
  if (identity.platform !== 'ios') return 'allowed';
  if (
    !identity.version ||
    !identity.build ||
    !buildPattern.test(identity.build)
  )
    return 'invalid';
  const installedBuild = Number(identity.build);
  if (!Number.isSafeInteger(installedBuild)) return 'invalid';
  const comparison = compareVersions(
    identity.version,
    policy.minimum_app_version,
  );
  if (comparison === null) return 'invalid';
  return comparison < 0 ||
    (comparison === 0 && installedBuild < policy.minimum_build)
    ? 'upgrade'
    : 'allowed';
}

const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const buildPattern = /^\d{1,9}$/;

function versionParts(value) {
  return versionPattern.test(value ?? '') ? value.split('.').map(Number) : null;
}

export function compareClientToMinimum(
  version,
  build,
  minimumVersion,
  minimumBuild,
) {
  const installed = versionParts(version);
  const minimum = versionParts(minimumVersion);
  if (
    !installed ||
    !minimum ||
    !buildPattern.test(build ?? '') ||
    !Number.isSafeInteger(minimumBuild) ||
    minimumBuild <= 0
  )
    return null;
  for (let index = 0; index < 3; index += 1) {
    if (installed[index] < minimum[index]) return -1;
    if (installed[index] > minimum[index]) return 1;
  }
  const installedBuild = Number(build);
  return installedBuild < minimumBuild
    ? -1
    : installedBuild > minimumBuild
      ? 1
      : 0;
}

export function clientVersionHeaders(request) {
  return {
    'X-HomeyPaw-Platform': request.headers.get('X-HomeyPaw-Platform') ?? '',
    'X-HomeyPaw-App-Version':
      request.headers.get('X-HomeyPaw-App-Version') ?? '',
    'X-HomeyPaw-Build': request.headers.get('X-HomeyPaw-Build') ?? '',
  };
}

export function evaluateClientRelease(policy, request) {
  if (!policy || policy.platform !== 'ios')
    return { status: 503, error: 'APP_RELEASE_POLICY_UNAVAILABLE' };
  if (policy.maintenance_mode) return { status: 503, error: 'APP_MAINTENANCE' };
  if (!policy.enforce_mutation_gate) return null;
  const platform = request.headers.get('X-HomeyPaw-Platform');
  const version = request.headers.get('X-HomeyPaw-App-Version');
  const build = request.headers.get('X-HomeyPaw-Build');
  if (
    !['ios', 'android', 'web'].includes(platform) ||
    !versionParts(version) ||
    !buildPattern.test(build ?? '')
  ) {
    return { status: 426, error: 'APP_UPDATE_REQUIRED' };
  }
  if (platform === 'ios') {
    const comparison = compareClientToMinimum(
      version,
      build,
      policy.minimum_app_version,
      policy.minimum_build,
    );
    if (comparison === null)
      return { status: 503, error: 'APP_RELEASE_POLICY_UNAVAILABLE' };
    if (comparison < 0) return { status: 426, error: 'APP_UPDATE_REQUIRED' };
  }
  return null;
}

export async function checkAppReleaseGate(admin, request) {
  const { data: locked, error: lockError } = await admin.rpc(
    'is_pre_cutover_release_locked',
  );
  if (lockError || locked !== false)
    return { status: 503, error: 'PRE_CUTOVER_RELEASE_LOCK' };
  const { data, error } = await admin
    .from('app_release_policy')
    .select(
      'platform,minimum_app_version,minimum_build,maintenance_mode,enforce_mutation_gate',
    )
    .eq('platform', 'ios')
    .maybeSingle();
  if (error) return { status: 503, error: 'APP_RELEASE_POLICY_UNAVAILABLE' };
  return evaluateClientRelease(data, request);
}

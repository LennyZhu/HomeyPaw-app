export const HOMEYPAW_APP_STORE_ID = '6806111286';
export const HOMEYPAW_APP_STORE_URL = `https://apps.apple.com/app/id${HOMEYPAW_APP_STORE_ID}`;
export const HOMEYPAW_APP_STORE_LOOKUP_URL = `https://itunes.apple.com/lookup?id=${HOMEYPAW_APP_STORE_ID}&country=hk`;

const semanticVersionPattern = /^\d+\.\d+\.\d+$/u;

export function compareNumericVersions(
  installedVersion: string,
  storeVersion: string,
) {
  if (
    !semanticVersionPattern.test(installedVersion) ||
    !semanticVersionPattern.test(storeVersion)
  ) {
    return null;
  }

  const installedParts = installedVersion.split('.').map(Number);
  const storeParts = storeVersion.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const installedPart = installedParts[index] ?? 0;
    const storePart = storeParts[index] ?? 0;
    if (storePart > installedPart) return 1;
    if (storePart < installedPart) return -1;
  }

  return 0;
}

export function parseAppStoreVersion(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;

  const { resultCount, results } = payload as {
    resultCount?: unknown;
    results?: unknown;
  };
  if (resultCount !== 1 || !Array.isArray(results) || results.length !== 1) {
    return null;
  }

  const result = results[0];
  if (!result || typeof result !== 'object') return null;

  const version = (result as { version?: unknown }).version;
  if (typeof version !== 'string' || !semanticVersionPattern.test(version)) {
    return null;
  }

  return version;
}

type AppStoreLookupOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export async function lookupLatestAppStoreVersion({
  fetcher = fetch,
  timeoutMs = 8_000,
}: AppStoreLookupOptions = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(HOMEYPAW_APP_STORE_LOOKUP_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `App Store lookup failed with status ${response.status}.`,
      );
    }

    const version = parseAppStoreVersion(await response.json());
    if (!version) {
      throw new Error('App Store lookup returned an invalid version.');
    }

    return version;
  } finally {
    clearTimeout(timeout);
  }
}

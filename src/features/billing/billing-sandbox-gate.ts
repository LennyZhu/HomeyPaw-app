export function canUseBillingSandbox(input: {
  development: boolean;
  platform: string;
  enabled: string | undefined;
  supabaseUrl: string | undefined;
  allowedHost: string | undefined;
  targetMode: string | undefined;
  projectRef: string | undefined;
}) {
  if (
    !input.development ||
    input.platform !== 'ios' ||
    input.enabled !== 'true' ||
    !input.supabaseUrl
  )
    return false;
  try {
    const url = new URL(input.supabaseUrl);
    if (url.hostname.includes('tknaobmlwmodsqtpqwkr')) return false;
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      ((input.targetMode === 'local' &&
        input.projectRef === 'local-pawday' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)) ||
        (input.targetMode === 'cloud' &&
          /^[a-z]{20}$/.test(input.projectRef ?? '') &&
          url.protocol === 'https:' &&
          !url.port &&
          url.hostname === `${input.projectRef}.supabase.co` &&
          url.hostname === input.allowedHost))
    );
  } catch {
    return false;
  }
}

export function canUseBillingSigning(
  development: boolean,
  devLauncher: boolean,
  releaseType: number,
) {
  // __DEV__ and native Dev Launcher are required in addition to provisioning.
  // Ordinary App Store/TestFlight, enterprise and simulator builds stay denied.
  return development && devLauncher && [3, 4].includes(releaseType);
}

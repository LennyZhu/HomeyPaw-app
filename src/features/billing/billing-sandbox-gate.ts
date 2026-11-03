export function canUseBillingSandbox(input: {
  development: boolean;
  buildTarget?: string | undefined;
  platform: string;
  enabled: string | undefined;
  supabaseUrl: string | undefined;
  allowedHost: string | undefined;
  targetMode: string | undefined;
  projectRef: string | undefined;
}) {
  if (
    (!input.development && input.buildTarget !== 'billing-rc-sandbox') ||
    input.platform !== 'ios' ||
    input.enabled !== 'true' ||
    !input.supabaseUrl
  )
    return false;
  if (
    input.buildTarget === 'billing-rc-sandbox' &&
    (input.development || input.targetMode !== 'cloud')
  )
    return false;
  if (input.buildTarget && input.buildTarget !== 'billing-rc-sandbox')
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
          input.projectRef === 'yhxxsawcaffxonpconaq' &&
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
  signedSandbox = false,
) {
  // A dedicated Store RC/test-account context is explicit; it does not depend
  // on Metro or Dev Launcher. Backend identity/transaction checks still apply.
  if (signedSandbox) return !development && releaseType === 5;
  return development && devLauncher && [3, 4].includes(releaseType);
}

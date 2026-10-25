export const familyPlusSandboxRef = 'yhxxsawcaffxonpconaq';
export const homeyPawProductionRef = 'tknaobmlwmodsqtpqwkr';

export function isPublicSupabaseKey(key: string | undefined, ref: string) {
  if (!key) return false;
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = key.split('.')[1]!;
    const claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return claims.role === 'anon' && claims.ref === ref;
  } catch {
    return false;
  }
}

// Separate values prevent the existing Production dotenv/linked project from
// becoming a fallback when a Sandbox build is missing its client credentials.
export function resolveSupabaseEnvironment(input: {
  development: boolean;
  buildTarget?: string | undefined;
  target?: string | undefined;
  url?: string | undefined;
  key?: string | undefined;
  sandboxUrl?: string | undefined;
  sandboxKey?: string | undefined;
}) {
  const denied = { url: undefined, key: undefined, sandbox: false };
  if (input.development && !input.target && !input.buildTarget)
    return { url: input.url, key: input.key, sandbox: false };
  if (input.target === 'production') {
    return !input.development &&
      input.buildTarget === 'production' &&
      input.url === `https://${homeyPawProductionRef}.supabase.co` &&
      isPublicSupabaseKey(input.key, homeyPawProductionRef)
      ? { url: input.url, key: input.key, sandbox: false }
      : denied;
  }
  const signedRC =
    !input.development &&
    input.buildTarget === 'billing-rc-sandbox' &&
    input.target === 'sandbox-rc';
  const developmentSandbox =
    input.development && !input.buildTarget && input.target === 'sandbox';
  if (
    (!signedRC && !developmentSandbox) ||
    input.sandboxUrl !== `https://${familyPlusSandboxRef}.supabase.co` ||
    !isPublicSupabaseKey(input.sandboxKey, familyPlusSandboxRef)
  )
    return denied;
  return { url: input.sandboxUrl, key: input.sandboxKey, sandbox: true };
}

export const supabaseEnvironment = resolveSupabaseEnvironment({
  development: __DEV__,
  buildTarget: process.env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET,
  target: process.env.EXPO_PUBLIC_HOMEYPAW_TARGET,
  url: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim(),
  key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  sandboxUrl: process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_URL?.trim(),
  sandboxKey: process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY?.trim(),
});

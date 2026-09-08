export function isLocalSupabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export const LOCAL_BACKEND = isLocalSupabase(
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim(),
);

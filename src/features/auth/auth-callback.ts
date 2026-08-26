import { requireSupabase } from '@/lib/supabase/client';

export type AuthCallbackKind = 'recovery' | 'signup' | 'unknown';

function getCallbackTarget(url: URL) {
  return (url.hostname || url.pathname.split('/').filter(Boolean)[0] || '')
    .trim()
    .toLowerCase();
}

function callbackParams(url: URL) {
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/u, ''));

  fragment.forEach((value, key) => {
    if (!params.has(key)) {
      params.set(key, value);
    }
  });

  return params;
}

export function isHomeyPawAuthCallback(urlValue: string) {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'pawday:') {
      return false;
    }

    const target = getCallbackTarget(url);
    return target === 'reset-password' || target === 'check-email';
  } catch {
    return false;
  }
}

export function isPasswordRecoveryCallback(urlValue: string) {
  try {
    const url = new URL(urlValue);
    return (
      url.protocol === 'pawday:' && getCallbackTarget(url) === 'reset-password'
    );
  } catch {
    return false;
  }
}

export async function applyAuthCallback(urlValue: string) {
  if (!isHomeyPawAuthCallback(urlValue)) {
    throw new Error('INVALID_AUTH_CALLBACK');
  }

  const url = new URL(urlValue);
  const params = callbackParams(url);
  const callbackError = params.get('error_code') ?? params.get('error');

  if (callbackError) {
    throw new Error('AUTH_CALLBACK_REJECTED');
  }

  const type = params.get('type');
  const kind: AuthCallbackKind =
    type === 'recovery'
      ? 'recovery'
      : type === 'signup' || type === 'email'
        ? 'signup'
        : isPasswordRecoveryCallback(urlValue)
          ? 'recovery'
          : 'unknown';
  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const client = requireSupabase();

  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      throw error;
    }
  } else if (accessToken && refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      throw error;
    }
  } else {
    throw new Error('AUTH_CALLBACK_MISSING_SESSION');
  }

  return kind;
}

import type { AuthError } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';

const errorCodeToKey: Record<string, string> = {
  email_address_invalid: 'auth.errors.invalidEmail',
  email_exists: 'auth.errors.emailExists',
  invalid_credentials: 'auth.errors.invalidCredentials',
  over_email_send_rate_limit: 'auth.errors.rateLimit',
  over_request_rate_limit: 'auth.errors.rateLimit',
  signup_disabled: 'auth.errors.signUpDisabled',
  user_already_exists: 'auth.errors.emailExists',
  weak_password: 'auth.errors.weakPassword',
};

export function getAuthErrorMessage(error: unknown, t: TFunction) {
  if (
    error instanceof TypeError ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return t('auth.errors.network');
  }

  const authError = error as Partial<AuthError> | null;
  const key = authError?.code ? errorCodeToKey[authError.code] : undefined;

  return t(key ?? 'auth.errors.generic');
}

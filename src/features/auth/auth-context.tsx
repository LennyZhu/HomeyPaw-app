import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import i18n, { isSupportedLanguage } from '@/i18n';
import {
  isSupabaseConfigured,
  registerSupabaseAutoRefresh,
  requireSupabase,
  supabase,
} from '@/lib/supabase/client';
import { cancelCareTaskNotifications } from '@/services/care-task-notifications';

import {
  applyAuthCallback,
  type AuthCallbackKind,
  isPasswordRecoveryCallback,
} from './auth-callback';

type AuthContextValue = {
  hasPasswordRecoveryError: boolean;
  isConfigured: boolean;
  isProcessingAuthCallback: boolean;
  isPasswordRecovery: boolean;
  isRestoring: boolean;
  processAuthCallback: (url: string) => Promise<AuthCallbackKind>;
  completePasswordRecovery: () => void;
  showPasswordRecoveryError: () => void;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const localeRestoreDeadlineMs = 8000;

async function getStoredLocale(session: Session | null) {
  if (!session || !supabase) {
    return null;
  }

  const { data } = await supabase
    .from('profiles')
    .select('locale')
    .eq('id', session.user.id)
    .maybeSingle();

  if (data?.locale && isSupportedLanguage(data.locale)) {
    return data.locale;
  }

  return null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [isProcessingAuthCallback, setIsProcessingAuthCallback] =
    useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [hasPasswordRecoveryError, setHasPasswordRecoveryError] =
    useState(false);
  const [isRestoring, setIsRestoring] = useState(Boolean(supabase));
  const latestUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isActive = true;
    let localeRestoreDeadline: ReturnType<typeof setTimeout> | null = null;
    const stopAutoRefresh = registerSupabaseAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      const previousUserId = latestUserId.current;

      if (previousUserId && previousUserId !== nextUserId) {
        void cancelCareTaskNotifications(previousUserId).catch(() => undefined);
        queryClient.clear();
      }

      latestUserId.current = nextUserId;
      setSession(nextSession);

      if (event === 'PASSWORD_RECOVERY') {
        setHasPasswordRecoveryError(false);
        setIsPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        setHasPasswordRecoveryError(false);
        setIsPasswordRecovery(false);
      }

      if (event === 'INITIAL_SESSION') {
        localeRestoreDeadline = setTimeout(() => {
          if (isActive) {
            setIsRestoring(false);
          }
        }, localeRestoreDeadlineMs);

        setTimeout(() => {
          void getStoredLocale(nextSession)
            .then(async (locale) => {
              if (
                locale &&
                isActive &&
                latestUserId.current === nextSession?.user.id
              ) {
                await i18n.changeLanguage(locale);
              }
            })
            .catch(() => undefined)
            .finally(() => {
              if (localeRestoreDeadline) {
                clearTimeout(localeRestoreDeadline);
                localeRestoreDeadline = null;
              }

              if (isActive) {
                setIsRestoring(false);
              }
            });
        }, 0);
      } else if (event === 'SIGNED_IN') {
        setTimeout(() => {
          void getStoredLocale(nextSession)
            .then(async (locale) => {
              if (
                locale &&
                isActive &&
                latestUserId.current === nextSession?.user.id
              ) {
                await i18n.changeLanguage(locale);
              }
            })
            .catch(() => undefined);
        }, 0);
      }
    });

    return () => {
      isActive = false;
      if (localeRestoreDeadline) {
        clearTimeout(localeRestoreDeadline);
      }
      data.subscription.unsubscribe();
      stopAutoRefresh();
    };
  }, [queryClient]);

  const signOut = useCallback(async () => {
    const client = requireSupabase();
    const departingUserId = latestUserId.current;
    if (departingUserId) {
      await cancelCareTaskNotifications(departingUserId).catch(() => undefined);
    }
    const { error } = await client.auth.signOut({ scope: 'local' });

    setSession(null);
    setHasPasswordRecoveryError(false);
    setIsPasswordRecovery(false);
    latestUserId.current = null;
    queryClient.clear();

    if (error) {
      throw error;
    }
  }, [queryClient]);

  const processAuthCallback = useCallback(async (url: string) => {
    setIsProcessingAuthCallback(true);
    try {
      const kind = await applyAuthCallback(url);
      setHasPasswordRecoveryError(false);
      setIsPasswordRecovery(kind === 'recovery');
      return kind;
    } catch (error) {
      setHasPasswordRecoveryError(isPasswordRecoveryCallback(url));
      setIsPasswordRecovery(false);
      throw error;
    } finally {
      setIsProcessingAuthCallback(false);
    }
  }, []);

  const completePasswordRecovery = useCallback(() => {
    setHasPasswordRecoveryError(false);
    setIsPasswordRecovery(false);
  }, []);

  const showPasswordRecoveryError = useCallback(() => {
    setHasPasswordRecoveryError(true);
    setIsPasswordRecovery(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      hasPasswordRecoveryError,
      isConfigured: isSupabaseConfigured,
      isProcessingAuthCallback,
      isPasswordRecovery,
      isRestoring,
      processAuthCallback,
      completePasswordRecovery,
      showPasswordRecoveryError,
      session,
      signOut,
      user: session?.user ?? null,
    }),
    [
      completePasswordRecovery,
      hasPasswordRecoveryError,
      isProcessingAuthCallback,
      isPasswordRecovery,
      isRestoring,
      processAuthCallback,
      session,
      showPasswordRecoveryError,
      signOut,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const value = use(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return value;
}

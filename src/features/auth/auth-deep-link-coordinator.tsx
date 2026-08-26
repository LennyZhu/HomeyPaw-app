import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { logError } from '@/lib/logger';

import {
  isPasswordRecoveryCallback,
  isHomeyPawAuthCallback,
} from './auth-callback';
import { useAuth } from './auth-context';

const consumedCallbacksStorageKey = 'pawday-consumed-auth-callbacks';
const consumedCallbacksLimit = 8;

function getConsumedCallbacks() {
  try {
    const storedValue = globalThis.localStorage?.getItem(
      consumedCallbacksStorageKey,
    );
    const parsedValue = storedValue ? (JSON.parse(storedValue) as unknown) : [];

    return Array.isArray(parsedValue)
      ? parsedValue.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function rememberConsumedCallback(fingerprint: string) {
  try {
    const nextCallbacks = [
      fingerprint,
      ...getConsumedCallbacks().filter((value) => value !== fingerprint),
    ].slice(0, consumedCallbacksLimit);

    globalThis.localStorage?.setItem(
      consumedCallbacksStorageKey,
      JSON.stringify(nextCallbacks),
    );
  } catch {
    // The in-memory guard still prevents duplicate handling for this runtime.
  }
}

async function getCallbackFingerprint(url: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, url);
}

export function AuthDeepLinkCoordinator() {
  const router = useRouter();
  const { processAuthCallback, session, showPasswordRecoveryError } = useAuth();
  const handledUrl = useRef<string | null>(null);

  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) {
        return;
      }

      if (handledUrl.current === url) {
        return;
      }

      if (!isHomeyPawAuthCallback(url)) {
        return;
      }

      const isRecoveryCallback = isPasswordRecoveryCallback(url);
      const fingerprint = await getCallbackFingerprint(url);
      if (getConsumedCallbacks().includes(fingerprint)) {
        if (session) {
          router.replace('/');
        } else if (isRecoveryCallback) {
          showPasswordRecoveryError();
          router.replace('/reset-password');
        }
        return;
      }

      handledUrl.current = url;

      try {
        const kind = await processAuthCallback(url);
        rememberConsumedCallback(fingerprint);
        if (kind === 'recovery') {
          router.replace('/reset-password');
        }
      } catch (error) {
        rememberConsumedCallback(fingerprint);
        logError('auth-deep-link', error);
        if (isRecoveryCallback) {
          router.replace(session ? '/' : '/reset-password');
        }
      }
    };

    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });

    return () => subscription.remove();
  }, [processAuthCallback, router, session, showPasswordRecoveryError]);

  return null;
}

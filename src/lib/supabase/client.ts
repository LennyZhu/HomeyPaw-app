import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/types/database';

import { fetchWithTimeout } from '../network-fetch';

const sessionStorage = {
  getItem(key: string) {
    if (typeof globalThis.localStorage === 'undefined') {
      return null;
    }

    return globalThis.localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(key, value);
    }
  },
  removeItem(key: string) {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.removeItem(key);
    }
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseClientKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

function isAllowedSupabaseUrl(value: string | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const isLocalHost =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    return (
      url.protocol === 'https:' || (isLocalHost && url.protocol === 'http:')
    );
  } catch {
    return false;
  }
}

function isPrivilegedKey(value: string | undefined) {
  if (!value) {
    return false;
  }

  if (value.startsWith('sb_secret_')) {
    return true;
  }

  const payload = value.split('.')[1];

  if (!payload || typeof globalThis.atob !== 'function') {
    return false;
  }

  try {
    const normalized = payload.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(globalThis.atob(padded)) as {
      role?: unknown;
    };

    return decoded.role === 'service_role';
  } catch {
    return false;
  }
}

export const isSupabaseConfigured = Boolean(
  isAllowedSupabaseUrl(supabaseUrl) &&
  supabaseClientKey &&
  !isPrivilegedKey(supabaseClientKey),
);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseClientKey!, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
      global: { fetch: fetchWithTimeout },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  return supabase;
}

export function registerSupabaseAutoRefresh() {
  if (!supabase || Platform.OS === 'web') {
    return () => undefined;
  }

  const updateRefreshState = (state: string) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  };

  updateRefreshState(AppState.currentState);
  const subscription = AppState.addEventListener('change', updateRefreshState);

  return () => {
    subscription.remove();
    supabase.auth.stopAutoRefresh();
  };
}

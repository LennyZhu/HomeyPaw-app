import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase/client';

import { getInstalledAppIdentity } from './minimum-version';
import {
  evaluateAppReleasePolicy,
  type AppReleasePolicy,
} from './version-policy';

type GateState =
  | { status: 'checking' }
  | { status: 'allowed' }
  | { status: 'upgrade'; message: string | null }
  | { status: 'maintenance'; message: string | null };

export function useAppReleaseGate() {
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const requestId = useRef(0);

  const recheck = useCallback(async () => {
    const id = ++requestId.current;
    if (!supabase) {
      setState({ status: 'allowed' });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('app_release_policy')
        .select('*')
        .eq('platform', 'ios')
        .maybeSingle();
      if (error) throw error;
      if (id !== requestId.current) return;
      const result = evaluateAppReleasePolicy(
        getInstalledAppIdentity(),
        data as AppReleasePolicy | null,
      );
      if (result === 'upgrade' || result === 'maintenance') {
        setState({
          status: result,
          message: data?.maintenance_message ?? null,
        });
      } else {
        // Missing/malformed config is a check failure, not an unsupported build.
        if (result === 'invalid' || !data) {
          console.warn('App release policy unavailable.');
          setState((previous) =>
            previous.status === 'upgrade' || previous.status === 'maintenance'
              ? previous
              : { status: 'allowed' },
          );
        } else {
          setState({ status: 'allowed' });
        }
      }
    } catch {
      if (id !== requestId.current) return;
      // A known blocking decision remains blocking during a network outage.
      setState((previous) =>
        previous.status === 'upgrade' || previous.status === 'maintenance'
          ? previous
          : { status: 'allowed' },
      );
    }
  }, []);

  useEffect(() => {
    const initialCheck = setTimeout(() => void recheck(), 0);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        // Keep the current navigation tree mounted while the gate rechecks.
        void recheck();
      }
    });
    return () => {
      clearTimeout(initialCheck);
      requestId.current += 1;
      subscription.remove();
    };
  }, [recheck]);

  return { ...state, recheck };
}

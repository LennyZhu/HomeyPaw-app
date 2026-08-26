import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import type { Profile, ProfileUpdate } from '@/types/database';

export function useProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const latestRequest = useRef(0);

  const loadProfile = useCallback(async () => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    if (!user) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: queryError } = await requireSupabase()
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (requestId !== latestRequest.current) {
      return;
    }

    if (queryError) {
      const nextError = new Error(queryError.message);
      setError(nextError);
      setIsLoading(false);
      throw nextError;
    }

    setProfile(data);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadProfile().catch(() => undefined);
    }, 0);

    return () => {
      clearTimeout(timeout);
      latestRequest.current += 1;
    };
  }, [loadProfile]);

  const updateProfile = useCallback(
    async (values: ProfileUpdate) => {
      if (!user) {
        throw new Error('AUTH_SESSION_MISSING');
      }

      const { data, error: updateError } = await requireSupabase()
        .from('profiles')
        .update(values)
        .eq('id', user.id)
        .select('*')
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      setProfile(data);
      await queryClient.invalidateQueries({
        queryKey: ['family', user.id],
      });
      return data;
    },
    [queryClient, user],
  );

  return {
    error,
    isLoading,
    profile,
    refetch: loadProfile,
    updateProfile,
  };
}

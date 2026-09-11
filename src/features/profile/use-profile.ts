import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import type { Profile, ProfileUpdate } from '@/types/database';

import { profileAvatarKeys } from './profile-avatar';
import { profileKeys } from './profile-query-state';

async function fetchProfile(userId: string) {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export function useProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    enabled: Boolean(user),
    queryFn: () => fetchProfile(user!.id),
    queryKey: profileKeys.detail(user?.id),
  });

  const updateProfile = useCallback(
    async (values: ProfileUpdate) => {
      if (!user) {
        throw new Error('AUTH_SESSION_MISSING');
      }

      const queryKey = profileKeys.detail(user.id);
      await queryClient.cancelQueries({ queryKey });
      const previousProfile = queryClient.getQueryData<Profile>(queryKey);
      const { data, error: updateError } = await requireSupabase()
        .from('profiles')
        .update(values)
        .eq('id', user.id)
        .select('*')
        .single();

      if (updateError) {
        throw new Error(updateError.message);
      }

      queryClient.setQueryData<Profile>(queryKey, data);
      const avatarChanged =
        Object.hasOwn(values, 'avatar_url') &&
        previousProfile?.avatar_url !== data.avatar_url;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['family', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['chat', user.id] }),
        queryClient.invalidateQueries({
          queryKey: ['care-schedule', user.id],
        }),
        ...(avatarChanged
          ? [
              queryClient.invalidateQueries({
                queryKey: profileAvatarKeys.all(user.id),
              }),
            ]
          : []),
      ]).catch(() => undefined);
      return data;
    },
    [queryClient, user],
  );

  return {
    error: profileQuery.error,
    isFetching: profileQuery.isFetching,
    isLoading: profileQuery.isPending && !profileQuery.data,
    profile: profileQuery.data ?? null,
    refetch: profileQuery.refetch,
    updateProfile,
  };
}

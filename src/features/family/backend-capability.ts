import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';

import {
  classifyBackendCapability,
  type BackendCapability,
} from './backend-capability-state';
export type { BackendCapability } from './backend-capability-state';

export const backendCapabilityKeys = {
  current: (userId: string | undefined) =>
    ['backend-capability', userId] as const,
};

export async function detectBackendCapability(): Promise<BackendCapability> {
  const { error } = await requireSupabase()
    .from('family_members')
    .select('family_id', { head: true })
    .limit(1);

  return classifyBackendCapability(error);
}

export function useBackendCapability() {
  const { user } = useAuth();
  const query = useQuery({
    enabled: Boolean(user),
    queryFn: detectBackendCapability,
    queryKey: backendCapabilityKeys.current(user?.id),
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  });
  // A failed re-probe must not keep routing mutations through a stale mode.
  return { ...query, data: query.isError ? undefined : query.data };
}

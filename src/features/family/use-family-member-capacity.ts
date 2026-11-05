import { onlineManager, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import { monotonicNow } from '@/features/billing/family-plus-presentation';

import {
  familyMemberCapacityView,
  parseFamilyMemberCapacity,
} from './family-member-limit';
import { familyKeys } from './family-query-keys';

export function useFamilyMemberCapacity(familyId: string | null) {
  const { user } = useAuth();
  const [, refreshClock] = useState(0);
  const online = useSyncExternalStore(
    onlineManager.subscribe,
    () => onlineManager.isOnline(),
    () => false,
  );
  const enabled = Boolean(user && familyId);
  const query = useQuery({
    queryKey: familyKeys.capacity(user?.id, familyId ?? ''),
    enabled: enabled && online,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc(
        'get_family_member_capacity',
        { target_family_id: familyId! },
      );
      if (error) throw error;
      return {
        capacity: parseFamilyMemberCapacity(data, user!.id, familyId!),
        receivedAt: monotonicNow(),
      };
    },
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (enabled && online) void refetch();
    }, [enabled, online, refetch]),
  );
  const matching =
    query.data?.capacity.family_id === familyId &&
    query.data?.capacity.viewer_user_id === user?.id;
  const data = matching && !query.isError ? query.data : undefined;
  useEffect(() => {
    if (!data) return;
    const now =
      Date.parse(data.capacity.server_time) +
      Math.max(0, monotonicNow() - data.receivedAt);
    const deadlines = [
      data.capacity.plus_until,
      data.capacity.invite_expires_at,
    ]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((value) => value > now);
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => {
        refreshClock((value) => value + 1);
        if (online) void refetch();
      },
      Math.min(2_147_483_647, Math.min(...deadlines) - now + 25),
    );
    return () => clearTimeout(timer);
  }, [data, online, refetch]);
  const serverNow = data
    ? Date.parse(data.capacity.server_time) +
      Math.max(0, monotonicNow() - data.receivedAt)
    : null;
  const capacity = data
    ? familyMemberCapacityView(data.capacity, serverNow!)
    : null;
  return {
    ...query,
    capacity,
    serverNow,
    canCreate: online && capacity?.canCreate === true,
  };
}

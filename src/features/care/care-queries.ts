import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import type { CareLog, CareType } from '@/types/database';

import { getDeviceTimeZone } from './care-date';
import type { CareFormValues } from './care-schema';

export type CarePerformer = { displayName: string; userId: string };
type CareCursor = Pick<CareLog, 'id' | 'occurred_at'>;
type CarePage = {
  logs: CareLog[];
  nextCursor: CareCursor | null;
};

const carePageSize = 40;

export const careKeys = {
  all: (userId: string | undefined) => ['care', userId] as const,
  detail: (userId: string | undefined, careLogId: string) =>
    ['care', userId, 'detail', careLogId] as const,
  history: (userId: string | undefined, petId: string | null) =>
    ['care', userId, 'history', petId] as const,
  performers: (userId: string | undefined, petId: string | null) =>
    ['care', userId, 'performers', petId] as const,
  today: (
    userId: string | undefined,
    petId: string | null,
    localDate: string,
  ) => ['care', userId, 'today', petId, localDate] as const,
};

function valuesToRpc(values: CareFormValues) {
  return {
    care_duration_minutes: values.durationMinutes
      ? Number(values.durationMinutes)
      : null,
    care_note: values.note.trim() || null,
    care_occurred_at: values.occurredAt,
    care_time_zone: getDeviceTimeZone(),
  };
}

async function fetchTodayCare(petId: string, localDate: string) {
  const { data, error } = await requireSupabase()
    .from('care_logs')
    .select('*')
    .eq('pet_id', petId)
    .eq('local_date', localDate)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data;
}

async function fetchCarePage(
  petId: string,
  cursor: CareCursor | null,
): Promise<CarePage> {
  let query = requireSupabase()
    .from('care_logs')
    .select('*')
    .eq('pet_id', petId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(carePageSize + 1);

  if (cursor) {
    query = query.or(
      `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  const hasNextPage = data.length > carePageSize;
  const logs = data.slice(0, carePageSize);
  const last = logs.at(-1);
  return {
    logs,
    nextCursor:
      hasNextPage && last
        ? { id: last.id, occurred_at: last.occurred_at }
        : null,
  };
}

async function fetchCareLog(careLogId: string) {
  const { data, error } = await requireSupabase()
    .from('care_logs')
    .select('*')
    .eq('id', careLogId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchCarePerformers(petId: string): Promise<CarePerformer[]> {
  const { data, error } = await requireSupabase().rpc(
    'get_pet_care_performers',
    { target_pet_id: petId },
  );
  if (error) throw error;
  return data.map((performer) => ({
    displayName: performer.performer_display_name,
    userId: performer.performer_user_id,
  }));
}

async function createCareLog(input: {
  careId: string;
  careType: CareType;
  petId: string;
  values: CareFormValues;
}) {
  const { data, error } = await requireSupabase().rpc('create_care_log', {
    care_id: input.careId,
    care_kind: input.careType,
    target_pet_id: input.petId,
    ...valuesToRpc(input.values),
  });
  if (error) throw error;
  return data;
}

async function updateCareLog(careLogId: string, values: CareFormValues) {
  const { data, error } = await requireSupabase().rpc('update_care_log', {
    target_care_log_id: careLogId,
    ...valuesToRpc(values),
  });
  if (error) throw error;
  return data;
}

async function deleteCareLog(careLogId: string) {
  const { data, error } = await requireSupabase()
    .from('care_logs')
    .delete()
    .eq('id', careLogId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('CARE_DELETE_FORBIDDEN');
  return careLogId;
}

export function useTodayCare(petId: string | null, localDate: string) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchTodayCare(petId!, localDate),
    queryKey: careKeys.today(user?.id, petId, localDate),
  });
}

export function useCareHistory(petId: string | null) {
  const { user } = useAuth();
  return useInfiniteQuery<
    CarePage,
    Error,
    InfiniteData<CarePage>,
    ReturnType<typeof careKeys.history>,
    CareCursor | null
  >({
    enabled: Boolean(user && petId),
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null as CareCursor | null,
    queryFn: ({ pageParam }) => fetchCarePage(petId!, pageParam),
    queryKey: careKeys.history(user?.id, petId),
  });
}

export function useCareLog(careLogId: string) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && careLogId),
    queryFn: () => fetchCareLog(careLogId),
    queryKey: careKeys.detail(user?.id, careLogId),
  });
}

export function useCarePerformers(petId: string | null) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchCarePerformers(petId!),
    queryKey: careKeys.performers(user?.id, petId),
  });
}

function useInvalidateCare() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: careKeys.all(user?.id) });
}

export function useCreateCareLog() {
  const invalidate = useInvalidateCare();
  return useMutation({ mutationFn: createCareLog, onSuccess: invalidate });
}

export function useUpdateCareLog(careLogId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCare();
  return useMutation({
    mutationFn: (values: CareFormValues) => updateCareLog(careLogId, values),
    onSuccess: (log) => {
      queryClient.setQueryData(careKeys.detail(user?.id, careLogId), log);
      void invalidate();
    },
  });
}

export function useDeleteCareLog() {
  const invalidate = useInvalidateCare();
  return useMutation({ mutationFn: deleteCareLog, onSuccess: invalidate });
}

export type CareHistoryData = InfiniteData<CarePage>;

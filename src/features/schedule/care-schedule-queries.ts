import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { useAuth } from '@/features/auth/auth-context';
import { careKeys } from '@/features/care/care-queries';
import { careTaskKeys } from '@/features/reminders/care-task-queries';

import {
  addCareShiftTasks,
  cancelCareShift,
  cancelCareShiftTask,
  claimCareShift,
  completeCareShiftTask,
  createCareShift,
  fetchCareScheduleRange,
  updateCareShift,
} from './care-schedule-api';

export const careScheduleKeys = {
  all: (userId: string | undefined) => ['care-schedule', userId] as const,
  pet: (userId: string | undefined, petId: string) =>
    [...careScheduleKeys.all(userId), 'pet', petId] as const,
  range: (
    userId: string | undefined,
    petId: string,
    startLocalDate: string,
    endLocalDate: string,
  ) =>
    [
      ...careScheduleKeys.pet(userId, petId),
      'range',
      startLocalDate,
      endLocalDate,
    ] as const,
};

export function invalidateCareSchedule(
  queryClient: QueryClient,
  userId: string | undefined,
  petId?: string,
) {
  return queryClient.invalidateQueries({
    queryKey: petId
      ? careScheduleKeys.pet(userId, petId)
      : careScheduleKeys.all(userId),
  });
}

export async function clearCareSchedulePetCache(
  queryClient: QueryClient,
  userId: string | undefined,
  petId: string,
) {
  await queryClient.cancelQueries({
    queryKey: careScheduleKeys.pet(userId, petId),
  });
  queryClient.removeQueries({ queryKey: careScheduleKeys.pet(userId, petId) });
}

export function useCareScheduleRange(input: {
  endLocalDate: string;
  petId: string | null;
  startLocalDate: string;
}) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && input.petId),
    queryFn: () =>
      fetchCareScheduleRange({
        endLocalDate: input.endLocalDate,
        petId: input.petId!,
        startLocalDate: input.startLocalDate,
      }),
    queryKey: careScheduleKeys.range(
      user?.id,
      input.petId ?? '',
      input.startLocalDate,
      input.endLocalDate,
    ),
    placeholderData: keepPreviousData,
  });
}

function useScheduleMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  petId: string,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateCareSchedule(queryClient, user?.id, petId),
  });
}

export function useCreateCareShift(petId: string) {
  return useScheduleMutation(createCareShift, petId);
}

export function useAddCareShiftTasks(petId: string) {
  return useScheduleMutation(addCareShiftTasks, petId);
}

export function useUpdateCareShift(petId: string) {
  return useScheduleMutation(updateCareShift, petId);
}

export function useClaimCareShift(petId: string) {
  return useScheduleMutation(claimCareShift, petId);
}

export function useCancelCareShift(petId: string) {
  return useScheduleMutation(cancelCareShift, petId);
}

export function useCancelCareShiftTask(petId: string) {
  return useScheduleMutation(cancelCareShiftTask, petId);
}

export function useCompleteCareShiftTask(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completeCareShiftTask,
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => undefined,
      );
      await Promise.all([
        invalidateCareSchedule(queryClient, user?.id, petId),
        queryClient.invalidateQueries({ queryKey: careTaskKeys.all(user?.id) }),
        queryClient.invalidateQueries({ queryKey: careKeys.all(user?.id) }),
      ]);
    },
  });
}

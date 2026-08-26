import { requireSupabase } from '@/lib/supabase/client';

import type { CareTaskOccurrence } from './care-task-types';

export async function fetchCareTaskOccurrences(input: {
  petId?: string | null;
  windowEnd: Date;
  windowStart: Date;
}): Promise<CareTaskOccurrence[]> {
  const { data, error } = await requireSupabase().rpc(
    'get_care_task_occurrences',
    {
      target_pet_id: input.petId ?? null,
      window_end: input.windowEnd.toISOString(),
      window_start: input.windowStart.toISOString(),
    },
  );
  if (error) throw error;
  return data;
}

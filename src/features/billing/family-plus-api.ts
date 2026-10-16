import { requireSupabase } from '@/lib/supabase/client';
import { parseFamilyPlusSummary } from './family-plus-data';
import { canUseFamilyPlusPreview } from './family-plus-preview';
import { monotonicNow } from './family-plus-presentation';

export async function readFamilyPlusSummary(
  userId: string,
  familyId: string,
  signal: AbortSignal,
) {
  // Local read-only milestone. No URL/credential fallback and no cloud requests.
  if (!canUseFamilyPlusPreview(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL))
    throw new Error('FAMILY_PLUS_LOCAL_ONLY');
  const { data, error } = await requireSupabase()
    .rpc('get_family_plus_summary', {
      target_family_id: familyId,
    })
    .abortSignal(signal);
  if (error) throw error;
  if (signal.aborted) throw new Error('FAMILY_PLUS_SCOPE_CHANGED');
  return {
    summary: parseFamilyPlusSummary(data, userId, familyId),
    receivedAt: monotonicNow(),
  };
}

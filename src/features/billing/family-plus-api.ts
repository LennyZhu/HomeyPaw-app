import { requireSupabase } from '@/lib/supabase/client';
import { parseFamilyPlusSummary } from './family-plus-data';
import {
  isFamilyPlusAvailable,
  isFamilyPlusRelease,
} from './family-plus-environment';
import { monotonicNow } from './family-plus-presentation';

export async function readFamilyPlusSummary(
  userId: string,
  familyId: string,
  signal: AbortSignal,
) {
  if (!isFamilyPlusAvailable()) throw new Error('FAMILY_PLUS_TARGET_DENIED');
  const { data, error } = await requireSupabase()
    .rpc('get_family_plus_summary', {
      target_family_id: familyId,
    })
    .abortSignal(signal);
  if (error) throw error;
  if (signal.aborted) throw new Error('FAMILY_PLUS_SCOPE_CHANGED');
  return {
    summary: parseFamilyPlusSummary(
      data,
      userId,
      familyId,
      isFamilyPlusRelease() ? 'PRODUCTION' : 'SANDBOX',
    ),
    receivedAt: monotonicNow(),
  };
}

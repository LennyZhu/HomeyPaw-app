import type { Database } from '@/types/database';

export type CareTaskOccurrence =
  Database['public']['Functions']['get_care_task_occurrences']['Returns'][number];

export type CareTaskCompletionResult =
  Database['public']['Functions']['complete_care_task']['Returns'][number];

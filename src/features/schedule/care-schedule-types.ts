import type { Database } from '@/types/database';

export type CareScheduleItem =
  Database['public']['Functions']['get_care_schedule_range']['Returns'][number] & {
    assignee_avatar_url: string | null;
  };

export type CareShiftTaskInput = {
  care_task_id: string;
  source_scheduled_for: string;
};

export type CompleteCareShiftTaskInput = {
  careLogId: string;
  completionDurationMinutes?: number | null;
  completionId: string;
  completionNote?: string | null;
  shiftTaskId: string;
};

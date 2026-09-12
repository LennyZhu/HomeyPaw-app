import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const migration = read(
  'supabase/migrations/20260907150000_phase11a_family_care_schedule.sql',
);
const rescheduleMigration = read(
  'supabase/migrations/20260912100000_fix_schedule_occurrence_reschedule.sql',
);
const compactMigration = migration.replace(/\s+/gu, '');
const compactRescheduleMigration = rescheduleMigration.replace(/\s+/gu, '');
const databaseTypes = read('src/types/database.ts');
const api = read('src/features/schedule/care-schedule-api.ts');
const queries = read('src/features/schedule/care-schedule-queries.ts');

assert(
  migration.includes('create table public.care_shifts') &&
    migration.includes('create table public.care_shift_tasks') &&
    migration.includes('add column care_shift_task_id uuid'),
  'Phase 11A Shift, Shift Task, or completion-link schema is missing.',
);
assert(
  migration.includes('care_shift_tasks_shift_pet_fkey') &&
    migration.includes('care_shift_tasks_task_pet_fkey') &&
    migration.includes('unique (care_task_id, source_scheduled_for)') &&
    migration.includes('on delete set null'),
  'Composite Pet integrity, unique occurrence assignment, or safe completion FK is missing.',
);
assert(
  compactRescheduleMigration.includes(
    'dropconstraintcare_shift_tasks_occurrence_unique',
  ) &&
    compactRescheduleMigration.includes(
      'createuniqueindexcare_shift_tasks_non_canceled_occurrence_unique_idx',
    ) &&
    compactRescheduleMigration.includes(
      'onpublic.care_shift_tasks(care_task_id,source_scheduled_for)',
    ) &&
    compactRescheduleMigration.includes("wherestatus<>'canceled'"),
  'Canceled Schedule history does not have the required non-canceled occurrence uniqueness.',
);
assert(
  rescheduleMigration.includes('having count(*) > 1') &&
    rescheduleMigration.includes("using errcode = '23505'") &&
    !rescheduleMigration.includes('delete from public.care_shift_tasks') &&
    !rescheduleMigration.includes('update public.care_shift_tasks'),
  'Schedule uniqueness migration must fail on conflicting data without rewriting history.',
);
assert(
  migration.includes('care_shifts_canceled_state') &&
    migration.includes("status = 'canceled' and canceled_at is not null") &&
    !migration.includes('canceled_by is not null'),
  'Canceled-state constraints do not support later account deletion.',
);
assert(
  migration.includes('private.has_care_schedule_access') &&
    migration.includes("membership.role in ('owner', 'member')") &&
    migration.includes('enable row level security') &&
    compactMigration.includes(
      'grantexecuteonfunctionprivate.has_care_schedule_access(uuid)toauthenticated',
    ) &&
    migration.includes('grant select on table public.care_shifts') &&
    !migration.includes('grant insert on table public.care_shifts') &&
    !migration.includes('grant update on table public.care_shift_tasks'),
  'Schedule RLS is not explicitly Owner/Member-only or exposes direct mutation.',
);

for (const [name, signature] of [
  ['create_care_shift', 'uuid, uuid, date, uuid, text, jsonb'],
  ['update_care_shift', 'uuid, uuid, text'],
  ['cancel_care_shift', 'uuid'],
  ['claim_care_shift', 'uuid'],
  ['add_care_shift_tasks', 'uuid, jsonb'],
  ['cancel_care_shift_task', 'uuid'],
  ['complete_care_shift_task', 'uuid, uuid, uuid, text, integer'],
  ['get_care_schedule_range', 'uuid, date, date'],
]) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = migration.indexOf('$$;', start);
  const definition = migration.slice(start, end);
  assert(start >= 0, `Missing Phase 11A RPC: ${name}`);
  assert(
    definition.includes("security definer\nset search_path = ''"),
    `${name} is missing SECURITY DEFINER with a fixed search_path.`,
  );
  assert(
    compactMigration.includes(
      `revokeexecuteonfunctionpublic.${name}(${signature.replace(/\s+/gu, '')})`,
    ),
    `${name} is missing explicit PUBLIC/anon revoke.`,
  );
}

assert(
  migration.includes('private.is_care_task_occurrence') &&
    migration.includes('shift local date does not match task occurrence') &&
    migration.includes('historical task occurrence cannot be scheduled') &&
    migration.includes('completed task occurrence cannot be scheduled'),
  'Existing occurrence, task-zone date, history, or completion validation is missing.',
);
assert(
  migration.includes('for update;') &&
    migration.includes('already_claimed') &&
    migration.includes('and assignee_user_id is null') &&
    migration.includes('private.is_care_shift_task_pending_mutable'),
  'Atomic claim or the shared item-mutability helper is missing.',
);
assert(
  migration.includes('from public.complete_care_task(') &&
    migration.includes('set care_shift_task_id = target_shift_task.id') &&
    !migration.includes('insert into public.care_logs') &&
    !migration.includes('insert into public.care_task_completions'),
  'Shift completion must reuse the existing Care Task/Care Log transaction.',
);
assert(
  migration.includes('reconcile_care_schedule_after_task_change') &&
    migration.includes('reconcile_removed_member_care_shifts') &&
    migration.includes('split_from_shift_id') &&
    migration.includes('private.normalize_care_shift_state'),
  'Task deactivation or removed-member partial-split lifecycle is missing.',
);
assert(
  migration.includes('range_end - range_start > 42') &&
    migration.includes('order by\n    shift.local_date') &&
    migration.includes("assignee_membership.role in ('owner', 'member')"),
  '42-day bounded range query, stable ordering, or safe profile projection is missing.',
);
assert(
  !migration.includes('realtime.') &&
    !migration.includes('notification') &&
    !migration.includes('care_shift_series') &&
    !migration.includes('care_task_week_days'),
  'Deferred Realtime, notification, or Phase 11B recurrence work leaked into Phase 11A.',
);
assert(
  databaseTypes.includes('care_shifts:') &&
    databaseTypes.includes('care_shift_tasks:') &&
    databaseTypes.includes('get_care_schedule_range:') &&
    databaseTypes.includes("care_schedule_status: 'scheduled' | 'canceled'"),
  'Phase 11A database types are incomplete.',
);
assert(
  api.includes("rpc('create_care_shift'") &&
    api.includes("'complete_care_shift_task'") &&
    api.includes("'get_care_schedule_range'") &&
    queries.includes("['care-schedule', userId]") &&
    queries.includes('startLocalDate') &&
    queries.includes('endLocalDate') &&
    queries.includes('invalidateCareSchedule') &&
    queries.includes('clearCareSchedulePetCache'),
  'Schedule API, range cache key, invalidation, or access-revocation cleanup primitive is missing.',
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PASS: Phase 11A bundle/item schema and completion link.');
  console.log(
    'PASS: canceled occurrences can be rescheduled while all non-canceled history remains unique.',
  );
  console.log('PASS: Owner/Member-only RLS and hardened RPC grants.');
  console.log('PASS: occurrence/date validation and atomic whole-Shift claim.');
  console.log('PASS: Task deactivation and removed-member lifecycle hooks.');
  console.log('PASS: 42-day range, indexes, types, and cache primitives.');
  console.log(
    'PASS: no Phase 11B recurrence, Schedule Realtime, or notification engine.',
  );
}

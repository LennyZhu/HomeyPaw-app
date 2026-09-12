import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import {
  addDateOnlyDays,
  getDateOnlyInZone,
  localDateTimeToInstant,
} from '../src/features/reminders/care-task-recurrence.ts';
import {
  mergeScheduleReminderSelection,
  occurrenceKey,
} from '../src/features/schedule/schedule-reminder-return.ts';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Local Supabase URL, anon key, and service-role key are required.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error(
    'SAFETY STOP: Schedule Reminder return verification is local only.',
  );
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const owner = createClient(url, anonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
let ownerId = null;
let petId = null;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sql(statement) {
  return execFileSync(
    'docker',
    [
      'exec',
      'supabase_db_pawday',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
      '-c',
      statement,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

try {
  const email = `schedule-return-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const createdUser = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: 'Schedule Return Owner', locale: 'en' },
  });
  if (createdUser.error || !createdUser.data.user) {
    throw createdUser.error ?? new Error('Owner fixture creation failed.');
  }
  ownerId = createdUser.data.user.id;
  const signedIn = await owner.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const createdPet = await owner.rpc('create_pet', {
    pet_description: 'Local Schedule Reminder return verification',
    pet_gender: 'unknown',
    pet_name: 'Schedule Return Pet',
    pet_species: 'other',
  });
  if (createdPet.error || !createdPet.data) {
    throw createdPet.error ?? new Error('Pet fixture creation failed.');
  }
  petId = createdPet.data.id;

  const timeZone = 'Asia/Hong_Kong';
  const scheduleDate = addDateOnlyDays(
    getDateOnlyInZone(new Date(), timeZone),
    1,
  );
  const scheduledAt = localDateTimeToInstant(scheduleDate, '09:00', timeZone);
  expect(scheduledAt, 'Could not resolve the Hong Kong occurrence time.');
  const taskId = randomUUID();
  const taskInput = {
    target_pet_id: petId,
    task_category: 'standard',
    task_care_type: 'feeding',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt.toISOString(),
    task_starts_on: null,
    task_time_zone: timeZone,
    task_title: 'New Schedule Breakfast',
    task_week_day: null,
  };
  const createdTask = await owner.rpc('create_care_task', taskInput);
  if (createdTask.error || createdTask.data?.id !== taskId) {
    throw createdTask.error ?? new Error('Care Task creation failed.');
  }
  const idempotentTask = await owner.rpc('create_care_task', taskInput);
  if (idempotentTask.error || idempotentTask.data?.id !== taskId) {
    throw (
      idempotentTask.error ?? new Error('Care Task retry was not idempotent.')
    );
  }

  const occurrences = await owner.rpc('get_care_task_occurrences', {
    target_pet_id: petId,
    window_end: new Date(scheduledAt.getTime() + 60_000).toISOString(),
    window_start: new Date(scheduledAt.getTime() - 60_000).toISOString(),
  });
  if (occurrences.error) throw occurrences.error;
  const returned = {
    draftId: 'integration-draft',
    petId,
    scheduleDate,
    taskId,
  };
  const selection = mergeScheduleReminderSelection({
    assignedKeys: new Set(),
    currentSelectedKeys: new Set(),
    occurrences: occurrences.data.filter(
      (occurrence) =>
        getDateOnlyInZone(
          new Date(occurrence.scheduled_for),
          occurrence.time_zone,
        ) === scheduleDate,
    ),
    petId,
    result: returned,
    scheduleDate,
  });
  expect(selection.kind === 'selected', 'New occurrence was not selectable.');

  const shiftId = randomUUID();
  const createdShift = await owner.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: scheduleDate,
    shift_note: null,
    target_assignee_user_id: ownerId,
    target_pet_id: petId,
    task_items: [
      {
        care_task_id: taskId,
        source_scheduled_for: selection.occurrence.scheduled_for,
      },
    ],
  });
  if (createdShift.error) throw createdShift.error;

  const counts = sql(
    `select
      (select count(*) from public.care_tasks where id='${taskId}'::uuid),
      (select count(*) from public.care_shifts where id='${shiftId}'::uuid),
      (select count(*) from public.care_shift_tasks
        where shift_id='${shiftId}'::uuid
          and care_task_id='${taskId}'::uuid
          and source_scheduled_for='${selection.occurrence.scheduled_for}'::timestamptz),
      (select count(*) from private.family_notification_outbox
        where event_type='reminder_created'
          and source_id='${taskId}'::uuid),
      (select count(*) from private.family_notification_outbox
        where source_id='${shiftId}'::uuid);`,
  );
  expect(counts === '1|1|1|1|0', `Unexpected lifecycle counts: ${counts}`);
  expect(
    selection.selectedKeys.has(occurrenceKey(selection.occurrence)),
    'Create Shift input was not selected.',
  );
  console.log(
    'PASS: one Reminder, one eligible occurrence, one Shift, one Shift Task, one Reminder Push event, and zero Schedule Push events.',
  );
} finally {
  if (petId) {
    sql(`delete from public.pets where id='${petId}'::uuid;`);
  }
  await owner.auth.signOut().catch(() => undefined);
  if (ownerId) {
    await admin.auth.admin.deleteUser(ownerId).catch(() => undefined);
  }
}

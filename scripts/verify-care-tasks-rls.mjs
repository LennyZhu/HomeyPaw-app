import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const fixtureName = 'HomeyPaw Phase 7 Verification Pet';
const fixtureDescription = 'Temporary Phase 7 care-task RLS verification';

function readPublicConfig() {
  const contents = readFileSync(
    new URL('../.env.local', import.meta.url),
    'utf8',
  );
  const values = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) values.set(match[1], match[2].trim());
  }
  return {
    key: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    url: values.get('EXPO_PUBLIC_SUPABASE_URL'),
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing temporary test credential: ${name}`);
  return value;
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(supabase, email, password, label) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(`${label} sign-in failed (${error?.code ?? 'no_user'}).`);
  }
  return data.user;
}

function localSchedule(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:00`,
  };
}

function dailyTaskInput(petId, title, date = new Date()) {
  const schedule = localSchedule(date, 'Asia/Hong_Kong');
  return {
    target_pet_id: petId,
    task_care_type: 'feeding',
    task_id: randomUUID(),
    task_local_time: schedule.time,
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'daily',
    task_scheduled_at: null,
    task_starts_on: schedule.date,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: title,
    task_week_day: null,
  };
}

function onceTaskInput(petId, title) {
  return {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_id: randomUUID(),
    task_local_time: null,
    task_month_day: null,
    task_note: 'Verification dose',
    task_schedule_type: 'once',
    task_scheduled_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: title,
    task_week_day: null,
  };
}

async function createTask(supabase, input) {
  return supabase.rpc('create_care_task', input);
}

async function completeTask(supabase, taskId, scheduledFor) {
  return supabase.rpc('complete_care_task', {
    care_log_id: randomUUID(),
    completion_duration_minutes: null,
    completion_id: randomUUID(),
    completion_note: null,
    occurrence_scheduled_for: scheduledFor,
    target_task_id: taskId,
  });
}

async function deletePet(supabase, petId) {
  const { data, error } = await supabase.functions.invoke('delete-pet', {
    body: { petId },
  });
  if (error || !data?.deleted) {
    throw new Error('Temporary Phase 7 pet cleanup failed.');
  }
}

async function main() {
  const { key, url } = readPublicConfig();
  if (!key || !url)
    throw new Error('Public Supabase configuration is missing.');
  const ownerClient = client(url, key);
  const memberClient = client(url, key);
  const strangerClient = client(url, key);
  const owner = await signIn(
    ownerClient,
    required('PAWDAY_FAMILY_OWNER_EMAIL'),
    required('PAWDAY_FAMILY_OWNER_PASSWORD'),
    'Owner',
  );
  const member = await signIn(
    memberClient,
    required('PAWDAY_FAMILY_MEMBER_EMAIL'),
    required('PAWDAY_FAMILY_MEMBER_PASSWORD'),
    'Member',
  );
  await signIn(
    strangerClient,
    required('PAWDAY_FAMILY_STRANGER_EMAIL'),
    required('PAWDAY_FAMILY_STRANGER_PASSWORD'),
    'Stranger',
  );
  let petId = null;

  try {
    const { data: stalePets } = await ownerClient
      .from('pets')
      .select('id')
      .eq('name', fixtureName)
      .eq('description', fixtureDescription);
    for (const stale of stalePets ?? []) await deletePet(ownerClient, stale.id);

    const { data: pet, error: petError } = await ownerClient.rpc('create_pet', {
      pet_description: fixtureDescription,
      pet_gender: 'unknown',
      pet_name: fixtureName,
      pet_species: 'other',
    });
    if (petError || !pet) throw new Error('Pet fixture creation failed.');
    petId = pet.id;

    const { data: invites, error: inviteError } = await ownerClient.rpc(
      'create_pet_invite',
      { target_pet_id: petId },
    );
    if (inviteError || !invites?.[0])
      throw new Error('Invite creation failed.');
    const { error: joinError } = await memberClient.rpc(
      'join_pet_with_invite',
      { invite_code: invites[0].invite_code },
    );
    if (joinError) throw new Error('Member join failed.');

    const ownerInput = dailyTaskInput(petId, 'Owner breakfast verification');
    const { data: ownerTask, error: ownerTaskError } = await createTask(
      ownerClient,
      ownerInput,
    );
    if (ownerTaskError || ownerTask.created_by !== owner.id) {
      throw new Error('Owner task creation or server-bound creator failed.');
    }
    console.log('PASS: Owner can create task.');

    const windowStart = new Date(Date.now() - 10 * 60_000);
    const windowEnd = new Date(Date.now() + 10 * 60_000);
    const { data: memberOccurrences, error: memberReadError } =
      await memberClient.rpc('get_care_task_occurrences', {
        target_pet_id: petId,
        window_end: windowEnd.toISOString(),
        window_start: windowStart.toISOString(),
      });
    const ownerOccurrence = memberOccurrences?.find(
      (item) => item.task_id === ownerTask.id,
    );
    if (memberReadError || !ownerOccurrence) {
      throw new Error('Member could not read owner task occurrence.');
    }
    console.log('PASS: Member can read task.');

    const memberInput = dailyTaskInput(petId, 'Member care verification');
    const { data: memberTask, error: memberTaskError } = await createTask(
      memberClient,
      memberInput,
    );
    if (memberTaskError || memberTask.created_by !== member.id) {
      throw new Error('Member task creation failed.');
    }
    console.log('PASS: Member can create task.');

    const memberEditOwner = await memberClient.rpc('update_care_task', {
      target_task_id: ownerTask.id,
      task_care_type: ownerInput.task_care_type,
      task_local_time: ownerInput.task_local_time,
      task_month_day: null,
      task_note: null,
      task_schedule_type: 'daily',
      task_scheduled_at: null,
      task_starts_on: ownerInput.task_starts_on,
      task_time_zone: ownerInput.task_time_zone,
      task_title: 'Forged owner task',
      task_week_day: null,
    });
    if (!memberEditOwner.error) {
      throw new Error('RLS BREACH: Member edited owner task.');
    }
    const memberDeactivateOwner = await memberClient.rpc(
      'deactivate_care_task',
      { target_task_id: ownerTask.id },
    );
    if (!memberDeactivateOwner.error) {
      throw new Error('RLS BREACH: Member deactivated owner task.');
    }
    console.log('PASS: Member cannot edit owner task.');

    const { data: ownerEditedMember, error: ownerEditError } =
      await ownerClient.rpc('update_care_task', {
        target_task_id: memberTask.id,
        task_care_type: memberInput.task_care_type,
        task_local_time: memberInput.task_local_time,
        task_month_day: null,
        task_note: null,
        task_schedule_type: 'daily',
        task_scheduled_at: null,
        task_starts_on: memberInput.task_starts_on,
        task_time_zone: memberInput.task_time_zone,
        task_title: 'Owner reviewed member task',
        task_week_day: null,
      });
    if (
      ownerEditError ||
      ownerEditedMember.title !== 'Owner reviewed member task'
    ) {
      throw new Error('Owner could not edit member task.');
    }
    console.log('PASS: Owner can edit member task.');

    const wrongOccurrence = await completeTask(
      memberClient,
      ownerTask.id,
      new Date(
        new Date(ownerOccurrence.scheduled_for).getTime() + 3_600_000,
      ).toISOString(),
    );
    if (!wrongOccurrence.error) {
      throw new Error('SECURITY BREACH: Wrong occurrence was completed.');
    }

    const memberCompletionInput = onceTaskInput(
      petId,
      'Member completion verification',
    );
    const { data: memberCompletionTask, error: memberCompletionTaskError } =
      await createTask(ownerClient, memberCompletionInput);
    if (memberCompletionTaskError || !memberCompletionTask) {
      throw new Error('Member completion task creation failed.');
    }
    const memberCompletion = await completeTask(
      memberClient,
      memberCompletionTask.id,
      memberCompletionTask.scheduled_at,
    );
    if (
      memberCompletion.error ||
      memberCompletion.data?.[0]?.result_completed_by !== member.id
    ) {
      throw new Error('Member could not complete an Owner task.');
    }
    const memberCompletionId = memberCompletion.data[0].result_completion_id;
    const { error: ownerUndoMemberError } = await ownerClient.rpc(
      'undo_care_task_completion',
      { target_completion_id: memberCompletionId },
    );
    if (ownerUndoMemberError) {
      throw new Error('Owner could not govern a Member completion.');
    }
    console.log('PASS: Member can complete owner task.');

    const [firstCompletion, secondCompletion] = await Promise.all([
      completeTask(ownerClient, ownerTask.id, ownerOccurrence.scheduled_for),
      completeTask(memberClient, ownerTask.id, ownerOccurrence.scheduled_for),
    ]);
    if (firstCompletion.error || secondCompletion.error) {
      throw new Error(
        'Concurrent completion RPC returned an unexpected error.',
      );
    }
    const statuses = [
      firstCompletion.data?.[0]?.completion_status,
      secondCompletion.data?.[0]?.completion_status,
    ];
    if (
      statuses.filter((status) => status === 'completed').length !== 1 ||
      statuses.filter((status) => status === 'already_completed').length !== 1
    ) {
      throw new Error('Concurrent completion was not idempotent.');
    }
    const { data: completionRows, error: completionReadError } =
      await ownerClient
        .from('care_task_completions')
        .select('id, care_log_id, completed_by')
        .eq('task_id', ownerTask.id);
    const completion = completionRows?.[0];
    const { data: careRows, error: careReadError } = await ownerClient
      .from('care_logs')
      .select('id, performed_by')
      .eq('id', completion?.care_log_id ?? '');
    if (
      completionReadError ||
      careReadError ||
      completionRows.length !== 1 ||
      careRows.length !== 1 ||
      careRows[0].performed_by !== completion.completed_by
    ) {
      throw new Error('Completion did not create exactly one bound Care Log.');
    }
    console.log('PASS: Completion creates care log.');
    console.log('PASS: Performer cannot be spoofed.');
    console.log('PASS: Concurrent completion creates one completion.');

    const strangerRead = await strangerClient
      .from('care_tasks')
      .select('id')
      .eq('pet_id', petId);
    const strangerCreate = await createTask(
      strangerClient,
      dailyTaskInput(petId, 'Stranger task'),
    );
    const strangerEdit = await strangerClient.rpc('update_care_task', {
      target_task_id: ownerTask.id,
      task_care_type: ownerInput.task_care_type,
      task_local_time: ownerInput.task_local_time,
      task_month_day: null,
      task_note: null,
      task_schedule_type: 'daily',
      task_scheduled_at: null,
      task_starts_on: ownerInput.task_starts_on,
      task_time_zone: ownerInput.task_time_zone,
      task_title: 'Stranger forged task',
      task_week_day: null,
    });
    const strangerDeactivate = await strangerClient.rpc(
      'deactivate_care_task',
      { target_task_id: ownerTask.id },
    );
    const strangerComplete = await completeTask(
      strangerClient,
      ownerTask.id,
      ownerOccurrence.scheduled_for,
    );
    const strangerUndo = await strangerClient.rpc('undo_care_task_completion', {
      target_completion_id: completion.id,
    });
    if (
      strangerRead.error ||
      strangerRead.data.length !== 0 ||
      !strangerCreate.error ||
      !strangerEdit.error ||
      !strangerDeactivate.error ||
      !strangerComplete.error ||
      !strangerUndo.error
    ) {
      throw new Error('RLS BREACH: Stranger accessed care tasks.');
    }
    console.log('PASS: Stranger cannot read task.');
    console.log(
      'PASS: Stranger cannot create, edit, deactivate, complete, or undo task data.',
    );

    const undoInput = onceTaskInput(petId, 'Undo verification');
    const { data: undoTask, error: undoTaskError } = await createTask(
      ownerClient,
      undoInput,
    );
    if (undoTaskError) throw new Error('Undo task creation failed.');
    const ownerCompletion = await completeTask(
      ownerClient,
      undoTask.id,
      undoTask.scheduled_at,
    );
    const ownerCompletionId = ownerCompletion.data?.[0]?.result_completion_id;
    const ownerCareLogId = ownerCompletion.data?.[0]?.result_care_log_id;
    if (ownerCompletion.error || !ownerCompletionId) {
      throw new Error('Undo completion fixture failed.');
    }
    const forbiddenUndo = await memberClient.rpc('undo_care_task_completion', {
      target_completion_id: ownerCompletionId,
    });
    if (!forbiddenUndo.error) {
      throw new Error('RLS BREACH: Member undid owner completion.');
    }
    const ownerUndo = await ownerClient.rpc('undo_care_task_completion', {
      target_completion_id: ownerCompletionId,
    });
    const { data: undoneRows } = await ownerClient
      .from('care_logs')
      .select('id')
      .eq('id', ownerCareLogId);
    if (
      ownerUndo.error ||
      ownerUndo.data !== 'undone' ||
      undoneRows.length !== 0
    ) {
      throw new Error(
        'Authorized undo did not remove completion and Care Log.',
      );
    }
    console.log('PASS: Completer or Owner can undo; other Member cannot.');

    const { error: removeError } = await ownerClient.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: member.id,
    });
    const removedRead = await memberClient
      .from('care_tasks')
      .select('id')
      .eq('pet_id', petId);
    const removedComplete = await completeTask(
      memberClient,
      ownerTask.id,
      ownerOccurrence.scheduled_for,
    );
    if (
      removeError ||
      removedRead.error ||
      removedRead.data.length !== 0 ||
      !removedComplete.error
    ) {
      throw new Error('Removed Member retained fresh task access.');
    }
    console.log('PASS: Removed member loses access.');

    await deletePet(ownerClient, petId);
    const { data: remainingTasks } = await ownerClient
      .from('care_tasks')
      .select('id')
      .eq('pet_id', petId);
    const { data: remainingCompletions } = await ownerClient
      .from('care_task_completions')
      .select('id')
      .eq('pet_id', petId);
    if (remainingTasks.length !== 0 || remainingCompletions.length !== 0) {
      throw new Error('Pet deletion left task data behind.');
    }
    petId = null;
    console.log('PASS: Pet deletion removes tasks.');
  } finally {
    if (petId) await deletePet(ownerClient, petId).catch(() => undefined);
    await Promise.all([
      ownerClient.auth.signOut(),
      memberClient.auth.signOut(),
      strangerClient.auth.signOut(),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

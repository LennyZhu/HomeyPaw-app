import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

const localUrl = process.env.SUPABASE_LOCAL_URL?.trim();
const localAnonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (!localUrl || !localAnonKey || !localServiceRoleKey) {
  throw new Error(
    'Local-only keys are required: SUPABASE_LOCAL_URL, SUPABASE_LOCAL_ANON_KEY, and SUPABASE_LOCAL_SERVICE_ROLE_KEY.',
  );
}

const parsedUrl = new URL(localUrl);
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
  throw new Error(
    'SAFETY STOP: Phase 11A Schedule verification only runs locally.',
  );
}

const admin = createClient(localUrl, localServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let auditClient;

function runLocalSql(sql) {
  execFileSync(
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
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function createTestClient() {
  return createClient(localUrl, localAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(result, message) {
  expect(Boolean(result.error), message);
}

async function allWithin(promises, label, timeoutMs = 12_000) {
  let timeout;
  try {
    return await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out; possible deadlock.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function addDays(dateOnly, count) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
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

async function createUser(label) {
  const email = `phase11a-${label.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (error || !data.user) throw error ?? new Error(`${label} create failed`);

  const client = createTestClient();
  const { data: signIn, error: signInError } =
    await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) {
    throw signInError ?? new Error(`${label} sign-in failed`);
  }
  return { client, id: data.user.id, label };
}

async function createPet(ownerClient, name) {
  const { data, error } = await ownerClient.rpc('create_pet', {
    pet_description: 'Local-only Phase 11A security fixture',
    pet_gender: 'unknown',
    pet_name: `${name} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (error || !data) throw error ?? new Error('Pet creation failed');
  return data.id;
}

async function addMembership(petId, userId, role = 'member') {
  runLocalSql(
    `insert into public.pet_members (pet_id, user_id, role) values ('${petId}'::uuid, '${userId}'::uuid, '${role}'::public.pet_member_role) on conflict (pet_id, user_id) do update set role = excluded.role;`,
  );
}

async function removeMember(ownerClient, petId, userId) {
  const result = await ownerClient.rpc('remove_pet_member', {
    target_pet_id: petId,
    target_user_id: userId,
  });
  if (result.error || result.data !== 'removed') {
    throw result.error ?? new Error('Member removal failed');
  }
  return result;
}

async function createDailyTask(
  ownerClient,
  petId,
  title,
  careType = 'feeding',
) {
  const schedule = localSchedule(new Date(), 'Asia/Hong_Kong');
  const input = {
    target_pet_id: petId,
    task_care_type: careType,
    task_id: randomUUID(),
    task_local_time: schedule.time,
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'daily',
    task_scheduled_at: null,
    task_starts_on: schedule.date,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: `${title} ${randomUUID().slice(0, 6)}`,
    task_week_day: null,
  };
  const { data: task, error } = await ownerClient.rpc(
    'create_care_task',
    input,
  );
  if (error || !task) throw error ?? new Error(`${title} task creation failed`);

  const { data: occurrences, error: occurrenceError } = await ownerClient.rpc(
    'get_care_task_occurrences',
    {
      target_pet_id: petId,
      window_end: new Date(Date.now() + 5 * 60_000).toISOString(),
      window_start: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  );
  const occurrence = occurrences?.find((item) => item.task_id === task.id);
  if (occurrenceError || !occurrence) {
    throw occurrenceError ?? new Error(`${title} occurrence lookup failed`);
  }
  return {
    localDate: schedule.date,
    scheduledFor: occurrence.scheduled_for,
    task,
  };
}

function taskItem(task) {
  return {
    care_task_id: task.task.id,
    source_scheduled_for: task.scheduledFor,
  };
}

async function createShift(client, input) {
  return client.rpc('create_care_shift', {
    shift_id: input.shiftId ?? randomUUID(),
    shift_local_date: input.localDate,
    shift_note: input.note ?? null,
    target_assignee_user_id: input.assigneeUserId,
    target_pet_id: input.petId,
    task_items: input.tasks.map(taskItem),
  });
}

async function shiftTasks(client, shiftId) {
  const { data, error } = await client
    .from('care_shift_tasks')
    .select('*')
    .eq('shift_id', shiftId)
    .order('source_scheduled_for')
    .order('id');
  if (error) throw error;
  return data;
}

async function completeShiftTask(client, shiftTaskId, ids = {}) {
  return client.rpc('complete_care_shift_task', {
    care_log_id: ids.careLogId ?? randomUUID(),
    completion_duration_minutes: null,
    completion_id: ids.completionId ?? randomUUID(),
    completion_note: null,
    target_shift_task_id: shiftTaskId,
  });
}

async function getShiftAdmin(shiftId) {
  const { data, error } = await auditClient
    .from('care_shifts')
    .select('*')
    .eq('id', shiftId)
    .single();
  if (error) throw error;
  return data;
}

async function assertRemoved(client, petId, label) {
  const direct = await client
    .from('care_shifts')
    .select('id')
    .eq('pet_id', petId);
  expect(
    !direct.error && direct.data.length === 0,
    `${label} retained direct Schedule SELECT access.`,
  );
  const range = await client.rpc('get_care_schedule_range', {
    range_end: addDays(localSchedule(new Date(), 'Asia/Hong_Kong').date, 1),
    range_start: localSchedule(new Date(), 'Asia/Hong_Kong').date,
    target_pet_id: petId,
  });
  expectError(range, `${label} retained Schedule RPC access.`);
}

async function main() {
  const users = [];
  const petIds = [];
  const owner = await createUser('Owner A');
  const member = await createUser('Member B');
  const helper = await createUser('Member C');
  const stranger = await createUser('Stranger C');
  const viewer = await createUser('Viewer D');
  users.push(owner, member, helper, stranger, viewer);
  auditClient = owner.client;

  let petId;
  try {
    petId = await createPet(owner.client, 'Phase 11A Pet');
    petIds.push(petId);
    await addMembership(petId, member.id);
    await addMembership(petId, helper.id);
    await addMembership(petId, viewer.id, 'viewer');

    const feeding = await createDailyTask(owner.client, petId, 'Feeding');
    const medicine = await createDailyTask(
      owner.client,
      petId,
      'Medicine',
      'medicine',
    );
    const walk = await createDailyTask(owner.client, petId, 'Walk', 'walk');
    const localDate = feeding.localDate;

    const ownerBundle = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      note: 'Owner bundle',
      petId,
      tasks: [feeding, medicine],
    });
    expect(
      !ownerBundle.error && ownerBundle.data?.assignee_user_id === member.id,
      `Owner bundle creation failed: ${ownerBundle.error?.message ?? 'unknown'}`,
    );
    const ownerBundleItems = await shiftTasks(
      owner.client,
      ownerBundle.data.id,
    );
    expect(
      ownerBundleItems.length === 2,
      'Owner bundle did not contain two task items.',
    );
    console.log('PASS: Owner assigned a two-item Shift bundle to Member B.');

    const memberSelf = await createShift(member.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [walk],
    });
    expect(!memberSelf.error, 'Member could not self-schedule.');
    const memberAddedTask = await createDailyTask(
      owner.client,
      petId,
      'Member added item',
    );
    const memberAdd = await member.client.rpc('add_care_shift_tasks', {
      target_shift_id: memberSelf.data.id,
      task_items: [taskItem(memberAddedTask)],
    });
    expect(
      !memberAdd.error && memberAdd.data?.length === 1,
      'Member could not add a valid occurrence to own Shift.',
    );
    const memberUpdate = await member.client.rpc('update_care_shift', {
      shift_note: 'Member updated own future Shift',
      target_assignee_user_id: member.id,
      target_shift_id: memberSelf.data.id,
    });
    expect(
      !memberUpdate.error &&
        memberUpdate.data?.note === 'Member updated own future Shift',
      'Member could not update own pending Shift.',
    );
    console.log('PASS: Member self-schedule and same-day multiple Shifts.');
    console.log(
      'PASS: Member can add an occurrence and update own pending Shift.',
    );

    const fullCancelTask = await createDailyTask(
      owner.client,
      petId,
      'Full Shift cancel',
    );
    const fullCancelShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [fullCancelTask],
    });
    const fullCancel = await member.client.rpc('cancel_care_shift', {
      target_shift_id: fullCancelShift.data.id,
    });
    expect(
      !fullCancel.error &&
        fullCancel.data === 'canceled' &&
        (await getShiftAdmin(fullCancelShift.data.id)).status === 'canceled',
      'Member could not soft-cancel own fully pending Shift.',
    );
    console.log('PASS: full pending Shift soft-cancel.');

    const assignOtherTask = await createDailyTask(
      owner.client,
      petId,
      'Assign other denied',
    );
    expectError(
      await createShift(member.client, {
        assigneeUserId: helper.id,
        localDate,
        petId,
        tasks: [assignOtherTask],
      }),
      'Member assigned another Member.',
    );
    const unassignedDeniedTask = await createDailyTask(
      owner.client,
      petId,
      'Unassigned denied',
    );
    expectError(
      await createShift(member.client, {
        assigneeUserId: null,
        localDate,
        petId,
        tasks: [unassignedDeniedTask],
      }),
      'Member created an unassigned Shift.',
    );
    console.log(
      'PASS: Member cannot assign others or create unassigned Shifts.',
    );

    expectError(
      await createShift(owner.client, {
        assigneeUserId: helper.id,
        localDate,
        petId,
        tasks: [feeding],
      }),
      'Duplicate Care Task occurrence assignment was accepted.',
    );
    const forgedTask = await createDailyTask(
      owner.client,
      petId,
      'Forged occurrence',
    );
    const forged = await owner.client.rpc('create_care_shift', {
      shift_id: randomUUID(),
      shift_local_date: localDate,
      shift_note: null,
      target_assignee_user_id: member.id,
      target_pet_id: petId,
      task_items: [
        {
          care_task_id: forgedTask.task.id,
          source_scheduled_for: new Date(
            new Date(forgedTask.scheduledFor).getTime() + 3_600_000,
          ).toISOString(),
        },
      ],
    });
    expectError(forged, 'Forged occurrence timestamp was accepted.');
    const mismatchTask = await createDailyTask(
      owner.client,
      petId,
      'Date mismatch',
    );
    expectError(
      await createShift(owner.client, {
        assigneeUserId: member.id,
        localDate: addDays(localDate, 1),
        petId,
        tasks: [mismatchTask],
      }),
      'Task-zone local-date mismatch was accepted.',
    );

    const crossPetId = await createPet(owner.client, 'Phase 11A Cross Pet');
    petIds.push(crossPetId);
    const crossTask = await createDailyTask(
      owner.client,
      crossPetId,
      'Cross Pet task',
    );
    expectError(
      await createShift(owner.client, {
        assigneeUserId: member.id,
        localDate,
        petId,
        tasks: [crossTask],
      }),
      'Cross-Pet task occurrence was accepted.',
    );
    console.log(
      'PASS: duplicate, forged, wrong-date, and cross-Pet occurrences denied.',
    );

    const directInsert = await owner.client.from('care_shifts').insert({
      id: randomUUID(),
      local_date: localDate,
      pet_id: petId,
    });
    const directUpdate = await owner.client
      .from('care_shifts')
      .update({ note: 'forbidden' })
      .eq('id', ownerBundle.data.id);
    const directDelete = await owner.client
      .from('care_shift_tasks')
      .delete()
      .eq('id', ownerBundleItems[0].id);
    expect(
      directInsert.error && directUpdate.error && directDelete.error,
      'Direct Schedule table mutation was exposed.',
    );

    for (const [actor, label] of [
      [stranger, 'Stranger'],
      [viewer, 'Viewer'],
    ]) {
      const direct = await actor.client
        .from('care_shifts')
        .select('id')
        .eq('pet_id', petId);
      expect(
        !direct.error && direct.data.length === 0,
        `${label} read Schedule rows.`,
      );
      const deniedTask = await createDailyTask(
        owner.client,
        petId,
        `${label} denied fixture`,
      );
      expectError(
        await createShift(actor.client, {
          assigneeUserId: actor.id,
          localDate,
          petId,
          tasks: [deniedTask],
        }),
        `${label} created a Schedule.`,
      );
      expectError(
        await actor.client.rpc('get_care_schedule_range', {
          range_end: addDays(localDate, 1),
          range_start: localDate,
          target_pet_id: petId,
        }),
        `${label} used the Schedule range RPC.`,
      );
      const deniedOperations = await allWithin(
        [
          actor.client.rpc('update_care_shift', {
            shift_note: 'forbidden',
            target_assignee_user_id: actor.id,
            target_shift_id: ownerBundle.data.id,
          }),
          actor.client.rpc('cancel_care_shift', {
            target_shift_id: ownerBundle.data.id,
          }),
          actor.client.rpc('claim_care_shift', {
            target_shift_id: ownerBundle.data.id,
          }),
          actor.client.rpc('add_care_shift_tasks', {
            target_shift_id: ownerBundle.data.id,
            task_items: [taskItem(deniedTask)],
          }),
          actor.client.rpc('cancel_care_shift_task', {
            target_shift_task_id: ownerBundleItems[0].id,
          }),
          completeShiftTask(actor.client, ownerBundleItems[0].id),
        ],
        `${label} denied operations`,
      );
      expect(
        deniedOperations.every((result) => result.error),
        `${label} obtained a Schedule mutation.`,
      );
    }
    console.log('PASS: Stranger and dormant Viewer have zero Schedule access.');

    const legacyTask = await createDailyTask(
      owner.client,
      petId,
      'Legacy completion compatibility',
    );
    const legacyShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [legacyTask],
    });
    const [legacyShiftItem] = await shiftTasks(
      owner.client,
      legacyShift.data.id,
    );
    const legacyCompletionId = randomUUID();
    const legacyCareLogId = randomUUID();
    const scheduleCompletionId = randomUUID();
    const scheduleCareLogId = randomUUID();
    const legacyCompletion = await helper.client.rpc('complete_care_task', {
      care_log_id: legacyCareLogId,
      completion_duration_minutes: null,
      completion_id: legacyCompletionId,
      completion_note: null,
      occurrence_scheduled_for: legacyTask.scheduledFor,
      target_task_id: legacyTask.task.id,
    });
    expect(
      !legacyCompletion.error &&
        legacyCompletion.data?.[0]?.result_completed_by === helper.id,
      `Legacy completion failed: ${legacyCompletion.error?.message ?? 'unknown'}`,
    );
    const legacyRange = await owner.client.rpc('get_care_schedule_range', {
      range_end: addDays(localDate, 1),
      range_start: localDate,
      target_pet_id: petId,
    });
    const legacyRangeItem = legacyRange.data?.find(
      (item) => item.shift_task_id === legacyShiftItem.id,
    );
    expect(
      !legacyRange.error &&
        legacyRangeItem?.completion_id === legacyCompletionId &&
        legacyRangeItem.completed_by === helper.id,
      'Schedule range did not resolve a legacy unlinked completion.',
    );
    const scheduleAfterLegacy = await completeShiftTask(
      helper.client,
      legacyShiftItem.id,
      {
        careLogId: scheduleCareLogId,
        completionId: scheduleCompletionId,
      },
    );
    expect(
      !scheduleAfterLegacy.error &&
        scheduleAfterLegacy.data?.[0]?.completion_status ===
          'already_completed' &&
        scheduleAfterLegacy.data?.[0]?.result_completion_id ===
          legacyCompletionId,
      `Schedule wrapper did not return the legacy completion idempotently: ${scheduleAfterLegacy.error?.message ?? 'unknown'}`,
    );
    const [{ data: compatibleCompletions }, { data: compatibleLogs }] =
      await Promise.all([
        owner.client
          .from('care_task_completions')
          .select('id, care_log_id, care_shift_task_id')
          .in('id', [legacyCompletionId, scheduleCompletionId]),
        owner.client
          .from('care_logs')
          .select('id')
          .in('id', [legacyCareLogId, scheduleCareLogId]),
      ]);
    expect(
      compatibleCompletions?.length === 1 &&
        compatibleLogs?.length === 1 &&
        compatibleCompletions[0].id === legacyCompletionId &&
        compatibleCompletions[0].care_log_id === legacyCareLogId &&
        compatibleCompletions[0].care_shift_task_id === legacyShiftItem.id,
      'Legacy-to-Schedule completion created a duplicate or failed safe backfill.',
    );
    console.log(
      'PASS: legacy completion fallback, idempotent Schedule completion, and safe link backfill.',
    );

    const helperCompletion = await completeShiftTask(
      helper.client,
      ownerBundleItems[0].id,
    );
    expect(
      !helperCompletion.error &&
        helperCompletion.data?.[0]?.result_completed_by === helper.id,
      `Helper completion failed: ${helperCompletion.error?.message ?? 'unknown'}`,
    );
    const { data: linkedCompletion } = await owner.client
      .from('care_task_completions')
      .select('*')
      .eq('care_shift_task_id', ownerBundleItems[0].id)
      .single();
    expect(
      linkedCompletion?.task_id === ownerBundleItems[0].care_task_id &&
        linkedCompletion?.scheduled_for ===
          ownerBundleItems[0].source_scheduled_for &&
        linkedCompletion?.completed_by === helper.id &&
        ownerBundle.data.assignee_user_id === member.id,
      'Completion link, occurrence identity, or assignee/completer separation failed.',
    );
    expectError(
      await member.client.rpc('cancel_care_shift_task', {
        target_shift_task_id: ownerBundleItems[0].id,
      }),
      'Completed Shift Task was mutable.',
    );
    const cancelRemaining = await member.client.rpc('cancel_care_shift_task', {
      target_shift_task_id: ownerBundleItems[1].id,
    });
    expect(
      !cancelRemaining.error,
      'Member could not cancel pending remainder.',
    );
    expectError(
      await completeShiftTask(helper.client, ownerBundleItems[1].id),
      'Canceled Shift Task was completed.',
    );
    expect(
      (await getShiftAdmin(ownerBundle.data.id)).status === 'scheduled',
      'Partially completed Shift history was incorrectly canceled.',
    );
    console.log(
      'PASS: item completion is independent; B assignee/C completer preserved.',
    );
    console.log(
      'PASS: completed item immutable and pending remainder cancelable.',
    );

    const claimTask = await createDailyTask(owner.client, petId, 'Claim race');
    const claimable = await createShift(owner.client, {
      assigneeUserId: null,
      localDate,
      petId,
      tasks: [claimTask],
    });
    expect(!claimable.error, 'Owner could not create a claimable Shift.');
    const claimResults = await allWithin(
      [
        member.client.rpc('claim_care_shift', {
          target_shift_id: claimable.data.id,
        }),
        helper.client.rpc('claim_care_shift', {
          target_shift_id: claimable.data.id,
        }),
      ],
      'Concurrent Shift claim',
    );
    expect(
      claimResults.filter((result) => !result.error).length === 1 &&
        claimResults.filter((result) => result.error).length === 1 &&
        ['already_claimed'].some((message) =>
          claimResults.some((result) =>
            result.error?.message.includes(message),
          ),
        ),
      'Concurrent whole-Shift claim did not produce one winner and one loser.',
    );
    console.log('PASS: concurrent whole-Shift claim has exactly one winner.');

    const deactivatePendingTask = await createDailyTask(
      owner.client,
      petId,
      'Deactivate pending',
    );
    const deactivatePendingShift = await createShift(owner.client, {
      assigneeUserId: helper.id,
      localDate,
      petId,
      tasks: [deactivatePendingTask],
    });
    const [deactivatePendingItem] = await shiftTasks(
      owner.client,
      deactivatePendingShift.data.id,
    );
    const deactivatePending = await owner.client.rpc('deactivate_care_task', {
      target_task_id: deactivatePendingTask.task.id,
    });
    expect(!deactivatePending.error, 'Task deactivation failed.');
    const { data: canceledByDeactivation } = await owner.client
      .from('care_shift_tasks')
      .select('status, canceled_at')
      .eq('id', deactivatePendingItem.id)
      .single();
    expect(
      canceledByDeactivation.status === 'canceled' &&
        canceledByDeactivation.canceled_at &&
        (await getShiftAdmin(deactivatePendingShift.data.id)).status ===
          'canceled',
      'Task deactivation did not soft-cancel the future pending item/empty Shift.',
    );

    const deactivateHistoryTask = await createDailyTask(
      owner.client,
      petId,
      'Deactivate completed history',
    );
    const deactivateHistoryShift = await createShift(owner.client, {
      assigneeUserId: helper.id,
      localDate,
      petId,
      tasks: [deactivateHistoryTask],
    });
    const [deactivateHistoryItem] = await shiftTasks(
      owner.client,
      deactivateHistoryShift.data.id,
    );
    expect(
      !(await completeShiftTask(helper.client, deactivateHistoryItem.id)).error,
      'Historical completion fixture failed.',
    );
    expect(
      !(
        await owner.client.rpc('deactivate_care_task', {
          target_task_id: deactivateHistoryTask.task.id,
        })
      ).error,
      'Completed Task deactivation failed.',
    );
    const { data: preservedHistoryItem } = await owner.client
      .from('care_shift_tasks')
      .select('status')
      .eq('id', deactivateHistoryItem.id)
      .single();
    expect(
      preservedHistoryItem.status === 'scheduled',
      'Task deactivation rewrote completed Shift Task history.',
    );
    console.log(
      'PASS: Task deactivation cancels pending but preserves completed history.',
    );

    const deactivateRaceTask = await createDailyTask(
      owner.client,
      petId,
      'Deactivate vs cancel race',
    );
    const deactivateRaceShift = await createShift(owner.client, {
      assigneeUserId: helper.id,
      localDate,
      petId,
      tasks: [deactivateRaceTask],
    });
    const [deactivateRace] = await allWithin(
      [
        owner.client.rpc('deactivate_care_task', {
          target_task_id: deactivateRaceTask.task.id,
        }),
        helper.client.rpc('cancel_care_shift', {
          target_shift_id: deactivateRaceShift.data.id,
        }),
      ],
      'Task deactivation vs Shift cancel',
    );
    expect(
      !deactivateRace.error &&
        (await getShiftAdmin(deactivateRaceShift.data.id)).status ===
          'canceled',
      'Task deactivation vs Shift cancel did not serialize safely.',
    );
    console.log('PASS: Task deactivation vs Shift cancel has no deadlock.');

    const removalPendingTask = await createDailyTask(
      owner.client,
      petId,
      'Removal fully pending',
    );
    const removalPendingShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [removalPendingTask],
    });
    const [removalPendingItem] = await shiftTasks(
      owner.client,
      removalPendingShift.data.id,
    );
    const removalCompleteTask = await createDailyTask(
      owner.client,
      petId,
      'Removal fully complete',
    );
    const removalCompleteShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [removalCompleteTask],
    });
    const [removalCompleteItem] = await shiftTasks(
      owner.client,
      removalCompleteShift.data.id,
    );
    expect(
      !(await completeShiftTask(helper.client, removalCompleteItem.id)).error,
      'Fully completed removal fixture failed.',
    );
    const removalPartialA = await createDailyTask(
      owner.client,
      petId,
      'Removal partial completed',
    );
    const removalPartialB = await createDailyTask(
      owner.client,
      petId,
      'Removal partial pending',
    );
    const removalPartialShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [removalPartialA, removalPartialB],
    });
    const removalPartialItems = await shiftTasks(
      owner.client,
      removalPartialShift.data.id,
    );
    expect(
      !(await completeShiftTask(helper.client, removalPartialItems[0].id))
        .error,
      'Partially completed removal fixture failed.',
    );

    await removeMember(owner.client, petId, member.id);
    expect(
      (await getShiftAdmin(removalPendingShift.data.id)).assignee_user_id ===
        null,
      'Fully pending removed-member Shift did not become claimable.',
    );
    expect(
      (await getShiftAdmin(removalCompleteShift.data.id)).assignee_user_id ===
        member.id,
      'Fully completed removed-member history was rewritten.',
    );
    const partialOriginal = await getShiftAdmin(removalPartialShift.data.id);
    const { data: splitShifts, error: splitError } = await owner.client
      .from('care_shifts')
      .select('*')
      .eq('split_from_shift_id', removalPartialShift.data.id);
    expect(
      !splitError &&
        partialOriginal.assignee_user_id === member.id &&
        splitShifts.length === 1 &&
        splitShifts[0].assignee_user_id === null &&
        (await shiftTasks(owner.client, partialOriginal.id)).length === 1 &&
        (await shiftTasks(owner.client, splitShifts[0].id)).length === 1,
      'Partially completed Shift was not split into history and claimable pending work.',
    );
    await assertRemoved(member.client, petId, 'Removed Member');
    expectError(
      await member.client.rpc('claim_care_shift', {
        target_shift_id: removalPendingShift.data.id,
      }),
      'Removed Member claimed a Shift.',
    );
    expectError(
      await member.client.rpc('update_care_shift', {
        shift_note: 'forbidden',
        target_assignee_user_id: member.id,
        target_shift_id: removalCompleteShift.data.id,
      }),
      'Removed Member updated a Shift.',
    );
    const removedCreateTask = await createDailyTask(
      owner.client,
      petId,
      'Removed create denied',
    );
    const removedDeniedOperations = await allWithin(
      [
        createShift(member.client, {
          assigneeUserId: member.id,
          localDate,
          petId,
          tasks: [removedCreateTask],
        }),
        member.client.rpc('add_care_shift_tasks', {
          target_shift_id: removalPendingShift.data.id,
          task_items: [taskItem(removedCreateTask)],
        }),
        member.client.rpc('cancel_care_shift', {
          target_shift_id: removalPendingShift.data.id,
        }),
        member.client.rpc('cancel_care_shift_task', {
          target_shift_task_id: removalPendingItem.id,
        }),
        completeShiftTask(member.client, removalPendingItem.id),
      ],
      'Removed Member denied operations',
    );
    expect(
      removedDeniedOperations.every((result) => result.error),
      'Removed Member retained create/add/cancel/complete access.',
    );
    console.log(
      'PASS: removed Member pending/full/partial lifecycle and zero access.',
    );

    async function rejoinMember() {
      await addMembership(petId, member.id);
    }

    const raceLabels = [];
    await rejoinMember();
    const raceClaimTask = await createDailyTask(
      owner.client,
      petId,
      'Remove vs claim',
    );
    const raceClaimShift = await createShift(owner.client, {
      assigneeUserId: null,
      localDate,
      petId,
      tasks: [raceClaimTask],
    });
    const [removeClaim, claimRace] = await allWithin(
      [
        owner.client.rpc('remove_pet_member', {
          target_pet_id: petId,
          target_user_id: member.id,
        }),
        member.client.rpc('claim_care_shift', {
          target_shift_id: raceClaimShift.data.id,
        }),
      ],
      'Remove vs claim',
    );
    expect(
      !removeClaim.error,
      `Remove vs claim failed: ${removeClaim.error?.message}`,
    );
    expect(
      (await getShiftAdmin(raceClaimShift.data.id)).assignee_user_id === null,
      'Remove vs claim left the removed Member assigned.',
    );
    raceLabels.push(claimRace.error ? 'claim-denied' : 'claim-then-unassigned');

    await rejoinMember();
    const raceUpdateTask = await createDailyTask(
      owner.client,
      petId,
      'Remove vs update',
    );
    const raceUpdateShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [raceUpdateTask],
    });
    const [removeUpdate, updateRace] = await allWithin(
      [
        owner.client.rpc('remove_pet_member', {
          target_pet_id: petId,
          target_user_id: member.id,
        }),
        member.client.rpc('update_care_shift', {
          shift_note: 'Concurrent update',
          target_assignee_user_id: member.id,
          target_shift_id: raceUpdateShift.data.id,
        }),
      ],
      'Remove vs update',
    );
    expect(
      !removeUpdate.error,
      `Remove vs update failed: ${removeUpdate.error?.message}`,
    );
    expect(
      (await getShiftAdmin(raceUpdateShift.data.id)).assignee_user_id === null,
      'Remove vs update left the removed Member assigned.',
    );
    raceLabels.push(
      updateRace.error ? 'update-denied' : 'update-then-unassigned',
    );

    await rejoinMember();
    const raceCancelTask = await createDailyTask(
      owner.client,
      petId,
      'Remove vs cancel',
    );
    const raceCancelShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [raceCancelTask],
    });
    const [removeCancel, cancelRace] = await allWithin(
      [
        owner.client.rpc('remove_pet_member', {
          target_pet_id: petId,
          target_user_id: member.id,
        }),
        member.client.rpc('cancel_care_shift', {
          target_shift_id: raceCancelShift.data.id,
        }),
      ],
      'Remove vs cancel',
    );
    expect(
      !removeCancel.error,
      `Remove vs cancel failed: ${removeCancel.error?.message}`,
    );
    const canceledRaceShift = await getShiftAdmin(raceCancelShift.data.id);
    expect(
      canceledRaceShift.assignee_user_id === null ||
        canceledRaceShift.status === 'canceled',
      'Remove vs cancel left active responsibility assigned to removed Member.',
    );
    raceLabels.push(cancelRace.error ? 'cancel-denied' : 'cancel-serialized');

    await rejoinMember();
    const raceCompleteTask = await createDailyTask(
      owner.client,
      petId,
      'Remove vs complete',
    );
    const raceCompleteShift = await createShift(owner.client, {
      assigneeUserId: member.id,
      localDate,
      petId,
      tasks: [raceCompleteTask],
    });
    const [raceCompleteItem] = await shiftTasks(
      owner.client,
      raceCompleteShift.data.id,
    );
    const [removeComplete, completeRace] = await allWithin(
      [
        owner.client.rpc('remove_pet_member', {
          target_pet_id: petId,
          target_user_id: member.id,
        }),
        completeShiftTask(member.client, raceCompleteItem.id),
      ],
      'Remove vs complete',
    );
    expect(
      !removeComplete.error,
      `Remove vs complete failed: ${removeComplete.error?.message}`,
    );
    await assertRemoved(member.client, petId, 'Race-removed Member');
    raceLabels.push(
      completeRace.error ? 'complete-denied' : 'complete-before-removal',
    );
    console.log(
      `PASS: remove concurrency serialized (${raceLabels.join(', ')}).`,
    );

    const deletionMember = await createUser('Account deletion Member');
    users.push(deletionMember);
    await addMembership(petId, deletionMember.id);
    const deletionTask = await createDailyTask(
      owner.client,
      petId,
      'Account deletion pending',
    );
    const deletionShift = await createShift(owner.client, {
      assigneeUserId: deletionMember.id,
      localDate,
      petId,
      tasks: [deletionTask],
    });
    const deletionCompletedTask = await createDailyTask(
      owner.client,
      petId,
      'Account deletion completed item',
    );
    const deletionPendingSplitTask = await createDailyTask(
      owner.client,
      petId,
      'Account deletion split item',
    );
    const deletionPartialShift = await createShift(owner.client, {
      assigneeUserId: deletionMember.id,
      localDate,
      petId,
      tasks: [deletionCompletedTask, deletionPendingSplitTask],
    });
    const deletionPartialItems = await shiftTasks(
      owner.client,
      deletionPartialShift.data.id,
    );
    expect(
      !(await completeShiftTask(helper.client, deletionPartialItems[0].id))
        .error,
      'Account deletion partial fixture completion failed.',
    );
    const deleteUserResult = await admin.auth.admin.deleteUser(
      deletionMember.id,
    );
    expect(!deleteUserResult.error, 'Member Auth account deletion failed.');
    expect(
      (await getShiftAdmin(deletionShift.data.id)).assignee_user_id === null,
      'Member account deletion left a future assignee FK.',
    );
    const { data: deletionSplit } = await owner.client
      .from('care_shifts')
      .select('*')
      .eq('split_from_shift_id', deletionPartialShift.data.id);
    expect(
      (await getShiftAdmin(deletionPartialShift.data.id)).assignee_user_id ===
        null &&
        deletionSplit.length === 1 &&
        deletionSplit[0].assignee_user_id === null &&
        (await shiftTasks(owner.client, deletionPartialShift.data.id))
          .length === 1 &&
        (await shiftTasks(owner.client, deletionSplit[0].id)).length === 1,
      'Member account deletion did not preserve completion and split pending work.',
    );
    console.log(
      'PASS: Member account deletion unassigns pending and splits partial history.',
    );

    const ownerTwo = await createUser('Owner Plan A');
    users.push(ownerTwo);
    const ownerTwoPet = await createPet(ownerTwo.client, 'Owner Plan A Pet');
    petIds.push(ownerTwoPet);
    const ownerTwoTask = await createDailyTask(
      ownerTwo.client,
      ownerTwoPet,
      'Owner Plan A task',
    );
    const ownerTwoShift = await createShift(ownerTwo.client, {
      assigneeUserId: ownerTwo.id,
      localDate: ownerTwoTask.localDate,
      petId: ownerTwoPet,
      tasks: [ownerTwoTask],
    });
    expect(!ownerTwoShift.error, 'Owner Plan A Schedule fixture failed.');
    runLocalSql(`delete from public.pets where id = '${ownerTwoPet}'::uuid;`);
    const ownerDelete = await admin.auth.admin.deleteUser(ownerTwo.id);
    expect(!ownerDelete.error, 'Owner Plan A account deletion failed.');
    runLocalSql(
      `do $$ begin if exists (select 1 from public.care_shifts where pet_id = '${ownerTwoPet}'::uuid) then raise exception 'Owner Plan A left Schedule rows'; end if; end $$;`,
    );
    console.log('PASS: Owner Plan A deletes Pet schedule before Auth account.');

    const start = localDate;
    const range42 = await owner.client.rpc('get_care_schedule_range', {
      range_end: addDays(start, 42),
      range_start: start,
      target_pet_id: petId,
    });
    expect(!range42.error, `42-day range failed: ${range42.error?.message}`);
    const range42Again = await owner.client.rpc('get_care_schedule_range', {
      range_end: addDays(start, 42),
      range_start: start,
      target_pet_id: petId,
    });
    expect(
      !range42Again.error &&
        JSON.stringify(range42.data?.map((item) => item.shift_task_id)) ===
          JSON.stringify(range42Again.data?.map((item) => item.shift_task_id)),
      'Schedule range ordering was unstable.',
    );
    expectError(
      await owner.client.rpc('get_care_schedule_range', {
        range_end: addDays(start, 43),
        range_start: start,
        target_pet_id: petId,
      }),
      '43-day range was accepted.',
    );
    console.log(
      'PASS: 42-day range succeeds, 43-day range rejects, ordering stable.',
    );

    runLocalSql(`delete from public.pets where id = '${petId}'::uuid;`);
    runLocalSql(
      `do $$ begin if exists (select 1 from public.care_shifts where pet_id = '${petId}'::uuid) or exists (select 1 from public.care_shift_tasks where pet_id = '${petId}'::uuid) or exists (select 1 from public.care_task_completions where pet_id = '${petId}'::uuid) then raise exception 'Pet deletion left Schedule or completion rows'; end if; end $$;`,
    );
    petIds.splice(petIds.indexOf(petId), 1);
    console.log(
      'PASS: Pet deletion cascades without Schedule/completion orphans.',
    );
    console.log(
      'PASS: no Schedule Realtime or notification behavior was introduced.',
    );
  } finally {
    for (const id of petIds) {
      runLocalSql(`delete from public.pets where id = '${id}'::uuid;`);
    }
    for (const user of users) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

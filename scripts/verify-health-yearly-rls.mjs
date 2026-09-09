import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
if (!url || !anonKey || !serviceKey)
  throw new Error('Local Supabase keys are required.');
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: health/yearly verification is local only.');
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
const users = [];
const pets = [];

function sql(statement) {
  execFileSync('docker', [
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
    statement,
  ]);
}
function expect(value, message) {
  if (!value) throw new Error(message);
}
function testClient() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
async function user(label) {
  const email = `batch2-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label },
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error('user create failed');
  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const result = { client, id: created.data.user.id };
  users.push(result);
  return result;
}
async function pet(owner, label) {
  const result = await owner.rpc('create_pet', {
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 6)}`,
    pet_species: 'other',
  });
  if (result.error || !result.data)
    throw result.error ?? new Error('pet create failed');
  pets.push(result.data.id);
  return result.data.id;
}
function membership(petId, userId, role = 'member') {
  sql(
    `insert into public.pet_members (pet_id,user_id,role) values ('${petId}'::uuid,'${userId}'::uuid,'${role}'::public.pet_member_role);`,
  );
}
async function health(client, petId, subtype, note = null, id = randomUUID()) {
  return client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_health_subtype: subtype,
    care_id: id,
    care_kind: 'health',
    care_note: note,
    care_occurred_at: new Date(Date.now() - 60_000).toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: petId,
  });
}
async function yearly(
  client,
  petId,
  { category = 'standard', date, time = '09:00:00', title },
) {
  return client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: null,
    task_category: category,
    task_id: randomUUID(),
    task_local_time: time,
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'yearly',
    task_scheduled_at: null,
    task_starts_on: date,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: title,
    task_week_day: null,
  });
}
async function occurrences(client, petId, start, end) {
  return client.rpc('get_care_task_occurrences', {
    target_pet_id: petId,
    window_end: end,
    window_start: start,
  });
}
function hkTodayAndTime() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:00`,
  };
}

function addDays(dateOnly, count) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

try {
  const owner = await user('Owner');
  const member = await user('Member');
  const viewer = await user('Viewer');
  const stranger = await user('Stranger');
  const removed = await user('Removed');
  const petId = await pet(owner.client, 'Batch 2');
  membership(petId, member.id);
  membership(petId, viewer.id, 'viewer');
  membership(petId, removed.id);
  await owner.client.rpc('remove_pet_member', {
    target_pet_id: petId,
    target_user_id: removed.id,
  });

  const [stool, vomiting, energy] = await Promise.all([
    health(owner.client, petId, 'stool', 'Normal observation'),
    health(member.client, petId, 'vomiting'),
    health(member.client, petId, 'energy', 'Bright and playful'),
  ]);
  expect(
    !stool.error && stool.data?.performed_by === owner.id,
    'Owner stool observation failed.',
  );
  expect(
    !vomiting.error && vomiting.data?.note === null,
    'Member empty-note vomiting observation failed.',
  );
  expect(
    !energy.error && energy.data?.health_subtype === 'energy',
    'Member energy observation failed.',
  );
  const duplicateId = randomUUID();
  const first = await health(owner.client, petId, 'stool', null, duplicateId);
  const retry = await health(owner.client, petId, 'stool', null, duplicateId);
  expect(
    !first.error && retry.data?.id === first.data?.id,
    'Health idempotency failed.',
  );
  for (const [label, client] of [
    ['Viewer', viewer.client],
    ['Stranger', stranger.client],
    ['Removed', removed.client],
  ]) {
    const create = await health(client, petId, 'stool');
    const read = await client
      .from('care_logs')
      .select('id')
      .eq('pet_id', petId);
    expect(
      Boolean(create.error) && !read.error && read.data.length === 0,
      `${label} accessed health logs.`,
    );
  }
  const posts = await owner.client
    .from('posts')
    .select('id')
    .eq('pet_id', petId);
  const tasks = await owner.client
    .from('care_tasks')
    .select('id')
    .eq('pet_id', petId);
  expect(
    posts.data?.length === 0 && tasks.data?.length === 0,
    `Health observation created a post or reminder (${posts.error?.message ?? posts.data?.length}/${tasks.error?.message ?? tasks.data?.length}).`,
  );
  console.log(
    'PASS: health owner/member creation, subtype, optional note, idempotency, and access boundaries.',
  );

  const ordinary = await yearly(owner.client, petId, {
    date: '2026-10-15',
    title: 'Yearly ordinary',
  });
  expect(
    !ordinary.error && ordinary.data?.task_category === 'standard',
    'Ordinary yearly create failed.',
  );
  const ordinaryRange = await occurrences(
    owner.client,
    petId,
    '2027-10-14T16:00:00.000Z',
    '2027-10-16T16:00:00.000Z',
  );
  expect(
    ordinaryRange.data?.some(
      (item) =>
        item.task_id === ordinary.data.id &&
        item.scheduled_for === '2027-10-15T01:00:00+00:00',
    ),
    'Ordinary yearly occurrence failed.',
  );
  const birthday = await yearly(owner.client, petId, {
    category: 'birthday',
    date: '2028-02-29',
    title: 'Birthday leap fixture',
  });
  expect(
    !birthday.error && birthday.data?.schedule_type === 'yearly',
    'Birthday yearly create failed.',
  );
  const leapRange = await occurrences(
    owner.client,
    petId,
    '2029-02-27T16:00:00.000Z',
    '2029-03-01T16:00:00.000Z',
  );
  expect(
    leapRange.data?.some(
      (item) =>
        item.task_id === birthday.data.id &&
        item.scheduled_for === '2029-02-28T01:00:00+00:00' &&
        item.task_category === 'birthday',
    ),
    'Feb 29 fallback/category projection failed.',
  );
  const edge = await occurrences(
    owner.client,
    petId,
    '2029-02-28T01:00:00.000Z',
    '2029-02-28T01:00:01.000Z',
  );
  const excluded = await occurrences(
    owner.client,
    petId,
    '2029-02-28T00:59:59.000Z',
    '2029-02-28T01:00:00.000Z',
  );
  expect(
    edge.data?.some((item) => item.task_id === birthday.data.id) &&
      !excluded.data?.some((item) => item.task_id === birthday.data.id),
    'Half-open range boundaries failed.',
  );
  const birthdayEdit = await owner.client.rpc('update_care_task', {
    target_task_id: birthday.data.id,
    task_care_type: null,
    task_category: 'birthday',
    task_local_time: '10:00:00',
    task_month_day: null,
    task_note: 'Edited birthday note',
    task_schedule_type: 'yearly',
    task_scheduled_at: null,
    task_starts_on: '2028-02-29',
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'Edited birthday title',
    task_week_day: null,
  });
  expect(
    !birthdayEdit.error &&
      birthdayEdit.data?.task_category === 'birthday' &&
      birthdayEdit.data?.title === 'Edited birthday title',
    'Birthday category did not persist through edit.',
  );
  const categoryEdit = await owner.client.rpc('update_care_task', {
    target_task_id: birthday.data.id,
    task_care_type: null,
    task_category: 'standard',
    task_local_time: '09:00:00',
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'yearly',
    task_scheduled_at: null,
    task_starts_on: '2028-02-29',
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'Edited leap reminder',
    task_week_day: null,
  });
  expect(
    !categoryEdit.error &&
      categoryEdit.data?.task_category === 'standard' &&
      categoryEdit.data?.schedule_type === 'yearly',
    'Category edit changed recurrence.',
  );
  console.log(
    'PASS: yearly, Birthday category, Feb 29 fallback, and range edges.',
  );

  const now = hkTodayAndTime();
  const due = await yearly(owner.client, petId, {
    date: now.date,
    time: now.time,
    title: 'Yearly completion',
  });
  const dueRange = await occurrences(
    owner.client,
    petId,
    new Date(Date.now() - 120_000).toISOString(),
    new Date(Date.now() + 120_000).toISOString(),
  );
  const dueOccurrence = dueRange.data?.find(
    (item) => item.task_id === due.data?.id,
  );
  expect(dueOccurrence, 'Due yearly occurrence missing.');
  const ids = {
    care_log_id: randomUUID(),
    completion_id: randomUUID(),
    occurrence_scheduled_for: dueOccurrence.scheduled_for,
    target_task_id: due.data.id,
  };
  const complete = await owner.client.rpc('complete_care_task', ids);
  const repeat = await owner.client.rpc('complete_care_task', {
    ...ids,
    care_log_id: randomUUID(),
    completion_id: randomUUID(),
  });
  expect(
    complete.data?.[0]?.completion_status === 'completed' &&
      repeat.data?.[0]?.result_completion_id ===
        complete.data[0].result_completion_id,
    'Yearly completion uniqueness failed.',
  );

  const scheduled = await yearly(owner.client, petId, {
    date: now.date,
    time: now.time,
    title: 'Yearly schedule',
  });
  const scheduleRange = await occurrences(
    owner.client,
    petId,
    new Date(Date.now() - 120_000).toISOString(),
    new Date(Date.now() + 120_000).toISOString(),
  );
  const scheduledOccurrence = scheduleRange.data?.find(
    (item) => item.task_id === scheduled.data?.id,
  );
  const shift = await owner.client.rpc('create_care_shift', {
    shift_id: randomUUID(),
    shift_local_date: now.date,
    shift_note: null,
    target_assignee_user_id: owner.id,
    target_pet_id: petId,
    task_items: [
      {
        care_task_id: scheduled.data.id,
        source_scheduled_for: scheduledOccurrence.scheduled_for,
      },
    ],
  });
  expect(
    !shift.error,
    `Yearly Schedule compatibility failed: ${shift.error?.message}`,
  );
  console.log(
    'PASS: yearly completion uniqueness and Schedule occurrence validation.',
  );

  const rollingBirthday = await yearly(owner.client, petId, {
    category: 'birthday',
    date: addDays(now.date, 10),
    time: '09:00:00',
    title: 'Birthday inside rolling window',
  });
  const rollingRange = await occurrences(
    owner.client,
    petId,
    new Date().toISOString(),
    new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  );
  expect(
    rollingRange.data?.some(
      (item) =>
        item.task_id === rollingBirthday.data?.id &&
        item.task_category === 'birthday',
    ),
    'Birthday did not enter the existing 30-day notification occurrence window.',
  );
  console.log(
    'PASS: Birthday occurrence enters the existing 30-day notification window.',
  );

  const cascadePet = await pet(owner.client, 'Cascade');
  await health(owner.client, cascadePet, 'stool');
  const petDelete = await owner.client
    .from('pets')
    .delete()
    .eq('id', cascadePet);
  expect(!petDelete.error, 'Pet cascade fixture delete failed.');
  const orphan = await owner.client
    .from('care_logs')
    .select('id')
    .eq('pet_id', cascadePet);
  expect(orphan.data?.length === 0, 'Pet cascade left a health log orphan.');
  const departing = await user('Departing member');
  membership(petId, departing.id);
  const departingLog = await health(departing.client, petId, 'energy');
  expect(!departingLog.error, 'Departing member health fixture failed.');
  await admin.auth.admin.deleteUser(departing.id);
  users.splice(users.indexOf(departing), 1);
  const accountOrphan = await owner.client
    .from('care_logs')
    .select('id')
    .eq('id', departingLog.data.id);
  expect(
    accountOrphan.data?.length === 0,
    'Account deletion left a health log orphan.',
  );
  console.log(
    'PASS: health logs follow existing account and Pet cascade lifecycle.',
  );
} finally {
  for (const petId of pets) {
    await admin.from('pets').delete().eq('id', petId);
  }
  for (const item of users) await admin.auth.admin.deleteUser(item.id);
}

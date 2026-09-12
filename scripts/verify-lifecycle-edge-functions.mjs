import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (!['delete-post', 'delete-pet', 'preview-pet-invite'].includes(mode)) {
  throw new Error('Choose delete-post, delete-pet, or preview-pet-invite.');
}
if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Local Supabase URL, anon key, and service-role key are required.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error(
    'SAFETY STOP: lifecycle Edge Function verification is local only.',
  );
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const deletedUsers = new Set();
const petIds = new Set();
const storagePaths = new Map([
  ['pet-avatars', new Set()],
  ['post-media', new Set()],
]);

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

function count(statement) {
  return Number(sql(statement));
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

async function createUser(label) {
  const email = `edge-${mode}-${label.toLowerCase()}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `${label} Edge Fixture`, locale: 'en' },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`${label} user creation failed.`);
  }
  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    throw signed.error ?? new Error(`${label} sign-in failed.`);
  }
  const user = {
    client,
    id: created.data.user.id,
    token: signed.data.session.access_token,
  };
  users.push(user);
  return user;
}

async function createPet(owner, label) {
  const created = await owner.client.rpc('create_pet', {
    pet_breed: 'Local fixture breed',
    pet_description: `Local ${mode} lifecycle fixture`,
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('Pet creation failed.');
  }
  petIds.add(created.data.id);
  return created.data.id;
}

function addMember(petId, userId, role = 'member') {
  sql(
    `insert into public.pet_members (pet_id,user_id,role) values ('${petId}'::uuid,'${userId}'::uuid,'${role}'::public.pet_member_role);`,
  );
}

async function invoke(functionName, user, body) {
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${user.token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await response.json();
  return { payload, status: response.status };
}

async function invokeAnonymous(functionName, body) {
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    body: JSON.stringify(body),
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return { payload: await response.json(), status: response.status };
}

async function upload(bucket, path, contentType = 'image/jpeg') {
  const uploaded = await admin.storage
    .from(bucket)
    .upload(path, new Uint8Array([255, 216, 255, 217]), {
      contentType,
      upsert: false,
    });
  if (uploaded.error) throw uploaded.error;
  storagePaths.get(bucket).add(path);
}

async function createPost(actor, petId, label) {
  const postId = randomUUID();
  const mediaId = randomUUID();
  const storagePath = `${actor.id}/${petId}/${postId}/${mediaId}.jpg`;
  await upload('post-media', storagePath);
  const created = await actor.client.rpc('create_post', {
    media_items: [
      {
        height: 32,
        id: mediaId,
        mime_type: 'image/jpeg',
        position: 0,
        storage_path: storagePath,
        width: 32,
      },
    ],
    post_content: label,
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('Post creation failed.');
  }
  return { id: postId, mediaPath: storagePath };
}

function localDate(date, timeZone = 'Asia/Hong_Kong') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function createOnceTask(actor, petId, label, scheduledAt) {
  const taskId = randomUUID();
  const created = await actor.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: 'Local lifecycle fixture',
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt.toISOString(),
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: label,
    task_week_day: null,
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('Care task creation failed.');
  }
  return created.data;
}

async function verifyDeletePost() {
  const owner = await createUser('Owner');
  const member = await createUser('Member');
  const stranger = await createUser('Stranger');
  const petId = await createPet(owner, 'Delete Post Pet');
  addMember(petId, member.id);

  const ownerPost = await createPost(owner, petId, 'Owner post');
  const memberPost = await createPost(member, petId, 'Member post');
  const memberOwnPost = await createPost(member, petId, 'Member own delete');

  const anonymousAttempt = await invokeAnonymous('delete-post', {
    postId: ownerPost.id,
  });
  expect(
    anonymousAttempt.status === 401,
    'Anonymous delete-post was not rejected.',
  );
  const memberAttempt = await invoke('delete-post', member, {
    postId: ownerPost.id,
  });
  expect(memberAttempt.status === 404, 'Member deleted another author post.');
  const strangerAttempt = await invoke('delete-post', stranger, {
    postId: ownerPost.id,
  });
  expect(
    strangerAttempt.status === 404,
    'Stranger delete-post was not rejected.',
  );
  expect(
    count(
      `select count(*) from public.posts where id='${ownerPost.id}'::uuid;`,
    ) === 1,
    'Unauthorized delete-post removed the row.',
  );

  const ownerModeration = await invoke('delete-post', owner, {
    postId: memberPost.id,
  });
  expect(
    ownerModeration.status === 200 && ownerModeration.payload.deleted === true,
    `Owner moderation failed (${ownerModeration.status}).`,
  );
  const memberOwn = await invoke('delete-post', member, {
    postId: memberOwnPost.id,
  });
  expect(
    memberOwn.status === 200 && memberOwn.payload.deleted === true,
    `Member own-post deletion failed (${memberOwn.status}).`,
  );
  const ownerOwn = await invoke('delete-post', owner, { postId: ownerPost.id });
  expect(
    ownerOwn.status === 200 && ownerOwn.payload.deleted === true,
    `Owner own-post deletion failed (${ownerOwn.status}).`,
  );

  for (const post of [ownerPost, memberPost, memberOwnPost]) {
    expect(
      count(
        `select count(*) from public.posts where id='${post.id}'::uuid;`,
      ) === 0 &&
        count(
          `select count(*) from storage.objects where bucket_id='post-media' and name='${post.mediaPath}';`,
        ) === 0,
      'delete-post left a database or Storage orphan.',
    );
  }
  console.log(
    'PASS: delete-post author/owner moderation succeeds; anonymous, stranger, and other-member calls are denied.',
  );
  console.log(
    'PASS: delete-post removes both metadata and private Storage objects.',
  );
}

async function verifyDeletePet() {
  const owner = await createUser('Owner');
  const member = await createUser('Member');
  const stranger = await createUser('Stranger');
  const petId = await createPet(owner, 'Delete Pet');
  addMember(petId, member.id);

  const avatarPath = `${owner.id}/${petId}/${randomUUID()}.jpg`;
  await upload('pet-avatars', avatarPath);
  const avatarUpdate = await owner.client
    .from('pets')
    .update({ avatar_path: avatarPath })
    .eq('id', petId);
  if (avatarUpdate.error) throw avatarUpdate.error;
  const post = await createPost(member, petId, 'Pet lifecycle post');

  const careLog = await member.client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_health_subtype: null,
    care_id: randomUUID(),
    care_kind: 'feeding',
    care_note: 'Lifecycle care log',
    care_occurred_at: new Date(Date.now() - 60_000).toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: petId,
  });
  if (careLog.error) throw careLog.error;

  const completedAt = new Date(Date.now() + 120_000);
  const completedTask = await createOnceTask(
    owner,
    petId,
    'Lifecycle completed task',
    completedAt,
  );
  const completion = await member.client.rpc('complete_care_task', {
    care_log_id: randomUUID(),
    completion_duration_minutes: null,
    completion_id: randomUUID(),
    completion_note: null,
    occurrence_scheduled_for: completedTask.scheduled_at,
    target_task_id: completedTask.id,
  });
  if (completion.error) throw completion.error;

  const shiftAt = new Date(Date.now() + 180_000);
  const shiftTask = await createOnceTask(
    owner,
    petId,
    'Lifecycle shift task',
    shiftAt,
  );
  const shift = await owner.client.rpc('create_care_shift', {
    shift_id: randomUUID(),
    shift_local_date: localDate(shiftAt),
    shift_note: 'Lifecycle shift',
    target_assignee_user_id: member.id,
    target_pet_id: petId,
    task_items: [
      {
        care_task_id: shiftTask.id,
        source_scheduled_for: shiftTask.scheduled_at,
      },
    ],
  });
  if (shift.error) throw shift.error;

  const chat = await member.client.rpc('send_chat_message', {
    message_body: 'Lifecycle chat fixture',
    target_client_message_id: randomUUID(),
    target_pet_id: petId,
  });
  if (chat.error) throw chat.error;

  const memberAttempt = await invoke('delete-pet', member, { petId });
  const strangerAttempt = await invoke('delete-pet', stranger, { petId });
  expect(
    memberAttempt.status === 404,
    'Member deleted a Pet owned by another user.',
  );
  expect(
    strangerAttempt.status === 404,
    'Stranger delete-pet was not rejected.',
  );
  expect(
    count(`select count(*) from public.pets where id='${petId}'::uuid;`) === 1,
    'Unauthorized delete-pet removed the Pet.',
  );

  const deleted = await invoke('delete-pet', owner, { petId });
  expect(
    deleted.status === 200 && deleted.payload.deleted === true,
    `Owner delete-pet failed (${deleted.status}).`,
  );
  petIds.delete(petId);

  const orphanCount = count(`
    select
      (select count(*) from public.pets where id='${petId}'::uuid) +
      (select count(*) from public.pet_members where pet_id='${petId}'::uuid) +
      (select count(*) from public.posts where pet_id='${petId}'::uuid) +
      (select count(*) from public.care_logs where pet_id='${petId}'::uuid) +
      (select count(*) from public.care_tasks where pet_id='${petId}'::uuid) +
      (select count(*) from public.care_task_completions where pet_id='${petId}'::uuid) +
      (select count(*) from public.chat_messages where pet_id='${petId}'::uuid) +
      (select count(*) from public.chat_read_states where pet_id='${petId}'::uuid) +
      (select count(*) from public.care_shifts where pet_id='${petId}'::uuid) +
      (select count(*) from public.care_shift_tasks where pet_id='${petId}'::uuid) +
      (select count(*) from private.pet_chat_states where pet_id='${petId}'::uuid) +
      (select count(*) from private.family_notification_outbox where pet_id='${petId}'::uuid);
  `);
  expect(
    orphanCount === 0,
    `delete-pet left ${orphanCount} relational orphans.`,
  );
  expect(
    count(
      `select count(*) from storage.objects where (bucket_id='pet-avatars' and name='${avatarPath}') or (bucket_id='post-media' and name='${post.mediaPath}');`,
    ) === 0,
    'delete-pet left a private Storage object.',
  );
  console.log(
    'PASS: delete-pet rejects Member/Stranger and succeeds for Owner.',
  );
  console.log(
    'PASS: delete-pet cascades Pet, membership, Journal, Care, Reminder completion, Chat, Schedule, Push, and Storage fixtures.',
  );
}

async function verifyPreviewInvite() {
  const owner = await createUser('Owner');
  const requester = await createUser('Requester');
  const petId = await createPet(owner, 'Invite Preview Pet');
  const created = await owner.client.rpc('create_pet_invite', {
    target_pet_id: petId,
  });
  if (created.error || !created.data?.[0]) {
    throw created.error ?? new Error('Invite creation failed.');
  }
  const code = created.data[0].invite_code;

  const valid = await invoke('preview-pet-invite', requester, { code });
  expect(
    valid.status === 200,
    `Valid invite preview failed (${valid.status}).`,
  );
  expect(
    JSON.stringify(Object.keys(valid.payload).sort()) ===
      JSON.stringify(
        [
          'avatarUrl',
          'inviterDisplayName',
          'petBreed',
          'petName',
          'petSpecies',
        ].sort(),
      ),
    `Invite preview returned unexpected fields: ${Object.keys(valid.payload).join(',')}`,
  );
  expect(
    valid.payload.petName?.startsWith('Invite Preview Pet') &&
      valid.payload.inviterDisplayName === 'Owner Edge Fixture',
    'Invite preview returned incorrect minimal data.',
  );

  const invalid = await invoke('preview-pet-invite', requester, {
    code: 'ZZZZZZZZ',
  });
  expect(
    invalid.status === 404 && invalid.payload.error === 'invite_invalid',
    'Invalid invite behavior changed.',
  );
  sql(
    `update public.pet_invites set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where pet_id='${petId}'::uuid;`,
  );
  const expired = await invoke('preview-pet-invite', requester, { code });
  expect(
    expired.status === 404 && expired.payload.error === 'invite_invalid',
    'Expired invite behavior changed.',
  );

  sql(`
    update public.pet_invites set revoked_at=now() where pet_id='${petId}'::uuid;
    insert into public.pet_invites (pet_id,invited_by,code_hash,expires_at,max_uses,used_count)
    values ('${petId}'::uuid,'${owner.id}'::uuid,private.pet_invite_code_hash('ABCDEFGH'),now()+interval '1 day',1,1);
  `);
  const exhausted = await invoke('preview-pet-invite', requester, {
    code: 'ABCDEFGH',
  });
  expect(
    exhausted.status === 404 && exhausted.payload.error === 'invite_invalid',
    'Exhausted invite behavior changed.',
  );
  console.log(
    'PASS: valid invite returns only the five approved preview fields.',
  );
  console.log(
    'PASS: invalid, expired, and exhausted invite previews return invite_invalid.',
  );
}

async function cleanup() {
  for (const petId of petIds) {
    sql(`delete from public.pets where id='${petId}'::uuid;`);
  }
  for (const [bucket, paths] of storagePaths) {
    if (paths.size > 0) {
      await admin.storage.from(bucket).remove([...paths]);
    }
  }
  for (const user of users) {
    await user.client.auth.signOut();
    if (!deletedUsers.has(user.id)) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw deleted.error;
    }
  }
}

try {
  if (mode === 'delete-post') await verifyDeletePost();
  if (mode === 'delete-pet') await verifyDeletePet();
  if (mode === 'preview-pet-invite') await verifyPreviewInvite();
} finally {
  await cleanup();
}

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Local Supabase URL, anon key, and service-role key are required.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: account-delete verification is local only.');
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const deletedUsers = new Set();
const petIds = new Set();
const storagePaths = new Map([
  ['post-media', new Set()],
  ['profile-avatars', new Set()],
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

function client() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createUser(label) {
  const email = `account-delete-${label.toLowerCase()}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`${label} fixture user creation failed.`);
  }
  const sessionClient = client();
  const signed = await sessionClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signed.error || !signed.data.session) {
    throw signed.error ?? new Error(`${label} fixture sign-in failed.`);
  }
  const user = {
    client: sessionClient,
    id: created.data.user.id,
    token: signed.data.session.access_token,
  };
  users.push(user);
  return user;
}

async function createPet(owner, label) {
  const created = await owner.client.rpc('create_pet', {
    pet_description: 'Local account-delete lifecycle fixture',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('Pet fixture creation failed.');
  }
  petIds.add(created.data.id);
  return created.data.id;
}

async function upload(bucket, path) {
  const uploaded = await admin.storage
    .from(bucket)
    .upload(path, new Uint8Array([255, 216, 255, 217]), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploaded.error) throw uploaded.error;
  storagePaths.get(bucket).add(path);
}

async function createPost(author, petId, label) {
  const postId = randomUUID();
  const mediaId = randomUUID();
  const path = `${author.id}/${petId}/${postId}/${mediaId}.jpg`;
  await upload('post-media', path);
  const created = await author.client.rpc('create_post', {
    media_items: [
      {
        height: 32,
        id: mediaId,
        mime_type: 'image/jpeg',
        position: 0,
        storage_path: path,
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
  if (created.error) throw created.error;
  return { id: postId, path };
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
  return { payload: await response.json(), status: response.status };
}

async function cleanup() {
  for (const petId of petIds) {
    sql(`delete from public.pets where id='${petId}'::uuid;`);
  }
  for (const [bucket, paths] of storagePaths) {
    if (paths.size > 0) await admin.storage.from(bucket).remove([...paths]);
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
  const owner = await createUser('Owner');
  const member = await createUser('Member');
  const ownerPetId = await createPet(owner, 'Owner Pet');
  sql(
    `insert into public.pet_members (pet_id,user_id,role) values ('${ownerPetId}'::uuid,'${member.id}'::uuid,'member'::public.pet_member_role);`,
  );

  const scheduledAt = new Date(Date.now() + 120_000).toISOString();
  const taskId = randomUUID();
  const task = await member.client.rpc('create_care_task', {
    target_pet_id: ownerPetId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: 'Account lifecycle fixture',
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt,
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'Preserved family reminder',
    task_week_day: null,
  });
  if (task.error) throw task.error;
  const completion = await member.client.rpc('complete_care_task', {
    care_log_id: randomUUID(),
    completion_duration_minutes: null,
    completion_id: randomUUID(),
    completion_note: null,
    occurrence_scheduled_for: scheduledAt,
    target_task_id: taskId,
  });
  if (completion.error || !completion.data?.[0]) throw completion.error;
  const completionId = completion.data[0].result_completion_id;
  const careLogId = completion.data[0].result_care_log_id;

  const sharedPost = await createPost(
    member,
    ownerPetId,
    'Departing member post',
  );
  const profileAvatarPath = `${member.id}/${randomUUID()}.jpg`;
  await upload('profile-avatars', profileAvatarPath);
  const avatarUpdate = await member.client
    .from('profiles')
    .update({ avatar_url: profileAvatarPath })
    .eq('id', member.id);
  if (avatarUpdate.error) throw avatarUpdate.error;
  const pushDevice = await member.client.rpc('register_push_device', {
    device_app_version: '1.1.0-local',
    device_expo_push_token: 'ExpoPushToken[accountdeletefixture]',
    device_installation_id: 'account-delete-fixture-installation',
    device_platform: 'ios',
  });
  if (pushDevice.error) throw pushDevice.error;

  const memberOwnedPetId = await createPet(member, 'Departing Owner Pet');
  const ownedPost = await createPost(
    member,
    memberOwnedPetId,
    'Owned Pet post',
  );

  const missingConfirmation = await invoke('delete-account', member, {
    confirmation: 'WRONG',
  });
  expect(
    missingConfirmation.status === 400,
    'Invalid confirmation was accepted.',
  );

  const deleted = await invoke('delete-account', member, {
    confirmation: 'DELETE_MY_ACCOUNT',
    targetUserId: owner.id,
  });
  expect(
    deleted.status === 200 && deleted.payload.deleted === true,
    `delete-account failed (${deleted.status}).`,
  );
  deletedUsers.add(member.id);
  petIds.delete(memberOwnedPetId);

  expect(
    count(`select count(*) from auth.users where id='${member.id}'::uuid;`) ===
      0 &&
      count(
        `select count(*) from public.profiles where id='${member.id}'::uuid;`,
      ) === 0 &&
      count(
        `select count(*) from public.pet_members where user_id='${member.id}'::uuid;`,
      ) === 0 &&
      count(
        `select count(*) from private.push_devices where user_id='${member.id}'::uuid;`,
      ) === 0,
    'Account deletion left identity, profile, membership, or push-device rows.',
  );
  expect(
    count(
      `select count(*) from public.pets where id='${ownerPetId}'::uuid;`,
    ) === 1 &&
      count(
        `select count(*) from public.pets where id='${memberOwnedPetId}'::uuid;`,
      ) === 0 &&
      count(`select count(*) from auth.users where id='${owner.id}'::uuid;`) ===
        1,
    'Account deletion violated owner/member Plan A semantics or trusted a target user id.',
  );
  expect(
    sql(
      `select coalesce(created_by::text,'null') from public.care_tasks where id='${taskId}'::uuid;`,
    ) === 'null',
    'Family task was not preserved with a null creator.',
  );
  expect(
    count(
      `select count(*) from public.care_task_completions where id='${completionId}'::uuid;`,
    ) === 0 &&
      count(
        `select count(*) from public.care_logs where id='${careLogId}'::uuid;`,
      ) === 0,
    'Deleted creator completion or linked Care Log survived.',
  );
  expect(
    count(
      `select count(*) from public.posts where id in ('${sharedPost.id}'::uuid,'${ownedPost.id}'::uuid);`,
    ) === 0 &&
      count(
        `select count(*) from storage.objects where bucket_id in ('post-media','profile-avatars') and name like '${member.id}/%';`,
      ) === 0,
    'Account deletion left authored posts or user-prefixed Storage objects.',
  );

  const deactivated = await owner.client.rpc('deactivate_care_task', {
    target_task_id: taskId,
  });
  expect(
    !deactivated.error && deactivated.data === 'deactivated',
    'Owner could not manage the preserved family task.',
  );
  const petDeleted = await invoke('delete-pet', owner, { petId: ownerPetId });
  expect(
    petDeleted.status === 200 && petDeleted.payload.deleted === true,
    'Owner fixture Pet cleanup through delete-pet failed.',
  );
  petIds.delete(ownerPetId);

  console.log(
    'PASS: delete-account rejects missing confirmation and deletes only the caller.',
  );
  console.log(
    'PASS: Plan A deletes owned Pets, preserves family tasks with null creator, and removes completion/Care Log rows.',
  );
  console.log(
    'PASS: profile/avatar, authored media, membership, and Push Device lifecycle cleanup completed.',
  );
} finally {
  await cleanup();
}

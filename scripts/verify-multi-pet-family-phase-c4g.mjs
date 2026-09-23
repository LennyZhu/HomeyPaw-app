import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
const container =
  process.env.SUPABASE_LOCAL_DB_CONTAINER?.trim() ?? 'supabase_db_pawday';
if (!url || !anonKey || !serviceKey) {
  throw new Error('Local Supabase credentials are required.');
}
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: C4G verifier is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: invalid local database container.');
}

const edge = readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260923120000_multi_pet_family_phase_c4g_safe_account_deletion.sql',
  'utf8',
);
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const families = new Set();
const objects = new Map(
  [
    'profile-avatars',
    'pet-avatars',
    'post-media',
    'post-videos',
    'post-video-thumbnails',
  ].map((bucket) => [bucket, new Set()]),
);
let failureTriggerInstalled = false;

function expect(ok, message) {
  if (!ok) throw new Error(message);
}
function sql(query) {
  return execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-q',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}
function count(query) {
  return Number(sql(query));
}
function checkSql(label, query) {
  expect(sql(query) === 't', label);
  console.log(`PASS: ${label}`);
}
function sessionClient() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
async function createUser(label) {
  const email = `c4g-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = sessionClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;
  const user = {
    client,
    id: created.data.user.id,
    token: signed.data.session.access_token,
    deleted: false,
  };
  users.push(user);
  return user;
}
async function createFamily(owner, label) {
  const result = await owner.client.rpc('create_pet', {
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (result.error || !result.data?.family_id) throw result.error;
  families.add(result.data.family_id);
  return { familyId: result.data.family_id, petId: result.data.id };
}
function addMember(familyId, userId, role = 'member') {
  sql(`
    with inserted as (
      insert into public.family_members (family_id,user_id,role,created_at)
      values ('${familyId}'::uuid,'${userId}'::uuid,
        '${role}'::public.pet_member_role,clock_timestamp())
      returning user_id,role,created_at
    )
    insert into public.pet_members (pet_id,user_id,role,created_at)
    select pet.id,inserted.user_id,inserted.role,inserted.created_at
    from public.pets as pet cross join inserted
    where pet.family_id = '${familyId}'::uuid;
  `);
}
async function invoke(user, body = { confirmation: 'DELETE_MY_ACCOUNT' }) {
  const response = await fetch(`${url}/functions/v1/delete-account`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${user.token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await response.json();
  if (response.status === 200) user.deleted = true;
  return { payload, status: response.status };
}
async function upload(bucket, path) {
  const result = await admin.storage
    .from(bucket)
    .upload(path, new Uint8Array([255, 216, 255, 217]), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (result.error) throw result.error;
  objects.get(bucket).add(path);
}
async function avatar(user) {
  const path = `${user.id}/${randomUUID()}.jpg`;
  await upload('profile-avatars', path);
  const result = await user.client
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', user.id);
  if (result.error) throw result.error;
  return path;
}
async function sharedPost(actor, petId) {
  const postId = randomUUID();
  const mediaId = randomUUID();
  const path = `${actor.id}/${petId}/${postId}/${mediaId}.jpg`;
  await upload('post-media', path);
  const result = await actor.client.rpc('create_post', {
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
    post_content: 'Shared history',
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (result.error) throw result.error;
  return { id: postId, path };
}
async function sharedVideoPost(actor, petId) {
  const postId = randomUUID();
  const videoId = randomUUID();
  const stem = `${actor.id}/${petId}/${postId}/${videoId}`;
  const videoPath = `${stem}.mp4`;
  const thumbnailPath = `${stem}.jpg`;
  const videoBytes = new Uint8Array([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
    111, 109, 105, 115, 111, 50,
  ]);
  for (const [bucket, path, bytes, contentType] of [
    ['post-videos', videoPath, videoBytes, 'video/mp4'],
    [
      'post-video-thumbnails',
      thumbnailPath,
      new Uint8Array([255, 216, 255, 217]),
      'image/jpeg',
    ],
  ]) {
    const uploaded = await actor.client.storage
      .from(bucket)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploaded.error) throw uploaded.error;
    objects.get(bucket).add(path);
  }
  const created = await actor.client.rpc('create_post_v2', {
    media_items: [],
    post_content: 'Shared video history',
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
    video_item: {
      duration_ms: 1500,
      height: 720,
      id: videoId,
      mime_type: 'video/mp4',
      storage_path: videoPath,
      thumbnail_path: thumbnailPath,
      width: 1280,
    },
  });
  if (created.error) throw created.error;
  return { postId, videoPath, thumbnailPath };
}
async function sharedSchedule(owner, assignee, petId) {
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  const taskId = randomUUID();
  const shiftId = randomUUID();
  const task = await owner.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt,
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'C4G shared Schedule',
    task_week_day: null,
  });
  if (task.error) throw task.error;
  const shift = await owner.client.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(scheduledAt)),
    shift_note: null,
    target_assignee_user_id: assignee.id,
    target_pet_id: petId,
    task_items: [{ care_task_id: taskId, source_scheduled_for: scheduledAt }],
  });
  if (shift.error) throw shift.error;
  return shiftId;
}
async function sharedCareAndChat(actor, petId) {
  const careId = randomUUID();
  const care = await actor.client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_health_subtype: 'energy',
    care_id: careId,
    care_kind: 'health',
    care_note: 'Shared health history',
    care_occurred_at: new Date().toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: petId,
  });
  if (care.error) throw care.error;
  const chat = await actor.client.rpc('send_chat_message', {
    message_body: 'Shared chat history',
    target_client_message_id: randomUUID(),
    target_pet_id: petId,
  });
  if (chat.error) throw chat.error;
  return { careId, chatId: chat.data.id };
}
async function sharedCompletion(actor, petId) {
  const taskId = randomUUID();
  const completionId = randomUUID();
  const careLogId = randomUUID();
  sql(`
    insert into public.care_tasks (
      id, pet_id, created_by, title, care_type, schedule_type,
      starts_on, local_time, time_zone
    ) values (
      '${taskId}'::uuid, '${petId}'::uuid, '${actor.id}'::uuid,
      'C4G shared completion', 'medicine'::public.care_type,
      'daily'::public.care_task_schedule_type,
      (clock_timestamp() at time zone 'Asia/Hong_Kong')::date,
      date_trunc('minute', clock_timestamp() at time zone 'Asia/Hong_Kong')::time(0),
      'Asia/Hong_Kong'
    );
  `);
  const occurrence = sql(`
    select to_char(
      ((starts_on + local_time) at time zone time_zone) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ) from public.care_tasks where id='${taskId}'::uuid;
  `);
  const completed = await actor.client.rpc('complete_care_task', {
    care_log_id: careLogId,
    completion_duration_minutes: null,
    completion_id: completionId,
    completion_note: 'Shared completion',
    occurrence_scheduled_for: occurrence,
    target_task_id: taskId,
  });
  if (
    completed.error ||
    completed.data?.[0]?.completion_status !== 'completed'
  ) {
    throw completed.error ?? new Error('Shared completion fixture failed.');
  }
  return { taskId, completionId, careLogId };
}
async function createFamilyPet(owner, familyId) {
  return owner.client.rpc('create_family_pet', {
    pet_name: `C4G additional ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    target_family_id: familyId,
  });
}
async function invite(owner, familyId) {
  const result = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  if (result.error || !result.data?.[0]) throw result.error;
  return result.data[0];
}
function queued(bucket, path) {
  return count(`
    select count(*) from public.media_cleanup_jobs
    where bucket_id = '${bucket}' and storage_path = '${path}'
      and completed_at is null;
  `);
}
function stored(bucket, path) {
  return count(`
    select count(*) from storage.objects
    where bucket_id = '${bucket}' and name = '${path}';
  `);
}
async function expectOwnerDenied(user, label) {
  const result = await invoke(user);
  expect(
    result.status === 409 && result.payload.error === 'ACCOUNT_OWNS_FAMILY',
    `${label}: owner deletion was not blocked with stable code (${result.status}).`,
  );
  checkSql(
    `${label}: owner denial left Auth, Profile, and memberships intact`,
    `select exists(select 1 from auth.users where id='${user.id}'::uuid)
      and exists(select 1 from public.profiles where id='${user.id}'::uuid)
      and exists(select 1 from public.family_members
        where user_id='${user.id}'::uuid and role='owner')
      and not exists(select 1 from private.account_deletion_preparations
        where user_id='${user.id}'::uuid);`,
  );
}
async function race(label, operations) {
  let timer;
  try {
    return await Promise.race([
      Promise.all(operations),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out; possible deadlock.`)),
          20000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function removeFailureTrigger() {
  sql(`
    drop trigger if exists c4g_inject_profile_delete_failure
      on public.profiles;
    drop function if exists private.c4g_inject_profile_delete_failure();
  `);
  failureTriggerInstalled = false;
}
async function cleanup() {
  if (failureTriggerInstalled) removeFailureTrigger();
  for (const familyId of families) {
    sql(`
      delete from public.pets where family_id='${familyId}'::uuid;
      delete from public.families where id='${familyId}'::uuid;
    `);
  }
  for (const user of users.reverse()) {
    if (user.deleted) continue;
    await user.client.auth.signOut();
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) throw result.error;
  }
  for (const [bucket, paths] of objects) {
    if (paths.size > 0) await admin.storage.from(bucket).remove([...paths]);
  }
  sql('delete from public.media_cleanup_jobs;');
}

try {
  expect(
    edge.includes("'prepare_account_deletion'") &&
      edge.indexOf("'prepare_account_deletion'") <
        edge.indexOf('auth.admin.deleteUser') &&
      !edge.includes(".from('pet_members')") &&
      !edge.includes('.storage.from(') &&
      !edge.includes('cleanupVideoReferences') &&
      !edge.includes('targetUserId') &&
      migration.includes('ACCOUNT_OWNS_FAMILY'),
    'Canonical Edge ordering or owner guard is missing.',
  );
  console.log('PASS: Edge delegates DB lifecycle and deletes Auth last.');

  const owner = await createUser('owner');
  const member = await createUser('member');
  const viewer = await createUser('viewer');
  const stranger = await createUser('stranger');
  const familyA = await createFamily(owner, 'Family A');
  const familyB = await createFamily(owner, 'Family B');
  addMember(familyA.familyId, member.id);
  addMember(familyB.familyId, member.id);
  addMember(familyA.familyId, viewer.id);

  const zero = await createFamily(stranger, 'Zero Pet');
  let result = await stranger.client.rpc('delete_family_pet', {
    target_pet_id: zero.petId,
  });
  if (result.error) throw result.error;
  await expectOwnerDenied(stranger, 'zero-Pet Owner');
  await expectOwnerDenied(owner, 'multiple-Family Owner');
  const multiOwner = await createUser('multi-pet-owner');
  const multiPet = await createFamily(multiOwner, 'Multi Pet');
  for (let index = 0; index < 2; index += 1) {
    const created = await createFamilyPet(multiOwner, multiPet.familyId);
    if (created.error) throw created.error;
  }
  await expectOwnerDenied(multiOwner, 'three-Pet Owner');
  checkSql(
    'Three-Pet Owner denial preserves every Pet',
    `select count(*) = 3 from public.pets
     where family_id='${multiPet.familyId}'::uuid;`,
  );

  const memberAvatar = await avatar(member);
  const memberPost = await sharedPost(member, familyA.petId);
  const memberVideo = await sharedVideoPost(member, familyA.petId);
  const memberHistory = await sharedCareAndChat(member, familyA.petId);
  const memberCompletion = await sharedCompletion(member, familyA.petId);
  const memberShiftId = await sharedSchedule(owner, member, familyA.petId);
  const petAvatar = `${owner.id}/${familyA.petId}/${randomUUID()}.jpg`;
  await upload('pet-avatars', petAvatar);
  const petAvatarUpdate = await owner.client
    .from('pets')
    .update({ avatar_path: petAvatar })
    .eq('id', familyA.petId);
  if (petAvatarUpdate.error) throw petAvatarUpdate.error;
  const device = await member.client.rpc('register_push_device', {
    device_app_version: '1.1.0-local',
    device_expo_push_token: `ExpoPushToken[c4g${randomUUID().replaceAll('-', '')}]`,
    device_installation_id: randomUUID(),
    device_platform: 'ios',
  });
  if (device.error) throw device.error;
  const forgedPreparation = await member.client.rpc(
    'prepare_account_deletion',
    {
      target_user_id: owner.id,
    },
  );
  expect(forgedPreparation.error, 'RPC accepted an arbitrary target user ID.');
  result = await member.client.rpc('prepare_account_deletion');
  if (result.error) throw result.error;
  // This caller is now prepared. Auth deletion is deliberately skipped to
  // simulate an Admin timeout; a retry through Edge must finish it safely.
  checkSql(
    'Prepared account remains retryable after simulated Auth outage',
    `select exists(select 1 from auth.users where id='${member.id}'::uuid)
      and exists(select 1 from private.account_deletion_preparations
        where user_id='${member.id}'::uuid)
      and not exists(select 1 from public.family_members
        where user_id='${member.id}'::uuid)
      and exists(select 1 from public.families
        where id='${familyA.familyId}'::uuid);`,
  );
  result = await invoke(member, {
    confirmation: 'DELETE_MY_ACCOUNT',
    targetUserId: owner.id,
  });
  expect(
    result.status === 200 && result.payload.deleted === true,
    `Member retry failed (${result.status}): ${JSON.stringify(result.payload)}`,
  );
  checkSql(
    'Member Auth, Profile, mirrors, push devices, and preparation removed; both Families survive',
    `select not exists(select 1 from auth.users where id='${member.id}'::uuid)
      and not exists(select 1 from public.profiles where id='${member.id}'::uuid)
      and not exists(select 1 from public.pet_members
        where user_id='${member.id}'::uuid)
      and not exists(select 1 from private.account_deletion_preparations
        where user_id='${member.id}'::uuid)
      and not exists(select 1 from private.push_devices
        where user_id='${member.id}'::uuid)
      and exists(select 1 from public.families where id='${familyA.familyId}'::uuid)
      and exists(select 1 from public.families where id='${familyB.familyId}'::uuid)
      and exists(select 1 from auth.users where id='${owner.id}'::uuid);`,
  );
  checkSql(
    'Member Journal, Care, Completion, and Chat actors are anonymous while shared rows survive',
    `select exists(select 1 from public.posts
        where id='${memberPost.id}'::uuid and author_id is null)
      and exists(select 1 from public.care_logs
        where id='${memberHistory.careId}'::uuid and performed_by is null)
      and exists(select 1 from public.chat_messages
        where id='${memberHistory.chatId}'::uuid and sender_id is null)
      and exists(select 1 from public.care_tasks
        where id='${memberCompletion.taskId}'::uuid and created_by is null)
      and exists(select 1 from public.care_task_completions
        where id='${memberCompletion.completionId}'::uuid
          and completed_by is null)
      and exists(select 1 from public.care_logs
        where id='${memberCompletion.careLogId}'::uuid
          and performed_by is null)
      and exists(select 1 from public.posts
        where id='${memberVideo.postId}'::uuid and author_id is null)
      and exists(select 1 from public.care_shifts
        where id='${memberShiftId}'::uuid and assignee_user_id is null);`,
  );
  expect(
    queued('profile-avatars', memberAvatar) === 1 &&
      queued('pet-avatars', petAvatar) === 0 &&
      queued('post-media', memberPost.path) === 0 &&
      queued('post-videos', memberVideo.videoPath) === 0 &&
      queued('post-video-thumbnails', memberVideo.thumbnailPath) === 0 &&
      stored('profile-avatars', memberAvatar) === 1 &&
      stored('pet-avatars', petAvatar) === 1 &&
      stored('post-media', memberPost.path) === 1 &&
      stored('post-videos', memberVideo.videoPath) === 1 &&
      stored('post-video-thumbnails', memberVideo.thumbnailPath) === 1,
    'Member deletion queued shared media or missed personal avatar cleanup.',
  );

  const viewerAvatar = await avatar(viewer);
  const viewerPost = await sharedPost(viewer, familyA.petId);
  sql(`
    update public.family_members set role='viewer'
    where family_id='${familyA.familyId}'::uuid
      and user_id='${viewer.id}'::uuid;
    update public.pet_members set role='viewer'
    where pet_id='${familyA.petId}'::uuid
      and user_id='${viewer.id}'::uuid;
  `);
  result = await viewer.client.rpc('send_chat_message', {
    message_body: 'Shared chat',
    target_client_message_id: randomUUID(),
    target_pet_id: familyA.petId,
  });
  expect(result.error, 'Viewer unexpectedly wrote Chat.');
  result = await invoke(viewer);
  expect(result.status === 200, 'Viewer account deletion failed.');
  checkSql(
    'Viewer deletion retains shared Post with anonymous actor',
    `select exists(select 1 from public.posts
        where id='${viewerPost.id}'::uuid and author_id is null)
      and exists(select 1 from public.pets where id='${familyA.petId}'::uuid)
      and not exists(select 1 from auth.users where id='${viewer.id}'::uuid);`,
  );
  expect(
    queued('profile-avatars', viewerAvatar) === 1 &&
      queued('post-media', viewerPost.path) === 0 &&
      stored('profile-avatars', viewerAvatar) === 1 &&
      stored('post-media', viewerPost.path) === 1,
    'Viewer deletion touched shared media or missed profile avatar queue.',
  );

  const formerOwner = await createUser('former-owner');
  const successor = await createUser('successor');
  const transferred = await createFamily(formerOwner, 'Transferred');
  addMember(transferred.familyId, successor.id);
  const formerPost = await sharedPost(formerOwner, transferred.petId);
  const formerAvatar = await avatar(formerOwner);
  const formerInvite = await invite(formerOwner, transferred.familyId);
  result = await formerOwner.client.rpc('transfer_family_ownership', {
    target_family_id: transferred.familyId,
    new_owner_user_id: successor.id,
  });
  if (result.error || result.data !== 'transferred') throw result.error;
  result = await formerOwner.client.rpc('leave_family', {
    target_family_id: transferred.familyId,
  });
  if (result.error) throw result.error;
  result = await invoke(formerOwner);
  expect(result.status === 200, 'Transferred former Owner deletion failed.');
  checkSql(
    'Transferred Family, successor, creator invite, and anonymous shared history survive',
    `select exists(select 1 from public.family_members
        where family_id='${transferred.familyId}'::uuid
          and user_id='${successor.id}'::uuid and role='owner')
      and exists(select 1 from public.pets where id='${transferred.petId}'::uuid)
      and exists(select 1 from public.posts
        where id='${formerPost.id}'::uuid and author_id is null)
      and exists(select 1 from public.family_invites
        where id='${formerInvite.invite_id}'::uuid and invited_by is null)
      and exists(select 1 from public.pet_invites
        where id='${formerInvite.invite_id}'::uuid and invited_by is null);`,
  );
  expect(
    queued('profile-avatars', formerAvatar) === 1 &&
      queued('post-media', formerPost.path) === 0,
    'Former Owner deletion queued shared media.',
  );

  const afterFamily = await createUser('after-family');
  const disposable = await createFamily(afterFamily, 'Explicit delete');
  result = await afterFamily.client.rpc('delete_family', {
    target_family_id: disposable.familyId,
  });
  if (result.error) throw result.error;
  result = await invoke(afterFamily);
  expect(
    result.status === 200,
    'Account deletion after explicit Family deletion failed.',
  );

  const rollbackUser = await createUser('rollback');
  const rollbackOwner = await createUser('rollback-owner');
  const rollbackFamily = await createFamily(rollbackOwner, 'Rollback Family');
  addMember(rollbackFamily.familyId, rollbackUser.id);
  const rollbackAvatar = await avatar(rollbackUser);
  sql(`
    create function private.c4g_inject_profile_delete_failure()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if old.id='${rollbackUser.id}'::uuid then
        raise exception 'c4g_injected_failure' using errcode='P0001';
      end if;
      return old;
    end; $$;
    create trigger c4g_inject_profile_delete_failure
    before delete on public.profiles for each row
    execute function private.c4g_inject_profile_delete_failure();
  `);
  failureTriggerInstalled = true;
  result = await invoke(rollbackUser);
  expect(
    result.status === 503,
    'Injected DB failure did not stop Auth deletion.',
  );
  removeFailureTrigger();
  checkSql(
    'Failed preparation rolls back membership, Profile, Auth, marker, and jobs',
    `select exists(select 1 from auth.users where id='${rollbackUser.id}'::uuid)
      and exists(select 1 from public.profiles where id='${rollbackUser.id}'::uuid)
      and exists(select 1 from public.family_members
        where family_id='${rollbackFamily.familyId}'::uuid
          and user_id='${rollbackUser.id}'::uuid)
      and not exists(select 1 from private.account_deletion_preparations
        where user_id='${rollbackUser.id}'::uuid)
      and not exists(select 1 from public.media_cleanup_jobs
        where storage_path='${rollbackAvatar}');`,
  );

  const prepared = await rollbackUser.client.rpc('prepare_account_deletion');
  expect(
    !prepared.error && prepared.data === 'prepared',
    'Preparation failed.',
  );
  const forbiddenJoin = await rollbackUser.client.rpc('create_pet', {
    pet_name: 'Must fail',
    pet_species: 'other',
  });
  expect(forbiddenJoin.error, 'Prepared account created a new Owner Family.');
  const forbiddenInvite = await rollbackOwner.client.rpc(
    'create_family_invite',
    {
      target_family_id: rollbackFamily.familyId,
    },
  );
  if (forbiddenInvite.error) throw forbiddenInvite.error;
  const joined = await rollbackUser.client.rpc('join_family_with_invite', {
    invite_code: forbiddenInvite.data[0].invite_code,
  });
  expect(joined.error, 'Prepared account rejoined a Family.');
  result = await invoke(rollbackUser);
  expect(result.status === 200, 'Retry after preparation failed.');

  const createRacer = await createUser('create-racer');
  const [createdDuringDelete, preparedDuringCreate] = await race(
    'prepare vs create Family',
    [
      createFamily(createRacer, 'Creation race')
        .then((value) => ({ data: value }))
        .catch((error) => ({ error })),
      createRacer.client.rpc('prepare_account_deletion'),
    ],
  );
  expect(
    Boolean(createdDuringDelete.error) !== Boolean(preparedDuringCreate.error),
    'Create Family race neither chose a safe winner nor rejected one side.',
  );
  if (!preparedDuringCreate.error) {
    checkSql(
      'Prepared creator has no new Family or Owner membership',
      `select not exists(select 1 from public.family_members
        where user_id='${createRacer.id}'::uuid)
        and not exists(select 1 from public.pets
          where family_id in (
            select family_id from public.family_members
            where user_id='${createRacer.id}'::uuid));`,
    );
  }

  const transferRacer = await createUser('transfer-racer');
  const transferSource = await createUser('transfer-source');
  const transferFamily = await createFamily(transferSource, 'Transfer race');
  addMember(transferFamily.familyId, transferRacer.id);
  const [transferResult, transferPreparation] = await race(
    'prepare vs transfer ownership',
    [
      transferSource.client.rpc('transfer_family_ownership', {
        target_family_id: transferFamily.familyId,
        new_owner_user_id: transferRacer.id,
      }),
      transferRacer.client.rpc('prepare_account_deletion'),
    ],
  );
  expect(
    Boolean(transferResult.error) !== Boolean(transferPreparation.error),
    'Transfer race did not serialize to exactly one safe outcome.',
  );
  checkSql(
    'Ownership transfer race retains exactly one live Family Owner',
    `select count(*)=1 from public.family_members
     where family_id='${transferFamily.familyId}'::uuid and role='owner';`,
  );

  const joinRacer = await createUser('join-racer');
  const joinSource = await createUser('join-source');
  const joinFamily = await createFamily(joinSource, 'Join race');
  const joinInvite = await invite(joinSource, joinFamily.familyId);
  const [joinResult, joinPreparation] = await race('prepare vs invite accept', [
    joinRacer.client.rpc('join_family_with_invite', {
      invite_code: joinInvite.invite_code,
    }),
    joinRacer.client.rpc('prepare_account_deletion'),
  ]);
  expect(!joinPreparation.error, 'Invite race left account unprepared.');
  expect(
    joinResult.error || joinResult.data?.[0]?.join_status === 'joined',
    'Invite race returned an unexpected result.',
  );
  checkSql(
    'Invite acceptance race leaves no prepared account membership',
    `select not exists(select 1 from public.family_members
       where user_id='${joinRacer.id}'::uuid)
      and not exists(select 1 from public.pet_members
       where user_id='${joinRacer.id}'::uuid);`,
  );

  const removeRacer = await createUser('remove-racer');
  const removeSource = await createUser('remove-source');
  const removeFamily = await createFamily(removeSource, 'Remove race');
  addMember(removeFamily.familyId, removeRacer.id);
  const [, removePreparation] = await race('prepare vs remove member', [
    removeSource.client.rpc('remove_family_member', {
      target_family_id: removeFamily.familyId,
      target_user_id: removeRacer.id,
    }),
    removeRacer.client.rpc('prepare_account_deletion'),
  ]);
  const settledRemovePreparation = removePreparation.error
    ? await removeRacer.client.rpc('prepare_account_deletion')
    : removePreparation;
  expect(
    !settledRemovePreparation.error,
    `Remove race did not converge after retry: ${settledRemovePreparation.error?.message}`,
  );
  checkSql(
    'Removal race leaves no prepared account membership',
    `select not exists(select 1 from public.family_members
       where user_id='${removeRacer.id}'::uuid)
      and not exists(select 1 from public.pet_members
       where user_id='${removeRacer.id}'::uuid);`,
  );
  const removedAccount = await invoke(removeRacer);
  expect(
    removedAccount.status === 200,
    'Removed member could not delete own account.',
  );
  const staleSession = await invoke(removeRacer);
  expect(
    staleSession.status === 401,
    'Deleted account session remained usable.',
  );
  console.log(
    'PASS: owner guards, member/viewer/former-Owner flows, retry, rollback, creator invite retention, and account write gates.',
  );
  console.log(
    'PASS: create Family, Owner transfer, invite accept, and member removal races remain safe.',
  );
  console.log('PASS: Phase C4G safe account deletion verification complete.');
} finally {
  await cleanup();
}

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
const container =
  process.env.SUPABASE_LOCAL_DB_CONTAINER?.trim() ?? 'supabase_db_pawday';

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Local Supabase URL, anon key, and service-role key are required.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: Phase C4F verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C4F requires a local DB container.');
}

const migrationPath =
  'supabase/migrations/20260923090000_multi_pet_family_phase_c4f_safe_family_deletion.sql';
const migration = readFileSync(join(root, migrationPath), 'utf8');
const databaseTypes = readFileSync(join(root, 'src/types/database.ts'), 'utf8');

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const familyIds = new Set();
const storageObjects = new Map(
  [
    'profile-avatars',
    'pet-avatars',
    'post-media',
    'post-videos',
    'post-video-thumbnails',
  ].map((bucket) => [bucket, new Set()]),
);
const jpegBytes = new Uint8Array([255, 216, 255, 217]);
const videoBytes = new Uint8Array([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
  111, 109, 105, 115, 111, 50,
]);
const today = new Date().toISOString().slice(0, 10);
let rollbackTriggerInstalled = false;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sql(statement) {
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

function expectSql(label, statement) {
  const result = sql(statement);
  expect(result === 't', `${label} (received ${JSON.stringify(result)})`);
  console.log(`PASS: ${label}`);
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
  const email = `phase-c4f-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase C4F ${label}`, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;
  const user = { client, id: created.data.user.id };
  users.push(user);
  return user;
}

async function createFamily(owner, label) {
  const result = await owner.client.rpc('create_pet', {
    pet_adoption_date: null,
    pet_birthday: null,
    pet_breed: 'Phase C4F verifier',
    pet_description: label,
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: null,
  });
  if (result.error || !result.data?.family_id) throw result.error;
  familyIds.add(result.data.family_id);
  return { familyId: result.data.family_id, petId: result.data.id };
}

async function createFamilyPet(owner, familyId, label) {
  return owner.client.rpc('create_family_pet', {
    pet_adoption_date: null,
    pet_birthday: null,
    pet_breed: 'Phase C4F verifier',
    pet_description: label,
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: null,
    target_family_id: familyId,
  });
}

function addMember(familyId, userId, role = 'member') {
  sql(`
    with inserted as (
      insert into public.family_members (family_id, user_id, role, created_at)
      values (
        '${familyId}'::uuid,
        '${userId}'::uuid,
        '${role}'::public.pet_member_role,
        clock_timestamp()
      )
      returning user_id, role, created_at
    )
    insert into public.pet_members (pet_id, user_id, role, created_at)
    select pet.id, inserted.user_id, inserted.role, inserted.created_at
    from inserted
    join public.pets as pet on pet.family_id = '${familyId}'::uuid;
  `);
}

async function createInvite(owner, familyId) {
  const result = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  if (result.error || !result.data?.[0]) throw result.error;
  return result.data[0];
}

async function upload(bucket, storagePath, contentType, bytes, client = admin) {
  const result = await client.storage.from(bucket).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });
  if (result.error) throw result.error;
  storageObjects.get(bucket).add(storagePath);
  return storagePath;
}

async function uploadImage(bucket, storagePath, client = admin) {
  return upload(bucket, storagePath, 'image/jpeg', jpegBytes, client);
}

function photoItem(id, storagePath) {
  return {
    height: 32,
    id,
    mime_type: 'image/jpeg',
    position: 0,
    storage_path: storagePath,
    width: 32,
  };
}

async function createPhotoPost(actor, petId, label) {
  const postId = randomUUID();
  const mediaId = randomUUID();
  const storagePath = `${actor.id}/${petId}/${postId}/${mediaId}.jpg`;
  await uploadImage('post-media', storagePath);
  const result = await actor.client.rpc('create_post', {
    media_items: [photoItem(mediaId, storagePath)],
    post_content: label,
    post_event_date: today,
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (result.error) throw result.error;
  return { postId, storagePath };
}

async function createVideoPost(actor, petId, label) {
  const postId = randomUUID();
  const videoId = randomUUID();
  const stem = `${actor.id}/${petId}/${postId}/${videoId}`;
  const storagePath = `${stem}.mp4`;
  const thumbnailPath = `${stem}.jpg`;
  await upload(
    'post-videos',
    storagePath,
    'video/mp4',
    videoBytes,
    actor.client,
  );
  await upload(
    'post-video-thumbnails',
    thumbnailPath,
    'image/jpeg',
    jpegBytes,
    actor.client,
  );
  const result = await actor.client.rpc('create_post_v2', {
    media_items: [],
    post_content: label,
    post_event_date: today,
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
    video_item: {
      duration_ms: 1500,
      height: 720,
      id: videoId,
      mime_type: 'video/mp4',
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      width: 1280,
    },
  });
  if (result.error) throw result.error;
  return { postId, storagePath, thumbnailPath };
}

async function createPetHistory(actor, petId, label) {
  let result = await actor.client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_health_subtype: 'energy',
    care_id: randomUUID(),
    care_kind: 'health',
    care_note: label,
    care_occurred_at: new Date().toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: petId,
  });
  if (result.error) throw result.error;

  result = await actor.client.rpc('send_chat_message', {
    message_body: label,
    target_client_message_id: randomUUID(),
    target_pet_id: petId,
  });
  if (result.error) throw result.error;

  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  const taskId = randomUUID();
  result = await actor.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: label,
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt,
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: label,
    task_week_day: null,
  });
  if (result.error) throw result.error;

  const shiftId = randomUUID();
  result = await actor.client.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(scheduledAt)),
    shift_note: label,
    target_assignee_user_id: actor.id,
    target_pet_id: petId,
    task_items: [{ care_task_id: taskId, source_scheduled_for: scheduledAt }],
  });
  if (result.error) throw result.error;
  return { shiftId, taskId };
}

function activeJobCount(bucket, storagePath) {
  return count(`
    select count(*) from public.media_cleanup_jobs
    where bucket_id = '${bucket}'
      and storage_path = '${storagePath}'
      and completed_at is null;
  `);
}

function objectExists(bucket, storagePath) {
  return (
    count(`
      select count(*) from storage.objects
      where bucket_id = '${bucket}' and name = '${storagePath}';
    `) === 1
  );
}

async function expectDenied(resultPromise, label) {
  const result = await resultPromise;
  expect(result.error, `${label} unexpectedly succeeded.`);
}

async function raceDelete(owner, familyId, mutations, label) {
  const results = await Promise.race([
    Promise.allSettled([
      owner.client.rpc('delete_family', { target_family_id: familyId }),
      ...mutations,
    ]),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out; possible deadlock.`)),
        20000,
      );
    }),
  ]);
  const deletion = results[0];
  expect(
    deletion.status === 'fulfilled' &&
      !deletion.value.error &&
      deletion.value.data === 'deleted',
    `${label}: delete_family did not win safely.`,
  );
  expectSql(
    `${label} leaves no Family aggregate`,
    `select
       not exists (select 1 from public.families where id = '${familyId}'::uuid)
       and not exists (
         select 1 from public.pets where family_id = '${familyId}'::uuid
       )
       and not exists (
         select 1 from public.family_members
         where family_id = '${familyId}'::uuid
       )
       and not exists (
         select 1 from public.family_invites
         where family_id = '${familyId}'::uuid
       );`,
  );
  return results.slice(1);
}

function installRollbackFailure(familyId) {
  sql(`
    create or replace function private.phase_c4f_inject_family_delete_failure()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      if old.id = '${familyId}'::uuid then
        raise exception 'phase_c4f_injected_failure' using errcode = 'P0001';
      end if;
      return old;
    end;
    $$;
    revoke execute on function private.phase_c4f_inject_family_delete_failure()
      from public, anon, authenticated;
    create trigger phase_c4f_inject_family_delete_failure
    before delete on public.families
    for each row
    execute function private.phase_c4f_inject_family_delete_failure();
  `);
  rollbackTriggerInstalled = true;
}

function removeRollbackFailure() {
  sql(`
    drop trigger if exists phase_c4f_inject_family_delete_failure
      on public.families;
    drop function if exists private.phase_c4f_inject_family_delete_failure();
  `);
  rollbackTriggerInstalled = false;
}

async function cleanup() {
  if (rollbackTriggerInstalled) removeRollbackFailure();
  for (const familyId of familyIds) {
    sql(`
      delete from public.pets where family_id = '${familyId}'::uuid;
      delete from public.families where id = '${familyId}'::uuid;
    `);
  }
  for (const user of users.reverse()) {
    await user.client.auth.signOut();
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
  for (const [bucket, paths] of storageObjects) {
    if (paths.size > 0) await admin.storage.from(bucket).remove([...paths]);
  }
  sql('delete from public.media_cleanup_jobs;');
}

try {
  for (const required of [
    'create or replace function public.delete_family(target_family_id uuid)',
    'pg_advisory_xact_lock',
    'from public.family_members as membership',
    "membership.role = 'owner'",
    'delete from public.pets',
    'where family_id = target_family_id',
    'delete from public.families',
    "return 'deleted'",
  ]) {
    expect(migration.includes(required), `Migration is missing: ${required}`);
  }
  expect(
    !migration.includes('private.is_pet_owner') &&
      !migration.includes('from public.pet_members') &&
      !migration.includes('storage.objects') &&
      !migration.includes('storage.from'),
    'Family deletion trusts legacy Pet authorization or deletes Storage.',
  );
  expect(
    databaseTypes.includes('delete_family:') &&
      databaseTypes.includes("Returns: 'deleted'"),
    'Typed delete_family RPC contract is missing.',
  );
  console.log(
    'PASS: C4F RPC is Family-scoped, canonical-owner authorized, atomic, and Storage-independent.',
  );

  expectSql(
    'Family and Pet descendant foreign keys have the audited lifecycle actions',
    `select
       (
         select confdeltype = 'r'
         from pg_catalog.pg_constraint
         where conname = 'pets_family_id_fkey'
       )
       and not exists (
         select 1
         from pg_catalog.pg_constraint
         where contype = 'f'
           and confrelid in (
             'public.families'::regclass,
             'public.pets'::regclass,
             'public.posts'::regclass
           )
           and conname <> 'pets_family_id_fkey'
           and confdeltype <> 'c'
       );`,
  );

  const owner = await createUser('owner');
  const member = await createUser('member');
  const viewer = await createUser('viewer');
  const removed = await createUser('removed');
  const stranger = await createUser('stranger');
  const otherOwner = await createUser('other-owner');

  const authz = await createFamily(owner, 'Authorization');
  addMember(authz.familyId, member.id, 'member');
  addMember(authz.familyId, viewer.id, 'viewer');
  addMember(authz.familyId, removed.id, 'member');
  let result = await owner.client.rpc('remove_family_member', {
    target_family_id: authz.familyId,
    target_user_id: removed.id,
  });
  if (result.error || result.data !== 'removed') throw result.error;
  const other = await createFamily(otherOwner, 'Other Family');

  for (const [actor, label] of [
    [member, 'Member'],
    [viewer, 'Viewer'],
    [removed, 'Removed member'],
    [stranger, 'Stranger'],
    [otherOwner, 'Other Family Owner'],
  ]) {
    await expectDenied(
      actor.client.rpc('delete_family', {
        target_family_id: authz.familyId,
      }),
      `${label} delete`,
    );
  }
  const anon = testClient();
  await expectDenied(
    anon.rpc('delete_family', { target_family_id: authz.familyId }),
    'Anonymous delete',
  );
  expectSql(
    'Authorization failures preserve both target and unrelated Families',
    `select
       exists (select 1 from public.families where id = '${authz.familyId}'::uuid)
       and exists (select 1 from public.families where id = '${other.familyId}'::uuid);`,
  );
  console.log(
    'PASS: Member, Viewer, removed Member, stranger, other Owner, and anonymous deletion are denied.',
  );

  const ownerDelete = await admin
    .from('family_members')
    .delete()
    .eq('family_id', authz.familyId)
    .eq('user_id', owner.id);
  expect(
    ownerDelete.error,
    'Direct deletion removed the sole live Family Owner.',
  );
  expectSql(
    'C4B exactly-one-Owner invariant remains enforced',
    `select count(*) = 1
     from public.family_members
     where family_id = '${authz.familyId}'::uuid and role = 'owner';`,
  );

  result = await owner.client.rpc('delete_family', {
    target_family_id: authz.familyId,
  });
  if (result.error) throw result.error;

  const zero = await createFamily(owner, 'Zero Pet');
  const zeroInvite = await createInvite(owner, zero.familyId);
  result = await owner.client.rpc('delete_family_pet', {
    target_pet_id: zero.petId,
  });
  if (result.error) throw result.error;
  expectSql(
    'Zero-Pet Family remains valid before explicit Family deletion',
    `select
       exists (select 1 from public.families where id = '${zero.familyId}'::uuid)
       and not exists (
         select 1 from public.pets where family_id = '${zero.familyId}'::uuid
       )
       and exists (
         select 1 from public.family_invites
         where id = '${zeroInvite.invite_id}'::uuid
       );`,
  );
  result = await owner.client.rpc('delete_family', {
    target_family_id: zero.familyId,
  });
  if (result.error || result.data !== 'deleted') throw result.error;
  expectSql(
    'Owner deletes zero-Pet Family while User and Profile remain',
    `select
       not exists (select 1 from public.families where id = '${zero.familyId}'::uuid)
       and not exists (
         select 1 from public.family_members
         where family_id = '${zero.familyId}'::uuid
       )
       and not exists (
         select 1 from public.family_invites
         where family_id = '${zero.familyId}'::uuid
       )
       and exists (select 1 from auth.users where id = '${owner.id}'::uuid)
       and exists (select 1 from public.profiles where id = '${owner.id}'::uuid);`,
  );
  await expectDenied(
    member.client.rpc('join_family_with_invite', {
      invite_code: zeroInvite.invite_code,
    }),
    'Deleted Family invite reuse',
  );
  await expectDenied(
    owner.client.rpc('delete_family', { target_family_id: zero.familyId }),
    'Repeated Family delete',
  );

  const aggregate = await createFamily(owner, 'Aggregate A');
  const petIds = [aggregate.petId];
  for (const label of ['Aggregate B', 'Aggregate C']) {
    const created = await createFamilyPet(owner, aggregate.familyId, label);
    if (created.error || !created.data?.id) throw created.error;
    petIds.push(created.data.id);
  }
  const aggregateInvite = await createInvite(owner, aggregate.familyId);

  const profilePath = `${owner.id}/${randomUUID()}.jpg`;
  await uploadImage('profile-avatars', profilePath);
  result = await owner.client
    .from('profiles')
    .update({ avatar_url: profilePath })
    .eq('id', owner.id);
  if (result.error) throw result.error;

  const ownedPaths = [];
  for (const [index, petId] of petIds.entries()) {
    const avatarPath = `${owner.id}/${petId}/${randomUUID()}.jpg`;
    await uploadImage('pet-avatars', avatarPath);
    result = await owner.client
      .from('pets')
      .update({ avatar_path: avatarPath })
      .eq('id', petId);
    if (result.error) throw result.error;
    const photo = await createPhotoPost(owner, petId, `C4F photo ${index}`);
    const video = await createVideoPost(owner, petId, `C4F video ${index}`);
    await createPetHistory(owner, petId, `C4F history ${index}`);
    ownedPaths.push(
      ['pet-avatars', avatarPath],
      ['post-media', photo.storagePath],
      ['post-videos', video.storagePath],
      ['post-video-thumbnails', video.thumbnailPath],
    );
  }

  const survivorOwner = await createUser('survivor-owner');
  const survivor = await createFamily(survivorOwner, 'Survivor Family');
  const survivorAvatar = `${survivorOwner.id}/${survivor.petId}/${randomUUID()}.jpg`;
  await uploadImage('pet-avatars', survivorAvatar);
  result = await survivorOwner.client
    .from('pets')
    .update({ avatar_path: survivorAvatar })
    .eq('id', survivor.petId);
  if (result.error) throw result.error;
  const survivorPhoto = await createPhotoPost(
    survivorOwner,
    survivor.petId,
    'Survivor photo',
  );
  addMember(survivor.familyId, member.id, 'member');

  result = await owner.client.rpc('delete_family', {
    target_family_id: aggregate.familyId,
  });
  if (result.error || result.data !== 'deleted') throw result.error;

  expectSql(
    'Three-Pet Family aggregate and all audited descendants are deleted',
    `select
       not exists (select 1 from public.families where id = '${aggregate.familyId}'::uuid)
       and not exists (
         select 1 from public.family_members
         where family_id = '${aggregate.familyId}'::uuid
       )
       and not exists (
         select 1 from public.family_invites
         where family_id = '${aggregate.familyId}'::uuid
       )
       and not exists (select 1 from public.pets where id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.pet_members where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.pet_invites where id = '${aggregateInvite.invite_id}'::uuid)
       and not exists (select 1 from public.posts where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.care_logs where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.care_tasks where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.care_task_completions where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.care_shifts where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.care_shift_tasks where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.chat_messages where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from public.chat_read_states where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from private.pet_chat_states where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and not exists (select 1 from private.family_notification_outbox where pet_id = any(array[${petIds.map((id) => `'${id}'::uuid`).join(',')}]))
       and exists (select 1 from auth.users where id = '${owner.id}'::uuid)
       and exists (
         select 1 from public.profiles
         where id = '${owner.id}'::uuid and avatar_url = '${profilePath}'
       );`,
  );

  for (const [bucket, storagePath] of ownedPaths) {
    expect(
      activeJobCount(bucket, storagePath) === 1,
      `Missing durable cleanup job for ${bucket}/${storagePath}`,
    );
    expect(
      objectExists(bucket, storagePath),
      `Family deletion synchronously removed ${bucket}/${storagePath}`,
    );
  }
  expect(
    activeJobCount('profile-avatars', profilePath) === 0 &&
      objectExists('profile-avatars', profilePath),
    'Family deletion queued or removed the User-owned profile avatar.',
  );
  expect(
    activeJobCount('pet-avatars', survivorAvatar) === 0 &&
      activeJobCount('post-media', survivorPhoto.storagePath) === 0 &&
      objectExists('pet-avatars', survivorAvatar) &&
      objectExists('post-media', survivorPhoto.storagePath),
    'Family deletion affected survivor Family media.',
  );
  expectSql(
    'Other Family, Pet, membership, history, and media references remain',
    `select
       exists (select 1 from public.families where id = '${survivor.familyId}'::uuid)
       and exists (select 1 from public.pets where id = '${survivor.petId}'::uuid)
       and exists (
         select 1 from public.family_members
         where family_id = '${survivor.familyId}'::uuid
           and user_id = '${member.id}'::uuid
       )
       and exists (
         select 1 from public.posts
         where id = '${survivorPhoto.postId}'::uuid
       );`,
  );
  console.log(
    'PASS: Multi-Pet cascade, durable owned-media enqueue, profile preservation, and cross-Family isolation verified.',
  );

  const rollback = await createFamily(owner, 'Rollback');
  const rollbackAvatar = `${owner.id}/${rollback.petId}/${randomUUID()}.jpg`;
  await uploadImage('pet-avatars', rollbackAvatar);
  result = await owner.client
    .from('pets')
    .update({ avatar_path: rollbackAvatar })
    .eq('id', rollback.petId);
  if (result.error) throw result.error;
  installRollbackFailure(rollback.familyId);
  await expectDenied(
    owner.client.rpc('delete_family', {
      target_family_id: rollback.familyId,
    }),
    'Injected rollback delete',
  );
  removeRollbackFailure();
  expect(
    activeJobCount('pet-avatars', rollbackAvatar) === 0 &&
      objectExists('pet-avatars', rollbackAvatar),
    'Rolled-back Family deletion committed cleanup or removed Storage.',
  );
  expectSql(
    'Rolled-back Family deletion restores the complete aggregate',
    `select
       exists (select 1 from public.families where id = '${rollback.familyId}'::uuid)
       and exists (select 1 from public.pets where id = '${rollback.petId}'::uuid)
       and exists (
         select 1 from public.family_members
         where family_id = '${rollback.familyId}'::uuid
           and role = 'owner'
       );`,
  );

  result = await owner.client.rpc('delete_family', {
    target_family_id: rollback.familyId,
  });
  if (result.error) throw result.error;

  const createRace = await createFamily(owner, 'Create race');
  await raceDelete(
    owner,
    createRace.familyId,
    [createFamilyPet(owner, createRace.familyId, 'Concurrent Pet')],
    'delete_family vs create_family_pet',
  );

  const joinRace = await createFamily(owner, 'Invite race');
  const joiner = await createUser('join-racer');
  const joinInvite = await createInvite(owner, joinRace.familyId);
  await raceDelete(
    owner,
    joinRace.familyId,
    [
      joiner.client.rpc('join_family_with_invite', {
        invite_code: joinInvite.invite_code,
      }),
    ],
    'delete_family vs invite accept',
  );
  await expectDenied(
    joiner.client.rpc('join_family_with_invite', {
      invite_code: joinInvite.invite_code,
    }),
    'Post-delete invite reuse',
  );

  const leaveRace = await createFamily(owner, 'Leave race');
  const leaver = await createUser('leave-racer');
  addMember(leaveRace.familyId, leaver.id, 'member');
  await raceDelete(
    owner,
    leaveRace.familyId,
    [
      leaver.client.rpc('leave_family', {
        target_family_id: leaveRace.familyId,
      }),
    ],
    'delete_family vs member leave',
  );

  const childRace = await createFamily(owner, 'Child race');
  const childSchedule = await createPetHistory(
    owner,
    childRace.petId,
    'Child race seed',
  );
  await raceDelete(
    owner,
    childRace.familyId,
    [
      owner.client.rpc('create_post', {
        media_items: [],
        post_content: 'Concurrent post',
        post_event_date: today,
        post_id: randomUUID(),
        post_location_name: null,
        post_pet_id: childRace.petId,
        post_tag: 'other',
      }),
      owner.client.rpc('create_care_log', {
        care_duration_minutes: null,
        care_health_subtype: 'energy',
        care_id: randomUUID(),
        care_kind: 'health',
        care_note: 'Concurrent care',
        care_occurred_at: new Date().toISOString(),
        care_time_zone: 'Asia/Hong_Kong',
        target_pet_id: childRace.petId,
      }),
      owner.client.rpc('send_chat_message', {
        message_body: 'Concurrent chat',
        target_client_message_id: randomUUID(),
        target_pet_id: childRace.petId,
      }),
      owner.client.rpc('claim_care_shift', {
        target_shift_id: childSchedule.shiftId,
      }),
    ],
    'delete_family vs Post/Care/Chat/Schedule mutations',
  );

  console.log(
    'PASS: Rollback atomicity, repeated requests, invite invalidation, and concurrency fail-closed behavior verified.',
  );
  console.log('PASS: Phase C4F safe Family deletion verification complete.');
} finally {
  await cleanup();
}

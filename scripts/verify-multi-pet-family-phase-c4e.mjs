import { execFileSync, spawnSync } from 'node:child_process';
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
  throw new Error('SAFETY STOP: Phase C4E verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C4E requires a local DB container.');
}

const migrationPath =
  'supabase/migrations/20260923032134_multi_pet_family_phase_c4e_storage_ownership.sql';
const migration = readFileSync(join(root, migrationPath), 'utf8');
const deletePostEdge = readFileSync(
  join(root, 'supabase/functions/delete-post/index.ts'),
  'utf8',
);
const deletePetEdge = readFileSync(
  join(root, 'supabase/functions/delete-pet/index.ts'),
  'utf8',
);
const postPublishing = readFileSync(
  join(root, 'src/features/posts/post-publishing.ts'),
  'utf8',
);
const profileForm = readFileSync(
  join(root, 'src/features/profile/components/profile-form.tsx'),
  'utf8',
);
const editPet = readFileSync(
  join(root, 'src/features/pets/edit-pet-screen.tsx'),
  'utf8',
);
const worker = readFileSync(
  join(root, 'scripts/process-journal-video-cleanup.mjs'),
  'utf8',
);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const deletedUsers = new Set();
const familyIds = new Set();
const trackedStorage = new Map(
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
  const email = `phase-c4e-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase C4E ${label}`, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;
  const user = { client, id: created.data.user.id };
  users.push(user);
  return user;
}

async function createFamily(owner) {
  const result = await owner.client.rpc('create_pet', {
    pet_breed: 'Phase C4E verifier',
    pet_description: 'Durable media cleanup fixture',
    pet_gender: 'unknown',
    pet_name: `C4E Pet ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (result.error || !result.data?.family_id) throw result.error;
  familyIds.add(result.data.family_id);
  return { familyId: result.data.family_id, petId: result.data.id };
}

async function createFamilyPet(owner, familyId) {
  const result = await owner.client.rpc('create_family_pet', {
    pet_adoption_date: null,
    pet_birthday: null,
    pet_breed: 'Phase C4E survivor',
    pet_description: null,
    pet_gender: 'unknown',
    pet_name: `C4E Survivor ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: null,
    target_family_id: familyId,
  });
  if (result.error || !result.data?.id) throw result.error;
  return result.data.id;
}

function addMember(familyId, userId) {
  sql(`
    with inserted as (
      insert into public.family_members (family_id, user_id, role, created_at)
      values (
        '${familyId}'::uuid,
        '${userId}'::uuid,
        'member'::public.pet_member_role,
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

async function upload(bucket, storagePath, contentType, bytes, client = admin) {
  const result = await client.storage.from(bucket).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });
  if (result.error) throw result.error;
  trackedStorage.get(bucket).add(storagePath);
  return storagePath;
}

async function uploadImage(bucket, storagePath) {
  return upload(bucket, storagePath, 'image/jpeg', jpegBytes);
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
  return { mediaId, postId, storagePath };
}

async function uploadVideoPair(actor, petId, postId) {
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
  return { storagePath, thumbnailPath, videoId };
}

function videoItem(video) {
  return {
    duration_ms: 1500,
    height: 720,
    id: video.videoId,
    mime_type: 'video/mp4',
    storage_path: video.storagePath,
    thumbnail_path: video.thumbnailPath,
    width: 1280,
  };
}

async function createVideoPost(actor, petId, label) {
  const postId = randomUUID();
  const video = await uploadVideoPair(actor, petId, postId);
  const result = await actor.client.rpc('create_post_v2', {
    media_items: [],
    post_content: label,
    post_event_date: today,
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
    video_item: videoItem(video),
  });
  if (result.error) throw result.error;
  return { postId, ...video };
}

function objectExists(bucket, storagePath) {
  return (
    count(`
      select count(*) from storage.objects
      where bucket_id = '${bucket}' and name = '${storagePath}';
    `) === 1
  );
}

function activeJobCount(bucket, storagePath) {
  return count(`
    select count(*) from public.media_cleanup_jobs
    where bucket_id = '${bucket}'
      and storage_path = '${storagePath}'
      and completed_at is null;
  `);
}

function runWorker() {
  return execFileSync(
    process.execPath,
    ['scripts/process-journal-video-cleanup.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_LOCAL_SERVICE_ROLE_KEY: serviceKey,
        SUPABASE_LOCAL_URL: url,
      },
    },
  ).trim();
}

async function cleanup() {
  for (const familyId of familyIds) {
    sql(`
      delete from public.pets where family_id = '${familyId}'::uuid;
      delete from public.families where id = '${familyId}'::uuid;
    `);
  }
  for (const user of users) {
    if (deletedUsers.has(user.id)) continue;
    await user.client.auth.signOut();
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
  for (const [bucket, paths] of trackedStorage) {
    if (paths.size > 0) await admin.storage.from(bucket).remove([...paths]);
  }
  sql(`delete from public.media_cleanup_jobs;`);
}

try {
  for (const bucket of [
    'profile-avatars',
    'pet-avatars',
    'post-media',
    'post-videos',
    'post-video-thumbnails',
  ]) {
    expect(
      migration.includes(`'${bucket}'`),
      `Migration is missing cleanup bucket ${bucket}.`,
    );
    expect(
      worker.includes(`'${bucket}'`),
      `Worker is missing cleanup bucket ${bucket}.`,
    );
  }
  expect(
    migration.includes('deferrable initially deferred') &&
      migration.includes('where media.storage_path = old.storage_path'),
    'Post media cleanup is not protected against retained delete/reinsert paths.',
  );
  expect(
    migration.includes('profile_avatar_replaced') &&
      migration.includes('profile_avatar_deleted') &&
      migration.includes('pet_avatar_replaced') &&
      migration.includes('pet_avatar_deleted') &&
      migration.includes('post_media_removed'),
    'Ownership-specific cleanup reasons are incomplete.',
  );
  expect(
    !deletePostEdge.includes(".storage\n      .from('post-media')") &&
      !deletePostEdge.includes('cleanupVideoReferences') &&
      !deletePetEdge.includes('cleanupVideoReferences') &&
      !deletePetEdge.includes(".from('pet-avatars').remove"),
    'A lifecycle Edge Function still deletes canonical Storage objects synchronously.',
  );
  expect(
    !postPublishing.includes('cleanupRemovedPhotos') &&
      !profileForm.includes('removeProfileAvatar(profile.avatar_url)') &&
      !editPet.includes('removePetAvatar(originalAvatarPath)'),
    'A client mutation still deletes canonical replaced media synchronously.',
  );
  expect(
    profileForm.includes('removeProfileAvatar(uploadedPath)') &&
      editPet.includes('uploadedPath && !avatarUpdated') &&
      editPet.includes('removePetAvatar(uploadedPath)') &&
      postPublishing.includes('cleanupNewPhotoUploads(uploadedPaths)'),
    'Uncommitted upload rollback cleanup was removed accidentally.',
  );
  console.log(
    'PASS: Ownership model, deferred Post protection, Edge ordering, and client cleanup boundaries are present.',
  );

  expectSql(
    'Cleanup queue allows exactly the five Phase C4E buckets.',
    `
      select pg_catalog.pg_get_constraintdef(constraint_info.oid) like '%profile-avatars%'
        and pg_catalog.pg_get_constraintdef(constraint_info.oid) like '%pet-avatars%'
        and pg_catalog.pg_get_constraintdef(constraint_info.oid) like '%post-media%'
        and pg_catalog.pg_get_constraintdef(constraint_info.oid) like '%post-videos%'
        and pg_catalog.pg_get_constraintdef(constraint_info.oid) like '%post-video-thumbnails%'
      from pg_catalog.pg_constraint as constraint_info
      where constraint_info.conname = 'media_cleanup_jobs_bucket';
    `,
  );
  expectSql(
    'All C4E enqueue triggers are installed with Post media deferred.',
    `
      select
        exists (
          select 1 from pg_catalog.pg_trigger
          where tgname = 'enqueue_removed_profile_avatar_cleanup'
            and not tgisinternal
        )
        and exists (
          select 1 from pg_catalog.pg_trigger
          where tgname = 'enqueue_removed_pet_avatar_cleanup'
            and not tgisinternal
        )
        and exists (
          select 1 from pg_catalog.pg_trigger
          where tgname = 'enqueue_deleted_post_media_cleanup'
            and tgdeferrable and tginitdeferred and not tgisinternal
        );
    `,
  );
  sql(`
    do $verify$
    begin
      begin
        perform private.enqueue_media_cleanup(
          'post-media', '../escape.jpg', 'invalid_path_probe', null
        );
        raise exception 'invalid cleanup path unexpectedly accepted';
      exception when sqlstate '22023' then
        null;
      end;
    end
    $verify$;
  `);
  console.log('PASS: Private enqueue rejects non-canonical traversal paths.');

  const owner = await createUser('owner');
  const member = await createUser('member');
  const { familyId, petId } = await createFamily(owner);
  const survivorPetId = await createFamilyPet(owner, familyId);
  addMember(familyId, member.id);

  const hiddenJobs = await owner.client.from('media_cleanup_jobs').select('id');
  expect(hiddenJobs.error, 'Authenticated user could read cleanup jobs.');
  const forbiddenClaim = await owner.client.rpc('claim_media_cleanup_jobs', {
    job_limit: 1,
  });
  expect(forbiddenClaim.error, 'Authenticated user could claim cleanup jobs.');
  console.log('PASS: Cleanup queue and worker RPCs remain service-role only.');

  const ownerProfileOld = `${owner.id}/${randomUUID()}.jpg`;
  const ownerProfileNew = `${owner.id}/${randomUUID()}.jpg`;
  await uploadImage('profile-avatars', ownerProfileOld);
  await uploadImage('profile-avatars', ownerProfileNew);
  let result = await owner.client
    .from('profiles')
    .update({ avatar_url: ownerProfileOld })
    .eq('id', owner.id);
  if (result.error) throw result.error;
  result = await owner.client
    .from('profiles')
    .update({ avatar_url: ownerProfileNew })
    .eq('id', owner.id);
  if (result.error) throw result.error;
  expect(
    activeJobCount('profile-avatars', ownerProfileOld) === 1 &&
      objectExists('profile-avatars', ownerProfileOld),
    'Profile replacement did not durably queue the old avatar before deletion.',
  );

  const removedProfileAvatar = `${member.id}/${randomUUID()}.jpg`;
  await uploadImage('profile-avatars', removedProfileAvatar);
  result = await member.client
    .from('profiles')
    .update({ avatar_url: removedProfileAvatar })
    .eq('id', member.id);
  if (result.error) throw result.error;
  result = await member.client
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', member.id);
  if (result.error) throw result.error;
  expect(
    activeJobCount('profile-avatars', removedProfileAvatar) === 1 &&
      objectExists('profile-avatars', removedProfileAvatar),
    'Profile avatar removal did not durably queue the old object.',
  );

  const petAvatarOld = `${owner.id}/${petId}/${randomUUID()}.jpg`;
  const petAvatarNew = `${owner.id}/${petId}/${randomUUID()}.jpg`;
  await uploadImage('pet-avatars', petAvatarOld);
  await uploadImage('pet-avatars', petAvatarNew);
  result = await owner.client
    .from('pets')
    .update({ avatar_path: petAvatarOld })
    .eq('id', petId);
  if (result.error) throw result.error;
  result = await owner.client
    .from('pets')
    .update({ avatar_path: petAvatarNew })
    .eq('id', petId);
  if (result.error) throw result.error;
  expect(
    activeJobCount('pet-avatars', petAvatarOld) === 1 &&
      objectExists('pet-avatars', petAvatarOld),
    'Pet avatar replacement did not durably queue the old avatar.',
  );

  const editedPost = await createPhotoPost(owner, petId, 'Edited photo');
  result = await owner.client.rpc('update_post', {
    media_items: [photoItem(editedPost.mediaId, editedPost.storagePath)],
    post_content: 'Retained photo',
    post_event_date: today,
    post_location_name: null,
    post_tag: 'other',
    target_post_id: editedPost.postId,
  });
  if (result.error) throw result.error;
  expect(
    activeJobCount('post-media', editedPost.storagePath) === 0,
    'Retained photo was incorrectly queued by delete/reinsert update.',
  );

  const replacementMediaId = randomUUID();
  const replacementPath = `${owner.id}/${petId}/${editedPost.postId}/${replacementMediaId}.jpg`;
  await uploadImage('post-media', replacementPath);
  result = await owner.client.rpc('update_post', {
    media_items: [photoItem(replacementMediaId, replacementPath)],
    post_content: 'Replacement photo',
    post_event_date: today,
    post_location_name: null,
    post_tag: 'other',
    target_post_id: editedPost.postId,
  });
  if (result.error) throw result.error;
  expect(
    activeJobCount('post-media', editedPost.storagePath) === 1 &&
      objectExists('post-media', editedPost.storagePath),
    'Removed Post photo was not queued durably.',
  );

  const replacementVideo = await createVideoPost(
    owner,
    petId,
    'Replacement video',
  );
  const replacementVideoNew = await uploadVideoPair(
    owner,
    petId,
    replacementVideo.postId,
  );
  result = await owner.client.rpc('update_post_v2', {
    media_items: [],
    post_content: 'Replacement video committed',
    post_event_date: today,
    post_location_name: null,
    post_tag: 'other',
    target_post_id: replacementVideo.postId,
    video_item: videoItem(replacementVideoNew),
  });
  if (result.error) throw result.error;
  expect(
    activeJobCount('post-videos', replacementVideo.storagePath) === 1 &&
      activeJobCount(
        'post-video-thumbnails',
        replacementVideo.thumbnailPath,
      ) === 1 &&
      activeJobCount('post-videos', replacementVideoNew.storagePath) === 0 &&
      activeJobCount(
        'post-video-thumbnails',
        replacementVideoNew.thumbnailPath,
      ) === 0,
    'Video replacement did not queue exactly the superseded pair.',
  );

  const deletedPhoto = await createPhotoPost(owner, petId, 'Deleted photo');
  const deletedVideo = await createVideoPost(owner, petId, 'Deleted video');
  result = await admin.from('posts').delete().eq('id', deletedPhoto.postId);
  if (result.error) throw result.error;
  result = await admin.from('posts').delete().eq('id', deletedVideo.postId);
  if (result.error) throw result.error;
  expect(
    activeJobCount('post-media', deletedPhoto.storagePath) === 1 &&
      activeJobCount('post-videos', deletedVideo.storagePath) === 1 &&
      activeJobCount('post-video-thumbnails', deletedVideo.thumbnailPath) ===
        1 &&
      objectExists('post-media', deletedPhoto.storagePath) &&
      objectExists('post-videos', deletedVideo.storagePath) &&
      objectExists('post-video-thumbnails', deletedVideo.thumbnailPath),
    'Post deletion did not enqueue all photo/video/thumbnail objects before worker execution.',
  );

  const rollbackProfilePath = `${member.id}/${randomUUID()}.jpg`;
  await uploadImage('profile-avatars', rollbackProfilePath);
  sql(`
    begin;
    update public.profiles
    set avatar_url = '${rollbackProfilePath}'
    where id = '${member.id}'::uuid;
    rollback;
  `);
  expect(
    activeJobCount('profile-avatars', rollbackProfilePath) === 0 &&
      count(
        `select count(*) from public.profiles where id='${member.id}'::uuid and avatar_url is null;`,
      ) === 1,
    'Rolled-back database mutation leaked cleanup work or changed authority.',
  );
  console.log(
    'PASS: Failed/rolled-back DB mutations leave Storage and queue state unchanged.',
  );

  const firstWorker = runWorker();
  expect(
    firstWorker.includes('failed') &&
      !objectExists('profile-avatars', ownerProfileOld) &&
      objectExists('profile-avatars', ownerProfileNew) &&
      !objectExists('profile-avatars', removedProfileAvatar) &&
      !objectExists('pet-avatars', petAvatarOld) &&
      objectExists('pet-avatars', petAvatarNew) &&
      !objectExists('post-media', editedPost.storagePath) &&
      objectExists('post-media', replacementPath) &&
      !objectExists('post-media', deletedPhoto.storagePath) &&
      !objectExists('post-videos', deletedVideo.storagePath) &&
      !objectExists('post-video-thumbnails', deletedVideo.thumbnailPath) &&
      !objectExists('post-videos', replacementVideo.storagePath) &&
      !objectExists('post-video-thumbnails', replacementVideo.thumbnailPath) &&
      objectExists('post-videos', replacementVideoNew.storagePath) &&
      objectExists('post-video-thumbnails', replacementVideoNew.thumbnailPath),
    'Worker did not remove only the queued stale objects.',
  );
  console.log(
    'PASS: Worker deletes queued objects and preserves canonical replacements.',
  );

  const retryPath = `${owner.id}/${randomUUID()}.jpg`;
  sql(`
    select private.enqueue_media_cleanup(
      'profile-avatars', '${retryPath}', 'retry_probe', null
    );
  `);
  const claimedRetry = await admin.rpc('claim_media_cleanup_jobs', {
    job_limit: 1,
  });
  if (claimedRetry.error) throw claimedRetry.error;
  const retryJob = claimedRetry.data?.find(
    (job) => job.storage_path === retryPath,
  );
  expect(
    retryJob?.attempt_count === 1 &&
      new Date(retryJob.next_attempt_at).getTime() > Date.now(),
    'Claim did not establish a retry lease.',
  );
  const failedRetry = await admin.rpc('fail_media_cleanup_job', {
    failure_message: 'Transient local Storage failure',
    target_job_id: retryJob.id,
  });
  if (failedRetry.error) throw failedRetry.error;
  sql(`
    update public.media_cleanup_jobs
    set next_attempt_at = now()
    where id = ${retryJob.id}::bigint;
  `);
  runWorker();
  expect(
    count(`
      select count(*) from public.media_cleanup_jobs
      where id=${retryJob.id}::bigint
        and attempt_count = 2
        and completed_at is not null
        and last_error is null;
    `) === 1,
    'Failed cleanup was not reclaimed and completed on retry.',
  );
  console.log(
    'PASS: Claim lease, fail state, retry, and complete are durable.',
  );

  const completionReplayPath = `${owner.id}/${randomUUID()}.jpg`;
  sql(`
    select private.enqueue_media_cleanup(
      'profile-avatars',
      '${completionReplayPath}',
      'complete_failure_replay_probe',
      null
    );
  `);
  const completionClaim = await admin.rpc('claim_media_cleanup_jobs', {
    job_limit: 1,
  });
  if (completionClaim.error) throw completionClaim.error;
  const completionReplayJob = completionClaim.data?.find(
    (job) => job.storage_path === completionReplayPath,
  );
  expect(completionReplayJob, 'Completion replay job was not claimed.');
  const firstRemoval = await admin.storage
    .from('profile-avatars')
    .remove([completionReplayPath]);
  if (firstRemoval.error) throw firstRemoval.error;
  // Simulate a crash or database failure before complete_media_cleanup_job.
  sql(`
    update public.media_cleanup_jobs
    set next_attempt_at = now()
    where id = ${completionReplayJob.id}::bigint;
  `);
  runWorker();
  expect(
    count(`
      select count(*) from public.media_cleanup_jobs
      where id=${completionReplayJob.id}::bigint
        and attempt_count = 2
        and completed_at is not null;
    `) === 1,
    'Cleanup did not recover after Storage deletion succeeded before completion.',
  );
  console.log(
    'PASS: Storage success followed by missing completion safely replays after lease expiry.',
  );

  const missingPath = `${owner.id}/${randomUUID()}.jpg`;
  sql(`
    select private.enqueue_media_cleanup(
      'profile-avatars', '${missingPath}', 'missing_object_probe', null
    );
    select private.enqueue_media_cleanup(
      'profile-avatars', '${missingPath}', 'missing_object_probe', null
    );
  `);
  expect(
    activeJobCount('profile-avatars', missingPath) === 1,
    'Duplicate active cleanup scheduling was not idempotent.',
  );
  runWorker();
  expect(
    count(`
      select count(*) from public.media_cleanup_jobs
      where bucket_id='profile-avatars'
        and storage_path='${missingPath}'
        and completed_at is not null;
    `) === 1,
    'Already-missing object cleanup did not complete idempotently.',
  );
  console.log(
    'PASS: Duplicate scheduling and missing-object deletion are idempotent.',
  );

  const memberProfile = `${member.id}/${randomUUID()}.jpg`;
  await uploadImage('profile-avatars', memberProfile);
  result = await member.client
    .from('profiles')
    .update({ avatar_url: memberProfile })
    .eq('id', member.id);
  if (result.error) throw result.error;
  const sharedPost = await createPhotoPost(
    member,
    petId,
    'Shared retained photo',
  );
  const sharedVideo = await createVideoPost(
    member,
    petId,
    'Shared retained video',
  );

  const outsider = await createUser('cross-family');
  const outsiderFamily = await createFamily(outsider);
  const outsiderPost = await createPhotoPost(
    outsider,
    outsiderFamily.petId,
    'Cross-Family protected photo',
  );
  const crossFamilyAttempt = await owner.client.rpc('update_post', {
    media_items: [],
    post_content: 'Unauthorized cleanup attempt',
    post_event_date: today,
    post_location_name: null,
    post_tag: 'other',
    target_post_id: outsiderPost.postId,
  });
  expect(
    crossFamilyAttempt.error &&
      activeJobCount('post-media', outsiderPost.storagePath) === 0 &&
      objectExists('post-media', outsiderPost.storagePath),
    'Cross-Family actor caused media cleanup.',
  );
  console.log(
    'PASS: Cross-Family mutation cannot enqueue victim media cleanup.',
  );

  const deletedMember = await admin.auth.admin.deleteUser(member.id);
  if (deletedMember.error) throw deletedMember.error;
  deletedUsers.add(member.id);
  expectSql(
    'Raw Auth deletion queues only the user-owned profile avatar and preserves shared Post/Pet media.',
    `
      select
        not exists (
          select 1 from public.profiles where id='${member.id}'::uuid
        )
        and exists (
          select 1 from public.posts
          where id='${sharedPost.postId}'::uuid and author_id is null
        )
        and exists (
          select 1 from public.post_media
          where post_id='${sharedPost.postId}'::uuid
            and storage_path='${sharedPost.storagePath}'
        )
        and exists (
          select 1 from public.post_videos
          where post_id='${sharedVideo.postId}'::uuid
            and storage_path='${sharedVideo.storagePath}'
            and thumbnail_path='${sharedVideo.thumbnailPath}'
        )
        and exists (
          select 1 from public.pets
          where id='${petId}'::uuid and avatar_path='${petAvatarNew}'
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='profile-avatars'
            and storage_path='${memberProfile}'
            and completed_at is null
        )
        and not exists (
          select 1 from public.media_cleanup_jobs
          where completed_at is null
            and (bucket_id, storage_path) in (
              ('post-media', '${sharedPost.storagePath}'),
              ('post-videos', '${sharedVideo.storagePath}'),
              ('post-video-thumbnails', '${sharedVideo.thumbnailPath}'),
              ('pet-avatars', '${petAvatarNew}')
            )
        );
    `,
  );
  runWorker();
  expect(
    !objectExists('profile-avatars', memberProfile) &&
      objectExists('post-media', sharedPost.storagePath) &&
      objectExists('post-videos', sharedVideo.storagePath) &&
      objectExists('post-video-thumbnails', sharedVideo.thumbnailPath) &&
      objectExists('pet-avatars', petAvatarNew),
    'Raw Auth cleanup deleted shared media or failed to delete the profile avatar.',
  );

  result = await owner.client.rpc('delete_family_pet', {
    target_pet_id: petId,
  });
  if (result.error || !result.data?.[0]) throw result.error;
  expectSql(
    'Pet deletion keeps the Family/other Pet and queues every descendant media object.',
    `
      select
        exists (select 1 from public.families where id='${familyId}'::uuid)
        and exists (select 1 from public.pets where id='${survivorPetId}'::uuid)
        and not exists (select 1 from public.pets where id='${petId}'::uuid)
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='pet-avatars'
            and storage_path='${petAvatarNew}'
            and completed_at is null
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='post-media'
            and storage_path='${replacementPath}'
            and completed_at is null
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='post-media'
            and storage_path='${sharedPost.storagePath}'
            and completed_at is null
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='post-videos'
            and storage_path='${sharedVideo.storagePath}'
            and completed_at is null
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='post-video-thumbnails'
            and storage_path='${sharedVideo.thumbnailPath}'
            and completed_at is null
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='post-videos'
            and storage_path='${replacementVideoNew.storagePath}'
            and completed_at is null
        );
    `,
  );
  runWorker();
  expect(
    !objectExists('pet-avatars', petAvatarNew) &&
      !objectExists('post-media', replacementPath) &&
      !objectExists('post-media', sharedPost.storagePath) &&
      !objectExists('post-videos', sharedVideo.storagePath) &&
      !objectExists('post-video-thumbnails', sharedVideo.thumbnailPath) &&
      !objectExists('post-videos', replacementVideoNew.storagePath) &&
      !objectExists(
        'post-video-thumbnails',
        replacementVideoNew.thumbnailPath,
      ) &&
      objectExists('profile-avatars', ownerProfileNew),
    'Pet cleanup did not remove its media or removed the owner profile avatar.',
  );
  console.log(
    'PASS: Pet deletion cleans Pet/Post media and retains the Family.',
  );

  const formerOwner = await createUser('former-owner');
  const successor = await createUser('successor-owner');
  const transferredFamily = await createFamily(formerOwner);
  addMember(transferredFamily.familyId, successor.id);
  const formerProfile = `${formerOwner.id}/${randomUUID()}.jpg`;
  const transferredPetAvatar = `${formerOwner.id}/${transferredFamily.petId}/${randomUUID()}.jpg`;
  await uploadImage('profile-avatars', formerProfile);
  await uploadImage('pet-avatars', transferredPetAvatar);
  result = await formerOwner.client
    .from('profiles')
    .update({ avatar_url: formerProfile })
    .eq('id', formerOwner.id);
  if (result.error) throw result.error;
  result = await formerOwner.client
    .from('pets')
    .update({ avatar_path: transferredPetAvatar })
    .eq('id', transferredFamily.petId);
  if (result.error) throw result.error;
  const transferredPhoto = await createPhotoPost(
    formerOwner,
    transferredFamily.petId,
    'Transferred owner retained photo',
  );
  const transferredVideo = await createVideoPost(
    formerOwner,
    transferredFamily.petId,
    'Transferred owner retained video',
  );
  const transfer = await formerOwner.client.rpc('transfer_family_ownership', {
    new_owner_user_id: successor.id,
    target_family_id: transferredFamily.familyId,
  });
  if (transfer.error || transfer.data !== 'transferred') throw transfer.error;
  const deleteFormerOwner = await admin.auth.admin.deleteUser(formerOwner.id);
  if (deleteFormerOwner.error) throw deleteFormerOwner.error;
  deletedUsers.add(formerOwner.id);
  expectSql(
    'Deleting a transferred former Owner queues only the profile avatar and preserves Family/Pet/Post media.',
    `
      select
        exists (
          select 1 from public.family_members
          where family_id='${transferredFamily.familyId}'::uuid
            and user_id='${successor.id}'::uuid
            and role='owner'
        )
        and exists (
          select 1 from public.pets
          where id='${transferredFamily.petId}'::uuid
            and avatar_path='${transferredPetAvatar}'
        )
        and exists (
          select 1 from public.post_media
          where post_id='${transferredPhoto.postId}'::uuid
            and storage_path='${transferredPhoto.storagePath}'
        )
        and exists (
          select 1 from public.post_videos
          where post_id='${transferredVideo.postId}'::uuid
            and storage_path='${transferredVideo.storagePath}'
            and thumbnail_path='${transferredVideo.thumbnailPath}'
        )
        and exists (
          select 1 from public.media_cleanup_jobs
          where bucket_id='profile-avatars'
            and storage_path='${formerProfile}'
            and completed_at is null
        )
        and not exists (
          select 1 from public.media_cleanup_jobs
          where completed_at is null
            and (bucket_id, storage_path) in (
              ('pet-avatars', '${transferredPetAvatar}'),
              ('post-media', '${transferredPhoto.storagePath}'),
              ('post-videos', '${transferredVideo.storagePath}'),
              ('post-video-thumbnails', '${transferredVideo.thumbnailPath}')
            )
        );
    `,
  );
  runWorker();
  expect(
    !objectExists('profile-avatars', formerProfile) &&
      objectExists('pet-avatars', transferredPetAvatar) &&
      objectExists('post-media', transferredPhoto.storagePath) &&
      objectExists('post-videos', transferredVideo.storagePath) &&
      objectExists('post-video-thumbnails', transferredVideo.thumbnailPath),
    'Former Owner deletion removed transferred shared media.',
  );
  console.log(
    'PASS: Transferred former Owner deletion preserves shared media.',
  );

  const invalidJobId = sql(`
    insert into public.media_cleanup_jobs (
      bucket_id, storage_path, reason
    ) values (
      'profile-avatars', 'invalid-path.jpg', 'worker_validation_probe'
    ) returning id;
  `);
  const failedWorker = spawnSync(
    process.execPath,
    ['scripts/process-journal-video-cleanup.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_LOCAL_SERVICE_ROLE_KEY: serviceKey,
        SUPABASE_LOCAL_URL: url,
      },
    },
  );
  expect(
    failedWorker.status === 1 &&
      count(`
        select count(*) from public.media_cleanup_jobs
        where id=${invalidJobId}::bigint
          and completed_at is null
          and attempt_count = 1
          and last_error like 'Rejected invalid cleanup%';
      `) === 1,
    'Worker did not retain and mark an invalid target for retry/inspection.',
  );
  sql(
    `delete from public.media_cleanup_jobs where id=${invalidJobId}::bigint;`,
  );
  console.log(
    'PASS: Worker validates targets and retains failed jobs with retry state.',
  );

  expectSql(
    'No active cleanup job points at a currently referenced object.',
    `
      select not exists (
        select 1
        from public.media_cleanup_jobs as job
        where job.completed_at is null
          and (
            (job.bucket_id = 'profile-avatars' and exists (
              select 1 from public.profiles where avatar_url = job.storage_path
            ))
            or (job.bucket_id = 'pet-avatars' and exists (
              select 1 from public.pets where avatar_path = job.storage_path
            ))
            or (job.bucket_id = 'post-media' and exists (
              select 1 from public.post_media where storage_path = job.storage_path
            ))
            or (job.bucket_id = 'post-videos' and exists (
              select 1 from public.post_videos where storage_path = job.storage_path
            ))
            or (job.bucket_id = 'post-video-thumbnails' and exists (
              select 1 from public.post_videos where thumbnail_path = job.storage_path
            ))
          )
      );
    `,
  );
  console.log(
    'PASS: Phase C4E durable ownership cleanup, failure ordering, retry state, and security invariants hold.',
  );
} finally {
  await cleanup();
}

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
  throw new Error('SAFETY STOP: Journal video verification is local only.');
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const deletedUsers = new Set();
const petIds = new Set();
const familyIds = new Set();
const petFamilyIds = new Map();
const fakeStorageRows = [];
const storagePaths = new Map([
  ['post-media', new Set()],
  ['post-videos', new Set()],
  ['post-video-thumbnails', new Set()],
]);
const today = new Date().toISOString().slice(0, 10);
const videoBytes = new Uint8Array([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
  111, 109, 105, 115, 111, 50,
]);
const jpegBytes = new Uint8Array([255, 216, 255, 217]);

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
  const email = `video-${label.toLowerCase()}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `${label} Video Fixture`, locale: 'en' },
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
    pet_breed: 'Local video fixture',
    pet_description: 'Journal Video V1A local-only verification',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('Pet creation failed.');
  }
  petIds.add(created.data.id);
  familyIds.add(created.data.family_id);
  petFamilyIds.set(created.data.id, created.data.family_id);
  return created.data.id;
}

function addMember(petId, userId) {
  sql(
    `with membership as (
       insert into public.pet_members (pet_id, user_id, role)
       values ('${petId}'::uuid, '${userId}'::uuid, 'member')
       returning user_id, role, created_at
     )
     insert into public.family_members (family_id, user_id, role, created_at)
     select pet.family_id, membership.user_id, membership.role,
       membership.created_at
     from membership
     join public.pets as pet on pet.id = '${petId}'::uuid;`,
  );
}

function removeMember(petId, userId) {
  sql(
    `begin;
     delete from public.pet_members
     where pet_id = '${petId}'::uuid and user_id = '${userId}'::uuid;
     delete from public.family_members as membership
     using public.pets as pet
     where pet.id = '${petId}'::uuid
       and membership.family_id = pet.family_id
       and membership.user_id = '${userId}'::uuid;
     commit;`,
  );
}

async function upload(bucket, path, bytes, contentType, client) {
  const result = await client.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (!result.error) storagePaths.get(bucket)?.add(path);
  return result;
}

function videoPaths(authorId, petId, postId, videoId) {
  const stem = `${authorId}/${petId}/${postId}/${videoId}`;
  return { storagePath: `${stem}.mp4`, thumbnailPath: `${stem}.jpg` };
}

function videoInput(videoId, paths, overrides = {}) {
  return {
    duration_ms: 14_500,
    height: 1280,
    id: videoId,
    mime_type: 'video/mp4',
    storage_path: paths.storagePath,
    thumbnail_path: paths.thumbnailPath,
    width: 720,
    ...overrides,
  };
}

function photoInput(photoId, path, position = 0) {
  return {
    height: 32,
    id: photoId,
    mime_type: 'image/jpeg',
    position,
    storage_path: path,
    width: 32,
  };
}

async function uploadVideoPair(actor, petId, postId, videoId) {
  const paths = videoPaths(actor.id, petId, postId, videoId);
  const video = await upload(
    'post-videos',
    paths.storagePath,
    videoBytes,
    'video/mp4',
    actor.client,
  );
  const thumbnail = await upload(
    'post-video-thumbnails',
    paths.thumbnailPath,
    jpegBytes,
    'image/jpeg',
    actor.client,
  );
  if (video.error || thumbnail.error) {
    throw video.error ?? thumbnail.error;
  }
  return { ...paths, videoId };
}

async function uploadPhoto(actor, petId, postId, photoId) {
  const path = `${actor.id}/${petId}/${postId}/${photoId}.jpg`;
  const uploaded = await upload(
    'post-media',
    path,
    jpegBytes,
    'image/jpeg',
    actor.client,
  );
  if (uploaded.error) throw uploaded.error;
  return { path, photoId };
}

function createInput(
  petId,
  postId,
  content,
  mediaItems = [],
  videoItem = null,
) {
  return {
    media_items: mediaItems,
    post_content: content,
    post_event_date: today,
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
    video_item: videoItem,
  };
}

function updateInput(postId, content, mediaItems = [], videoItem = null) {
  return {
    media_items: mediaItems,
    post_content: content,
    post_event_date: today,
    post_location_name: null,
    post_tag: 'other',
    target_post_id: postId,
    video_item: videoItem,
  };
}

async function expectRpcFailure(client, name, input, label) {
  const result = await client.rpc(name, input);
  expect(result.error, `${label} unexpectedly succeeded.`);
  return result.error;
}

function insertFakeStorageObject(bucket, path, ownerId, size, mimetype) {
  const rowId = randomUUID();
  const metadata = JSON.stringify({ mimetype, size }).replaceAll("'", "''");
  sql(`
    insert into storage.objects (id,bucket_id,name,owner,owner_id,metadata)
    values ('${rowId}'::uuid,'${bucket}','${path}','${ownerId}'::uuid,'${ownerId}','${metadata}'::jsonb);
  `);
  fakeStorageRows.push({ bucket, path });
}

async function invoke(functionName, actor, body) {
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${actor.token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  return { payload: await response.json(), status: response.status };
}

function runCleanupWorker() {
  return execFileSync(
    process.execPath,
    ['scripts/process-journal-video-cleanup.mjs'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_LOCAL_SERVICE_ROLE_KEY: serviceKey,
        SUPABASE_LOCAL_URL: url,
      },
    },
  ).trim();
}

async function verifyStoragePolicies(context) {
  const { memberA, memberB, owner, petId, removed, stranger, strangerPetId } =
    context;
  const allowedPostId = randomUUID();
  const allowedVideoId = randomUUID();
  const allowed = await uploadVideoPair(
    memberB,
    petId,
    allowedPostId,
    allowedVideoId,
  );

  const duplicate = await memberB.client.storage
    .from('post-videos')
    .upload(allowed.storagePath, videoBytes, {
      contentType: 'video/mp4',
      upsert: false,
    });
  expect(duplicate.error, 'Duplicate video path upload overwrote an object.');

  for (const [label, actor, path] of [
    [
      'stranger upload',
      stranger,
      videoPaths(stranger.id, petId, randomUUID(), randomUUID()).storagePath,
    ],
    [
      'removed-member upload',
      removed,
      videoPaths(removed.id, petId, randomUUID(), randomUUID()).storagePath,
    ],
    [
      'author spoof',
      memberA,
      videoPaths(owner.id, petId, randomUUID(), randomUUID()).storagePath,
    ],
    [
      'pet spoof',
      memberA,
      videoPaths(memberA.id, strangerPetId, randomUUID(), randomUUID())
        .storagePath,
    ],
  ]) {
    const denied = await actor.client.storage
      .from('post-videos')
      .upload(path, videoBytes, { contentType: 'video/mp4', upsert: false });
    expect(denied.error, `${label} unexpectedly succeeded.`);
  }

  const wrongMimePath = videoPaths(
    memberA.id,
    petId,
    randomUUID(),
    randomUUID(),
  ).storagePath;
  const wrongMime = await memberA.client.storage
    .from('post-videos')
    .upload(wrongMimePath, videoBytes, {
      contentType: 'video/quicktime',
      upsert: false,
    });
  expect(wrongMime.error, 'Storage accepted a non-MP4 video MIME type.');

  const oversizedPath = videoPaths(
    memberA.id,
    petId,
    randomUUID(),
    randomUUID(),
  ).storagePath;
  const oversized = await memberA.client.storage
    .from('post-videos')
    .upload(oversizedPath, new Uint8Array(26_214_401), {
      contentType: 'video/mp4',
      upsert: false,
    });
  expect(oversized.error, 'Storage accepted a video above 25 MiB.');

  console.log(
    'PASS: member upload works; stranger, removed member, author spoof, pet spoof, duplicate path, wrong MIME, and oversize uploads are denied.',
  );
}

async function verifyCreateReadAndSecurity(context) {
  const { memberA, memberB, owner, petId, removed, stranger } = context;

  const textPostId = randomUUID();
  const textPost = await memberA.client.rpc(
    'create_post_v2',
    createInput(petId, textPostId, 'Text-only video v1 post'),
  );
  expect(!textPost.error, `Text-only create failed (${textPost.error?.code}).`);

  const photoPostId = randomUUID();
  const photo = await uploadPhoto(memberA, petId, photoPostId, randomUUID());
  const photoPost = await memberA.client.rpc(
    'create_post_v2',
    createInput(petId, photoPostId, null, [
      photoInput(photo.photoId, photo.path),
    ]),
  );
  expect(
    !photoPost.error,
    `Photo-only create failed (${photoPost.error?.code}).`,
  );

  const videoPostId = randomUUID();
  const video = await uploadVideoPair(
    memberA,
    petId,
    videoPostId,
    randomUUID(),
  );
  const videoPost = await memberA.client.rpc(
    'create_post_v2',
    createInput(petId, videoPostId, null, [], videoInput(video.videoId, video)),
  );
  expect(
    !videoPost.error,
    `Video-only create failed (${JSON.stringify(videoPost.error)}).`,
  );

  const storedVideo = await admin
    .from('post_videos')
    .select('*')
    .eq('post_id', videoPostId)
    .single();
  expect(
    !storedVideo.error,
    `Canonical video row was not created (${JSON.stringify(storedVideo.error)}).`,
  );
  expect(
    storedVideo.data.file_size_bytes === videoBytes.byteLength,
    'Video size was not copied from Storage metadata.',
  );

  const textVideoPostId = randomUUID();
  const textVideo = await uploadVideoPair(
    memberA,
    petId,
    textVideoPostId,
    randomUUID(),
  );
  const textVideoPost = await memberA.client.rpc(
    'create_post_v2',
    createInput(
      petId,
      textVideoPostId,
      'Text and video post',
      [],
      videoInput(textVideo.videoId, textVideo),
    ),
  );
  expect(!textVideoPost.error, 'Text plus video create failed.');

  await expectRpcFailure(
    memberA.client,
    'create_post_v2',
    createInput(petId, randomUUID(), null),
    'Empty post',
  );

  const mixedPostId = randomUUID();
  const mixedPhoto = await uploadPhoto(
    memberA,
    petId,
    mixedPostId,
    randomUUID(),
  );
  const mixedVideo = await uploadVideoPair(
    memberA,
    petId,
    mixedPostId,
    randomUUID(),
  );
  await expectRpcFailure(
    memberA.client,
    'create_post_v2',
    createInput(
      petId,
      mixedPostId,
      'Invalid mixed media',
      [photoInput(mixedPhoto.photoId, mixedPhoto.path)],
      videoInput(mixedVideo.videoId, mixedVideo),
    ),
    'Photos plus video',
  );

  const readableClients = [owner.client, memberA.client, memberB.client];
  for (const client of readableClients) {
    const read = await client
      .from('post_videos')
      .select('id')
      .eq('post_id', videoPostId);
    expect(
      !read.error && read.data.length === 1,
      'Current member read failed.',
    );
    const downloaded = await client.storage
      .from('post-videos')
      .download(video.storagePath);
    expect(!downloaded.error, 'Current member video download failed.');
  }

  for (const actor of [stranger, removed]) {
    const read = await actor.client
      .from('post_videos')
      .select('id')
      .eq('post_id', videoPostId);
    expect(
      !read.error && read.data.length === 0,
      'Unauthorized row read leaked.',
    );
    const downloaded = await actor.client.storage
      .from('post-videos')
      .download(video.storagePath);
    expect(downloaded.error, 'Unauthorized video download succeeded.');
    const signed = await actor.client.storage
      .from('post-videos')
      .createSignedUrl(video.storagePath, 60);
    expect(signed.error, 'Unauthorized signed URL creation succeeded.');
    const removedObject = await actor.client.storage
      .from('post-videos')
      .remove([video.storagePath]);
    expect(
      removedObject.error || removedObject.data.length === 0,
      'Unauthorized Storage delete reported a deleted object.',
    );
    const afterUnauthorizedDelete = await owner.client.storage
      .from('post-videos')
      .download(video.storagePath);
    expect(
      !afterUnauthorizedDelete.error,
      'Unauthorized Storage delete removed the object.',
    );
  }

  const directInsert = await memberA.client.from('post_videos').insert({
    duration_ms: 1000,
    file_size_bytes: 10,
    height: 10,
    id: randomUUID(),
    mime_type: 'video/mp4',
    post_id: textPostId,
    storage_path: `${randomUUID()}.mp4`,
    thumbnail_path: `${randomUUID()}.jpg`,
    width: 10,
  });
  expect(
    directInsert.error,
    'Authenticated direct post_videos insert succeeded.',
  );

  await expectRpcFailure(
    stranger.client,
    'create_post_v2',
    createInput(petId, randomUUID(), 'Stranger create'),
    'Stranger create',
  );
  await expectRpcFailure(
    removed.client,
    'create_post_v2',
    createInput(petId, randomUUID(), 'Removed member create'),
    'Removed member create',
  );
  await expectRpcFailure(
    memberB.client,
    'update_post_v2',
    updateInput(videoPostId, 'Editing another author'),
    'Member editing another author post',
  );

  const hiddenJobs = await memberA.client
    .from('media_cleanup_jobs')
    .select('id');
  expect(hiddenJobs.error, 'Authenticated user could read cleanup outbox.');

  console.log(
    'PASS: text/photo/video/text+video creates work; empty and mixed media fail.',
  );
  console.log(
    'PASS: Owner, Member A, and Member B can read; Stranger and Removed Member have zero row, object, signed-URL, delete, and mutation access.',
  );

  return { videoPostId };
}

async function verifyInvalidStorageMetadata(context) {
  const { memberA, petId } = context;

  const fakePathPostId = randomUUID();
  const fakePathVideoId = randomUUID();
  const validFakePath = videoPaths(
    memberA.id,
    petId,
    fakePathPostId,
    fakePathVideoId,
  );
  const fakePathThumbnail = await upload(
    'post-video-thumbnails',
    validFakePath.thumbnailPath,
    jpegBytes,
    'image/jpeg',
    memberA.client,
  );
  if (fakePathThumbnail.error) throw fakePathThumbnail.error;
  await expectRpcFailure(
    memberA.client,
    'create_post_v2',
    createInput(
      petId,
      fakePathPostId,
      null,
      [],
      videoInput(fakePathVideoId, {
        ...validFakePath,
        storagePath: `${validFakePath.storagePath}.spoof`,
      }),
    ),
    'Fake Storage path',
  );

  await expectRpcFailure(
    memberA.client,
    'create_post_v2',
    createInput(
      petId,
      fakePathPostId,
      null,
      [],
      videoInput(fakePathVideoId, validFakePath),
    ),
    'Missing video object',
  );

  for (const test of [
    {
      label: 'Oversize Storage metadata',
      mimetype: 'video/mp4',
      size: 26_214_401,
    },
    { label: 'Wrong Storage MIME', mimetype: 'video/quicktime', size: 1024 },
  ]) {
    const postId = randomUUID();
    const videoId = randomUUID();
    const paths = videoPaths(memberA.id, petId, postId, videoId);
    insertFakeStorageObject(
      'post-videos',
      paths.storagePath,
      memberA.id,
      test.size,
      test.mimetype,
    );
    const thumbnail = await upload(
      'post-video-thumbnails',
      paths.thumbnailPath,
      jpegBytes,
      'image/jpeg',
      memberA.client,
    );
    if (thumbnail.error) throw thumbnail.error;
    await expectRpcFailure(
      memberA.client,
      'create_post_v2',
      createInput(petId, postId, null, [], videoInput(videoId, paths)),
      test.label,
    );
  }

  const wrongBucketPostId = randomUUID();
  const wrongBucketVideoId = randomUUID();
  const wrongBucketPaths = videoPaths(
    memberA.id,
    petId,
    wrongBucketPostId,
    wrongBucketVideoId,
  );
  insertFakeStorageObject(
    'post-video-thumbnails',
    wrongBucketPaths.storagePath,
    memberA.id,
    1024,
    'video/mp4',
  );
  const wrongBucketThumbnail = await upload(
    'post-video-thumbnails',
    wrongBucketPaths.thumbnailPath,
    jpegBytes,
    'image/jpeg',
    memberA.client,
  );
  if (wrongBucketThumbnail.error) throw wrongBucketThumbnail.error;
  await expectRpcFailure(
    memberA.client,
    'create_post_v2',
    createInput(
      petId,
      wrongBucketPostId,
      null,
      [],
      videoInput(wrongBucketVideoId, wrongBucketPaths),
    ),
    'Wrong video bucket',
  );

  console.log(
    'PASS: fake path, missing object, wrong bucket, oversize metadata, and wrong Storage MIME are rejected.',
  );
}

async function verifyUpdateMatrixAndConcurrency(context) {
  const { memberA, petId } = context;
  const postId = randomUUID();
  const firstPhoto = await uploadPhoto(memberA, petId, postId, randomUUID());
  const created = await memberA.client.rpc(
    'create_post_v2',
    createInput(petId, postId, null, [
      photoInput(firstPhoto.photoId, firstPhoto.path),
    ]),
  );
  expect(!created.error, 'Update fixture photo create failed.');

  const firstVideo = await uploadVideoPair(
    memberA,
    petId,
    postId,
    randomUUID(),
  );
  const photoToVideo = await memberA.client.rpc(
    'update_post_v2',
    updateInput(postId, null, [], videoInput(firstVideo.videoId, firstVideo)),
  );
  expect(!photoToVideo.error, 'Photo to video update failed.');

  const secondPhoto = await uploadPhoto(memberA, petId, postId, randomUUID());
  const videoToPhoto = await memberA.client.rpc(
    'update_post_v2',
    updateInput(postId, null, [
      photoInput(secondPhoto.photoId, secondPhoto.path),
    ]),
  );
  expect(!videoToPhoto.error, 'Video to photo update failed.');

  const secondVideo = await uploadVideoPair(
    memberA,
    petId,
    postId,
    randomUUID(),
  );
  const photoToSecondVideo = await memberA.client.rpc(
    'update_post_v2',
    updateInput(postId, null, [], videoInput(secondVideo.videoId, secondVideo)),
  );
  expect(!photoToSecondVideo.error, 'Second photo to video update failed.');

  const thirdVideo = await uploadVideoPair(
    memberA,
    petId,
    postId,
    randomUUID(),
  );
  const replaceVideo = await memberA.client.rpc(
    'update_post_v2',
    updateInput(postId, null, [], videoInput(thirdVideo.videoId, thirdVideo)),
  );
  expect(!replaceVideo.error, 'Video replacement failed.');

  const retryVideo = await memberA.client.rpc(
    'update_post_v2',
    updateInput(postId, null, [], videoInput(thirdVideo.videoId, thirdVideo)),
  );
  expect(!retryVideo.error, 'Identical video retry was not idempotent.');
  expect(
    count(
      `select count(*) from public.media_cleanup_jobs where completed_at is null and storage_path in ('${thirdVideo.storagePath}','${thirdVideo.thumbnailPath}');`,
    ) === 0,
    'Identical retry queued the active video for deletion.',
  );

  const removeWithText = await memberA.client.rpc(
    'update_post_v2',
    updateInput(postId, 'Video removed, text remains'),
  );
  expect(!removeWithText.error, 'Remove video with text failed.');

  const emptyGuardPostId = randomUUID();
  const emptyGuardVideo = await uploadVideoPair(
    memberA,
    petId,
    emptyGuardPostId,
    randomUUID(),
  );
  const emptyGuardCreate = await memberA.client.rpc(
    'create_post_v2',
    createInput(
      petId,
      emptyGuardPostId,
      null,
      [],
      videoInput(emptyGuardVideo.videoId, emptyGuardVideo),
    ),
  );
  expect(!emptyGuardCreate.error, 'Empty guard fixture create failed.');
  await expectRpcFailure(
    memberA.client,
    'update_post_v2',
    updateInput(emptyGuardPostId, null),
    'Remove video leaving empty post',
  );
  expect(
    count(
      `select count(*) from public.post_videos where post_id='${emptyGuardPostId}'::uuid;`,
    ) === 1,
    'Failed empty update removed the existing video.',
  );

  const duplicatePostId = randomUUID();
  const duplicateCreate = await memberA.client.rpc(
    'create_post_v2',
    createInput(petId, duplicatePostId, 'Duplicate post fixture'),
  );
  expect(!duplicateCreate.error, 'Duplicate post fixture create failed.');
  await expectRpcFailure(
    memberA.client,
    'create_post_v2',
    createInput(petId, duplicatePostId, 'Duplicate post fixture'),
    'Repeated create post_id',
  );
  expect(
    count(
      `select count(*) from public.posts where id='${duplicatePostId}'::uuid;`,
    ) === 1,
    'Repeated create produced duplicate posts.',
  );

  const concurrentPostId = randomUUID();
  const concurrentInitial = await uploadVideoPair(
    memberA,
    petId,
    concurrentPostId,
    randomUUID(),
  );
  const concurrentCreate = await memberA.client.rpc(
    'create_post_v2',
    createInput(
      petId,
      concurrentPostId,
      null,
      [],
      videoInput(concurrentInitial.videoId, concurrentInitial),
    ),
  );
  expect(!concurrentCreate.error, 'Concurrent update fixture create failed.');
  const concurrentA = await uploadVideoPair(
    memberA,
    petId,
    concurrentPostId,
    randomUUID(),
  );
  const concurrentB = await uploadVideoPair(
    memberA,
    petId,
    concurrentPostId,
    randomUUID(),
  );
  const concurrentResults = await Promise.all([
    memberA.client.rpc(
      'update_post_v2',
      updateInput(
        concurrentPostId,
        null,
        [],
        videoInput(concurrentA.videoId, concurrentA),
      ),
    ),
    memberA.client.rpc(
      'update_post_v2',
      updateInput(
        concurrentPostId,
        null,
        [],
        videoInput(concurrentB.videoId, concurrentB),
      ),
    ),
  ]);
  expect(
    concurrentResults.every((result) => !result.error),
    'Concurrent video replacement returned an unexpected error.',
  );
  const finalVideo = await admin
    .from('post_videos')
    .select('id')
    .eq('post_id', concurrentPostId)
    .single();
  expect(
    !finalVideo.error &&
      [concurrentA.videoId, concurrentB.videoId].includes(finalVideo.data.id),
    'Concurrent replacement left stale or duplicate final data.',
  );
  const nonFinal =
    finalVideo.data.id === concurrentA.videoId ? concurrentB : concurrentA;
  expect(
    count(
      `select count(*) from public.media_cleanup_jobs where completed_at is null and storage_path in ('${nonFinal.storagePath}','${nonFinal.thumbnailPath}');`,
    ) === 2,
    'Concurrent replacement did not queue the superseded video pair.',
  );

  console.log(
    'PASS: photo/video conversion matrix, video retry, empty guard, duplicate create, and serialized concurrent replacement behave safely.',
  );
}

async function verifyLegacyJournal(context) {
  const { memberA, memberB, owner, petId, removed, stranger } = context;
  const textPostId = randomUUID();
  const textPost = await memberA.client.rpc('create_post', {
    media_items: [],
    post_content: 'Legacy text-only post',
    post_event_date: today,
    post_id: textPostId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  expect(!textPost.error, 'Legacy text-only create regressed.');

  const photoPostId = randomUUID();
  const photo = await uploadPhoto(memberA, petId, photoPostId, randomUUID());
  const photoPost = await memberA.client.rpc('create_post', {
    media_items: [photoInput(photo.photoId, photo.path)],
    post_content: null,
    post_event_date: today,
    post_id: photoPostId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  expect(!photoPost.error, 'Legacy photo create regressed.');
  const photoUpdate = await memberA.client.rpc('update_post', {
    media_items: [photoInput(photo.photoId, photo.path)],
    post_content: 'Legacy photo update',
    post_event_date: today,
    post_location_name: null,
    post_tag: 'walk',
    target_post_id: photoPostId,
  });
  expect(!photoUpdate.error, 'Legacy photo update regressed.');

  for (const actor of [owner, memberA, memberB]) {
    const readableMedia = await actor.client
      .from('post_media')
      .select('id')
      .eq('post_id', photoPostId);
    expect(
      !readableMedia.error && readableMedia.data.length === 1,
      'Legacy photo RLS denied a current member.',
    );
    const readableObject = await actor.client.storage
      .from('post-media')
      .download(photo.path);
    expect(!readableObject.error, 'Legacy photo Storage read regressed.');
  }

  for (const actor of [stranger, removed]) {
    const hiddenMedia = await actor.client
      .from('post_media')
      .select('id')
      .eq('post_id', photoPostId);
    expect(
      !hiddenMedia.error && hiddenMedia.data.length === 0,
      'Legacy photo RLS leaked to an unauthorized user.',
    );
    const hiddenObject = await actor.client.storage
      .from('post-media')
      .download(photo.path);
    expect(
      hiddenObject.error,
      'Legacy photo Storage leaked to an unauthorized user.',
    );
  }

  const tooMany = Array.from({ length: 10 }, (_, position) =>
    photoInput(
      randomUUID(),
      `${memberA.id}/${petId}/${randomUUID()}/${randomUUID()}.jpg`,
      position,
    ),
  );
  await expectRpcFailure(
    memberA.client,
    'create_post',
    {
      media_items: tooMany,
      post_content: 'Ten photos',
      post_event_date: today,
      post_id: randomUUID(),
      post_location_name: null,
      post_pet_id: petId,
      post_tag: 'other',
    },
    'Legacy ten-photo create',
  );

  console.log(
    'PASS: legacy create_post/update_post, text-only, photo, 1–9 photo limit, row RLS, and Storage RLS remain intact.',
  );
}

async function verifyOrphanBoundary(context) {
  const { memberA, petId } = context;
  const orphan = await uploadVideoPair(
    memberA,
    petId,
    randomUUID(),
    randomUUID(),
  );
  expect(
    count(
      `select count(*) from public.media_cleanup_jobs where storage_path in ('${orphan.storagePath}','${orphan.thumbnailPath}');`,
    ) === 0,
    'DB outbox incorrectly claimed an upload that never reached an RPC commit.',
  );
  const videoRemoved = await memberA.client.storage
    .from('post-videos')
    .remove([orphan.storagePath]);
  const thumbnailRemoved = await memberA.client.storage
    .from('post-video-thumbnails')
    .remove([orphan.thumbnailPath]);
  expect(
    !videoRemoved.error && !thumbnailRemoved.error,
    'Immediate client orphan cleanup path failed.',
  );
  console.log(
    'PASS: never-committed upload is outside the DB outbox and remains an explicit immediate-client/sweeper responsibility.',
  );
}

async function verifyDeleteLifecycles(context) {
  const { memberA, owner, petId } = context;
  const deletePostId = randomUUID();
  const deletePostVideo = await uploadVideoPair(
    memberA,
    petId,
    deletePostId,
    randomUUID(),
  );
  const postCreated = await memberA.client.rpc(
    'create_post_v2',
    createInput(
      petId,
      deletePostId,
      null,
      [],
      videoInput(deletePostVideo.videoId, deletePostVideo),
    ),
  );
  expect(!postCreated.error, 'Delete-post video fixture failed.');
  const deletedPost = await invoke('delete-post', memberA, {
    postId: deletePostId,
  });
  expect(
    deletedPost.status === 200 && deletedPost.payload.deleted === true,
    `Video delete-post failed (${deletedPost.status}).`,
  );
  runCleanupWorker();
  expect(
    count(
      `select count(*) from storage.objects where name in ('${deletePostVideo.storagePath}','${deletePostVideo.thumbnailPath}');`,
    ) === 0,
    'delete-post left video Storage objects.',
  );

  const deletePetId = await createPet(owner, 'Video delete-pet');
  addMember(deletePetId, memberA.id);
  const deletePetPostId = randomUUID();
  const deletePetVideo = await uploadVideoPair(
    memberA,
    deletePetId,
    deletePetPostId,
    randomUUID(),
  );
  const deletePetPost = await memberA.client.rpc(
    'create_post_v2',
    createInput(
      deletePetId,
      deletePetPostId,
      null,
      [],
      videoInput(deletePetVideo.videoId, deletePetVideo),
    ),
  );
  expect(!deletePetPost.error, 'Delete-pet video fixture failed.');
  const deletedPet = await invoke('delete-pet', owner, { petId: deletePetId });
  expect(
    deletedPet.status === 200 && deletedPet.payload.deleted === true,
    `Video delete-pet failed (${deletedPet.status}).`,
  );
  petIds.delete(deletePetId);
  runCleanupWorker();
  expect(
    count(
      `select count(*) from storage.objects where name in ('${deletePetVideo.storagePath}','${deletePetVideo.thumbnailPath}');`,
    ) === 0,
    'delete-pet left video Storage objects.',
  );

  const accountUser = await createUser('AccountDelete');
  const accountPetId = await createPet(accountUser, 'Video delete-account');
  const accountPostId = randomUUID();
  const accountVideo = await uploadVideoPair(
    accountUser,
    accountPetId,
    accountPostId,
    randomUUID(),
  );
  const accountPost = await accountUser.client.rpc(
    'create_post_v2',
    createInput(
      accountPetId,
      accountPostId,
      null,
      [],
      videoInput(accountVideo.videoId, accountVideo),
    ),
  );
  expect(!accountPost.error, 'Delete-account video fixture failed.');
  const deletedAccount = await invoke('delete-account', accountUser, {
    confirmation: 'DELETE_MY_ACCOUNT',
  });
  expect(
    deletedAccount.status === 409 &&
      deletedAccount.payload.error === 'ACCOUNT_OWNS_FAMILY',
    `Owner delete-account did not preserve its Family (${deletedAccount.status}).`,
  );
  expect(
    count(
      `select count(*) from public.pets where id='${accountPetId}'::uuid;`,
    ) === 1 &&
      count(
        `select count(*) from public.posts where id='${accountPostId}'::uuid;`,
      ) === 1 &&
      count(
        `select count(*) from storage.objects where name in ('${accountVideo.storagePath}','${accountVideo.thumbnailPath}');`,
      ) === 2,
    'Owner denial changed shared Pet, Post, or Storage data.',
  );
  const explicitFamilyDelete = await accountUser.client.rpc('delete_family', {
    target_family_id: petFamilyIds.get(accountPetId),
  });
  expect(!explicitFamilyDelete.error, 'Explicit Family deletion failed.');
  familyIds.delete(petFamilyIds.get(accountPetId));
  const accountDeletedAfterFamily = await invoke(
    'delete-account',
    accountUser,
    {
      confirmation: 'DELETE_MY_ACCOUNT',
    },
  );
  expect(
    accountDeletedAfterFamily.status === 200,
    'Account deletion after explicit Family deletion failed.',
  );
  deletedUsers.add(accountUser.id);
  petIds.delete(accountPetId);
  runCleanupWorker();
  expect(
    count(
      `select count(*) from storage.objects where name in ('${accountVideo.storagePath}','${accountVideo.thumbnailPath}');`,
    ) === 0,
    'Explicit Family deletion cleanup left video Storage objects.',
  );

  console.log(
    'PASS: delete-post/delete-pet remove video data; Owner account deletion preserves shared media until explicit Family deletion.',
  );
}

async function cleanup() {
  for (const petId of petIds) {
    await admin.from('pets').delete().eq('id', petId);
  }
  for (const familyId of familyIds) {
    sql(`delete from public.families where id = '${familyId}'::uuid;`);
  }

  try {
    runCleanupWorker();
  } catch {
    // Best-effort fixture cleanup continues below.
  }

  for (const [bucket, paths] of storagePaths) {
    if (paths.size > 0) {
      await admin.storage.from(bucket).remove([...paths]);
    }
  }

  for (const row of fakeStorageRows) {
    await admin.storage.from(row.bucket).remove([row.path]);
  }

  sql('delete from public.media_cleanup_jobs;');

  for (const user of users) {
    await user.client.auth.signOut();
    if (!deletedUsers.has(user.id)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
}

try {
  const owner = await createUser('Owner');
  const memberA = await createUser('MemberA');
  const memberB = await createUser('MemberB');
  const stranger = await createUser('Stranger');
  const removed = await createUser('Removed');
  const petId = await createPet(owner, 'Video family');
  const strangerPetId = await createPet(stranger, 'Unrelated pet');
  addMember(petId, memberA.id);
  addMember(petId, memberB.id);
  addMember(petId, removed.id);
  removeMember(petId, removed.id);

  const context = {
    memberA,
    memberB,
    owner,
    petId,
    removed,
    stranger,
    strangerPetId,
  };

  await verifyStoragePolicies(context);
  await verifyCreateReadAndSecurity(context);
  await verifyInvalidStorageMetadata(context);
  await verifyUpdateMatrixAndConcurrency(context);
  await verifyLegacyJournal(context);
  await verifyOrphanBoundary(context);

  const workerOutput = runCleanupWorker();
  expect(
    count(
      'select count(*) from public.media_cleanup_jobs where completed_at is null;',
    ) === 0,
    'Cleanup worker left due video jobs active.',
  );
  console.log(
    `PASS: durable cleanup worker completed queued objects. ${workerOutput}`,
  );

  await verifyDeleteLifecycles(context);
  console.log('PASS: Journal Video V1A local backend verification complete.');
} finally {
  await cleanup();
}

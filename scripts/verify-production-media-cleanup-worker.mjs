import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import {
  isValidCleanupTarget,
  processCleanupBatch,
  readWorkerConfig,
} from '../supabase/functions/_shared/media-cleanup.mjs';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
const secretFile = process.env.MEDIA_CLEANUP_TEST_SECRET_FILE;
if (!url || !anonKey || !serviceKey || !secretFile) {
  throw new Error(
    'Local Supabase keys and local Edge test secret file required.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: R2 verifier is local only.');
}
const invokeSecret = readFileSync(secretFile, 'utf8').trim().split('=')[1];
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const jobIds = new Set();
const uploaded = [];
let createdUserId = null;
function expect(value, message) {
  if (!value) throw new Error(message);
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
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}
async function enqueue(bucket, path) {
  const id = Number(
    sql(
      `select private.enqueue_media_cleanup('${bucket}', '${path}', 'r2_verifier', null);`,
    ),
  );
  jobIds.add(id);
  return id;
}
async function invoke(headers = {}, body = {}) {
  return fetch(`${url}/functions/v1/process-media-cleanup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

try {
  const mockEnv = {
    MEDIA_CLEANUP_INVOKE_SECRET: invokeSecret,
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  };
  expect(
    readWorkerConfig((name) => mockEnv[name]),
    'Valid worker env rejected',
  );
  for (const missing of Object.keys(mockEnv)) {
    const incomplete = { ...mockEnv };
    delete incomplete[missing];
    expect(
      !readWorkerConfig((name) => incomplete[name]),
      `Missing ${missing} did not fail closed`,
    );
  }
  console.log('PASS: missing invoke secret, URL, or service key fails closed.');
  const uuid = randomUUID();
  const pet = randomUUID();
  const post = randomUUID();
  const targets = [
    ['profile-avatars', `${uuid}/${randomUUID()}.jpg`],
    ['pet-avatars', `${uuid}/${pet}/${randomUUID()}.png`],
    ['post-media', `${uuid}/${pet}/${post}/${randomUUID()}.webp`],
    ['post-videos', `${uuid}/${pet}/${post}/${randomUUID()}.mp4`],
    ['post-video-thumbnails', `${uuid}/${pet}/${post}/${randomUUID()}.jpg`],
  ];
  for (const [bucket, path] of targets) {
    expect(
      isValidCleanupTarget(bucket, path),
      `${bucket} canonical path rejected`,
    );
    const isVideo = bucket === 'post-videos';
    const bytes = isVideo
      ? new Uint8Array([
          0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105,
          115, 111, 109, 105, 115, 111, 50,
        ])
      : new Uint8Array([255, 216, 255, 217]);
    const uploadedObject = await admin.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: isVideo ? 'video/mp4' : 'image/jpeg',
        upsert: false,
      });
    if (uploadedObject.error) throw uploadedObject.error;
    uploaded.push([bucket, path]);
    await enqueue(bucket, path);
  }
  expect(
    !isValidCleanupTarget('evil', targets[0][1]),
    'Arbitrary bucket accepted',
  );
  expect(
    !isValidCleanupTarget('profile-avatars', `${uuid}/../outside.jpg`),
    'Path traversal accepted',
  );
  const forbidden = await anon.rpc('claim_media_cleanup_jobs', {
    job_limit: 1,
  });
  expect(forbidden.error, 'Anonymous RPC claim unexpectedly allowed');
  const before = Number(
    sql(
      `select count(*) from public.media_cleanup_jobs where id in (${[...jobIds].join(',')}) and completed_at is null;`,
    ),
  );
  expect(before === 5, 'Queue did not persist before worker invocation');
  const noAuth = await invoke();
  expect(
    noAuth.status === 401,
    `Unauthenticated Edge invocation: ${noAuth.status}`,
  );
  const email = `r2-cleanup-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error('Could not create local user');
  createdUserId = created.data.user.id;
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session)
    throw signed.error ?? new Error('Could not sign in local user');
  const clientAuth = await invoke({
    Authorization: `Bearer ${signed.data.session.access_token}`,
  });
  expect(clientAuth.status === 401, 'Authenticated client invoked worker');
  const forbiddenMemberClaim = await anon.rpc('claim_media_cleanup_jobs', {
    job_limit: 1,
  });
  expect(forbiddenMemberClaim.error, 'Authenticated user claimed cleanup jobs');
  const processed = await invoke(
    { Authorization: `Bearer ${invokeSecret}` },
    { bucket: 'evil', path: 'outside', job_limit: 1000 },
  );
  const batch = await processed.json();
  expect(
    processed.status === 200 && batch.completed === 5,
    `Edge batch failed: ${JSON.stringify(batch)}`,
  );
  const after = Number(
    sql(
      `select count(*) from public.media_cleanup_jobs where id in (${[...jobIds].join(',')}) and completed_at is not null;`,
    ),
  );
  expect(after === 5, 'Five-bucket cleanup did not settle');
  for (const [bucket, path] of targets) {
    expect(
      Number(
        sql(
          `select count(*) from storage.objects where bucket_id = '${bucket}' and name = '${path}';`,
        ),
      ) === 0,
      `${bucket} object remained after cleanup`,
    );
  }
  const missingPath = `${uuid}/${randomUUID()}.jpg`;
  const missingId = await enqueue('profile-avatars', missingPath);
  expect(
    (await enqueue('profile-avatars', missingPath)) === missingId,
    'Active dedup created a second job',
  );
  const missingResponse = await invoke({
    Authorization: `Bearer ${invokeSecret}`,
  });
  const missingBatch = await missingResponse.json();
  expect(
    missingResponse.status === 200 && missingBatch.completed === 1,
    'Missing object did not complete',
  );
  console.log(
    'PASS: Edge internal auth, arbitrary request ignored, queue backlog, all five buckets removed, missing object and active dedup.',
  );

  const rowA = await enqueue('profile-avatars', `${uuid}/${randomUUID()}.jpg`);
  const rowB = await enqueue('profile-avatars', `${uuid}/${randomUUID()}.jpg`);
  const [claimA, claimB] = await Promise.all([
    admin.rpc('claim_media_cleanup_jobs', { job_limit: 1 }),
    admin.rpc('claim_media_cleanup_jobs', { job_limit: 1 }),
  ]);
  if (claimA.error || claimB.error) throw claimA.error ?? claimB.error;
  const first = claimA.data?.[0];
  const second = claimB.data?.[0];
  expect(
    first && second && first.id !== second.id,
    'Concurrent claims took the same active job',
  );
  expect(
    [rowA, rowB].includes(first.id) && [rowA, rowB].includes(second.id),
    'Concurrent claims selected unexpected jobs',
  );
  const staleAttempt = first.attempt_count;
  sql(
    `update public.media_cleanup_jobs set next_attempt_at = now() where id = ${first.id};`,
  );
  const replay = await admin.rpc('claim_media_cleanup_jobs', { job_limit: 1 });
  if (replay.error) throw replay.error;
  expect(
    replay.data?.[0]?.id === first.id &&
      replay.data[0].attempt_count === staleAttempt + 1,
    'Lease replay did not increment generation',
  );
  const staleSettlement = await admin.rpc(
    'complete_media_cleanup_job_if_claimed',
    {
      target_job_id: first.id,
      claimed_attempt_count: staleAttempt,
    },
  );
  expect(
    !staleSettlement.error && staleSettlement.data === false,
    'Stale worker settled newer lease',
  );
  const currentSettlement = await admin.rpc(
    'complete_media_cleanup_job_if_claimed',
    {
      target_job_id: first.id,
      claimed_attempt_count: staleAttempt + 1,
    },
  );
  expect(
    !currentSettlement.error && currentSettlement.data === true,
    'Current worker could not settle lease',
  );
  const failure = await admin.rpc('fail_media_cleanup_job_if_claimed', {
    target_job_id: second.id,
    claimed_attempt_count: second.attempt_count,
    failure_message: 'Transient Storage failure',
  });
  expect(!failure.error && failure.data === true, 'Failure not recorded');
  const backoff = sql(
    `select last_error is not null and next_attempt_at > now() from public.media_cleanup_jobs where id = ${second.id};`,
  );
  expect(backoff === 't', 'Retry/backoff state missing');
  console.log(
    'PASS: concurrent claims, stale lease rejection, retry and backoff.',
  );

  const mockJobs = [
    {
      id: 10,
      bucket_id: 'profile-avatars',
      storage_path: targets[0][1],
      attempt_count: 1,
    },
    {
      id: 11,
      bucket_id: 'post-media',
      storage_path: targets[2][1],
      attempt_count: 1,
    },
    { id: 12, bucket_id: 'evil', storage_path: 'outside', attempt_count: 1 },
    {
      id: 13,
      bucket_id: 'pet-avatars',
      storage_path: targets[1][1],
      attempt_count: 1,
    },
    {
      id: 14,
      bucket_id: 'post-video-thumbnails',
      storage_path: targets[4][1],
      attempt_count: 1,
    },
  ];
  const mock = {
    rpc: async (name) => {
      if (name === 'claim_media_cleanup_jobs')
        return { data: mockJobs, error: null };
      return { data: true, error: null };
    },
    storage: {
      from: (bucket) => ({
        remove: async () => ({
          error:
            bucket === 'post-media'
              ? { message: 'Storage temporarily unavailable', statusCode: 503 }
              : bucket === 'pet-avatars'
                ? { message: 'Bucket not found', statusCode: 404 }
                : bucket === 'post-video-thumbnails'
                  ? { message: 'Object not found', statusCode: 404 }
                  : null,
        }),
      }),
    },
  };
  const partial = await processCleanupBatch(mock, 5, () => {});
  expect(
    partial.completed === 2 && partial.failed === 3,
    'Partial batch did not continue',
  );
  console.log(
    'PASS: partial batch failure, invalid target rejection, object-missing no-op, bucket-missing retry.',
  );
} finally {
  if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
  for (const [bucket, path] of uploaded) {
    await admin.storage.from(bucket).remove([path]);
  }
  if (jobIds.size)
    sql(
      `delete from public.media_cleanup_jobs where id in (${[...jobIds].join(',')});`,
    );
}

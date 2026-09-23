export function readWorkerConfig(getEnv) {
  const secret = getEnv('MEDIA_CLEANUP_INVOKE_SECRET')?.trim();
  const url = getEnv('SUPABASE_URL')?.trim();
  let serviceKey;
  const keys = getEnv('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const key = JSON.parse(keys).default;
      if (typeof key === 'string' && key.length > 0) serviceKey = key;
    } catch {
      // Legacy key is supported during project key migration.
    }
  }
  serviceKey ??= getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!secret || secret.length < 32 || !url || !serviceKey) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const requestedSize = Number(getEnv('MEDIA_CLEANUP_BATCH_SIZE') ?? '5');
  const batchSize =
    Number.isInteger(requestedSize) && requestedSize >= 1 && requestedSize <= 25
      ? requestedSize
      : 5;
  return { secret, url, serviceKey, batchSize };
}

const uuidSegment =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const imageName = '[a-z0-9][a-z0-9._-]*\\.(?:jpg|jpeg|png|webp)';
const pathPatterns = new Map([
  ['profile-avatars', new RegExp(`^${uuidSegment}/${imageName}$`, 'i')],
  [
    'pet-avatars',
    new RegExp(`^${uuidSegment}/${uuidSegment}/${imageName}$`, 'i'),
  ],
  [
    'post-media',
    new RegExp(
      `^${uuidSegment}/${uuidSegment}/${uuidSegment}/${imageName}$`,
      'i',
    ),
  ],
  [
    'post-videos',
    new RegExp(
      `^${uuidSegment}/${uuidSegment}/${uuidSegment}/[a-z0-9][a-z0-9._-]*\\.mp4$`,
      'i',
    ),
  ],
  [
    'post-video-thumbnails',
    new RegExp(
      `^${uuidSegment}/${uuidSegment}/${uuidSegment}/${imageName}$`,
      'i',
    ),
  ],
]);

export function isValidCleanupTarget(bucketId, storagePath) {
  const pattern = pathPatterns.get(bucketId);
  return (
    pattern !== undefined &&
    typeof storagePath === 'string' &&
    storagePath === storagePath.trim() &&
    storagePath.length > 0 &&
    storagePath.length <= 1024 &&
    !storagePath.includes('..') &&
    !storagePath.includes('//') &&
    pattern.test(storagePath)
  );
}

function isMissingObject(error) {
  // A 404 can also mean the bucket itself is missing; only the object case is a no-op.
  return /^object not found\.?$/i.test(error?.message ?? '');
}

export async function processCleanupBatch(
  admin,
  batchSize = 5,
  log = console.log,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error('Cleanup batch size must be between 1 and 25.');
  }
  const { data: jobs, error: claimError } = await admin.rpc(
    'claim_media_cleanup_jobs',
    {
      job_limit: batchSize,
    },
  );
  if (claimError) throw claimError;
  const result = { claimed: jobs.length, completed: 0, failed: 0, stale: 0 };
  for (const job of jobs) {
    let failure = null;
    if (!isValidCleanupTarget(job.bucket_id, job.storage_path)) {
      failure = 'Rejected invalid cleanup bucket or Storage path.';
    } else {
      try {
        const { error } = await admin.storage
          .from(job.bucket_id)
          .remove([job.storage_path]);
        if (error && !isMissingObject(error)) failure = error.message;
      } catch (error) {
        if (!isMissingObject(error))
          failure =
            error instanceof Error ? error.message : 'Storage request failed';
      }
    }
    const { data: settled, error: settlementError } = failure
      ? await admin.rpc('fail_media_cleanup_job_if_claimed', {
          target_job_id: job.id,
          claimed_attempt_count: job.attempt_count,
          failure_message: failure,
        })
      : await admin.rpc('complete_media_cleanup_job_if_claimed', {
          target_job_id: job.id,
          claimed_attempt_count: job.attempt_count,
        });
    if (settlementError) {
      result.failed += 1;
      log({
        event: 'media_cleanup_settlement_error',
        jobId: job.id,
        bucket: job.bucket_id,
      });
    } else if (!settled) {
      result.stale += 1;
      log({
        event: 'media_cleanup_stale_claim',
        jobId: job.id,
        bucket: job.bucket_id,
      });
    } else if (failure) {
      result.failed += 1;
      log({
        event: 'media_cleanup_retry',
        jobId: job.id,
        bucket: job.bucket_id,
        attempt: job.attempt_count,
      });
    } else {
      result.completed += 1;
    }
  }
  log({ event: 'media_cleanup_batch', ...result });
  return result;
}

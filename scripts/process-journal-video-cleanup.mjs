import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceKey) {
  throw new Error('Local Supabase URL and service-role key are required.');
}

if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: video cleanup worker is local only.');
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: jobs, error: claimError } = await admin.rpc(
  'claim_media_cleanup_jobs',
  { job_limit: 25 },
);

if (claimError) {
  throw claimError;
}

let failureCount = 0;

for (const job of jobs) {
  const { error: storageError } = await admin.storage
    .from(job.bucket_id)
    .remove([job.storage_path]);

  if (storageError) {
    failureCount += 1;
    const { error: recordError } = await admin.rpc('fail_media_cleanup_job', {
      failure_message: storageError.message,
      target_job_id: job.id,
    });
    if (recordError) {
      console.error(`Could not record cleanup failure for job ${job.id}.`);
    }
    continue;
  }

  const { error: completionError } = await admin.rpc(
    'complete_media_cleanup_job',
    { target_job_id: job.id },
  );
  if (completionError) {
    failureCount += 1;
    console.error(`Could not complete cleanup job ${job.id}.`);
  }
}

console.log(
  `Processed ${jobs.length} Journal video cleanup job(s); ${failureCount} failed.`,
);

if (failureCount > 0) {
  process.exitCode = 1;
}

import { createClient } from '@supabase/supabase-js';

import { processCleanupBatch } from '../supabase/functions/_shared/media-cleanup.mjs';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceKey) {
  throw new Error('Local Supabase URL and service-role key are required.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error(
    'SAFETY STOP: local CLI requires a local Supabase URL. Use the scheduled Edge worker in Production.',
  );
}
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const result = await processCleanupBatch(admin, 25);
if (result.failed > 0) process.exitCode = 1;

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  processCleanupBatch,
  readWorkerConfig,
} from '../_shared/media-cleanup.mjs';

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function tokenMatches(actual: string | null, expected: string) {
  if (!actual?.startsWith('Bearer ') || expected.length < 32) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual.slice(7))),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const actualHash = new Uint8Array(a);
  const expectedHash = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index];
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return jsonResponse({ error: 'Method not allowed' }, 405);
  const config = readWorkerConfig((name: string) => Deno.env.get(name));
  if (!config) {
    console.error(
      JSON.stringify({ event: 'media_cleanup_configuration_error' }),
    );
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }
  if (
    !(await tokenMatches(request.headers.get('Authorization'), config.secret))
  ) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  // The request body is deliberately ignored: targets come only from the queue.
  const admin = createClient(config.url, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const result = await processCleanupBatch(admin, config.batchSize, (event) =>
      console.log(JSON.stringify(event)),
    );
    return jsonResponse(result, result.failed > 0 ? 503 : 200);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'media_cleanup_batch_error',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
    return jsonResponse({ error: 'Cleanup unavailable' }, 503);
  }
});

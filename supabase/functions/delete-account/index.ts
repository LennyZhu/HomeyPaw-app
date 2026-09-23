import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function readDefaultKey(currentName: string, legacyName: string) {
  const serializedKeys = Deno.env.get(currentName);
  if (serializedKeys) {
    try {
      const keys = JSON.parse(serializedKeys) as Record<string, unknown>;
      if (typeof keys.default === 'string' && keys.default.length > 0) {
        return keys.default;
      }
    } catch {
      // Fall back to the legacy hosted secret.
    }
  }
  return Deno.env.get(legacyName);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : null;
  if (!token) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: { confirmation?: unknown };
  try {
    body = (await request.json()) as { confirmation?: unknown };
  } catch {
    return jsonResponse({ error: 'Invalid request' }, 400);
  }
  if (body.confirmation !== 'DELETE_MY_ACCOUNT') {
    return jsonResponse({ error: 'Confirmation required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKey = readDefaultKey(
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SERVICE_ROLE_KEY',
  );
  if (!supabaseUrl || !secretKey) {
    console.error('Required Supabase function environment is unavailable.');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(token);
  if (userError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // PostgREST receives the verified caller's JWT. The RPC has no target-user
  // argument and binds every mutation to auth.uid() inside PostgreSQL.
  const callerClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error: preparationError } = await callerClient.rpc(
    'prepare_account_deletion',
  );
  if (preparationError) {
    if (preparationError.message.includes('ACCOUNT_OWNS_FAMILY')) {
      return jsonResponse({ error: 'ACCOUNT_OWNS_FAMILY' }, 409);
    }
    console.error('Account preparation failed.', {
      code: preparationError.code,
    });
    return jsonResponse({ error: 'ACCOUNT_PREPARATION_FAILED' }, 503);
  }

  // Preparation has committed. An Admin failure leaves a durable preparation
  // marker and no shared deletion; a retry repeats the idempotent RPC.
  const { error: deletionError } = await adminClient.auth.admin.deleteUser(
    user.id,
  );
  if (deletionError) {
    console.error('Auth deletion failed after account preparation.', {
      code: deletionError.code,
      status: deletionError.status,
    });
    return jsonResponse({ error: 'ACCOUNT_DELETE_RETRYABLE' }, 503);
  }

  return jsonResponse({ deleted: true }, 200);
});

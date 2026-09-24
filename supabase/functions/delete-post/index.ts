import {
  checkAppReleaseGate,
  clientVersionHeaders,
} from '../_shared/app-release-gate.mjs';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-homeypaw-platform, x-homeypaw-app-version, x-homeypaw-build',
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
      const defaultKey = keys.default;

      if (typeof defaultKey === 'string' && defaultKey.length > 0) {
        return defaultKey;
      }
    } catch {
      // Fall back to the legacy hosted secret below.
    }
  }

  return Deno.env.get(legacyName);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
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

  let body: { postId?: unknown };

  try {
    body = (await request.json()) as { postId?: unknown };
  } catch {
    return jsonResponse({ error: 'Invalid request' }, 400);
  }

  if (!isUuid(body.postId)) {
    return jsonResponse({ error: 'Invalid request' }, 400);
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

  const releaseGate = await checkAppReleaseGate(adminClient, request);
  if (releaseGate) {
    return jsonResponse({ error: releaseGate.error }, releaseGate.status);
  }

  const { data: post, error: postError } = await adminClient
    .from('posts')
    .select('id, pet_id, author_id')
    .eq('id', body.postId)
    .maybeSingle();

  if (postError) {
    console.error('Post lookup failed.', { code: postError.code });
    return jsonResponse({ error: 'Post deletion failed' }, 500);
  }

  if (!post) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }

  const { data: pet, error: petError } = await adminClient
    .from('pets')
    .select('family_id')
    .eq('id', post.pet_id)
    .maybeSingle();

  if (petError) {
    console.error('Post Family lookup failed.', { code: petError.code });
    return jsonResponse({ error: 'Post deletion failed' }, 500);
  }
  if (!pet?.family_id) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }

  // Resolve canonical family_members through the caller-bound RPC. The
  // service role does not have direct SELECT on that table.
  const callerClient = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        ...clientVersionHeaders(request),
      },
    },
  });
  const { data: memberships, error: membershipError } = await callerClient.rpc(
    'get_family_members',
    { target_family_id: pet.family_id },
  );

  if (membershipError) {
    if (membershipError.code === '42501') {
      return jsonResponse({ error: 'Post not found' }, 404);
    }
    console.error('Post Family membership check failed.', {
      code: membershipError.code,
    });
    return jsonResponse({ error: 'Post deletion failed' }, 500);
  }

  const membership = memberships?.find(
    (candidate) => candidate.member_user_id === user.id,
  );
  const canDelete =
    membership?.member_role === 'owner' ||
    (membership?.member_role === 'member' && post.author_id === user.id);

  if (!canDelete) {
    return jsonResponse({ error: 'Post not found' }, 404);
  }

  // Storage cleanup is enqueued by database triggers in this transaction.
  // Removing objects here would make a later database failure unrecoverable.
  const { error: deletionError } = await adminClient
    .from('posts')
    .delete()
    .eq('id', body.postId);

  if (deletionError) {
    console.error('Post deletion failed.', { code: deletionError.code });
    return jsonResponse({ error: 'Post deletion failed' }, 500);
  }

  return jsonResponse({ deleted: true, mediaCleanupPending: true }, 200);
});

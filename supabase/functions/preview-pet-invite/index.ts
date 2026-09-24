import { createClient } from '@supabase/supabase-js';

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

  let body: { code?: unknown };

  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return jsonResponse({ error: 'invite_invalid' }, 400);
  }

  const code =
    typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';

  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) {
    return jsonResponse({ error: 'invite_invalid' }, 404);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const secretKey = readDefaultKey(
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SERVICE_ROLE_KEY',
  );

  if (!supabaseUrl || !anonKey || !secretKey) {
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

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: previews, error: previewError } = await callerClient.rpc(
    'preview_family_invite',
    { invite_code: code },
  );
  if (previewError?.message.includes('invite_invalid')) {
    return jsonResponse({ error: 'invite_invalid' }, 404);
  }
  if (previewError || !previews?.[0]) {
    console.error('Canonical invite preview failed.', {
      code: previewError?.code,
    });
    return jsonResponse({ error: 'Invite preview failed' }, 500);
  }
  const preview = previews[0];
  const { data: pet, error: petError } = await adminClient
    .from('pets')
    .select('avatar_path')
    .eq('id', preview.display_pet_id)
    .maybeSingle();
  if (petError || !pet) {
    console.error('Invite avatar lookup failed.', { code: petError?.code });
    return jsonResponse({ error: 'Invite preview failed' }, 500);
  }

  let avatarUrl: string | null = null;

  if (pet.avatar_path) {
    const { data, error } = await adminClient.storage
      .from('pet-avatars')
      .createSignedUrl(pet.avatar_path, 300);

    if (error) {
      console.error('Invite avatar signing failed.', {
        statusCode: error.statusCode,
      });
      return jsonResponse({ error: 'Invite preview failed' }, 500);
    }

    avatarUrl = data.signedUrl;
  }

  return jsonResponse(
    {
      avatarUrl,
      inviterDisplayName: preview.inviter_display_name,
      petBreed: preview.display_pet_breed,
      petName: preview.display_pet_name,
      petSpecies: preview.display_pet_species,
    },
    200,
  );
});

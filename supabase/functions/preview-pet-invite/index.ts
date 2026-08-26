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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
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

  const codeHash = await sha256Hex(code);
  const { data: invite, error: inviteError } = await adminClient
    .from('pet_invites')
    .select('pet_id, invited_by, expires_at, max_uses, used_count, revoked_at')
    .eq('code_hash', codeHash)
    .maybeSingle();

  if (inviteError) {
    console.error('Invite preview lookup failed.', { code: inviteError.code });
    return jsonResponse({ error: 'Invite preview failed' }, 500);
  }

  if (
    !invite ||
    invite.revoked_at ||
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    return jsonResponse({ error: 'invite_invalid' }, 404);
  }

  if (invite.used_count >= invite.max_uses) {
    const { data: membership, error: membershipError } = await adminClient
      .from('pet_members')
      .select('pet_id')
      .eq('pet_id', invite.pet_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError) {
      console.error('Invite membership lookup failed.', {
        code: membershipError.code,
      });
      return jsonResponse({ error: 'Invite preview failed' }, 500);
    }

    if (!membership) {
      return jsonResponse({ error: 'invite_invalid' }, 404);
    }
  }

  const [
    { data: pet, error: petError },
    { data: inviter, error: profileError },
  ] = await Promise.all([
    adminClient
      .from('pets')
      .select('name, species, breed, avatar_path')
      .eq('id', invite.pet_id)
      .maybeSingle(),
    adminClient
      .from('profiles')
      .select('display_name')
      .eq('id', invite.invited_by)
      .maybeSingle(),
  ]);

  if (petError || profileError || !pet || !inviter) {
    console.error('Invite preview data lookup failed.', {
      petCode: petError?.code,
      profileCode: profileError?.code,
    });
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
      inviterDisplayName: inviter.display_name,
      petBreed: pet.breed,
      petName: pet.name,
      petSpecies: pet.species,
    },
    200,
  );
});

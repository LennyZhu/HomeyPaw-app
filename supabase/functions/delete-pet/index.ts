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

  let body: { petId?: unknown };

  try {
    body = (await request.json()) as { petId?: unknown };
  } catch {
    return jsonResponse({ error: 'Invalid request' }, 400);
  }

  if (!isUuid(body.petId)) {
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

  const { data: membership, error: membershipError } = await adminClient
    .from('pet_members')
    .select('role')
    .eq('pet_id', body.petId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    console.error('Pet ownership check failed.', {
      code: membershipError.code,
    });
    return jsonResponse({ error: 'Pet deletion failed' }, 500);
  }

  if (membership?.role !== 'owner') {
    return jsonResponse({ error: 'Pet not found' }, 404);
  }

  const { data: pet, error: petError } = await adminClient
    .from('pets')
    .select('avatar_path')
    .eq('id', body.petId)
    .maybeSingle();

  if (petError) {
    console.error('Pet lookup failed.', { code: petError.code });
    return jsonResponse({ error: 'Pet deletion failed' }, 500);
  }

  if (!pet) {
    return jsonResponse({ error: 'Pet not found' }, 404);
  }

  let mediaOffset = 0;

  while (true) {
    const { data: mediaRows, error: mediaError } = await adminClient
      .from('post_media')
      .select('storage_path, posts!inner(pet_id)')
      .eq('posts.pet_id', body.petId)
      .range(mediaOffset, mediaOffset + 499);

    if (mediaError) {
      console.error('Pet journal media lookup failed.', {
        code: mediaError.code,
      });
      return jsonResponse({ error: 'Pet deletion failed' }, 500);
    }

    const mediaPaths = mediaRows.map((media) => media.storage_path);

    for (let index = 0; index < mediaPaths.length; index += 100) {
      const { error: storageError } = await adminClient.storage
        .from('post-media')
        .remove(mediaPaths.slice(index, index + 100));

      if (storageError) {
        console.error('Pet journal media cleanup failed.', {
          statusCode: storageError.statusCode,
        });
        return jsonResponse({ error: 'Pet deletion failed' }, 500);
      }
    }

    if (mediaRows.length < 500) {
      break;
    }

    mediaOffset += mediaRows.length;
  }

  if (pet.avatar_path) {
    const { data: removedAvatars, error: storageError } =
      await adminClient.storage.from('pet-avatars').remove([pet.avatar_path]);

    if (storageError || (removedAvatars?.length ?? 0) !== 1) {
      console.error('Pet avatar cleanup failed before database deletion.', {
        removedCount: removedAvatars?.length ?? 0,
        statusCode: storageError?.statusCode,
      });
      return jsonResponse({ error: 'Pet deletion failed' }, 500);
    }
  }

  const { error: deletionError } = await adminClient
    .from('pets')
    .delete()
    .eq('id', body.petId);

  if (deletionError) {
    console.error('Pet deletion failed after avatar cleanup.', {
      code: deletionError.code,
    });
    return jsonResponse({ error: 'Pet deletion failed' }, 500);
  }

  return jsonResponse({ deleted: true }, 200);
});

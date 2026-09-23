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
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(token);

  if (userError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: pet, error: petError } = await adminClient
    .from('pets')
    .select('family_id')
    .eq('id', body.petId)
    .maybeSingle();

  if (petError) {
    console.error('Pet lookup failed.', { code: petError.code });
    return jsonResponse({ error: 'Pet deletion failed' }, 500);
  }

  if (!pet) {
    return jsonResponse({ error: 'Pet not found' }, 404);
  }

  const { data: memberships, error: membershipError } = await userClient.rpc(
    'get_family_members',
    { target_family_id: pet.family_id },
  );

  if (membershipError) {
    if (membershipError.code === '42501') {
      return jsonResponse({ error: 'Pet not found' }, 404);
    }
    console.error('Family ownership check failed.', {
      code: membershipError.code,
    });
    return jsonResponse({ error: 'Pet deletion failed' }, 500);
  }

  const membership = memberships?.find(
    (candidate) => candidate.member_user_id === user.id,
  );
  if (membership?.member_role !== 'owner') {
    return jsonResponse({ error: 'Pet not found' }, 404);
  }

  // delete_family_pet owns the transaction. Cascades remove canonical rows,
  // and their triggers enqueue every Storage object before commit.
  const { data: deletionRows, error: deletionError } = await userClient.rpc(
    'delete_family_pet',
    { target_pet_id: body.petId },
  );
  const deletion = deletionRows?.[0];

  if (deletionError || !deletion) {
    console.error('Pet deletion failed.', { code: deletionError?.code });
    return jsonResponse({ error: 'Pet deletion failed' }, 500);
  }

  return jsonResponse(
    {
      deleted: true,
      familyId: deletion.deleted_family_id,
      mediaCleanupPending: true,
      nextPetId: deletion.next_pet_id,
    },
    200,
  );
});

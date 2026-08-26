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

async function listStorageFiles(
  client: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 4) {
    throw new Error('Storage path depth exceeded');
  }

  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      throw error;
    }

    for (const entry of data) {
      const entryPath = `${prefix}/${entry.name}`;

      if (entry.id) {
        paths.push(entryPath);
      } else {
        paths.push(
          ...(await listStorageFiles(client, bucket, entryPath, depth + 1)),
        );
      }
    }

    if (data.length < 100) {
      break;
    }

    offset += data.length;
  }

  return paths;
}

async function removeStorageFiles(
  client: ReturnType<typeof createClient>,
  bucket: string,
  paths: string[],
) {
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error } = await client.storage.from(bucket).remove(batch);

    if (error) {
      throw error;
    }
  }
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

  const { data: ownedMemberships, error: membershipsError } = await adminClient
    .from('pet_members')
    .select('pet_id')
    .eq('user_id', user.id)
    .eq('role', 'owner');

  if (membershipsError) {
    console.error('Owned pet lookup failed.', { code: membershipsError.code });
    return jsonResponse({ error: 'Account deletion failed' }, 500);
  }

  const ownedPetIds = ownedMemberships.map((membership) => membership.pet_id);

  for (const petId of ownedPetIds) {
    let offset = 0;

    while (true) {
      const { data: mediaRows, error: mediaError } = await adminClient
        .from('post_media')
        .select('storage_path, posts!inner(pet_id)')
        .eq('posts.pet_id', petId)
        .range(offset, offset + 499);

      if (mediaError) {
        console.error('Owned pet journal media lookup failed.', {
          code: mediaError.code,
        });
        return jsonResponse({ error: 'Account deletion failed' }, 500);
      }

      try {
        await removeStorageFiles(
          adminClient,
          'post-media',
          mediaRows.map((media) => media.storage_path),
        );
      } catch (error) {
        console.error('Owned pet journal media cleanup failed.', {
          statusCode:
            error && typeof error === 'object' && 'statusCode' in error
              ? error.statusCode
              : undefined,
        });
        return jsonResponse({ error: 'Account deletion failed' }, 500);
      }

      if (mediaRows.length < 500) {
        break;
      }

      offset += mediaRows.length;
    }
  }

  try {
    const postMediaPaths = await listStorageFiles(
      adminClient,
      'post-media',
      user.id,
    );
    await removeStorageFiles(adminClient, 'post-media', postMediaPaths);

    const avatarPaths = await listStorageFiles(
      adminClient,
      'pet-avatars',
      user.id,
    );
    await removeStorageFiles(adminClient, 'pet-avatars', avatarPaths);
  } catch (error) {
    console.error('Account Storage cleanup failed.', {
      statusCode:
        error && typeof error === 'object' && 'statusCode' in error
          ? error.statusCode
          : undefined,
    });
    return jsonResponse({ error: 'Account deletion failed' }, 500);
  }

  if (ownedPetIds.length > 0) {
    const { error: petsDeletionError } = await adminClient
      .from('pets')
      .delete()
      .in('id', ownedPetIds);

    if (petsDeletionError) {
      console.error('Owned pet deletion failed.', {
        code: petsDeletionError.code,
      });
      return jsonResponse({ error: 'Account deletion failed' }, 500);
    }
  }

  const { error: deletionError } = await adminClient.auth.admin.deleteUser(
    user.id,
  );

  if (deletionError) {
    console.error('Account deletion failed.', {
      code: deletionError.code,
      message: deletionError.message,
      name: deletionError.name,
      status: deletionError.status,
    });
    return jsonResponse({ error: 'Account deletion failed' }, 500);
  }

  return jsonResponse({ deleted: true }, 200);
});

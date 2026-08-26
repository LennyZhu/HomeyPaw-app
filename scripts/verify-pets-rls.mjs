import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';

const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const temporaryPetDescription = 'Temporary Phase 3 RLS verification pet';
const temporaryPetName = 'HomeyPaw RLS Temporary Pet';

function readPublicConfig() {
  const contents = readFileSync(
    new URL('../.env.local', import.meta.url),
    'utf8',
  );
  const values = new Map();

  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);

    if (match) {
      values.set(match[1], match[2].trim());
    }
  }

  return {
    publishableKey: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    url: values.get('EXPO_PUBLIC_SUPABASE_URL'),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing temporary test credential: ${name}`);
  }

  return value;
}

function createTestClient(url, publishableKey) {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    throw new Error(`${label} sign-in failed (${error?.code ?? 'no_user'}).`);
  }

  return data.user;
}

async function ignoreCleanupError(cleanup) {
  try {
    await cleanup();
  } catch {
    // Preserve the original verification failure while cleanup remains best effort.
  }
}

async function removeStaleVerificationPets(client) {
  const { data: stalePets, error } = await client
    .from('pets')
    .select('id')
    .eq('name', temporaryPetName)
    .eq('description', temporaryPetDescription);

  if (error) {
    throw new Error('Could not inspect stale verification pets.');
  }

  for (const stalePet of stalePets) {
    const { data, error: deleteError } = await client.functions.invoke(
      'delete-pet',
      { body: { petId: stalePet.id } },
    );

    if (deleteError || !data?.deleted || data.avatarCleanupPending) {
      throw new Error('Could not clean up a stale verification pet.');
    }
  }
}

async function main() {
  const { publishableKey, url } = readPublicConfig();

  if (!url || !publishableKey) {
    throw new Error('Public Supabase configuration is missing.');
  }

  const userAEmail = requiredEnvironment('PAWDAY_RLS_USER_A_EMAIL');
  const userAPassword = requiredEnvironment('PAWDAY_RLS_USER_A_PASSWORD');
  const userBEmail = requiredEnvironment('PAWDAY_RLS_USER_B_EMAIL');
  const userBPassword = requiredEnvironment('PAWDAY_RLS_USER_B_PASSWORD');

  if (userAEmail.toLowerCase() === userBEmail.toLowerCase()) {
    throw new Error('User A and User B must be different accounts.');
  }

  const clientA = createTestClient(url, publishableKey);
  const clientB = createTestClient(url, publishableKey);
  let temporaryPetId = null;
  let avatarPath = null;

  try {
    const userA = await signIn(clientA, userAEmail, userAPassword, 'User A');
    const userB = await signIn(clientB, userBEmail, userBPassword, 'User B');

    if (userA.id === userB.id) {
      throw new Error('User A and User B resolved to the same identity.');
    }

    await removeStaleVerificationPets(clientA);

    const { data: pet, error: createError } = await clientA.rpc('create_pet', {
      pet_description: temporaryPetDescription,
      pet_gender: 'unknown',
      pet_name: temporaryPetName,
      pet_species: 'other',
    });

    if (createError || !pet) {
      throw new Error(`Atomic pet creation failed (${createError?.code}).`);
    }

    temporaryPetId = pet.id;

    const { data: ownRead, error: ownReadError } = await clientA
      .from('pets')
      .select('id')
      .eq('id', temporaryPetId)
      .single();

    if (ownReadError || !ownRead) {
      throw new Error('User A could not read its own pet.');
    }

    const { data: ownUpdate, error: ownUpdateError } = await clientA
      .from('pets')
      .update({ breed: 'Verification' })
      .eq('id', temporaryPetId)
      .select('id')
      .single();

    if (ownUpdateError || !ownUpdate) {
      throw new Error('User A could not update its own pet.');
    }

    const { data: crossRead, error: crossReadError } = await clientB
      .from('pets')
      .select('id')
      .eq('id', temporaryPetId);

    if (crossReadError || crossRead.length !== 0) {
      throw new Error('RLS BREACH: User B could read User A pet.');
    }

    const { data: crossUpdate, error: crossUpdateError } = await clientB
      .from('pets')
      .update({ name: 'Must not change' })
      .eq('id', temporaryPetId)
      .select('id');

    if (crossUpdateError || crossUpdate.length !== 0) {
      throw new Error('RLS BREACH: User B could update User A pet.');
    }

    const { data: crossDelete, error: crossDeleteError } = await clientB
      .from('pets')
      .delete()
      .eq('id', temporaryPetId)
      .select('id');

    if (crossDeleteError || crossDelete.length !== 0) {
      throw new Error('RLS BREACH: User B could delete User A pet.');
    }

    const { error: forgedMembershipError } = await clientB
      .from('pet_members')
      .insert({ pet_id: temporaryPetId, role: 'owner', user_id: userB.id });

    if (!forgedMembershipError) {
      throw new Error('RLS BREACH: User B forged membership for User A pet.');
    }

    avatarPath = `${userA.id}/${temporaryPetId}/${randomUUID()}.png`;
    const imageBytes = decode(onePixelPng);
    const { error: uploadError } = await clientA.storage
      .from('pet-avatars')
      .upload(avatarPath, imageBytes, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`User A avatar upload failed (${uploadError.name}).`);
    }

    const { error: avatarUpdateError } = await clientA
      .from('pets')
      .update({ avatar_path: avatarPath })
      .eq('id', temporaryPetId);

    if (avatarUpdateError) {
      throw new Error('User A could not attach its avatar path.');
    }

    const { error: ownDownloadError } = await clientA.storage
      .from('pet-avatars')
      .download(avatarPath);

    if (ownDownloadError) {
      throw new Error('User A could not read its own pet avatar.');
    }

    const { error: crossDownloadError } = await clientB.storage
      .from('pet-avatars')
      .download(avatarPath);

    if (!crossDownloadError) {
      throw new Error('STORAGE BREACH: User B read User A pet avatar.');
    }

    const { error: crossReplaceError } = await clientB.storage
      .from('pet-avatars')
      .update(avatarPath, imageBytes, { contentType: 'image/png' });

    if (!crossReplaceError) {
      throw new Error('STORAGE BREACH: User B replaced User A pet avatar.');
    }

    const { data: crossRemove, error: crossRemoveError } = await clientB.storage
      .from('pet-avatars')
      .remove([avatarPath]);

    const { error: ownerReadAfterCrossRemoveError } = await clientA.storage
      .from('pet-avatars')
      .download(avatarPath);

    if (
      (!crossRemoveError && (crossRemove?.length ?? 0) > 0) ||
      ownerReadAfterCrossRemoveError
    ) {
      throw new Error('STORAGE BREACH: User B deleted User A pet avatar.');
    }

    const { data: deletion, error: deletionError } =
      await clientA.functions.invoke('delete-pet', {
        body: { petId: temporaryPetId },
      });

    if (deletionError || !deletion?.deleted || deletion.avatarCleanupPending) {
      throw new Error('Owner delete-pet function failed.');
    }

    const { data: deletedPet, error: deletedPetError } = await clientA
      .from('pets')
      .select('id')
      .eq('id', temporaryPetId);

    if (deletedPetError || deletedPet.length !== 0) {
      throw new Error('Deleted pet row still exists.');
    }

    const { data: deletedMembership, error: deletedMembershipError } =
      await clientA
        .from('pet_members')
        .select('pet_id')
        .eq('pet_id', temporaryPetId);

    if (deletedMembershipError || deletedMembership.length !== 0) {
      throw new Error('Deleted pet membership still exists.');
    }

    const { data: deletedAvatarGrant, error: deletedAvatarGrantError } =
      await clientA.storage.from('pet-avatars').createSignedUrl(avatarPath, 60);

    if (!deletedAvatarGrantError || deletedAvatarGrant?.signedUrl) {
      throw new Error('Deleted pet avatar is still accessible.');
    }

    temporaryPetId = null;
    avatarPath = null;

    console.log('PASS: Owner pet creation is atomic and readable.');
    console.log('PASS: User A can update its own pet.');
    console.log('PASS: User B cannot read, update, or delete User A pet.');
    console.log('PASS: User B cannot forge pet membership.');
    console.log('PASS: User A can upload and read its private pet avatar.');
    console.log('PASS: User B cannot read, replace, or delete User A avatar.');
    console.log('PASS: Pet, membership, and avatar deletion is verified.');
  } finally {
    if (avatarPath) {
      await ignoreCleanupError(() =>
        clientA.storage.from('pet-avatars').remove([avatarPath]),
      );
    }

    if (temporaryPetId) {
      await ignoreCleanupError(() =>
        clientA.from('pets').delete().eq('id', temporaryPetId),
      );
    }

    await Promise.allSettled([
      clientA.auth.signOut({ scope: 'local' }),
      clientB.auth.signOut({ scope: 'local' }),
    ]);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Pet security test failed.',
  );
  process.exitCode = 1;
});

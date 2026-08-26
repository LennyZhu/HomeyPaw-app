import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const temporaryPetDescription = 'Temporary Phase 4 RLS verification pet';
const temporaryPetName = 'HomeyPaw Post RLS Temporary Pet';
const verificationImage = readFileSync(
  new URL('../assets/images/favicon.png', import.meta.url),
);

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
    throw new Error('Could not inspect stale post verification pets.');
  }

  for (const stalePet of stalePets) {
    const { data, error: deleteError } = await client.functions.invoke(
      'delete-pet',
      { body: { petId: stalePet.id } },
    );

    if (deleteError || !data?.deleted) {
      throw new Error('Could not clean up a stale post verification pet.');
    }
  }
}

function mediaMetadata({ mediaId, path, position = 0 }) {
  return {
    height: 48,
    id: mediaId,
    mime_type: 'image/jpeg',
    position,
    storage_path: path,
    width: 48,
  };
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
  let postId = null;
  let mediaPath = null;
  let failedPublishPath = null;

  try {
    const userA = await signIn(clientA, userAEmail, userAPassword, 'User A');
    const userB = await signIn(clientB, userBEmail, userBPassword, 'User B');

    if (userA.id === userB.id) {
      throw new Error('User A and User B resolved to the same identity.');
    }

    await removeStaleVerificationPets(clientA);

    const { data: pet, error: petError } = await clientA.rpc('create_pet', {
      pet_description: temporaryPetDescription,
      pet_gender: 'unknown',
      pet_name: temporaryPetName,
      pet_species: 'other',
    });

    if (petError || !pet) {
      throw new Error(`Temporary pet creation failed (${petError?.code}).`);
    }

    temporaryPetId = pet.id;
    postId = randomUUID();
    const mediaId = randomUUID();
    mediaPath = `${userA.id}/${temporaryPetId}/${postId}/${mediaId}.jpg`;

    const { error: uploadError } = await clientA.storage
      .from('post-media')
      .upload(mediaPath, verificationImage, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Owner post media upload failed (${uploadError.name}).`);
    }

    const mediaItem = mediaMetadata({ mediaId, path: mediaPath });
    const { data: createdPost, error: createError } = await clientA.rpc(
      'create_post',
      {
        media_items: [mediaItem],
        post_content: 'Phase 4 security verification',
        post_event_date: new Date().toISOString().slice(0, 10),
        post_id: postId,
        post_location_name: 'Private test place',
        post_pet_id: temporaryPetId,
        post_tag: 'other',
      },
    );

    if (createError || !createdPost) {
      throw new Error(`Atomic post creation failed (${createError?.code}).`);
    }

    const { data: ownRead, error: ownReadError } = await clientA
      .from('posts')
      .select('id, post_media(id, storage_path)')
      .eq('id', postId)
      .single();

    if (ownReadError || ownRead.post_media.length !== 1) {
      throw new Error('User A could not read its post and ordered media.');
    }

    const { data: crossRead, error: crossReadError } = await clientB
      .from('posts')
      .select('id')
      .eq('id', postId);

    if (crossReadError || crossRead.length !== 0) {
      throw new Error('RLS BREACH: User B could read User A post.');
    }

    const { data: crossMediaRead, error: crossMediaReadError } = await clientB
      .from('post_media')
      .select('id')
      .eq('post_id', postId);

    if (crossMediaReadError || crossMediaRead.length !== 0) {
      throw new Error('RLS BREACH: User B could read User A post media row.');
    }

    const { error: crossDownloadError } = await clientB.storage
      .from('post-media')
      .download(mediaPath);

    if (!crossDownloadError) {
      throw new Error('STORAGE BREACH: User B read User A post image.');
    }

    const { data: crossRemove, error: crossRemoveError } = await clientB.storage
      .from('post-media')
      .remove([mediaPath]);
    const { error: ownerReadAfterCrossRemoveError } = await clientA.storage
      .from('post-media')
      .download(mediaPath);

    if (
      (!crossRemoveError && (crossRemove?.length ?? 0) > 0) ||
      ownerReadAfterCrossRemoveError
    ) {
      throw new Error('STORAGE BREACH: User B deleted User A post image.');
    }

    const forgedPostId = randomUUID();
    const { error: forgedPostError } = await clientB.rpc('create_post', {
      media_items: [],
      post_content: 'Must not be created',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_id: forgedPostId,
      post_location_name: null,
      post_pet_id: temporaryPetId,
      post_tag: null,
    });

    if (!forgedPostError) {
      throw new Error('RLS BREACH: User B created a post for User A pet.');
    }

    const { error: directInsertError } = await clientA.from('posts').insert({
      author_id: userB.id,
      content: 'Spoofed author',
      event_date: new Date().toISOString().slice(0, 10),
      id: randomUUID(),
      pet_id: temporaryPetId,
    });

    if (!directInsertError) {
      throw new Error('RLS BREACH: Client directly inserted a spoofed post.');
    }

    const { data: updatedPost, error: updateError } = await clientA.rpc(
      'update_post',
      {
        media_items: [mediaItem],
        post_content: 'Phase 4 security verification updated',
        post_event_date: new Date().toISOString().slice(0, 10),
        post_location_name: null,
        post_tag: 'walk',
        target_post_id: postId,
      },
    );

    if (updateError || !updatedPost) {
      throw new Error(`Atomic post update failed (${updateError?.code}).`);
    }

    const failedPostId = randomUUID();
    const failedMediaId = randomUUID();
    failedPublishPath = `${userA.id}/${temporaryPetId}/${failedPostId}/${failedMediaId}.jpg`;
    const { error: failedPathUploadError } = await clientA.storage
      .from('post-media')
      .upload(failedPublishPath, verificationImage, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (failedPathUploadError) {
      throw new Error('Controlled failure object upload failed.');
    }

    const invalidMedia = {
      ...mediaMetadata({ mediaId: failedMediaId, path: failedPublishPath }),
      width: 0,
    };
    const { error: controlledFailureError } = await clientA.rpc('create_post', {
      media_items: [invalidMedia],
      post_content: null,
      post_event_date: new Date().toISOString().slice(0, 10),
      post_id: failedPostId,
      post_location_name: null,
      post_pet_id: temporaryPetId,
      post_tag: null,
    });

    if (!controlledFailureError) {
      throw new Error('Controlled publish failure unexpectedly succeeded.');
    }

    const { error: failureCleanupError } = await clientA.storage
      .from('post-media')
      .remove([failedPublishPath]);

    if (failureCleanupError) {
      throw new Error('Controlled failure object cleanup failed.');
    }

    const { data: failedPostRows, error: failedPostReadError } = await clientA
      .from('posts')
      .select('id')
      .eq('id', failedPostId);
    const { data: failedObjectGrant, error: failedObjectGrantError } =
      await clientA.storage
        .from('post-media')
        .createSignedUrl(failedPublishPath, 60);

    if (
      failedPostReadError ||
      failedPostRows.length !== 0 ||
      !failedObjectGrantError ||
      failedObjectGrant?.signedUrl
    ) {
      throw new Error('Controlled failure left a database or Storage orphan.');
    }

    failedPublishPath = null;

    const { data: deletion, error: deletionError } =
      await clientA.functions.invoke('delete-post', {
        body: { postId },
      });

    if (deletionError || !deletion?.deleted) {
      throw new Error('Owner delete-post function failed.');
    }

    const { data: deletedPost, error: deletedPostError } = await clientA
      .from('posts')
      .select('id')
      .eq('id', postId);
    const { data: deletedMedia, error: deletedMediaError } = await clientA
      .from('post_media')
      .select('id')
      .eq('post_id', postId);
    const { data: deletedObjectGrant, error: deletedObjectGrantError } =
      await clientA.storage.from('post-media').createSignedUrl(mediaPath, 60);

    if (
      deletedPostError ||
      deletedPost.length !== 0 ||
      deletedMediaError ||
      deletedMedia.length !== 0 ||
      !deletedObjectGrantError ||
      deletedObjectGrant?.signedUrl
    ) {
      throw new Error('Post deletion left a row or Storage object behind.');
    }

    postId = null;
    mediaPath = null;

    const { data: petDeletion, error: petDeletionError } =
      await clientA.functions.invoke('delete-pet', {
        body: { petId: temporaryPetId },
      });

    if (petDeletionError || !petDeletion?.deleted) {
      throw new Error('Phase 4 pet lifecycle cleanup failed.');
    }

    temporaryPetId = null;

    console.log('PASS: Owner can atomically create, read, and update a post.');
    console.log('PASS: Author identity cannot be spoofed by client input.');
    console.log('PASS: User B cannot access User A post or media metadata.');
    console.log('PASS: User B cannot read or delete User A post image.');
    console.log('PASS: Controlled publish failure leaves no post or object.');
    console.log('PASS: Post and media deletion lifecycle is verified.');
  } finally {
    if (failedPublishPath) {
      await ignoreCleanupError(() =>
        clientA.storage.from('post-media').remove([failedPublishPath]),
      );
    }

    if (postId) {
      await ignoreCleanupError(() =>
        clientA.functions.invoke('delete-post', { body: { postId } }),
      );
    } else if (mediaPath) {
      await ignoreCleanupError(() =>
        clientA.storage.from('post-media').remove([mediaPath]),
      );
    }

    if (temporaryPetId) {
      await ignoreCleanupError(() =>
        clientA.functions.invoke('delete-pet', {
          body: { petId: temporaryPetId },
        }),
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
    error instanceof Error ? error.message : 'Post security test failed.',
  );
  process.exitCode = 1;
});

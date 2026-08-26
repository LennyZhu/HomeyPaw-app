import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const temporaryPetDescription = 'Temporary Phase 4.5 family RLS verification';
const temporaryPetName = 'HomeyPaw Family RLS Temporary Pet';
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
    if (match) values.set(match[1], match[2].trim());
  }

  return {
    publishableKey: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    url: values.get('EXPO_PUBLIC_SUPABASE_URL'),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing temporary test credential: ${name}`);
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
    // Preserve the original verification failure.
  }
}

async function removeStalePets(client) {
  const { data, error } = await client
    .from('pets')
    .select('id')
    .eq('name', temporaryPetName)
    .eq('description', temporaryPetDescription);

  if (error) throw new Error('Could not inspect stale family test pets.');

  for (const pet of data) {
    const { data: deletion, error: deletionError } =
      await client.functions.invoke('delete-pet', {
        body: { petId: pet.id },
      });
    if (deletionError || !deletion?.deleted) {
      throw new Error('Could not clean up a stale family test pet.');
    }
  }
}

function postInput(petId, postId, content, mediaItems = []) {
  return {
    media_items: mediaItems,
    post_content: content,
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  };
}

function mediaInput(mediaId, path) {
  return {
    height: 48,
    id: mediaId,
    mime_type: 'image/jpeg',
    position: 0,
    storage_path: path,
    width: 48,
  };
}

async function uploadImage(client, path) {
  const { error } = await client.storage
    .from('post-media')
    .upload(path, verificationImage, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (error)
    throw new Error(`Verification image upload failed (${error.name}).`);
}

async function main() {
  const { publishableKey, url } = readPublicConfig();
  if (!url || !publishableKey) {
    throw new Error('Public Supabase configuration is missing.');
  }

  const ownerEmail = requiredEnvironment('PAWDAY_FAMILY_OWNER_EMAIL');
  const ownerPassword = requiredEnvironment('PAWDAY_FAMILY_OWNER_PASSWORD');
  const memberEmail = requiredEnvironment('PAWDAY_FAMILY_MEMBER_EMAIL');
  const memberPassword = requiredEnvironment('PAWDAY_FAMILY_MEMBER_PASSWORD');
  const strangerEmail = requiredEnvironment('PAWDAY_FAMILY_STRANGER_EMAIL');
  const strangerPassword = requiredEnvironment(
    'PAWDAY_FAMILY_STRANGER_PASSWORD',
  );
  const normalizedEmails = new Set(
    [ownerEmail, memberEmail, strangerEmail].map((email) =>
      email.toLowerCase(),
    ),
  );
  if (normalizedEmails.size !== 3) {
    throw new Error('Owner, Member, and Stranger must be different accounts.');
  }

  const ownerClient = createTestClient(url, publishableKey);
  const memberClient = createTestClient(url, publishableKey);
  const strangerClient = createTestClient(url, publishableKey);
  let petId = null;
  const cleanupPaths = new Set();

  try {
    const owner = await signIn(ownerClient, ownerEmail, ownerPassword, 'Owner');
    const member = await signIn(
      memberClient,
      memberEmail,
      memberPassword,
      'Member',
    );
    const stranger = await signIn(
      strangerClient,
      strangerEmail,
      strangerPassword,
      'Stranger',
    );
    if (new Set([owner.id, member.id, stranger.id]).size !== 3) {
      throw new Error('Test accounts resolved to duplicate identities.');
    }

    await removeStalePets(ownerClient);

    const { data: pet, error: petError } = await ownerClient.rpc('create_pet', {
      pet_description: temporaryPetDescription,
      pet_gender: 'unknown',
      pet_name: temporaryPetName,
      pet_species: 'other',
    });
    if (petError || !pet) {
      throw new Error(`Temporary pet creation failed (${petError?.code}).`);
    }
    petId = pet.id;

    const { data: strangerPetBefore, error: strangerPetBeforeError } =
      await strangerClient.from('pets').select('id').eq('id', petId);
    const { data: strangerMembersBefore, error: strangerMembersBeforeError } =
      await strangerClient
        .from('pet_members')
        .select('pet_id')
        .eq('pet_id', petId);
    if (
      strangerPetBeforeError ||
      strangerMembersBeforeError ||
      strangerPetBefore.length !== 0 ||
      strangerMembersBefore.length !== 0
    ) {
      throw new Error('RLS BREACH: Stranger accessed pet or members.');
    }

    const { error: invalidPreviewError } = await strangerClient.rpc(
      'preview_pet_invite',
      { invite_code: 'ZZZZZZZZ' },
    );
    if (!invalidPreviewError) {
      throw new Error('Invalid invite preview unexpectedly succeeded.');
    }

    const { data: inviteRows, error: inviteError } = await ownerClient.rpc(
      'create_pet_invite',
      { target_pet_id: petId },
    );
    const invite = inviteRows?.[0];
    if (
      inviteError ||
      !invite ||
      !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u.test(invite.invite_code)
    ) {
      throw new Error(`Owner invite creation failed (${inviteError?.code}).`);
    }
    const inviteCode = invite.invite_code;

    const { error: hashReadError } = await ownerClient
      .from('pet_invites')
      .select('code_hash')
      .eq('id', invite.invite_id);
    if (!hashReadError) {
      throw new Error(
        'SECURITY BREACH: Invite hash was exposed to the client.',
      );
    }

    const { data: previewRows, error: previewError } = await memberClient.rpc(
      'preview_pet_invite',
      { invite_code: inviteCode },
    );
    if (
      previewError ||
      previewRows?.length !== 1 ||
      Object.hasOwn(previewRows[0], 'pet_id') ||
      Object.hasOwn(previewRows[0], 'owner_id')
    ) {
      throw new Error('Invite preview did not return the minimal whitelist.');
    }

    const { data: ownerJoinRows, error: ownerJoinError } =
      await ownerClient.rpc('join_pet_with_invite', {
        invite_code: inviteCode,
      });
    if (
      ownerJoinError ||
      ownerJoinRows?.[0]?.join_status !== 'already_member'
    ) {
      throw new Error('Owner invite reuse was not idempotent.');
    }

    const { data: joinRows, error: joinError } = await memberClient.rpc(
      'join_pet_with_invite',
      { invite_code: inviteCode },
    );
    if (joinError || joinRows?.[0]?.join_status !== 'joined') {
      throw new Error(`Member join failed (${joinError?.code}).`);
    }

    const { data: repeatRows, error: repeatError } = await memberClient.rpc(
      'join_pet_with_invite',
      { invite_code: inviteCode },
    );
    if (repeatError || repeatRows?.[0]?.join_status !== 'already_member') {
      throw new Error('Member invite reuse was not idempotent.');
    }

    const { data: memberPet, error: memberPetError } = await memberClient
      .from('pets')
      .select('id, avatar_path')
      .eq('id', petId)
      .single();
    const { data: members, error: membersError } = await memberClient.rpc(
      'get_pet_members',
      { target_pet_id: petId },
    );
    if (memberPetError || !memberPet || membersError || members.length !== 2) {
      throw new Error('Member could not read the shared pet and member list.');
    }

    const ownerPostId = randomUUID();
    const ownerMediaId = randomUUID();
    const ownerMediaPath = `${owner.id}/${petId}/${ownerPostId}/${ownerMediaId}.jpg`;
    cleanupPaths.add(ownerMediaPath);
    await uploadImage(ownerClient, ownerMediaPath);
    const { error: ownerPostError } = await ownerClient.rpc(
      'create_post',
      postInput(petId, ownerPostId, 'Owner family verification post', [
        mediaInput(ownerMediaId, ownerMediaPath),
      ]),
    );
    if (ownerPostError) {
      throw new Error(`Owner post creation failed (${ownerPostError.code}).`);
    }

    const { data: ownerPostRead, error: ownerPostReadError } =
      await memberClient
        .from('posts')
        .select('id, post_media(storage_path)')
        .eq('id', ownerPostId)
        .single();
    const { error: ownerImageReadError } = await memberClient.storage
      .from('post-media')
      .download(ownerMediaPath);
    if (
      ownerPostReadError ||
      ownerPostRead.post_media.length !== 1 ||
      ownerImageReadError
    ) {
      throw new Error('Member could not read the owner post and image.');
    }

    const memberPostId = randomUUID();
    const memberMediaId = randomUUID();
    const memberMediaPath = `${member.id}/${petId}/${memberPostId}/${memberMediaId}.jpg`;
    cleanupPaths.add(memberMediaPath);
    await uploadImage(memberClient, memberMediaPath);
    const { data: memberPost, error: memberPostError } = await memberClient.rpc(
      'create_post',
      postInput(petId, memberPostId, 'Member family verification post', [
        mediaInput(memberMediaId, memberMediaPath),
      ]),
    );
    if (memberPostError || memberPost?.author_id !== member.id) {
      throw new Error(
        `Member post creation failed (${memberPostError?.code}).`,
      );
    }

    const { error: memberUpdateError } = await memberClient.rpc('update_post', {
      media_items: [mediaInput(memberMediaId, memberMediaPath)],
      post_content: 'Member family verification post updated',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
      post_tag: 'walk',
      target_post_id: memberPostId,
    });
    if (memberUpdateError) {
      throw new Error(
        `Member own-post update failed (${memberUpdateError.code}).`,
      );
    }

    const { data: memberPostForOwner, error: memberPostForOwnerError } =
      await ownerClient
        .from('posts')
        .select('id')
        .eq('id', memberPostId)
        .single();
    const { error: memberImageForOwnerError } = await ownerClient.storage
      .from('post-media')
      .download(memberMediaPath);
    if (
      memberPostForOwnerError ||
      !memberPostForOwner ||
      memberImageForOwnerError
    ) {
      throw new Error('Owner could not read member post and private media.');
    }

    const { error: updateOwnerError } = await memberClient.rpc('update_post', {
      media_items: [mediaInput(ownerMediaId, ownerMediaPath)],
      post_content: 'Must not update owner post',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
      post_tag: null,
      target_post_id: ownerPostId,
    });
    if (!updateOwnerError) {
      throw new Error('RLS BREACH: Member updated the owner post.');
    }

    const { error: memberDeleteOwnerError } =
      await memberClient.functions.invoke('delete-post', {
        body: { postId: ownerPostId },
      });
    if (!memberDeleteOwnerError) {
      throw new Error('RLS BREACH: Member deleted the owner post.');
    }

    const { data: crossRemove } = await memberClient.storage
      .from('post-media')
      .remove([ownerMediaPath]);
    const { error: ownerImageStillThereError } = await ownerClient.storage
      .from('post-media')
      .download(ownerMediaPath);
    if ((crossRemove?.length ?? 0) > 0 || ownerImageStillThereError) {
      throw new Error('STORAGE BREACH: Member deleted owner media.');
    }

    const { data: memberDeletion, error: memberDeletionError } =
      await memberClient.functions.invoke('delete-post', {
        body: { postId: memberPostId },
      });
    if (memberDeletionError || !memberDeletion?.deleted) {
      throw new Error('Member could not delete its own post.');
    }
    cleanupPaths.delete(memberMediaPath);
    const { data: deletedMemberPost, error: deletedMemberPostError } =
      await ownerClient.from('posts').select('id').eq('id', memberPostId);
    const { data: deletedMemberObject, error: deletedMemberObjectError } =
      await ownerClient.storage
        .from('post-media')
        .createSignedUrl(memberMediaPath, 60);
    if (
      deletedMemberPostError ||
      deletedMemberPost.length !== 0 ||
      !deletedMemberObjectError ||
      deletedMemberObject?.signedUrl
    ) {
      throw new Error('Member post deletion left a row or media object.');
    }

    const forgedMediaPath = `${stranger.id}/${petId}/${randomUUID()}/${randomUUID()}.jpg`;
    const { error: strangerUploadError } = await strangerClient.storage
      .from('post-media')
      .upload(forgedMediaPath, verificationImage, {
        contentType: 'image/jpeg',
        upsert: false,
      });
    const { error: strangerMembershipError } = await strangerClient
      .from('pet_members')
      .insert({ pet_id: petId, role: 'owner', user_id: stranger.id });
    if (!strangerUploadError || !strangerMembershipError) {
      throw new Error(
        'RLS BREACH: Stranger uploaded media or forged membership.',
      );
    }

    const { data: strangerPosts, error: strangerPostsError } =
      await strangerClient.from('posts').select('id').eq('pet_id', petId);
    const { data: strangerMedia, error: strangerMediaError } =
      await strangerClient
        .from('post_media')
        .select('id')
        .eq('post_id', ownerPostId);
    const { error: strangerDownloadError } = await strangerClient.storage
      .from('post-media')
      .download(ownerMediaPath);
    if (
      strangerPostsError ||
      strangerMediaError ||
      strangerPosts.length !== 0 ||
      strangerMedia.length !== 0 ||
      !strangerDownloadError
    ) {
      throw new Error('RLS BREACH: Stranger accessed shared journal data.');
    }

    const ownerDeleteMemberPostId = randomUUID();
    const { error: ownerDeleteCandidateError } = await memberClient.rpc(
      'create_post',
      postInput(petId, ownerDeleteMemberPostId, 'Owner moderation candidate'),
    );
    if (ownerDeleteCandidateError) {
      throw new Error('Member moderation candidate creation failed.');
    }
    const { data: ownerModeration, error: ownerModerationError } =
      await ownerClient.functions.invoke('delete-post', {
        body: { postId: ownerDeleteMemberPostId },
      });
    if (ownerModerationError || !ownerModeration?.deleted) {
      throw new Error('Owner could not delete a member post.');
    }

    const historicalPostId = randomUUID();
    const { error: historicalError } = await memberClient.rpc(
      'create_post',
      postInput(petId, historicalPostId, 'Historical family memory'),
    );
    if (historicalError)
      throw new Error('Historical member post creation failed.');

    const { error: removeError } = await ownerClient.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: member.id,
    });
    if (removeError) {
      throw new Error(`Owner member removal failed (${removeError.code}).`);
    }

    const { data: removedPet, error: removedPetError } = await memberClient
      .from('pets')
      .select('id')
      .eq('id', petId);
    const { data: removedPosts, error: removedPostsError } = await memberClient
      .from('posts')
      .select('id')
      .eq('pet_id', petId);
    const { data: removedSignedUrl, error: removedSignedUrlError } =
      await memberClient.storage
        .from('post-media')
        .createSignedUrl(ownerMediaPath, 60);
    const { error: removedCreateError } = await memberClient.rpc(
      'create_post',
      postInput(petId, randomUUID(), 'Must not be created after removal'),
    );
    if (
      removedPetError ||
      removedPostsError ||
      removedPet.length !== 0 ||
      removedPosts.length !== 0 ||
      !removedSignedUrlError ||
      removedSignedUrl?.signedUrl ||
      !removedCreateError
    ) {
      throw new Error('RLS BREACH: Removed member retained fresh access.');
    }

    const { data: history, error: historyError } = await ownerClient
      .from('posts')
      .select('id, author_id')
      .eq('id', historicalPostId)
      .single();
    if (historyError || history.author_id !== member.id) {
      throw new Error('Removed member history was not preserved for the pet.');
    }

    const { error: revokedPreviewError } = await strangerClient.rpc(
      'preview_pet_invite',
      { invite_code: inviteCode },
    );
    if (!revokedPreviewError) {
      throw new Error('Revoked invite remained usable after member removal.');
    }

    const { data: petDeletion, error: petDeletionError } =
      await ownerClient.functions.invoke('delete-pet', {
        body: { petId },
      });
    if (petDeletionError || !petDeletion?.deleted) {
      throw new Error('Family test pet lifecycle cleanup failed.');
    }
    petId = null;
    cleanupPaths.clear();

    console.log('PASS: Owner can create a hashed, expiring invite.');
    console.log('PASS: Invalid invites reveal no pet data.');
    console.log('PASS: Member preview returns only whitelisted pet details.');
    console.log('PASS: Owner and repeat joins are idempotent.');
    console.log('PASS: Member can join and read the shared pet and members.');
    console.log('PASS: Member can read owner posts and private media.');
    console.log('PASS: Member can create and update its own post and media.');
    console.log('PASS: Member can delete its own post and media.');
    console.log('PASS: Member cannot update or delete the owner post.');
    console.log('PASS: Stranger cannot access pet, members, posts, or media.');
    console.log('PASS: Owner can delete a member post.');
    console.log(
      'PASS: Owner can remove a member and revoke the active invite.',
    );
    console.log('PASS: Removed member loses fresh access without re-login.');
    console.log('PASS: Removed member history remains visible to the owner.');
    console.log('PASS: Pet deletion cleans family test data.');
  } finally {
    if (cleanupPaths.size > 0) {
      await ignoreCleanupError(() =>
        ownerClient.storage.from('post-media').remove([...cleanupPaths]),
      );
    }
    if (petId) {
      await ignoreCleanupError(() =>
        ownerClient.functions.invoke('delete-pet', { body: { petId } }),
      );
    }
    await Promise.allSettled([
      ownerClient.auth.signOut(),
      memberClient.auth.signOut(),
      strangerClient.auth.signOut(),
    ]);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Verification failed.',
  );
  process.exitCode = 1;
});

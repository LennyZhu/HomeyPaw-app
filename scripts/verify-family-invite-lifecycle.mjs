import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';

import { createClient } from '@supabase/supabase-js';

const temporaryPetDescription =
  'Temporary Phase 4.5 invite lifecycle verification';
const expiredPetName = 'HomeyPaw Expired Invite Temporary Pet';
const concurrentPetName = 'HomeyPaw Concurrent Invite Temporary Pet';

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

async function deletePet(client, petId) {
  const { data, error } = await client.functions.invoke('delete-pet', {
    body: { petId },
  });
  if (error || !data?.deleted) {
    throw new Error('Could not delete an invite lifecycle test pet.');
  }
}

async function removeStalePets(client) {
  const { data, error } = await client
    .from('pets')
    .select('id')
    .eq('description', temporaryPetDescription)
    .in('name', [expiredPetName, concurrentPetName]);

  if (error) throw new Error('Could not inspect stale invite test pets.');

  for (const pet of data) await deletePet(client, pet.id);
}

async function createPet(client, name) {
  const { data, error } = await client.rpc('create_pet', {
    pet_description: temporaryPetDescription,
    pet_gender: 'unknown',
    pet_name: name,
    pet_species: 'other',
  });
  if (error || !data?.id) {
    throw new Error(`Could not create an invite lifecycle test pet.`);
  }
  return data.id;
}

async function createInvite(client, petId) {
  const { data, error } = await client.rpc('create_pet_invite', {
    target_pet_id: petId,
  });
  const invite = data?.[0];
  if (
    error ||
    !invite ||
    !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u.test(invite.invite_code)
  ) {
    throw new Error(`Could not create an invite lifecycle test invite.`);
  }
  return invite;
}

async function readInviteMetadata(client, inviteId) {
  const { data, error } = await client
    .from('pet_invites')
    .select('expires_at, max_uses, used_count')
    .eq('id', inviteId)
    .single();
  if (error || !data) {
    throw new Error('Could not read safe invite metadata.');
  }
  return data;
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
  if (
    new Set(
      [ownerEmail, memberEmail, strangerEmail].map((email) =>
        email.toLowerCase(),
      ),
    ).size !== 3
  ) {
    throw new Error('Owner, Member, and Stranger must be different accounts.');
  }

  const ownerClient = createTestClient(url, publishableKey);
  const memberClient = createTestClient(url, publishableKey);
  const strangerClient = createTestClient(url, publishableKey);
  const petIds = new Set();
  const terminal = createInterface({ input, output });

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

    const expiredPetId = await createPet(ownerClient, expiredPetName);
    petIds.add(expiredPetId);
    const concurrentPetId = await createPet(ownerClient, concurrentPetName);
    petIds.add(concurrentPetId);

    const expiredInvite = await createInvite(ownerClient, expiredPetId);
    const concurrentInvite = await createInvite(ownerClient, concurrentPetId);

    console.log('READY: Temporary invite lifecycle fixtures created.');
    console.log(
      'Run the supplied test-fixture update in Supabase SQL Editor, then return here.',
    );
    await terminal.question('Press Enter only after the SQL query succeeds: ');

    const expiredMetadata = await readInviteMetadata(
      ownerClient,
      expiredInvite.invite_id,
    );
    const concurrentMetadata = await readInviteMetadata(
      ownerClient,
      concurrentInvite.invite_id,
    );
    if (
      new Date(expiredMetadata.expires_at).getTime() >= Date.now() ||
      concurrentMetadata.max_uses !== 1 ||
      concurrentMetadata.used_count !== 0
    ) {
      throw new Error(
        'Fixture metadata was not updated. Re-run the SQL query before continuing.',
      );
    }

    const { error: expiredPreviewError } = await memberClient.rpc(
      'preview_pet_invite',
      { invite_code: expiredInvite.invite_code },
    );
    const { error: expiredJoinError } = await memberClient.rpc(
      'join_pet_with_invite',
      { invite_code: expiredInvite.invite_code },
    );
    if (!expiredPreviewError || !expiredJoinError) {
      throw new Error('Expired invite unexpectedly previewed or joined.');
    }

    const [memberAttempt, strangerAttempt] = await Promise.all([
      memberClient.rpc('join_pet_with_invite', {
        invite_code: concurrentInvite.invite_code,
      }),
      strangerClient.rpc('join_pet_with_invite', {
        invite_code: concurrentInvite.invite_code,
      }),
    ]);
    const attempts = [
      { client: memberClient, result: memberAttempt },
      { client: strangerClient, result: strangerAttempt },
    ];
    const winners = attempts.filter(
      ({ result }) =>
        !result.error && result.data?.[0]?.join_status === 'joined',
    );
    const losers = attempts.filter(({ result }) => result.error);
    if (winners.length !== 1 || losers.length !== 1) {
      throw new Error('Concurrent last-slot join did not produce one winner.');
    }

    const finalMetadata = await readInviteMetadata(
      ownerClient,
      concurrentInvite.invite_id,
    );
    const { data: memberships, error: membershipsError } =
      await ownerClient.rpc('get_pet_members', {
        target_pet_id: concurrentPetId,
      });
    if (
      finalMetadata.max_uses !== 1 ||
      finalMetadata.used_count !== 1 ||
      membershipsError ||
      memberships?.length !== 2
    ) {
      throw new Error('Max-use invite exceeded its membership limit.');
    }

    const winnerClient = winners[0].client;
    const loserClient = losers[0].client;
    const { data: repeatData, error: repeatError } = await winnerClient.rpc(
      'join_pet_with_invite',
      { invite_code: concurrentInvite.invite_code },
    );
    const { error: fullPreviewError } = await loserClient.rpc(
      'preview_pet_invite',
      { invite_code: concurrentInvite.invite_code },
    );
    const { error: fullJoinError } = await loserClient.rpc(
      'join_pet_with_invite',
      { invite_code: concurrentInvite.invite_code },
    );
    if (
      repeatError ||
      repeatData?.[0]?.join_status !== 'already_member' ||
      !fullPreviewError ||
      !fullJoinError
    ) {
      throw new Error('Fully used invite did not preserve safe idempotency.');
    }

    await deletePet(ownerClient, expiredPetId);
    petIds.delete(expiredPetId);
    await deletePet(ownerClient, concurrentPetId);
    petIds.delete(concurrentPetId);

    console.log('PASS: Expired invite cannot preview or join.');
    console.log('PASS: Fully used invite rejects a non-member.');
    console.log('PASS: Existing member reuse remains idempotent at capacity.');
    console.log('PASS: Concurrent last-slot joins admit exactly one member.');
    console.log('PASS: Invite lifecycle fixtures are deleted.');
  } finally {
    terminal.close();
    for (const petId of petIds) {
      await ignoreCleanupError(() => deletePet(ownerClient, petId));
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

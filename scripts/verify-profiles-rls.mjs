import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

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

async function requireOwnProfile(client, userId, label) {
  const { data, error } = await client
    .from('profiles')
    .select('id, display_name')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error(`${label} could not read its own profile.`);
  }

  return data;
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

  try {
    const userA = await signIn(clientA, userAEmail, userAPassword, 'User A');
    const userB = await signIn(clientB, userBEmail, userBPassword, 'User B');

    if (userA.id === userB.id) {
      throw new Error('User A and User B resolved to the same identity.');
    }

    await requireOwnProfile(clientA, userA.id, 'User A');
    const profileB = await requireOwnProfile(clientB, userB.id, 'User B');

    const { data: crossRead, error: crossReadError } = await clientA
      .from('profiles')
      .select('id')
      .eq('id', userB.id);

    if (crossReadError) {
      throw new Error(`Cross-user read test failed (${crossReadError.code}).`);
    }

    if (crossRead.length !== 0) {
      throw new Error('RLS BREACH: User A could read User B profile.');
    }

    const { data: crossUpdate, error: crossUpdateError } = await clientA
      .from('profiles')
      .update({ display_name: profileB.display_name })
      .eq('id', userB.id)
      .select('id');

    if (crossUpdateError) {
      throw new Error(
        `Cross-user update test failed (${crossUpdateError.code}).`,
      );
    }

    if (crossUpdate.length !== 0) {
      throw new Error('RLS BREACH: User A could update User B profile.');
    }

    console.log('PASS: User A can read its own profile.');
    console.log('PASS: User B can read its own profile.');
    console.log('PASS: User A cannot read User B profile.');
    console.log('PASS: User A cannot update User B profile.');
  } finally {
    await Promise.allSettled([
      clientA.auth.signOut({ scope: 'local' }),
      clientB.auth.signOut({ scope: 'local' }),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'RLS test failed.');
  process.exitCode = 1;
});

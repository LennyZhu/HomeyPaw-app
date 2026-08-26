import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const fixtureName = 'Phase 6 Pagination Test Pet';
const fixtureDescription = 'Temporary 65-row Care History UI fixture';

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
    key: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    url: values.get('EXPO_PUBLIC_SUPABASE_URL'),
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing temporary test credential: ${name}`);
  return value;
}

async function deletePet(supabase, petId) {
  const { data, error } = await supabase.functions.invoke('delete-pet', {
    body: { petId },
  });
  if (error || !data?.deleted) {
    throw new Error('Could not clean an older pagination fixture.');
  }
}

async function main() {
  const { key, url } = readPublicConfig();
  if (!key || !url)
    throw new Error('Public Supabase configuration is missing.');
  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: required('PAWDAY_FAMILY_OWNER_EMAIL'),
    password: required('PAWDAY_FAMILY_OWNER_PASSWORD'),
  });
  if (signInError)
    throw new Error(`Owner sign-in failed (${signInError.code}).`);

  try {
    const { data: stale, error: staleError } = await supabase
      .from('pets')
      .select('id')
      .eq('name', fixtureName)
      .eq('description', fixtureDescription);
    if (staleError) throw staleError;
    for (const pet of stale) await deletePet(supabase, pet.id);

    const { data: pet, error: petError } = await supabase.rpc('create_pet', {
      pet_description: fixtureDescription,
      pet_gender: 'unknown',
      pet_name: fixtureName,
      pet_species: 'other',
    });
    if (petError || !pet)
      throw new Error(`Pet creation failed (${petError?.code}).`);

    const baseTime = Date.now() - 10 * 60_000;
    for (let index = 0; index < 65; index += 1) {
      const { error } = await supabase.rpc('create_care_log', {
        care_duration_minutes: index % 6 === 1 ? 15 + (index % 4) * 15 : null,
        care_id: randomUUID(),
        care_kind: ['feeding', 'walk', 'medicine', 'bath', 'grooming', 'other'][
          index % 6
        ],
        care_note: `Pagination Care ${String(index + 1).padStart(2, '0')}`,
        care_occurred_at: new Date(baseTime - index * 60_000).toISOString(),
        care_time_zone: 'Asia/Hong_Kong',
        target_pet_id: pet.id,
      });
      if (error) {
        await deletePet(supabase, pet.id);
        throw new Error(`Care fixture ${index + 1} failed (${error.code}).`);
      }
    }

    console.log('READY: Phase 6 Pagination Test Pet has 65 Care Logs.');
    console.log(
      'Open the App, refresh My Pets, and verify Care History pagination.',
    );
  } finally {
    await supabase.auth.signOut();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

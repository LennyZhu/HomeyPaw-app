import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const fixtureFile = new URL(
  '../.phase7-account-delete-fixture.json',
  import.meta.url,
);
const fixtureName = 'HomeyPaw Phase 7 Account Delete Pet';
const fixtureDescription = 'Temporary Phase 7 account lifecycle verification';

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

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(supabase, email, password, label) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(`${label} sign-in failed (${error?.code ?? 'no_user'}).`);
  }
}

async function deletePet(supabase, petId) {
  const { data, error } = await supabase.functions.invoke('delete-pet', {
    body: { petId },
  });
  if (error || !data?.deleted) throw new Error('Fixture cleanup failed.');
}

async function main() {
  const { key, url } = readPublicConfig();
  if (!key || !url)
    throw new Error('Public Supabase configuration is missing.');
  const ownerClient = client(url, key);
  const memberClient = client(url, key);
  await signIn(
    ownerClient,
    required('PAWDAY_PHASE7_OWNER_EMAIL'),
    required('PAWDAY_PHASE7_OWNER_PASSWORD'),
    'Owner',
  );
  await signIn(
    memberClient,
    required('PAWDAY_PHASE7_DELETE_MEMBER_EMAIL'),
    required('PAWDAY_PHASE7_DELETE_MEMBER_PASSWORD'),
    'Delete-test Member',
  );
  let petId = null;

  try {
    const { data: stalePets, error: staleError } = await ownerClient
      .from('pets')
      .select('id')
      .eq('name', fixtureName)
      .eq('description', fixtureDescription);
    if (staleError) throw staleError;
    for (const stale of stalePets ?? []) await deletePet(ownerClient, stale.id);

    const { data: pet, error: petError } = await ownerClient.rpc('create_pet', {
      pet_description: fixtureDescription,
      pet_gender: 'unknown',
      pet_name: fixtureName,
      pet_species: 'other',
    });
    if (petError || !pet) throw new Error('Pet fixture creation failed.');
    petId = pet.id;

    const { data: invites, error: inviteError } = await ownerClient.rpc(
      'create_pet_invite',
      { target_pet_id: petId },
    );
    if (inviteError || !invites?.[0])
      throw new Error('Invite creation failed.');
    const { error: joinError } = await memberClient.rpc(
      'join_pet_with_invite',
      {
        invite_code: invites[0].invite_code,
      },
    );
    if (joinError) throw new Error('Member join failed.');

    const scheduledAt = new Date(Date.now() + 2 * 60_000).toISOString();
    const taskId = randomUUID();
    const { data: task, error: taskError } = await memberClient.rpc(
      'create_care_task',
      {
        target_pet_id: petId,
        task_care_type: 'medicine',
        task_id: taskId,
        task_local_time: null,
        task_month_day: null,
        task_note: 'Account lifecycle verification',
        task_schedule_type: 'once',
        task_scheduled_at: scheduledAt,
        task_starts_on: null,
        task_time_zone: 'Asia/Hong_Kong',
        task_title: 'Preserved family medicine reminder',
        task_week_day: null,
      },
    );
    if (taskError || !task) throw new Error('Member task creation failed.');

    const { data: completion, error: completionError } = await memberClient.rpc(
      'complete_care_task',
      {
        care_log_id: randomUUID(),
        completion_duration_minutes: null,
        completion_id: randomUUID(),
        completion_note: null,
        occurrence_scheduled_for: scheduledAt,
        target_task_id: taskId,
      },
    );
    if (completionError || !completion?.[0]) {
      throw new Error('Member completion fixture failed.');
    }

    writeFileSync(
      fixtureFile,
      `${JSON.stringify(
        {
          careLogId: completion[0].result_care_log_id,
          completionId: completion[0].result_completion_id,
          petId,
          taskId,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    petId = null;
    console.log('READY: Phase 7 account-delete fixtures created.');
    console.log(
      'Permanently delete only the designated Member account in the App, then run the verification script.',
    );
  } finally {
    if (petId) await deletePet(ownerClient, petId).catch(() => undefined);
    await Promise.all([
      ownerClient.auth.signOut(),
      memberClient.auth.signOut(),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

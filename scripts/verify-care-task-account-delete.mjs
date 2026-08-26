import { readFileSync, unlinkSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const fixtureFile = new URL(
  '../.phase7-account-delete-fixture.json',
  import.meta.url,
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
    key: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    url: values.get('EXPO_PUBLIC_SUPABASE_URL'),
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing temporary test credential: ${name}`);
  return value;
}

async function main() {
  const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  const { key, url } = readPublicConfig();
  if (!key || !url)
    throw new Error('Public Supabase configuration is missing.');
  const ownerClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email: required('PAWDAY_PHASE7_OWNER_EMAIL'),
    password: required('PAWDAY_PHASE7_OWNER_PASSWORD'),
  });
  if (signInError) throw new Error('Owner sign-in failed.');

  try {
    const [taskResult, completionResult, careLogResult, petResult] =
      await Promise.all([
        ownerClient
          .from('care_tasks')
          .select('id, created_by')
          .eq('id', fixture.taskId)
          .maybeSingle(),
        ownerClient
          .from('care_task_completions')
          .select('id')
          .eq('id', fixture.completionId),
        ownerClient.from('care_logs').select('id').eq('id', fixture.careLogId),
        ownerClient.from('pets').select('id').eq('id', fixture.petId),
      ]);
    if (
      taskResult.error ||
      completionResult.error ||
      careLogResult.error ||
      petResult.error ||
      !taskResult.data ||
      taskResult.data.created_by !== null ||
      completionResult.data.length !== 0 ||
      careLogResult.data.length !== 0 ||
      petResult.data.length !== 1
    ) {
      throw new Error('Account-delete lifecycle verification failed.');
    }

    const { data: deactivated, error: deactivateError } = await ownerClient.rpc(
      'deactivate_care_task',
      { target_task_id: fixture.taskId },
    );
    if (deactivateError || deactivated !== 'deactivated') {
      throw new Error('Owner could not manage the preserved task.');
    }

    const { data: deleted, error: deleteError } =
      await ownerClient.functions.invoke('delete-pet', {
        body: { petId: fixture.petId },
      });
    if (deleteError || !deleted?.deleted)
      throw new Error('Fixture cleanup failed.');
    unlinkSync(fixtureFile);
    console.log('PASS: Task creator account deletion preserves family task.');
    console.log('PASS: Deleted creator is null and Owner can manage the task.');
    console.log('PASS: Creator completion and linked Care Log are deleted.');
    console.log('PASS: Account lifecycle fixtures are deleted.');
  } finally {
    await ownerClient.auth.signOut();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

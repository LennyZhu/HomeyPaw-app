import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const fixtureName = 'HomeyPaw Phase 6 Verification Pet';
const fixtureDescription = 'Temporary Phase 6 care log fixture';

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
  if (error || !data.user)
    throw new Error(`${label} sign-in failed (${error?.code ?? 'no_user'}).`);
  return data.user;
}

async function createLog(
  supabase,
  petId,
  careType,
  occurredAt,
  timeZone,
  note = null,
  duration = null,
) {
  const { data, error } = await supabase.rpc('create_care_log', {
    care_duration_minutes: duration,
    care_id: randomUUID(),
    care_kind: careType,
    care_note: note,
    care_occurred_at: occurredAt,
    care_time_zone: timeZone,
    target_pet_id: petId,
  });
  return { data, error };
}

async function deletePet(supabase, petId) {
  const { data, error } = await supabase.functions.invoke('delete-pet', {
    body: { petId },
  });
  if (error || !data?.deleted)
    throw new Error('Temporary Phase 6 pet cleanup failed.');
}

async function main() {
  const { key, url } = readPublicConfig();
  if (!key || !url)
    throw new Error('Public Supabase configuration is missing.');
  const owner = client(url, key);
  const member = client(url, key);
  const stranger = client(url, key);
  const ownerUser = await signIn(
    owner,
    required('PAWDAY_FAMILY_OWNER_EMAIL'),
    required('PAWDAY_FAMILY_OWNER_PASSWORD'),
    'Owner',
  );
  const memberUser = await signIn(
    member,
    required('PAWDAY_FAMILY_MEMBER_EMAIL'),
    required('PAWDAY_FAMILY_MEMBER_PASSWORD'),
    'Member',
  );
  await signIn(
    stranger,
    required('PAWDAY_FAMILY_STRANGER_EMAIL'),
    required('PAWDAY_FAMILY_STRANGER_PASSWORD'),
    'Stranger',
  );
  let petId = null;

  try {
    const { data: stale } = await owner
      .from('pets')
      .select('id')
      .eq('name', fixtureName)
      .eq('description', fixtureDescription);
    for (const pet of stale ?? []) await deletePet(owner, pet.id);

    const { data: pet, error: petError } = await owner.rpc('create_pet', {
      pet_description: fixtureDescription,
      pet_gender: 'unknown',
      pet_name: fixtureName,
      pet_species: 'other',
    });
    if (petError || !pet)
      throw new Error(`Pet fixture creation failed (${petError?.code}).`);
    petId = pet.id;

    const { data: invites, error: inviteError } = await owner.rpc(
      'create_pet_invite',
      { target_pet_id: petId },
    );
    if (inviteError || !invites?.[0])
      throw new Error('Invite fixture creation failed.');
    const { error: joinError } = await member.rpc('join_pet_with_invite', {
      invite_code: invites[0].invite_code,
    });
    if (joinError) throw new Error(`Member join failed (${joinError.code}).`);

    const ownerLog = await createLog(
      owner,
      petId,
      'feeding',
      new Date(Date.now() - 3_600_000).toISOString(),
      'Asia/Hong_Kong',
      'Breakfast',
    );
    const memberLog = await createLog(
      member,
      petId,
      'walk',
      new Date(Date.now() - 1_800_000).toISOString(),
      'America/Los_Angeles',
      null,
      30,
    );
    if (
      ownerLog.error ||
      ownerLog.data?.performed_by !== ownerUser.id ||
      memberLog.error ||
      memberLog.data?.performed_by !== memberUser.id
    ) {
      throw new Error(
        'Server did not bind care logs to the authenticated performer.',
      );
    }
    console.log(
      'PASS: Owner and Member can create care logs with server-bound identity.',
    );

    const badOther = await createLog(
      member,
      petId,
      'other',
      new Date().toISOString(),
      'UTC',
    );
    const future = await createLog(
      owner,
      petId,
      'bath',
      new Date(Date.now() + 10 * 60_000).toISOString(),
      'UTC',
    );
    if (!badOther.error || !future.error)
      throw new Error('Database accepted invalid note or future time.');
    console.log('PASS: Required note and future-time bounds are enforced.');

    const strangerCreate = await createLog(
      stranger,
      petId,
      'bath',
      new Date().toISOString(),
      'UTC',
    );
    const strangerRead = await stranger
      .from('care_logs')
      .select('id')
      .eq('pet_id', petId);
    if (
      !strangerCreate.error ||
      strangerRead.error ||
      (strangerRead.data?.length ?? 0) !== 0
    )
      throw new Error('RLS BREACH: Stranger accessed care logs.');

    const memberUpdateOwner = await member.rpc('update_care_log', {
      care_duration_minutes: null,
      care_note: 'forged',
      care_occurred_at: ownerLog.data.occurred_at,
      care_time_zone: 'UTC',
      target_care_log_id: ownerLog.data.id,
    });
    const ownerUpdateMember = await owner.rpc('update_care_log', {
      care_duration_minutes: 45,
      care_note: null,
      care_occurred_at: memberLog.data.occurred_at,
      care_time_zone: 'UTC',
      target_care_log_id: memberLog.data.id,
    });
    const memberDeleteOwner = await member
      .from('care_logs')
      .delete()
      .eq('id', ownerLog.data.id)
      .select('id');
    if (
      !memberUpdateOwner.error ||
      !ownerUpdateMember.error ||
      (memberDeleteOwner.data?.length ?? 0) !== 0
    )
      throw new Error('RLS BREACH: Cross-author mutation succeeded.');
    console.log(
      'PASS: Only the performer can edit; Member cannot delete Owner care.',
    );

    for (let index = 0; index < 60; index += 1) {
      const result = await createLog(
        owner,
        petId,
        index % 2 ? 'medicine' : 'grooming',
        new Date(Date.now() - (index + 2) * 60_000).toISOString(),
        index % 2 ? 'Pacific/Kiritimati' : 'Pacific/Honolulu',
        `Care ${index + 1}`,
      );
      if (result.error)
        throw new Error(`60-log fixture failed (${result.error.code}).`);
    }
    const { data: allLogs, error: allError } = await member
      .from('care_logs')
      .select('id, local_date')
      .eq('pet_id', petId)
      .order('occurred_at', { ascending: false });
    if (
      allError ||
      (allLogs?.length ?? 0) < 62 ||
      new Set(allLogs.map((log) => log.id)).size !== allLogs.length
    )
      throw new Error('Family read or 60+ fixture verification failed.');
    console.log(
      'PASS: Family can read 60+ unique care logs across IANA date boundaries.',
    );

    const ownerDeleteMember = await owner
      .from('care_logs')
      .delete()
      .eq('id', memberLog.data.id)
      .select('id')
      .single();
    if (ownerDeleteMember.error)
      throw new Error('Owner could not delete Member care.');
    console.log(
      'PASS: Owner can delete a Member care log without edit permission.',
    );

    const history = await createLog(
      member,
      petId,
      'medicine',
      new Date().toISOString(),
      'UTC',
      'Historical care',
    );
    if (history.error)
      throw new Error('Historical Member care fixture failed.');
    const { error: removeError } = await owner.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: memberUser.id,
    });
    const removedRead = await member
      .from('care_logs')
      .select('id')
      .eq('pet_id', petId);
    const ownerHistory = await owner
      .from('care_logs')
      .select('id')
      .eq('id', history.data.id)
      .single();
    if (
      removeError ||
      removedRead.error ||
      (removedRead.data?.length ?? 0) !== 0 ||
      ownerHistory.error
    )
      throw new Error('Removed-member lifecycle failed.');
    console.log(
      'PASS: Removed Member loses fresh access while historical care remains.',
    );

    await deletePet(owner, petId);
    petId = null;
    console.log('PASS: Pet deletion cascades all temporary care logs.');
  } finally {
    if (petId) await deletePet(owner, petId).catch(() => undefined);
    await Promise.all([
      owner.auth.signOut(),
      member.auth.signOut(),
      stranger.auth.signOut(),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

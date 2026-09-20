import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
const container =
  process.env.SUPABASE_LOCAL_DB_CONTAINER?.trim() ?? 'supabase_db_pawday';

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Local Supabase URL, anon key, and service-role key are required.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: Phase C2 verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C2 requires a local DB container.');
}

const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260920113000_multi_pet_family_phase_c2_membership_invite_canonicalization.sql',
  ),
  'utf8',
);
const familyQueries = readFileSync(
  join(root, 'src/features/family/family-queries.ts'),
  'utf8',
);
const users = [];
const createdFamilies = new Set();
let failureTriggerInstalled = false;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function client() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sql(statement) {
  return execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
      '-c',
      statement,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function expectSql(label, statement) {
  const result = sql(statement);
  expect(result === 't', `${label} (received ${JSON.stringify(result)})`);
  console.log(`PASS: ${label}`);
}

async function allWithin(promises, label, timeoutMs = 15_000) {
  let timeout;
  try {
    return await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out; possible deadlock.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function createUser(label) {
  const email = `phase-c2-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase C2 ${label}`, locale: 'en' },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }

  const userClient = client();
  const signed = await userClient.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    throw signed.error ?? new Error(`Could not sign in ${label}.`);
  }

  const result = { client: userClient, id: created.data.user.id };
  users.push(result);
  return result;
}

async function createPet(owner, label) {
  const created = await owner.client.rpc('create_pet', {
    pet_breed: 'Phase C2 verifier',
    pet_description: 'Local-only multi-Pet Family verification',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (created.error || !created.data?.family_id) {
    throw created.error ?? new Error('create_pet failed.');
  }
  createdFamilies.add(created.data.family_id);
  return created.data;
}

function addSecondPet(familyId, ownerId, firstPetCreatedAt, label) {
  const petId = randomUUID();
  sql(`
    insert into public.pets (
      id, name, species, breed, gender, description, family_id, created_at
    ) values (
      '${petId}'::uuid,
      '${label.replaceAll("'", "''")}',
      'other',
      'Phase C2 verifier',
      'unknown',
      'Local-only second Pet fixture',
      '${familyId}'::uuid,
      '${firstPetCreatedAt}'::timestamptz + interval '1 second'
    );
    insert into public.pet_members (pet_id, user_id, role, created_at)
    select '${petId}'::uuid, member.user_id, member.role, member.created_at
    from public.family_members as member
    where member.family_id = '${familyId}'::uuid
      and member.user_id = '${ownerId}'::uuid;
  `);
  return petId;
}

function addCanonicalMember(familyId, userId, role = 'member') {
  sql(`
    with inserted as (
      insert into public.family_members (family_id, user_id, role, created_at)
      values (
        '${familyId}'::uuid,
        '${userId}'::uuid,
        '${role}'::public.pet_member_role,
        clock_timestamp()
      )
      returning user_id, role, created_at
    )
    insert into public.pet_members (pet_id, user_id, role, created_at)
    select pet.id, inserted.user_id, inserted.role, inserted.created_at
    from public.pets as pet
    cross join inserted
    where pet.family_id = '${familyId}'::uuid
    order by pet.id;
  `);
}

function backdateFamilyInvites(familyId) {
  sql(`
    update public.family_invites
    set created_at = created_at - interval '1 minute'
    where family_id = '${familyId}'::uuid;
    update public.pet_invites as pet_invite
    set created_at = family_invite.created_at
    from public.family_invites as family_invite
    where family_invite.id = pet_invite.id
      and family_invite.family_id = '${familyId}'::uuid;
  `);
}

async function createFamilyInvite(owner, familyId) {
  const result = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  if (result.error || !result.data?.[0]) {
    throw result.error ?? new Error('create_family_invite failed.');
  }
  return result.data[0];
}

function installPetMirrorFailure(userId, petId) {
  sql(`
    create or replace function private.phase_c2_inject_pet_mirror_failure()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      if new.user_id = '${userId}'::uuid
        and new.pet_id = '${petId}'::uuid
      then
        raise exception 'phase_c2_injected_failure' using errcode = 'P0001';
      end if;
      return new;
    end;
    $$;
    revoke execute on function private.phase_c2_inject_pet_mirror_failure()
      from public, anon, authenticated;
    create trigger phase_c2_inject_pet_mirror_failure
    before insert on public.pet_members
    for each row execute function private.phase_c2_inject_pet_mirror_failure();
  `);
  failureTriggerInstalled = true;
}

function removeFailureTrigger() {
  sql(`
    drop trigger if exists phase_c2_inject_pet_mirror_failure
      on public.pet_members;
    drop function if exists private.phase_c2_inject_pet_mirror_failure();
  `);
  failureTriggerInstalled = false;
}

function expectFamilyInvariant(familyId, label) {
  expectSql(
    label,
    `select
       (
         select count(*) = 1
         from public.family_members
         where family_id = '${familyId}'::uuid
           and role = 'owner'
       )
       and not exists (
         select 1
         from public.pets as pet
         cross join public.family_members as family_member
         where pet.family_id = '${familyId}'::uuid
           and family_member.family_id = pet.family_id
           and not exists (
             select 1
             from public.pet_members as pet_member
             where pet_member.pet_id = pet.id
               and pet_member.user_id = family_member.user_id
               and pet_member.role = family_member.role
               and pet_member.created_at = family_member.created_at
           )
       )
       and not exists (
         select 1
         from public.pet_members as pet_member
         join public.pets as pet on pet.id = pet_member.pet_id
         where pet.family_id = '${familyId}'::uuid
           and not exists (
             select 1
             from public.family_members as family_member
             where family_member.family_id = pet.family_id
               and family_member.user_id = pet_member.user_id
               and family_member.role = pet_member.role
               and family_member.created_at = pet_member.created_at
           )
       )
       and not exists (
         select 1
         from public.family_invites as family_invite
         where family_invite.family_id = '${familyId}'::uuid
           and (
             select count(*)
             from public.pet_invites as pet_invite
             join public.pets as pet on pet.id = pet_invite.pet_id
             where pet_invite.id = family_invite.id
               and pet.family_id = family_invite.family_id
               and pet_invite.invited_by = family_invite.invited_by
               and pet_invite.code_hash = family_invite.code_hash
               and pet_invite.expires_at = family_invite.expires_at
               and pet_invite.max_uses = family_invite.max_uses
               and pet_invite.used_count = family_invite.used_count
               and pet_invite.revoked_at is not distinct from family_invite.revoked_at
               and pet_invite.created_at = family_invite.created_at
               and pet_invite.pet_id = (
                 select anchor.id
                 from public.pets as anchor
                 where anchor.family_id = family_invite.family_id
                 order by anchor.created_at, anchor.id
                 limit 1
               )
           ) <> 1
       )
       and not exists (
         select 1
         from public.pet_invites as pet_invite
         join public.pets as pet on pet.id = pet_invite.pet_id
         where pet.family_id = '${familyId}'::uuid
           and not exists (
             select 1
             from public.family_invites as family_invite
             where family_invite.id = pet_invite.id
               and family_invite.family_id = pet.family_id
           )
       );`,
  );
}

async function getVersion(userClient, petId) {
  const result = await userClient.rpc('get_pet_chat_channel_version', {
    target_pet_id: petId,
  });
  if (result.error) throw result.error;
  return Number(result.data);
}

function localSchedule(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:00`,
  };
}

async function createClaimableShift(owner, petId) {
  const schedule = localSchedule(new Date(), 'Asia/Hong_Kong');
  const taskId = randomUUID();
  const task = await owner.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'feeding',
    task_id: taskId,
    task_local_time: schedule.time,
    task_month_day: null,
    task_note: null,
    task_schedule_type: 'daily',
    task_scheduled_at: null,
    task_starts_on: schedule.date,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: `Phase C2 claim race ${randomUUID().slice(0, 6)}`,
    task_week_day: null,
  });
  if (task.error) throw task.error;

  const occurrences = await owner.client.rpc('get_care_task_occurrences', {
    target_pet_id: petId,
    window_end: new Date(Date.now() + 5 * 60_000).toISOString(),
    window_start: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
  const occurrence = occurrences.data?.find((item) => item.task_id === taskId);
  if (occurrences.error || !occurrence) {
    throw occurrences.error ?? new Error('Schedule occurrence missing.');
  }

  const shiftId = randomUUID();
  const shift = await owner.client.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: schedule.date,
    shift_note: null,
    target_assignee_user_id: null,
    target_pet_id: petId,
    task_items: [
      {
        care_task_id: taskId,
        source_scheduled_for: occurrence.scheduled_for,
      },
    ],
  });
  if (shift.error) throw shift.error;
  return shiftId;
}

async function cleanup() {
  if (failureTriggerInstalled) removeFailureTrigger();
  for (const familyId of createdFamilies) {
    sql(`delete from public.pets where family_id = '${familyId}'::uuid;`);
    sql(`delete from public.families where id = '${familyId}'::uuid;`);
  }
  for (const user of users.reverse()) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

for (const requiredSql of [
  'create or replace function public.get_family_members(target_family_id uuid)',
  'create or replace function public.create_family_invite(target_family_id uuid)',
  'create or replace function public.revoke_family_invite(target_family_id uuid)',
  'create or replace function public.preview_family_invite(invite_code text)',
  'create or replace function public.join_family_with_invite(invite_code text)',
  'create or replace function public.remove_family_member(',
  'select * from public.get_family_members(target_family_id)',
  'select * from public.create_family_invite(target_family_id)',
  'public.join_family_with_invite(invite_code)',
  'public.remove_family_member(target_family_id, target_user_id)',
  'order by pet.created_at, pet.id',
  'order by membership.pet_id',
]) {
  expect(
    migration.includes(requiredSql),
    `C2 migration is missing: ${requiredSql}`,
  );
}
for (const forbiddenSql of [
  'alter table public.chat_messages',
  'alter table public.care_shifts',
  'create_family_pet',
  'add_pet_to_family',
]) {
  expect(
    !migration.includes(forbiddenSql),
    `C2 changed forbidden scope: ${forbiddenSql}`,
  );
}
expect(
  familyQueries.includes(".from('family_members')"),
  'Family query left canonical membership.',
);
expect(
  familyQueries.includes(".from('family_invites')"),
  'Client invite metadata is not Family-scoped.',
);
expect(
  familyQueries.includes("'join_family_with_invite'"),
  'Join screen data path did not switch to the Family RPC.',
);
expect(
  familyQueries.includes("'remove_family_member'"),
  'Removal data path did not switch to the Family RPC.',
);

expectSql(
  'Family and legacy RPC signatures coexist.',
  `select
     to_regprocedure('public.get_family_members(uuid)') is not null
     and to_regprocedure('public.create_family_invite(uuid)') is not null
     and to_regprocedure('public.revoke_family_invite(uuid)') is not null
     and to_regprocedure('public.preview_family_invite(text)') is not null
     and to_regprocedure('public.join_family_with_invite(text)') is not null
     and to_regprocedure('public.remove_family_member(uuid,uuid)') is not null
     and to_regprocedure('public.get_pet_members(uuid)') is not null
     and to_regprocedure('public.create_pet_invite(uuid)') is not null
     and to_regprocedure('public.revoke_pet_invite(uuid)') is not null
     and to_regprocedure('public.preview_pet_invite(text)') is not null
     and to_regprocedure('public.join_pet_with_invite(text)') is not null
     and to_regprocedure('public.remove_pet_member(uuid,uuid)') is not null;`,
);

const owner = await createUser('owner');
const member = await createUser('member');
const viewer = await createUser('viewer');
const failingJoiner = await createUser('failing-joiner');
const revokeRacer = await createUser('revoke-racer');

try {
  const petA = await createPet(owner, 'Phase C2 Pet A');
  const petBId = addSecondPet(
    petA.family_id,
    owner.id,
    petA.created_at,
    'Phase C2 Pet B',
  );

  expectFamilyInvariant(
    petA.family_id,
    'Owner is identical in canonical membership and both Pet mirrors.',
  );

  const anonymous = client();
  const [anonymousMembers, strangerMembers, strangerCreate, strangerRevoke] =
    await Promise.all([
      anonymous.rpc('get_family_members', {
        target_family_id: petA.family_id,
      }),
      revokeRacer.client.rpc('get_family_members', {
        target_family_id: petA.family_id,
      }),
      revokeRacer.client.rpc('create_family_invite', {
        target_family_id: petA.family_id,
      }),
      revokeRacer.client.rpc('revoke_family_invite', {
        target_family_id: petA.family_id,
      }),
    ]);
  const inviteHashRead = await owner.client
    .from('family_invites')
    .select('code_hash');
  expect(
    anonymousMembers.error &&
      strangerMembers.error &&
      strangerCreate.error &&
      strangerRevoke.error &&
      inviteHashRead.error,
    'Family RPC permissions or invite hash boundary widened.',
  );
  console.log(
    'PASS: anonymous/Stranger Family access is denied and invite hashes stay private.',
  );

  const firstInvite = await createFamilyInvite(owner, petA.family_id);
  expectSql(
    'Family invite has one exact legacy representation on stable Pet A.',
    `select
       (select count(*) from public.family_invites
        where id = '${firstInvite.invite_id}'::uuid) = 1
       and (select count(*) from public.pet_invites
        where id = '${firstInvite.invite_id}'::uuid
          and pet_id = '${petA.id}'::uuid) = 1;`,
  );

  const [familyPreview, legacyPreview] = await Promise.all([
    member.client.rpc('preview_family_invite', {
      invite_code: firstInvite.invite_code,
    }),
    member.client.rpc('preview_pet_invite', {
      invite_code: firstInvite.invite_code,
    }),
  ]);
  expect(
    !familyPreview.error &&
      familyPreview.data?.[0]?.display_pet_id === petA.id &&
      !legacyPreview.error &&
      legacyPreview.data?.[0]?.pet_name === petA.name,
    'Invite previews did not use the stable display Pet.',
  );

  const joined = await member.client.rpc('join_family_with_invite', {
    invite_code: firstInvite.invite_code,
  });
  expect(
    !joined.error &&
      joined.data?.[0]?.join_status === 'joined' &&
      joined.data[0].joined_family_id === petA.family_id &&
      joined.data[0].display_pet_id === petA.id,
    `Family join failed (${joined.error?.message ?? 'no result'}).`,
  );
  expectFamilyInvariant(
    petA.family_id,
    'Family join mirrored Member role and created_at to Pet A and Pet B.',
  );

  const [familyMembers, petAMembers, petBMembers] = await Promise.all([
    owner.client.rpc('get_family_members', {
      target_family_id: petA.family_id,
    }),
    owner.client.rpc('get_pet_members', { target_pet_id: petA.id }),
    owner.client.rpc('get_pet_members', { target_pet_id: petBId }),
  ]);
  expect(
    !familyMembers.error &&
      !petAMembers.error &&
      !petBMembers.error &&
      JSON.stringify(familyMembers.data) === JSON.stringify(petAMembers.data) &&
      JSON.stringify(petAMembers.data) === JSON.stringify(petBMembers.data),
    'Family and legacy member reads diverged across Pets.',
  );

  const repeatedJoin = await member.client.rpc('join_pet_with_invite', {
    invite_code: firstInvite.invite_code,
  });
  expect(
    !repeatedJoin.error &&
      repeatedJoin.data?.[0]?.join_status === 'already_member',
    'Repeated legacy join was not idempotent.',
  );
  expectSql(
    'Repeated join did not increment invite usage.',
    `select used_count = 1 from public.family_invites
     where id = '${firstInvite.invite_id}'::uuid;`,
  );

  addCanonicalMember(petA.family_id, viewer.id, 'viewer');
  expectFamilyInvariant(
    petA.family_id,
    'Viewer role and created_at are identical across both Pet mirrors.',
  );

  backdateFamilyInvites(petA.family_id);
  const replacement = await owner.client.rpc('create_pet_invite', {
    target_pet_id: petBId,
  });
  expect(
    !replacement.error && replacement.data?.[0],
    'Legacy Pet B invite wrapper failed.',
  );
  const replacementInvite = replacement.data[0];
  expectSql(
    'Invite replacement kept one active Family invite and anchor Pet A representation.',
    `select
       (select count(*) from public.family_invites
        where family_id = '${petA.family_id}'::uuid and revoked_at is null) = 1
       and (select count(*) from public.pet_invites as invite
        join public.pets as pet on pet.id = invite.pet_id
        where pet.family_id = '${petA.family_id}'::uuid
          and invite.revoked_at is null) = 1
       and exists (
         select 1 from public.pet_invites
         where id = '${replacementInvite.invite_id}'::uuid
           and pet_id = '${petA.id}'::uuid
       )
       and exists (
         select 1 from public.family_invites
         where id = '${firstInvite.invite_id}'::uuid
           and revoked_at is not null
       );`,
  );

  const revoked = await owner.client.rpc('revoke_pet_invite', {
    target_pet_id: petBId,
  });
  expect(
    !revoked.error && revoked.data === true,
    'Legacy revoke wrapper failed.',
  );
  expectFamilyInvariant(
    petA.family_id,
    'Invite revoke kept canonical and legacy state identical.',
  );

  backdateFamilyInvites(petA.family_id);
  const failureInvite = await createFamilyInvite(owner, petA.family_id);
  const versionsBeforeFailure = await Promise.all([
    getVersion(owner.client, petA.id),
    getVersion(owner.client, petBId),
  ]);
  installPetMirrorFailure(failingJoiner.id, petBId);
  const failedJoin = await failingJoiner.client.rpc('join_family_with_invite', {
    invite_code: failureInvite.invite_code,
  });
  removeFailureTrigger();
  expect(failedJoin.error, 'Injected partial Pet mirror failure did not fail.');
  const versionsAfterFailure = await Promise.all([
    getVersion(owner.client, petA.id),
    getVersion(owner.client, petBId),
  ]);
  expect(
    JSON.stringify(versionsBeforeFailure) ===
      JSON.stringify(versionsAfterFailure),
    'Failed multi-Pet join did not roll back Chat rotations.',
  );
  expectSql(
    'Failed join rolled back canonical membership, every Pet mirror, and usage.',
    `select
       not exists (
         select 1 from public.family_members
         where family_id = '${petA.family_id}'::uuid
           and user_id = '${failingJoiner.id}'::uuid
       )
       and not exists (
         select 1 from public.pet_members
         where user_id = '${failingJoiner.id}'::uuid
           and pet_id in ('${petA.id}'::uuid, '${petBId}'::uuid)
       )
       and (select used_count from public.family_invites
         where id = '${failureInvite.invite_id}'::uuid) = 0
       and (select used_count from public.pet_invites
         where id = '${failureInvite.invite_id}'::uuid) = 0;`,
  );

  const versionsBeforeRemoval = await Promise.all([
    getVersion(owner.client, petA.id),
    getVersion(owner.client, petBId),
  ]);
  const [removeRace, sendRace] = await allWithin(
    [
      owner.client.rpc('remove_family_member', {
        target_family_id: petA.family_id,
        target_user_id: member.id,
      }),
      member.client.rpc('send_chat_message', {
        message_body: 'Phase C2 serialized race',
        target_client_message_id: randomUUID(),
        target_pet_id: petA.id,
      }),
    ],
    'remove member vs Chat send',
  );
  expect(
    !removeRace.error && removeRace.data === 'removed',
    `Concurrent Family removal failed (${removeRace.error?.message ?? 'no result'}).`,
  );
  void sendRace;
  const futureSend = await member.client.rpc('send_chat_message', {
    message_body: 'Phase C2 must be rejected',
    target_client_message_id: randomUUID(),
    target_pet_id: petBId,
  });
  expect(futureSend.error, 'Removed Member sent a future Chat message.');
  const versionsAfterRemoval = await Promise.all([
    getVersion(owner.client, petA.id),
    getVersion(owner.client, petBId),
  ]);
  expect(
    versionsAfterRemoval[0] === versionsBeforeRemoval[0] + 1 &&
      versionsAfterRemoval[1] === versionsBeforeRemoval[1] + 1,
    'Family removal did not rotate every Pet Chat channel exactly once.',
  );
  expectFamilyInvariant(
    petA.family_id,
    'Family removal deleted Member from canonical state and both Pet mirrors.',
  );

  const repeatedRemoval = await owner.client.rpc('remove_pet_member', {
    target_pet_id: petBId,
    target_user_id: member.id,
  });
  expect(
    !repeatedRemoval.error && repeatedRemoval.data === 'not_found',
    'Repeated legacy removal was not safely idempotent.',
  );

  backdateFamilyInvites(petA.family_id);
  const scheduleInvite = await createFamilyInvite(owner, petA.family_id);
  const scheduleJoin = await member.client.rpc('join_family_with_invite', {
    invite_code: scheduleInvite.invite_code,
  });
  expect(!scheduleJoin.error, 'Member rejoin for Schedule race failed.');
  const shiftId = await createClaimableShift(owner, petBId);
  const [scheduleRemoval, claimRace] = await allWithin(
    [
      owner.client.rpc('remove_family_member', {
        target_family_id: petA.family_id,
        target_user_id: member.id,
      }),
      member.client.rpc('claim_care_shift', { target_shift_id: shiftId }),
    ],
    'remove member vs Schedule claim',
  );
  expect(
    !scheduleRemoval.error && scheduleRemoval.data === 'removed',
    'Concurrent Schedule removal failed.',
  );
  void claimRace;
  const finalAssignee = sql(
    `select coalesce(assignee_user_id::text, '')
     from public.care_shifts
     where id = '${shiftId}'::uuid;`,
  );
  expect(
    finalAssignee !== member.id,
    `Removed Member retained a Schedule assignment: ${JSON.stringify({
      claimError: claimRace.error?.message ?? null,
      claimResult: claimRace.data?.assignee_user_id ?? null,
      finalAssignee,
      removalError: scheduleRemoval.error?.message ?? null,
      removalResult: scheduleRemoval.data ?? null,
    })}`,
  );
  const futureClaim = await member.client.rpc('claim_care_shift', {
    target_shift_id: shiftId,
  });
  expect(futureClaim.error, 'Removed Member claimed a future Schedule shift.');
  expectFamilyInvariant(
    petA.family_id,
    'Schedule removal race completed without multi-Pet drift or deadlock.',
  );

  backdateFamilyInvites(petA.family_id);
  const revokeRaceInvite = await createFamilyInvite(owner, petA.family_id);
  const [joinRace, revokeRace] = await allWithin(
    [
      revokeRacer.client.rpc('join_family_with_invite', {
        invite_code: revokeRaceInvite.invite_code,
      }),
      owner.client.rpc('revoke_family_invite', {
        target_family_id: petA.family_id,
      }),
    ],
    'invite revoke vs join',
  );
  expect(!revokeRace.error, 'Concurrent Family invite revoke failed.');
  expect(
    Boolean(joinRace.error) || joinRace.data?.[0]?.join_status === 'joined',
    'Revoke-vs-join produced a non-serial result.',
  );
  expectSql(
    'Revoke-vs-join ended with the canonical and legacy invite revoked.',
    `select exists (
       select 1
       from public.family_invites as family_invite
       join public.pet_invites as pet_invite on pet_invite.id = family_invite.id
       where family_invite.id = '${revokeRaceInvite.invite_id}'::uuid
         and family_invite.revoked_at is not null
         and pet_invite.revoked_at = family_invite.revoked_at
     );`,
  );
  expectFamilyInvariant(
    petA.family_id,
    'Invite revoke-vs-join remained serial and drift-free.',
  );

  const capOwner = await createUser('cap-owner');
  const capPetA = await createPet(capOwner, 'Phase C2 Cap Pet A');
  const capPetBId = addSecondPet(
    capPetA.family_id,
    capOwner.id,
    capPetA.created_at,
    'Phase C2 Cap Pet B',
  );
  void capPetBId;
  const fillers = [];
  for (let index = 0; index < 8; index += 1) {
    const filler = await createUser(`cap-filler-${index}`);
    fillers.push(filler);
    addCanonicalMember(capPetA.family_id, filler.id);
  }
  const racerA = await createUser('cap-racer-a');
  const racerB = await createUser('cap-racer-b');
  const capInvite = await createFamilyInvite(capOwner, capPetA.family_id);
  const capResults = await allWithin(
    [racerA, racerB].map((racer) =>
      racer.client.rpc('join_family_with_invite', {
        invite_code: capInvite.invite_code,
      }),
    ),
    'two users competing for the last Family slot',
  );
  const capWinners = capResults.filter(
    (result) => !result.error && result.data?.[0]?.join_status === 'joined',
  );
  const capLosers = capResults.filter((result) => result.error);
  expect(
    capWinners.length === 1 &&
      capLosers.length === 1 &&
      capLosers[0].error.message.includes('family_member_limit_reached'),
    'Exactly one last-slot contender did not win.',
  );
  expectSql(
    'The Family cap stopped at ten Owner/Member rows.',
    `select count(*) = 10
     from public.family_members
     where family_id = '${capPetA.family_id}'::uuid
       and role in ('owner', 'member');`,
  );
  expectFamilyInvariant(
    capPetA.family_id,
    'Last-slot concurrency mirrored only the winner to every Pet.',
  );

  console.log(
    'PASS: Phase C2 multi-Pet mutation matrix, rollback, and concurrency verification complete.',
  );
} finally {
  await cleanup();
}

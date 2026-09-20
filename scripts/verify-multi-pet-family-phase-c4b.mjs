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
  throw new Error('Local Supabase URL and keys are required.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: Phase C4B verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C4B requires a local DB container.');
}

const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260920190000_multi_pet_family_phase_c4b_ownership_transfer.sql',
  ),
  'utf8',
);
const databaseTypes = readFileSync(join(root, 'src/types/database.ts'), 'utf8');
const familyQueries = readFileSync(
  join(root, 'src/features/family/family-queries.ts'),
  'utf8',
);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const deletedUsers = new Set();
const familyIds = new Set();
let failureTriggerInstalled = false;

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

function expectSqlFailure(label, statement) {
  try {
    sql(statement);
  } catch {
    console.log(`PASS: ${label}`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

function testClient() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createUser(label) {
  const email = `phase-c4b-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase C4B ${label}`, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;
  const user = { client, id: created.data.user.id };
  users.push(user);
  return user;
}

async function createFamily(owner, label) {
  const result = await owner.client.rpc('create_pet', {
    pet_adoption_date: null,
    pet_birthday: null,
    pet_breed: 'Phase C4B verifier',
    pet_description: null,
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: null,
  });
  if (result.error || !result.data?.family_id) throw result.error;
  familyIds.add(result.data.family_id);
  return { familyId: result.data.family_id, petId: result.data.id };
}

async function createFamilyPet(owner, familyId, label) {
  const result = await owner.client.rpc('create_family_pet', {
    pet_adoption_date: null,
    pet_birthday: null,
    pet_breed: 'Phase C4B verifier',
    pet_description: null,
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: null,
    target_family_id: familyId,
  });
  if (result.error || !result.data) throw result.error;
  return result.data;
}

function addMember(familyId, userId, role = 'member') {
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
    from inserted
    join public.pets as pet on pet.family_id = '${familyId}'::uuid;
  `);
}

async function transfer(actor, familyId, newOwnerId) {
  return actor.client.rpc('transfer_family_ownership', {
    new_owner_user_id: newOwnerId,
    target_family_id: familyId,
  });
}

function invariant(familyId) {
  return `
    (select count(*) = 1
     from public.family_members
     where family_id = '${familyId}'::uuid and role = 'owner')
    and not exists (
      select 1
      from public.pets as pet
      cross join public.family_members as canonical
      where pet.family_id = '${familyId}'::uuid
        and canonical.family_id = pet.family_id
        and not exists (
          select 1 from public.pet_members as mirror
          where mirror.pet_id = pet.id
            and mirror.user_id = canonical.user_id
            and mirror.role = canonical.role
            and mirror.created_at = canonical.created_at
        )
    )
    and not exists (
      select 1
      from public.pet_members as mirror
      join public.pets as pet on pet.id = mirror.pet_id
      where pet.family_id = '${familyId}'::uuid
        and not exists (
          select 1 from public.family_members as canonical
          where canonical.family_id = pet.family_id
            and canonical.user_id = mirror.user_id
            and canonical.role = mirror.role
            and canonical.created_at = mirror.created_at
        )
    )`;
}

async function createInvite(owner, familyId) {
  const result = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  if (result.error || !result.data?.[0]) throw result.error;
  return result.data[0];
}

async function deleteAuthUser(user) {
  const result = await admin.auth.admin.deleteUser(user.id);
  if (!result.error) deletedUsers.add(user.id);
  return result;
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function cleanup() {
  if (failureTriggerInstalled) {
    sql(`
      drop trigger if exists phase_c4b_fail_pet_member on public.pet_members;
      drop function if exists private.phase_c4b_fail_pet_member();
    `);
  }
  for (const familyId of familyIds) {
    sql(`
      delete from public.pets where family_id = '${familyId}'::uuid;
      delete from public.families where id = '${familyId}'::uuid;
    `);
  }
  for (const user of users) {
    await user.client.auth.signOut();
    if (!deletedUsers.has(user.id)) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw deleted.error;
    }
  }
}

try {
  expect(
    migration.includes(
      'create or replace function public.transfer_family_ownership(',
    ) &&
      migration.includes(
        'hashtextextended(target_family_id::text, 4815162342)',
      ) &&
      migration.includes('deferrable initially deferred') &&
      databaseTypes.includes('transfer_family_ownership:') &&
      familyQueries.includes('export async function transferFamilyOwnership('),
    'C4B migration, lock namespace, type, or internal wrapper is missing.',
  );
  expect(
    !readFileSync(join(root, 'src/app/(tabs)/profile.tsx'), 'utf8').includes(
      'transferFamilyOwnership',
    ),
    'Ownership transfer was exposed in visible UI.',
  );
  console.log(
    'PASS: C4B is wired as an internal typed API with no visible UI entry.',
  );

  const owner = await createUser('matrix-owner');
  const member = await createUser('matrix-member');
  const viewer = await createUser('matrix-viewer');
  const stranger = await createUser('matrix-stranger');
  const removed = await createUser('matrix-removed');
  const matrix = await createFamily(owner, 'Matrix A');
  addMember(matrix.familyId, member.id);
  addMember(matrix.familyId, viewer.id, 'viewer');
  addMember(matrix.familyId, removed.id);
  const removedFixture = await owner.client.rpc('remove_family_member', {
    target_family_id: matrix.familyId,
    target_user_id: removed.id,
  });
  expect(!removedFixture.error, 'Could not create removed-member fixture.');

  for (const [label, actor, target] of [
    ['Member caller', member, member.id],
    ['Viewer caller', viewer, member.id],
    ['Stranger caller', stranger, member.id],
    ['Viewer target', owner, viewer.id],
    ['Stranger target', owner, stranger.id],
    ['Removed target', owner, removed.id],
  ]) {
    const result = await transfer(actor, matrix.familyId, target);
    expect(Boolean(result.error), `${label} transfer unexpectedly succeeded.`);
  }
  const self = await transfer(owner, matrix.familyId, owner.id);
  expect(
    !self.error && self.data === 'already_owner',
    'Owner self-transfer changed behavior.',
  );
  expectSql(
    'Denied and self transfers preserve the exact Owner/mirror invariant.',
    `select ${invariant(matrix.familyId)};`,
  );

  const activeInvite = await createInvite(owner, matrix.familyId);
  const chatVersionBefore = Number(
    (
      await owner.client.rpc('get_pet_chat_channel_version', {
        target_pet_id: matrix.petId,
      })
    ).data,
  );
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  const taskId = randomUUID();
  const shiftId = randomUUID();
  const careTask = await owner.client.rpc('create_care_task', {
    target_pet_id: matrix.petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: 'C4B transfer retention',
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt,
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'C4B transfer retention',
    task_week_day: null,
  });
  if (careTask.error) throw careTask.error;
  const careShift = await owner.client.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: scheduledAt.slice(0, 10),
    shift_note: 'C4B transfer retention',
    target_assignee_user_id: owner.id,
    target_pet_id: matrix.petId,
    task_items: [{ care_task_id: taskId, source_scheduled_for: scheduledAt }],
  });
  if (careShift.error) throw careShift.error;
  const avatarPath = `${owner.id}/${matrix.petId}/c4b-unchanged.jpg`;
  sql(
    `update public.pets set avatar_path = '${avatarPath}' where id = '${matrix.petId}'::uuid;`,
  );
  const profileSnapshot = sql(
    `select string_agg(row_to_json(profile)::text, ',' order by profile.id) from public.profiles as profile where id in ('${owner.id}'::uuid, '${member.id}'::uuid);`,
  );
  const beforeCreatedAt = sql(
    `select string_agg(user_id::text || ':' || created_at::text, ',' order by user_id) from public.family_members where family_id = '${matrix.familyId}'::uuid;`,
  );
  const transferred = await transfer(owner, matrix.familyId, member.id);
  expect(
    !transferred.error && transferred.data === 'transferred',
    `One-Pet transfer failed: ${transferred.error?.message}`,
  );
  expectSql(
    'One-Pet transfer swaps canonical/mirror roles, preserves membership timestamps, and revokes canonical/legacy invite together.',
    `select ${invariant(matrix.familyId)}
       and (select role = 'member' from public.family_members where family_id = '${matrix.familyId}'::uuid and user_id = '${owner.id}'::uuid)
       and (select role = 'owner' from public.family_members where family_id = '${matrix.familyId}'::uuid and user_id = '${member.id}'::uuid)
       and (select string_agg(user_id::text || ':' || created_at::text, ',' order by user_id) from public.family_members where family_id = '${matrix.familyId}'::uuid) = '${beforeCreatedAt}'
       and (select revoked_at is not null from public.family_invites where id = '${activeInvite.invite_id}'::uuid)
       and (select canonical.revoked_at = legacy.revoked_at from public.family_invites canonical join public.pet_invites legacy using (id) where canonical.id = '${activeInvite.invite_id}'::uuid);`,
  );
  const chatVersionAfter = Number(
    (
      await member.client.rpc('get_pet_chat_channel_version', {
        target_pet_id: matrix.petId,
      })
    ).data,
  );
  expect(
    chatVersionAfter > chatVersionBefore,
    'Existing Pet role-change trigger did not rotate the Chat channel version.',
  );
  expectSql(
    'Transfer preserves Schedule assignment/history, Profile rows, Pet avatar, and storage ownership fields.',
    `select
       exists (select 1 from public.care_tasks where id = '${taskId}'::uuid and pet_id = '${matrix.petId}'::uuid)
       and exists (select 1 from public.care_shifts where id = '${shiftId}'::uuid and assignee_user_id = '${owner.id}'::uuid)
       and (select avatar_path = '${avatarPath}' from public.pets where id = '${matrix.petId}'::uuid)
       and (select string_agg(row_to_json(profile)::text, ',' order by profile.id) from public.profiles as profile where id in ('${owner.id}'::uuid, '${member.id}'::uuid)) = '${profileSnapshot}';`,
  );
  const oldOwnerMessage = await owner.client.rpc('send_chat_message', {
    message_body: 'old owner remains a member',
    target_client_message_id: randomUUID(),
    target_pet_id: matrix.petId,
  });
  const newOwnerMembers = await member.client.rpc('get_pet_members', {
    target_pet_id: matrix.petId,
  });
  expect(
    !oldOwnerMessage.error && !newOwnerMembers.error,
    'Chat/member reads did not survive transfer.',
  );
  console.log(
    'PASS: old Owner remains an active Member; both roles retain Chat access, and the existing role-change trigger rotates channel version.',
  );

  const zeroOwner = await createUser('zero-owner');
  const zeroMember = await createUser('zero-member');
  const zero = await createFamily(zeroOwner, 'Zero Pet');
  addMember(zero.familyId, zeroMember.id);
  const deletedPet = await zeroOwner.client.rpc('delete_family_pet', {
    target_pet_id: zero.petId,
  });
  expect(
    !deletedPet.error,
    `Could not create zero-Pet fixture: ${deletedPet.error?.message}`,
  );
  const zeroTransfer = await transfer(zeroOwner, zero.familyId, zeroMember.id);
  expect(
    !zeroTransfer.error && zeroTransfer.data === 'transferred',
    'Zero-Pet transfer failed.',
  );
  expectSql(
    'Zero-Pet Family keeps exactly one Owner after transfer.',
    `select not exists (select 1 from public.pets where family_id = '${zero.familyId}'::uuid) and ${invariant(zero.familyId)};`,
  );

  const threeOwner = await createUser('three-owner');
  const threeMember = await createUser('three-member');
  const three = await createFamily(threeOwner, 'Three A');
  addMember(three.familyId, threeMember.id);
  await createFamilyPet(threeOwner, three.familyId, 'Three B');
  await createFamilyPet(threeOwner, three.familyId, 'Three C');
  const threeTransfer = await transfer(
    threeOwner,
    three.familyId,
    threeMember.id,
  );
  expect(
    !threeTransfer.error,
    `Three-Pet transfer failed: ${threeTransfer.error?.message}`,
  );
  expectSql(
    'Three-Pet transfer mirrors every canonical role exactly.',
    `select (select count(*) = 3 from public.pets where family_id = '${three.familyId}'::uuid) and ${invariant(three.familyId)};`,
  );

  const noInviteOwner = await createUser('no-invite-owner');
  const noInviteMember = await createUser('no-invite-member');
  const noInvite = await createFamily(noInviteOwner, 'No Invite');
  addMember(noInvite.familyId, noInviteMember.id);
  const noInviteTransfer = await transfer(
    noInviteOwner,
    noInvite.familyId,
    noInviteMember.id,
  );
  expect(!noInviteTransfer.error, 'Transfer without an active invite failed.');
  console.log('PASS: transfer succeeds with no active invite.');

  const rollbackOwner = await createUser('rollback-owner');
  const rollbackMember = await createUser('rollback-member');
  const rollback = await createFamily(rollbackOwner, 'Rollback A');
  addMember(rollback.familyId, rollbackMember.id);
  await createFamilyPet(rollbackOwner, rollback.familyId, 'Rollback B');
  const rollbackInvite = await createInvite(rollbackOwner, rollback.familyId);
  sql(`
    create or replace function private.phase_c4b_fail_pet_member()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.user_id = '${rollbackMember.id}'::uuid and new.role = 'owner' then
        raise exception 'phase_c4b_injected_failure';
      end if;
      return new;
    end;
    $$;
    create trigger phase_c4b_fail_pet_member
    before update on public.pet_members
    for each row execute function private.phase_c4b_fail_pet_member();
  `);
  failureTriggerInstalled = true;
  const rollbackResult = await transfer(
    rollbackOwner,
    rollback.familyId,
    rollbackMember.id,
  );
  expect(
    Boolean(rollbackResult.error),
    'Injected mirror failure unexpectedly succeeded.',
  );
  expectSql(
    'Injected mirror failure rolls back canonical roles, all mirrors, and invite revocation.',
    `select ${invariant(rollback.familyId)} and (select role = 'owner' from public.family_members where family_id = '${rollback.familyId}'::uuid and user_id = '${rollbackOwner.id}'::uuid) and (select revoked_at is null from public.family_invites where id = '${rollbackInvite.invite_id}'::uuid) and (select revoked_at is null from public.pet_invites where id = '${rollbackInvite.invite_id}'::uuid);`,
  );
  sql(
    `drop trigger phase_c4b_fail_pet_member on public.pet_members; drop function private.phase_c4b_fail_pet_member();`,
  );
  failureTriggerInstalled = false;

  expectSqlFailure(
    'Direct deletion of the sole Owner fails for a zero-Pet Family.',
    `begin; delete from public.family_members where family_id = '${zero.familyId}'::uuid and role = 'owner'; commit;`,
  );
  expectSqlFailure(
    'Direct deletion of the sole Owner fails for a one-Pet Family.',
    `begin; delete from public.family_members where family_id = '${matrix.familyId}'::uuid and role = 'owner'; commit;`,
  );
  expectSqlFailure(
    'Direct deletion of the sole Owner fails for a multi-Pet Family.',
    `begin; delete from public.family_members where family_id = '${three.familyId}'::uuid and role = 'owner'; commit;`,
  );
  expectSqlFailure(
    'The partial unique index rejects a second canonical Owner.',
    `update public.family_members set role = 'owner' where family_id = '${matrix.familyId}'::uuid and user_id = '${viewer.id}'::uuid;`,
  );
  expectSqlFailure(
    'A newly inserted Family cannot commit without exactly one Owner.',
    `insert into public.families (id) values ('${randomUUID()}'::uuid);`,
  );
  const disposableOwner = await createUser('family-delete-owner');
  const disposable = await createFamily(disposableOwner, 'Family Delete');
  sql(
    `begin; delete from public.pets where family_id = '${disposable.familyId}'::uuid; delete from public.families where id = '${disposable.familyId}'::uuid; commit;`,
  );
  familyIds.delete(disposable.familyId);
  expectSql(
    'Deleting an entire Family remains legal.',
    `select not exists (select 1 from public.families where id = '${disposable.familyId}'::uuid);`,
  );

  const deleteMemberOwner = await createUser('delete-member-owner');
  const deleteMember = await createUser('delete-member');
  const deleteViewer = await createUser('delete-viewer');
  const deleteFamily = await createFamily(deleteMemberOwner, 'Delete Auth');
  addMember(deleteFamily.familyId, deleteMember.id);
  addMember(deleteFamily.familyId, deleteViewer.id, 'viewer');
  expect(
    !(await deleteAuthUser(deleteMember)).error,
    'Deleting a Member auth user failed.',
  );
  expect(
    !(await deleteAuthUser(deleteViewer)).error,
    'Deleting a Viewer auth user failed.',
  );
  expect(
    Boolean((await deleteAuthUser(deleteMemberOwner)).error),
    'Deleting the sole Owner auth user did not fail closed.',
  );
  expectSql(
    'Member/Viewer deletion succeeds while unsafe Owner deletion preserves the Family Owner.',
    `select ${invariant(deleteFamily.familyId)} and exists (select 1 from auth.users where id = '${deleteMemberOwner.id}'::uuid);`,
  );

  const onlyOwner = await createUser('only-owner');
  const onlyOwnerFamily = await createFamily(onlyOwner, 'Only Owner');
  expect(
    Boolean((await deleteAuthUser(onlyOwner)).error),
    'Deleting an Owner-only Family auth user did not fail closed.',
  );
  expectSql(
    'Owner-only Family blocks Owner auth deletion.',
    `select exists (select 1 from auth.users where id = '${onlyOwner.id}'::uuid) and ${invariant(onlyOwnerFamily.familyId)};`,
  );

  const zeroDeleteOwner = await createUser('zero-delete-owner');
  const zeroDelete = await createFamily(zeroDeleteOwner, 'Zero Delete');
  const zeroDeletePet = await zeroDeleteOwner.client.rpc('delete_family_pet', {
    target_pet_id: zeroDelete.petId,
  });
  if (zeroDeletePet.error) throw zeroDeletePet.error;
  expect(
    Boolean((await deleteAuthUser(zeroDeleteOwner)).error),
    'Deleting a zero-Pet Family Owner auth user did not fail closed.',
  );
  expectSql(
    'Zero-Pet Family blocks Owner auth deletion.',
    `select not exists (select 1 from public.pets where family_id = '${zeroDelete.familyId}'::uuid) and exists (select 1 from auth.users where id = '${zeroDeleteOwner.id}'::uuid) and ${invariant(zeroDelete.familyId)};`,
  );

  const postTransferOwner = await createUser('post-transfer-owner');
  const postTransferMember = await createUser('post-transfer-member');
  const postTransfer = await createFamily(
    postTransferOwner,
    'Post Transfer Delete',
  );
  addMember(postTransfer.familyId, postTransferMember.id);
  expect(
    !(
      await transfer(
        postTransferOwner,
        postTransfer.familyId,
        postTransferMember.id,
      )
    ).error,
    'Pre-delete transfer failed.',
  );
  expect(
    !(await deleteAuthUser(postTransferOwner)).error,
    'Old Owner auth deletion failed after transfer.',
  );
  expectSql(
    'After transfer, deleting the old Owner preserves Family, Pet, and new Owner.',
    `select exists (select 1 from public.families where id = '${postTransfer.familyId}'::uuid) and exists (select 1 from public.pets where id = '${postTransfer.petId}'::uuid) and ${invariant(postTransfer.familyId)};`,
  );

  const raceOwner = await createUser('race-owner');
  const raceA = await createUser('race-a');
  const raceB = await createUser('race-b');
  const race = await createFamily(raceOwner, 'Transfer Race');
  addMember(race.familyId, raceA.id);
  addMember(race.familyId, raceB.id);
  const transferRace = await withTimeout(
    Promise.all([
      transfer(raceOwner, race.familyId, raceA.id),
      transfer(raceOwner, race.familyId, raceB.id),
    ]),
    'transfer/transfer',
  );
  expect(
    transferRace.filter((result) => !result.error).length === 1,
    'Concurrent transfers did not produce exactly one winner.',
  );
  expectSql(
    'Concurrent transfers serialize to exactly one Owner with complete mirrors.',
    `select ${invariant(race.familyId)};`,
  );

  const removeOwner = await createUser('remove-race-owner');
  const removeTarget = await createUser('remove-race-target');
  const removeRace = await createFamily(removeOwner, 'Remove Race');
  addMember(removeRace.familyId, removeTarget.id);
  await withTimeout(
    Promise.all([
      transfer(removeOwner, removeRace.familyId, removeTarget.id),
      removeOwner.client.rpc('remove_family_member', {
        target_family_id: removeRace.familyId,
        target_user_id: removeTarget.id,
      }),
    ]),
    'transfer/remove',
  );
  expectSql(
    'Transfer versus member removal cannot leave an Ownerless or drifted Family.',
    `select ${invariant(removeRace.familyId)};`,
  );

  const petRaceOwner = await createUser('pet-race-owner');
  const petRaceMember = await createUser('pet-race-member');
  const petRace = await createFamily(petRaceOwner, 'Pet Race');
  addMember(petRace.familyId, petRaceMember.id);
  await withTimeout(
    Promise.all([
      transfer(petRaceOwner, petRace.familyId, petRaceMember.id),
      petRaceOwner.client.rpc('create_family_pet', {
        pet_adoption_date: null,
        pet_birthday: null,
        pet_breed: null,
        pet_description: null,
        pet_gender: 'unknown',
        pet_name: 'Concurrent Create',
        pet_species: 'other',
        pet_weight: null,
        target_family_id: petRace.familyId,
      }),
    ]),
    'transfer/create pet',
  );
  expectSql(
    'Transfer versus Pet creation cannot leave mirror drift.',
    `select ${invariant(petRace.familyId)};`,
  );

  const deleteRaceOwner = await createUser('delete-race-owner');
  const deleteRaceMember = await createUser('delete-race-member');
  const deleteRace = await createFamily(deleteRaceOwner, 'Delete Race A');
  addMember(deleteRace.familyId, deleteRaceMember.id);
  const deleteRacePet = await createFamilyPet(
    deleteRaceOwner,
    deleteRace.familyId,
    'Delete Race B',
  );
  await withTimeout(
    Promise.all([
      transfer(deleteRaceOwner, deleteRace.familyId, deleteRaceMember.id),
      deleteRaceOwner.client.rpc('delete_family_pet', {
        target_pet_id: deleteRacePet.id,
      }),
    ]),
    'transfer/delete pet',
  );
  expectSql(
    'Transfer versus Pet deletion cannot leave mirror drift.',
    `select ${invariant(deleteRace.familyId)};`,
  );

  const joinOwner = await createUser('join-race-owner');
  const joinTarget = await createUser('join-race-target');
  const joiner = await createUser('join-race-joiner');
  const joinRace = await createFamily(joinOwner, 'Join Race');
  addMember(joinRace.familyId, joinTarget.id);
  const joinInvite = await createInvite(joinOwner, joinRace.familyId);
  await withTimeout(
    Promise.all([
      transfer(joinOwner, joinRace.familyId, joinTarget.id),
      joiner.client.rpc('join_family_with_invite', {
        invite_code: joinInvite.invite_code,
      }),
    ]),
    'transfer/join',
  );
  expectSql(
    'Transfer versus invite join preserves one Owner and exact mirrors.',
    `select ${invariant(joinRace.familyId)};`,
  );

  const authRaceOwner = await createUser('auth-race-owner');
  const authRaceMember = await createUser('auth-race-member');
  const authRace = await createFamily(authRaceOwner, 'Auth Race');
  addMember(authRace.familyId, authRaceMember.id);
  const authRaceResults = await withTimeout(
    Promise.all([
      transfer(authRaceOwner, authRace.familyId, authRaceMember.id),
      deleteAuthUser(authRaceOwner),
    ]),
    'transfer/auth delete',
  );
  expectSql(
    'Transfer versus Owner auth deletion never leaves a live Family without exactly one Owner.',
    `select ${invariant(authRace.familyId)};`,
  );
  if (!authRaceResults[1].error) deletedUsers.add(authRaceOwner.id);

  console.log(
    'PASS: Phase C4B ownership invariant, authorization, rollback, deletion, and concurrency matrix completed.',
  );
} finally {
  await cleanup();
}

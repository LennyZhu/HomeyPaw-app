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
  throw new Error('SAFETY STOP: Phase C4C verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C4C requires a local DB container.');
}

const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260920220000_multi_pet_family_phase_c4c_membership_lifecycle.sql',
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

function count(statement) {
  return Number(sql(statement));
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
  const email = `phase-c4c-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase C4C ${label}`, locale: 'en' },
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
    pet_breed: 'Phase C4C verifier',
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
    pet_breed: 'Phase C4C verifier',
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

async function leave(actor, familyId) {
  return actor.client.rpc('leave_family', { target_family_id: familyId });
}

async function remove(owner, familyId, userId) {
  return owner.client.rpc('remove_family_member', {
    target_family_id: familyId,
    target_user_id: userId,
  });
}

async function transfer(owner, familyId, newOwnerId) {
  return owner.client.rpc('transfer_family_ownership', {
    new_owner_user_id: newOwnerId,
    target_family_id: familyId,
  });
}

async function createInvite(owner, familyId) {
  const result = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  if (result.error || !result.data?.[0]) throw result.error;
  return result.data[0];
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

async function chatVersion(actor, petId) {
  const result = await actor.client.rpc('get_pet_chat_channel_version', {
    target_pet_id: petId,
  });
  if (result.error) throw result.error;
  return Number(result.data);
}

async function createSchedule(owner, assignee, petId, label) {
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  const taskId = randomUUID();
  const shiftId = randomUUID();
  const task = await owner.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: label,
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt,
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: label,
    task_week_day: null,
  });
  if (task.error) throw task.error;
  const shift = await owner.client.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(scheduledAt)),
    shift_note: label,
    target_assignee_user_id: assignee?.id ?? null,
    target_pet_id: petId,
    task_items: [{ care_task_id: taskId, source_scheduled_for: scheduledAt }],
  });
  if (shift.error) throw shift.error;
  return { shiftId, taskId };
}

async function allWithin(promises, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out; possible deadlock.`)),
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
      drop trigger if exists phase_c4c_fail_pet_member on public.pet_members;
      drop function if exists private.phase_c4c_fail_pet_member();
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
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
}

try {
  expect(
    migration.includes('create or replace function public.leave_family(') &&
      migration.includes(
        'create or replace function public.remove_family_member(',
      ) &&
      migration.match(
        /hashtextextended\(target_family_id::text, 4815162342\)/gu,
      )?.length === 2 &&
      databaseTypes.includes('leave_family:') &&
      familyQueries.includes('export async function leaveFamily(') &&
      familyQueries.includes('export async function removeFamilyMember(') &&
      familyQueries.includes('export function useLeaveFamily()'),
    'C4C migration, shared lock namespace, types, or client API is missing.',
  );
  expect(
    !readFileSync(join(root, 'src/app/(tabs)/profile.tsx'), 'utf8').includes(
      'useLeaveFamily',
    ),
    'C4C leave behavior was exposed in visible UI.',
  );
  console.log(
    'PASS: C4C APIs are typed, use the shared Family lock, reconcile caches internally, and add no UI.',
  );

  const zeroOwner = await createUser('zero-owner');
  const zeroMember = await createUser('zero-member');
  const zero = await createFamily(zeroOwner, 'Zero');
  addMember(zero.familyId, zeroMember.id);
  const zeroPetDelete = await zeroOwner.client.rpc('delete_family_pet', {
    target_pet_id: zero.petId,
  });
  if (zeroPetDelete.error) throw zeroPetDelete.error;
  const zeroLeave = await leave(zeroMember, zero.familyId);
  expect(
    !zeroLeave.error && zeroLeave.data === 'left',
    'Zero-Pet Member leave failed.',
  );
  expectSql(
    'Member can leave a zero-Pet Family while its Owner invariant remains.',
    `select not exists (select 1 from public.pets where family_id = '${zero.familyId}'::uuid) and not exists (select 1 from public.family_members where family_id = '${zero.familyId}'::uuid and user_id = '${zeroMember.id}'::uuid) and ${invariant(zero.familyId)};`,
  );

  const oneOwner = await createUser('one-owner');
  const oneMember = await createUser('one-member');
  const one = await createFamily(oneOwner, 'One');
  addMember(one.familyId, oneMember.id);
  const invite = await createInvite(oneOwner, one.familyId);
  const beforeVersion = await chatVersion(oneOwner, one.petId);
  const schedule = await createSchedule(
    oneOwner,
    oneMember,
    one.petId,
    'Leave schedule',
  );
  const messageId = randomUUID();
  const message = await oneMember.client.rpc('send_chat_message', {
    message_body: 'Retained shared history',
    target_client_message_id: messageId,
    target_pet_id: one.petId,
  });
  if (message.error) throw message.error;
  const careLogId = randomUUID();
  const care = await oneMember.client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_id: careLogId,
    care_kind: 'feeding',
    care_note: 'Retained shared history',
    care_occurred_at: new Date().toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: one.petId,
  });
  if (care.error) throw care.error;
  const oneLeave = await leave(oneMember, one.familyId);
  expect(
    !oneLeave.error && oneLeave.data === 'left',
    'One-Pet Member leave failed.',
  );
  const postLeaveSend = await oneMember.client.rpc('send_chat_message', {
    message_body: 'Must be denied',
    target_client_message_id: randomUUID(),
    target_pet_id: one.petId,
  });
  expect(
    Boolean(postLeaveSend.error),
    'Departed Member retained Chat send access.',
  );
  expectSql(
    'Member leave removes canonical/mirror access, rotates Chat, unassigns Schedule, preserves shared history, and keeps invite active.',
    `select ${invariant(one.familyId)}
       and not exists (select 1 from public.family_members where family_id = '${one.familyId}'::uuid and user_id = '${oneMember.id}'::uuid)
       and not exists (select 1 from public.pet_members where pet_id = '${one.petId}'::uuid and user_id = '${oneMember.id}'::uuid)
       and (select channel_version > ${beforeVersion} from private.pet_chat_states where pet_id = '${one.petId}'::uuid)
       and (select assignee_user_id is null from public.care_shifts where id = '${schedule.shiftId}'::uuid)
       and exists (select 1 from public.chat_messages where id = '${message.data.id}'::uuid and sender_id = '${oneMember.id}'::uuid)
       and exists (select 1 from public.care_logs where id = '${careLogId}'::uuid and performed_by = '${oneMember.id}'::uuid)
       and (select revoked_at is null from public.family_invites where id = '${invite.invite_id}'::uuid)
       and (select revoked_at is null from public.pet_invites where id = '${invite.invite_id}'::uuid);`,
  );

  const manyOwner = await createUser('many-owner');
  const manyMember = await createUser('many-member');
  const manyViewer = await createUser('many-viewer');
  const many = await createFamily(manyOwner, 'Many A');
  const manyB = await createFamilyPet(manyOwner, many.familyId, 'Many B');
  const manyC = await createFamilyPet(manyOwner, many.familyId, 'Many C');
  addMember(many.familyId, manyMember.id);
  addMember(many.familyId, manyViewer.id, 'viewer');
  const manyPetIds = [many.petId, manyB.id, manyC.id];
  const versionsBefore = await Promise.all(
    manyPetIds.map((petId) => chatVersion(manyOwner, petId)),
  );
  const manyLeave = await leave(manyMember, many.familyId);
  expect(!manyLeave.error, 'Three-Pet Member leave failed.');
  const viewerLeave = await leave(manyViewer, many.familyId);
  expect(!viewerLeave.error, 'Viewer leave failed.');
  for (const petId of manyPetIds) {
    const memberRead = await manyMember.client.rpc('get_chat_messages_page', {
      before_created_at: null,
      before_message_id: null,
      requested_limit: 20,
      target_pet_id: petId,
    });
    const viewerRead = await manyViewer.client.rpc('get_chat_messages_page', {
      before_created_at: null,
      before_message_id: null,
      requested_limit: 20,
      target_pet_id: petId,
    });
    expect(
      memberRead.error && viewerRead.error,
      'Departed user retained Chat read access on a Family Pet.',
    );
  }
  expectSql(
    'Three-Pet Member and Viewer leave remove every mirror and rotate every Pet Chat channel.',
    `select ${invariant(many.familyId)} and not exists (select 1 from public.pet_members where pet_id in ('${many.petId}'::uuid, '${manyB.id}'::uuid, '${manyC.id}'::uuid) and user_id in ('${manyMember.id}'::uuid, '${manyViewer.id}'::uuid)) and (select bool_and(state.channel_version > before_version) from private.pet_chat_states state join (values ('${many.petId}'::uuid, ${versionsBefore[0]}), ('${manyB.id}'::uuid, ${versionsBefore[1]}), ('${manyC.id}'::uuid, ${versionsBefore[2]})) expected(pet_id, before_version) using (pet_id));`,
  );

  const guardOwner = await createUser('guard-owner');
  const guardMember = await createUser('guard-member');
  const guardViewer = await createUser('guard-viewer');
  const guardStranger = await createUser('guard-stranger');
  const guardRemoved = await createUser('guard-removed');
  const guard = await createFamily(guardOwner, 'Guards');
  addMember(guard.familyId, guardMember.id);
  addMember(guard.familyId, guardViewer.id, 'viewer');
  addMember(guard.familyId, guardRemoved.id);
  const removedFixture = await remove(
    guardOwner,
    guard.familyId,
    guardRemoved.id,
  );
  if (removedFixture.error) throw removedFixture.error;
  for (const [label, result] of [
    ['Owner leave', await leave(guardOwner, guard.familyId)],
    ['Stranger leave', await leave(guardStranger, guard.familyId)],
    [
      'Removed Member repeated leave',
      await leave(guardRemoved, guard.familyId),
    ],
    [
      'Owner remove self',
      await remove(guardOwner, guard.familyId, guardOwner.id),
    ],
    [
      'Member remove Owner',
      await remove(guardMember, guard.familyId, guardOwner.id),
    ],
    [
      'Viewer remove Member',
      await remove(guardViewer, guard.familyId, guardMember.id),
    ],
    [
      'Stranger remove Member',
      await remove(guardStranger, guard.familyId, guardMember.id),
    ],
  ]) {
    expect(Boolean(result.error), `${label} unexpectedly succeeded.`);
  }
  expectSqlFailure(
    'Direct SQL deletion of the canonical Owner still fails at commit.',
    `begin; delete from public.family_members where family_id = '${guard.familyId}'::uuid and user_id = '${guardOwner.id}'::uuid; commit;`,
  );
  expectSql(
    'All rejected leave/remove attempts preserve Owner and mirror invariants.',
    `select ${invariant(guard.familyId)};`,
  );

  const removeMemberUser = await createUser('forced-member');
  addMember(guard.familyId, removeMemberUser.id);
  const memberInvite = await createInvite(guardOwner, guard.familyId);
  const forcedMember = await remove(
    guardOwner,
    guard.familyId,
    removeMemberUser.id,
  );
  expect(
    !forcedMember.error && forcedMember.data === 'removed',
    'Owner remove Member failed.',
  );
  expectSql(
    'Forced Member removal cleans every mirror and revokes canonical/legacy invite together.',
    `select ${invariant(guard.familyId)} and not exists (select 1 from public.family_members where family_id = '${guard.familyId}'::uuid and user_id = '${removeMemberUser.id}'::uuid) and (select canonical.revoked_at is not null and canonical.revoked_at = legacy.revoked_at from public.family_invites canonical join public.pet_invites legacy using (id) where canonical.id = '${memberInvite.invite_id}'::uuid);`,
  );
  const repeatedRemove = await remove(
    guardOwner,
    guard.familyId,
    removeMemberUser.id,
  );
  expect(
    !repeatedRemove.error && repeatedRemove.data === 'not_found',
    'Repeated remove did not preserve existing idempotent not_found semantics.',
  );

  const removeViewerOwner = await createUser('remove-viewer-owner');
  const removeViewer = await createUser('forced-viewer');
  const viewerFamily = await createFamily(removeViewerOwner, 'Remove Viewer');
  addMember(viewerFamily.familyId, removeViewer.id, 'viewer');
  const viewerInvite = await createInvite(
    removeViewerOwner,
    viewerFamily.familyId,
  );
  const forcedViewer = await remove(
    removeViewerOwner,
    viewerFamily.familyId,
    removeViewer.id,
  );
  expect(
    !forcedViewer.error && forcedViewer.data === 'removed',
    'Owner remove Viewer failed.',
  );
  expectSql(
    'Forced Viewer removal is supported and revokes the active invite.',
    `select ${invariant(viewerFamily.familyId)} and not exists (select 1 from public.family_members where family_id = '${viewerFamily.familyId}'::uuid and user_id = '${removeViewer.id}'::uuid) and (select revoked_at is not null from public.family_invites where id = '${viewerInvite.invite_id}'::uuid);`,
  );

  const transferOwner = await createUser('transfer-owner');
  const transferMember = await createUser('transfer-member');
  const transferFamily = await createFamily(transferOwner, 'Transfer Leave A');
  await createFamilyPet(
    transferOwner,
    transferFamily.familyId,
    'Transfer Leave B',
  );
  addMember(transferFamily.familyId, transferMember.id);
  const transferred = await transfer(
    transferOwner,
    transferFamily.familyId,
    transferMember.id,
  );
  if (transferred.error) throw transferred.error;
  const oldOwnerLeave = await leave(transferOwner, transferFamily.familyId);
  expect(!oldOwnerLeave.error, 'Old Owner could not leave after transfer.');
  expectSql(
    'After transfer, the old Owner can leave while the new Owner, Family, Pets, and mirrors remain valid.',
    `select ${invariant(transferFamily.familyId)} and (select count(*) = 2 from public.pets where family_id = '${transferFamily.familyId}'::uuid) and (select role = 'owner' from public.family_members where family_id = '${transferFamily.familyId}'::uuid and user_id = '${transferMember.id}'::uuid) and not exists (select 1 from public.family_members where family_id = '${transferFamily.familyId}'::uuid and user_id = '${transferOwner.id}'::uuid);`,
  );

  const isolatedUser = await createUser('isolated-user');
  const isolationOwnerA = await createUser('isolation-owner-a');
  const isolationOwnerB = await createUser('isolation-owner-b');
  const isolationA = await createFamily(isolationOwnerA, 'Isolation A');
  const isolationB = await createFamily(isolationOwnerB, 'Isolation B');
  const isolationC = await createFamily(isolatedUser, 'Isolation C');
  addMember(isolationA.familyId, isolatedUser.id);
  addMember(isolationB.familyId, isolatedUser.id, 'viewer');
  expect(
    !(await leave(isolatedUser, isolationA.familyId)).error,
    'Multi-Family Member leave failed.',
  );
  expectSql(
    'Leaving Family A does not affect Viewer membership in B or Owner membership in C.',
    `select not exists (select 1 from public.family_members where family_id = '${isolationA.familyId}'::uuid and user_id = '${isolatedUser.id}'::uuid) and exists (select 1 from public.family_members where family_id = '${isolationB.familyId}'::uuid and user_id = '${isolatedUser.id}'::uuid and role = 'viewer') and exists (select 1 from public.family_members where family_id = '${isolationC.familyId}'::uuid and user_id = '${isolatedUser.id}'::uuid and role = 'owner') and ${invariant(isolationA.familyId)} and ${invariant(isolationB.familyId)} and ${invariant(isolationC.familyId)};`,
  );
  expect(
    !(await leave(isolatedUser, isolationB.familyId)).error,
    'Multi-Family Viewer leave failed.',
  );
  expect(
    Boolean((await leave(isolatedUser, isolationC.familyId)).error),
    'Multi-Family Owner leave unexpectedly succeeded.',
  );

  const rollbackOwner = await createUser('rollback-owner');
  const rollbackTarget = await createUser('rollback-target');
  const rollbackFamily = await createFamily(rollbackOwner, 'Rollback A');
  const rollbackB = await createFamilyPet(
    rollbackOwner,
    rollbackFamily.familyId,
    'Rollback B',
  );
  const rollbackC = await createFamilyPet(
    rollbackOwner,
    rollbackFamily.familyId,
    'Rollback C',
  );
  addMember(rollbackFamily.familyId, rollbackTarget.id);
  const rollbackInvite = await createInvite(
    rollbackOwner,
    rollbackFamily.familyId,
  );
  const rollbackVersions = await Promise.all(
    [rollbackFamily.petId, rollbackB.id, rollbackC.id].map((petId) =>
      chatVersion(rollbackOwner, petId),
    ),
  );
  const rollbackSchedule = await createSchedule(
    rollbackOwner,
    rollbackTarget,
    rollbackFamily.petId,
    'Rollback schedule',
  );
  sql(`
    create or replace function private.phase_c4c_fail_pet_member()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if old.user_id = '${rollbackTarget.id}'::uuid
        and old.pet_id = '${rollbackB.id}'::uuid
      then
        raise exception 'phase_c4c_injected_failure';
      end if;
      return old;
    end;
    $$;
    create trigger phase_c4c_fail_pet_member
    before delete on public.pet_members
    for each row execute function private.phase_c4c_fail_pet_member();
  `);
  failureTriggerInstalled = true;
  const rollbackResult = await remove(
    rollbackOwner,
    rollbackFamily.familyId,
    rollbackTarget.id,
  );
  expect(
    Boolean(rollbackResult.error),
    'Injected mirror delete failure unexpectedly succeeded.',
  );
  expectSql(
    'Injected remove failure rolls back canonical/mirrors, invite, Chat versions, and Schedule assignment.',
    `select ${invariant(rollbackFamily.familyId)} and exists (select 1 from public.family_members where family_id = '${rollbackFamily.familyId}'::uuid and user_id = '${rollbackTarget.id}'::uuid) and (select count(*) = 3 from public.pet_members where pet_id in ('${rollbackFamily.petId}'::uuid, '${rollbackB.id}'::uuid, '${rollbackC.id}'::uuid) and user_id = '${rollbackTarget.id}'::uuid) and (select revoked_at is null from public.family_invites where id = '${rollbackInvite.invite_id}'::uuid) and (select revoked_at is null from public.pet_invites where id = '${rollbackInvite.invite_id}'::uuid) and (select channel_version = ${rollbackVersions[0]} from private.pet_chat_states where pet_id = '${rollbackFamily.petId}'::uuid) and (select channel_version = ${rollbackVersions[1]} from private.pet_chat_states where pet_id = '${rollbackB.id}'::uuid) and (select channel_version = ${rollbackVersions[2]} from private.pet_chat_states where pet_id = '${rollbackC.id}'::uuid) and (select assignee_user_id = '${rollbackTarget.id}'::uuid from public.care_shifts where id = '${rollbackSchedule.shiftId}'::uuid);`,
  );
  sql(
    `drop trigger phase_c4c_fail_pet_member on public.pet_members; drop function private.phase_c4c_fail_pet_member();`,
  );
  failureTriggerInstalled = false;

  const raceOwner = await createUser('race-owner');
  const raceTarget = await createUser('race-target');
  const raceFamily = await createFamily(raceOwner, 'Leave Remove Race');
  addMember(raceFamily.familyId, raceTarget.id);
  const leaveRemove = await allWithin(
    [
      leave(raceTarget, raceFamily.familyId),
      remove(raceOwner, raceFamily.familyId, raceTarget.id),
    ],
    'leave/remove',
  );
  expect(
    leaveRemove.some((result) => !result.error),
    'Leave/remove race had no successful mutation.',
  );
  expectSql(
    'Leave versus remove serializes without ghost membership or mirror drift.',
    `select ${invariant(raceFamily.familyId)} and not exists (select 1 from public.family_members where family_id = '${raceFamily.familyId}'::uuid and user_id = '${raceTarget.id}'::uuid);`,
  );

  const leaveTransferOwner = await createUser('leave-transfer-owner');
  const leaveTransferTarget = await createUser('leave-transfer-target');
  const leaveTransferFamily = await createFamily(
    leaveTransferOwner,
    'Leave Transfer',
  );
  addMember(leaveTransferFamily.familyId, leaveTransferTarget.id);
  await allWithin(
    [
      leave(leaveTransferTarget, leaveTransferFamily.familyId),
      transfer(
        leaveTransferOwner,
        leaveTransferFamily.familyId,
        leaveTransferTarget.id,
      ),
    ],
    'leave/transfer',
  );
  expectSql(
    'Leave versus transfer ends with either one Owner or the target absent, never ownerless.',
    `select ${invariant(leaveTransferFamily.familyId)};`,
  );

  const removeTransferOwner = await createUser('remove-transfer-owner');
  const removeTransferTarget = await createUser('remove-transfer-target');
  const removeTransferFamily = await createFamily(
    removeTransferOwner,
    'Remove Transfer',
  );
  addMember(removeTransferFamily.familyId, removeTransferTarget.id);
  await allWithin(
    [
      remove(
        removeTransferOwner,
        removeTransferFamily.familyId,
        removeTransferTarget.id,
      ),
      transfer(
        removeTransferOwner,
        removeTransferFamily.familyId,
        removeTransferTarget.id,
      ),
    ],
    'remove/transfer',
  );
  expectSql(
    'Remove versus transfer preserves exactly one Owner and exact mirrors.',
    `select ${invariant(removeTransferFamily.familyId)};`,
  );

  const joinRaceOwner = await createUser('join-race-owner');
  const joinRaceTarget = await createUser('join-race-target');
  const joinRace = await createFamily(joinRaceOwner, 'Join Race');
  addMember(joinRace.familyId, joinRaceTarget.id);
  const joinInvite = await createInvite(joinRaceOwner, joinRace.familyId);
  await allWithin(
    [
      leave(joinRaceTarget, joinRace.familyId),
      joinRaceTarget.client.rpc('join_family_with_invite', {
        invite_code: joinInvite.invite_code,
      }),
    ],
    'leave/join',
  );
  expectSql(
    'Leave versus invite join has no duplicate or ghost membership.',
    `select ${invariant(joinRace.familyId)} and (select count(*) <= 1 from public.family_members where family_id = '${joinRace.familyId}'::uuid and user_id = '${joinRaceTarget.id}'::uuid);`,
  );

  const createRaceOwner = await createUser('create-race-owner');
  const createRaceTarget = await createUser('create-race-target');
  const createRace = await createFamily(createRaceOwner, 'Create Race');
  addMember(createRace.familyId, createRaceTarget.id);
  await allWithin(
    [
      leave(createRaceTarget, createRace.familyId),
      createFamilyPet(
        createRaceOwner,
        createRace.familyId,
        'Concurrent Create',
      ),
    ],
    'leave/create pet',
  );
  expectSql(
    'Leave versus create_family_pet cannot mirror a departed user onto the new Pet.',
    `select ${invariant(createRace.familyId)} and not exists (select 1 from public.pet_members mirror join public.pets pet on pet.id = mirror.pet_id where pet.family_id = '${createRace.familyId}'::uuid and mirror.user_id = '${createRaceTarget.id}'::uuid);`,
  );

  const deleteRaceOwner = await createUser('delete-race-owner');
  const deleteRaceTarget = await createUser('delete-race-target');
  const deleteRace = await createFamily(deleteRaceOwner, 'Delete Race A');
  addMember(deleteRace.familyId, deleteRaceTarget.id);
  const deleteRacePet = await createFamilyPet(
    deleteRaceOwner,
    deleteRace.familyId,
    'Delete Race B',
  );
  await allWithin(
    [
      remove(deleteRaceOwner, deleteRace.familyId, deleteRaceTarget.id),
      deleteRaceOwner.client.rpc('delete_family_pet', {
        target_pet_id: deleteRacePet.id,
      }),
    ],
    'remove/delete pet',
  );
  expectSql(
    'Remove versus delete_family_pet completes without deadlock or mirror drift.',
    `select ${invariant(deleteRace.familyId)};`,
  );

  const chatRaceOwner = await createUser('chat-race-owner');
  const chatRaceTarget = await createUser('chat-race-target');
  const chatRace = await createFamily(chatRaceOwner, 'Chat Race');
  addMember(chatRace.familyId, chatRaceTarget.id);
  await allWithin(
    [
      leave(chatRaceTarget, chatRace.familyId),
      chatRaceTarget.client.rpc('send_chat_message', {
        message_body: 'Concurrent send',
        target_client_message_id: randomUUID(),
        target_pet_id: chatRace.petId,
      }),
    ],
    'leave/chat send',
  );
  const deniedChat = await chatRaceTarget.client.rpc('send_chat_message', {
    message_body: 'Post-commit denied',
    target_client_message_id: randomUUID(),
    target_pet_id: chatRace.petId,
  });
  expect(
    Boolean(deniedChat.error),
    'Departed Member sent Chat after leave committed.',
  );

  const claimRaceOwner = await createUser('claim-race-owner');
  const claimRaceTarget = await createUser('claim-race-target');
  const claimRace = await createFamily(claimRaceOwner, 'Claim Race');
  addMember(claimRace.familyId, claimRaceTarget.id);
  const claimSchedule = await createSchedule(
    claimRaceOwner,
    null,
    claimRace.petId,
    'Claim Race',
  );
  await allWithin(
    [
      remove(claimRaceOwner, claimRace.familyId, claimRaceTarget.id),
      claimRaceTarget.client.rpc('claim_care_shift', {
        target_shift_id: claimSchedule.shiftId,
      }),
    ],
    'remove/schedule claim',
  );
  const deniedClaim = await claimRaceTarget.client.rpc('claim_care_shift', {
    target_shift_id: claimSchedule.shiftId,
  });
  expect(
    Boolean(deniedClaim.error),
    'Removed Member claimed Schedule after removal committed.',
  );
  expectSql(
    'Chat send and Schedule claim races revoke future access and leave no active departed assignee.',
    `select ${invariant(chatRace.familyId)} and ${invariant(claimRace.familyId)} and (select assignee_user_id is distinct from '${claimRaceTarget.id}'::uuid from public.care_shifts where id = '${claimSchedule.shiftId}'::uuid);`,
  );

  console.log(
    'PASS: Phase C4C leave/remove authorization, lifecycle, rollback, isolation, and concurrency matrix completed.',
  );
} finally {
  await cleanup();
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
const container =
  process.env.SUPABASE_LOCAL_DB_CONTAINER?.trim() ?? 'supabase_db_pawday';
if (!url || !anonKey || !serviceKey)
  throw new Error('Local Supabase credentials are required.');
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
  throw new Error('SAFETY STOP: C4I verifier is local only.');
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container))
  throw new Error('SAFETY STOP: invalid local DB container.');

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const familyIds = new Set();
function sql(query) {
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
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}
function count(query) {
  return Number(sql(query));
}
function pass(label, condition) {
  assert.ok(condition, label);
  console.log(`PASS: ${label}`);
}
function hasError(result, code) {
  return Boolean(result.error?.message.includes(code));
}
function membershipCount(user) {
  return count(
    `select count(*) from public.family_members where user_id = '${user.id}'::uuid`,
  );
}
function globalInvariant() {
  pass(
    'database unique index keeps every account at <= 1 Family',
    sql(
      'select not exists (select 1 from public.family_members group by user_id having count(*) > 1)',
    ) === 't',
  );
}
async function user(label) {
  const email = `c4i-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const value = { id: created.data.user.id, client };
  users.push(value);
  return value;
}
async function createFamily(actor, label) {
  const result = await actor.client.rpc('create_pet', {
    pet_name: label,
    pet_species: 'other',
  });
  if (result.error || !result.data?.family_id) throw result.error;
  familyIds.add(result.data.family_id);
  return { familyId: result.data.family_id, petId: result.data.id };
}
async function invite(owner, familyId) {
  // The existing invite RPC rate-limits regeneration; age only these local
  // fixtures and keep the compatibility mirror's timestamp identical.
  sql(`update public.family_invites set created_at = created_at - interval '1 minute'
    where family_id = '${familyId}'::uuid;
    update public.pet_invites as mirror set created_at = canonical.created_at
    from public.family_invites as canonical
    where canonical.id = mirror.id and canonical.family_id = '${familyId}'::uuid;`);
  const result = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  if (result.error || !result.data?.[0]?.invite_code) throw result.error;
  return result.data[0].invite_code;
}
async function join(actor, code, legacy = false) {
  return actor.client.rpc(
    legacy ? 'join_pet_with_invite' : 'join_family_with_invite',
    { invite_code: code },
  );
}
function seedMember(familyId, actor, role) {
  sql(`with created as (
    insert into public.family_members (family_id,user_id,role)
    values ('${familyId}'::uuid,'${actor.id}'::uuid,'${role}'::public.pet_member_role)
    returning user_id,role,created_at
  ) insert into public.pet_members (pet_id,user_id,role,created_at)
    select pet.id,created.user_id,created.role,created.created_at
    from public.pets as pet cross join created where pet.family_id = '${familyId}'::uuid`);
}
async function run() {
  pass(
    'database has a unique user_id index',
    sql(
      "select count(*) = 1 from pg_indexes where schemaname = 'public' and tablename = 'family_members' and indexname = 'family_members_one_family_per_user' and indexdef like '%UNIQUE INDEX%'",
    ) === 't',
  );
  const ownerA = await user('owner-a');
  const ownerB = await user('owner-b');
  const member = await user('member');
  const viewer = await user('viewer');
  const successor = await user('successor');
  const familyA = await createFamily(ownerA, 'C4I Pet A');
  const familyB = await createFamily(ownerB, 'C4I Pet B');
  pass('no-Family account can create a Family', membershipCount(ownerA) === 1);
  const second = await ownerA.client.rpc('create_pet', {
    pet_name: 'Forbidden second Family',
    pet_species: 'other',
  });
  pass(
    'second Family create returns ALREADY_IN_FAMILY',
    hasError(second, 'ALREADY_IN_FAMILY') && membershipCount(ownerA) === 1,
  );
  const codeA = await invite(ownerA, familyA.familyId);
  const codeB = await invite(ownerB, familyB.familyId);
  const joinedA = await join(member, codeA);
  pass(
    'Family A invite accepts a no-Family Member',
    !joinedA.error && membershipCount(member) === 1,
  );
  seedMember(familyA.familyId, viewer, 'viewer');
  seedMember(familyA.familyId, successor, 'member');
  pass(
    'Member cannot create another Family',
    hasError(
      await member.client.rpc('create_pet', {
        pet_name: 'Forbidden',
        pet_species: 'other',
      }),
      'ALREADY_IN_FAMILY',
    ),
  );
  pass(
    'Member in A cannot join B',
    hasError(await join(member, codeB), 'ALREADY_IN_FAMILY'),
  );
  pass(
    'Viewer cannot create or join another Family',
    hasError(
      await viewer.client.rpc('create_pet', {
        pet_name: 'Forbidden',
        pet_species: 'other',
      }),
      'ALREADY_IN_FAMILY',
    ) && hasError(await join(viewer, codeB, true), 'ALREADY_IN_FAMILY'),
  );
  pass(
    'Owner cannot join another Family',
    hasError(await join(ownerA, codeB), 'ALREADY_IN_FAMILY'),
  );
  pass(
    'same-Family repeat join is denied',
    hasError(await join(member, codeA, true), 'ALREADY_IN_FAMILY'),
  );
  const familyCountBefore = count('select count(*) from public.families');
  const secondPet = await ownerA.client.rpc('create_family_pet', {
    target_family_id: familyA.familyId,
    pet_name: 'C4I Pet A2',
    pet_species: 'other',
  });
  pass(
    'Add Pet keeps the current Family and creates no Family',
    !secondPet.error &&
      secondPet.data?.family_id === familyA.familyId &&
      count('select count(*) from public.families') === familyCountBefore,
  );
  const familyMembers = await ownerA.client.rpc('get_family_members', {
    target_family_id: familyA.familyId,
  });
  const petMembersA = await ownerA.client.rpc('get_pet_members', {
    target_pet_id: familyA.petId,
  });
  const petMembersA2 = await ownerA.client.rpc('get_pet_members', {
    target_pet_id: secondPet.data.id,
  });
  pass(
    'all Pets expose the same canonical Family members',
    !familyMembers.error &&
      !petMembersA.error &&
      !petMembersA2.error &&
      JSON.stringify(familyMembers.data) === JSON.stringify(petMembersA.data) &&
      JSON.stringify(petMembersA.data) === JSON.stringify(petMembersA2.data),
  );
  const ownerLeave = await ownerA.client.rpc('leave_family', {
    target_family_id: familyA.familyId,
  });
  pass(
    'Owner direct leave remains blocked',
    Boolean(ownerLeave.error) && membershipCount(ownerA) === 1,
  );
  const memberLeave = await member.client.rpc('leave_family', {
    target_family_id: familyA.familyId,
  });
  const memberRejoin = await join(member, codeB);
  pass(
    'Member leaves A then joins B',
    !memberLeave.error && !memberRejoin.error && membershipCount(member) === 1,
  );
  const viewerLeave = await viewer.client.rpc('leave_family', {
    target_family_id: familyA.familyId,
  });
  const viewerRejoin = await join(viewer, codeB);
  pass(
    'Viewer leaves A then joins B',
    !viewerLeave.error && !viewerRejoin.error && membershipCount(viewer) === 1,
  );
  const ownerPrep = await ownerA.client.rpc('prepare_account_deletion');
  pass(
    'C4G still blocks deleting an Owner account',
    hasError(ownerPrep, 'ACCOUNT_OWNS_FAMILY'),
  );
  const createRacer = await user('create-racer');
  const createResults = await Promise.all(
    [0, 1].map((index) =>
      createRacer.client.rpc('create_pet', {
        pet_name: `C4I Race ${index}`,
        pet_species: 'other',
      }),
    ),
  );
  for (const result of createResults)
    if (result.data?.family_id) familyIds.add(result.data.family_id);
  pass(
    'concurrent create/create has one winner',
    createResults.filter((result) => !result.error).length === 1 &&
      membershipCount(createRacer) === 1,
  );
  const createJoinRacer = await user('create-join-racer');
  const createJoinResults = await Promise.all([
    createJoinRacer.client.rpc('create_pet', {
      pet_name: 'C4I Create Join',
      pet_species: 'other',
    }),
    join(createJoinRacer, codeA),
  ]);
  if (createJoinResults[0].data?.family_id)
    familyIds.add(createJoinResults[0].data.family_id);
  pass(
    'concurrent create/join has one winner',
    createJoinResults.filter((result) => !result.error).length === 1 &&
      membershipCount(createJoinRacer) === 1,
  );
  const inviteRacer = await user('invite-racer');
  const inviteResults = await Promise.all([
    join(inviteRacer, codeA),
    join(inviteRacer, codeB),
  ]);
  pass(
    'concurrent invite A/invite B has one winner',
    inviteResults.filter((result) => !result.error).length === 1 &&
      membershipCount(inviteRacer) === 1,
  );
  const deletionRacer = await user('deletion-racer');
  const raceInvite = await invite(ownerA, familyA.familyId);
  const [raceJoin, racePreparation] = await Promise.all([
    join(deletionRacer, raceInvite),
    deletionRacer.client.rpc('prepare_account_deletion'),
  ]);
  pass(
    'join vs account-deletion preparation leaves no active membership',
    !racePreparation.error &&
      membershipCount(deletionRacer) === 0 &&
      (raceJoin.error || raceJoin.data?.[0]?.join_status === 'joined'),
  );
  const transfer = await ownerA.client.rpc('transfer_family_ownership', {
    target_family_id: familyA.familyId,
    new_owner_user_id: successor.id,
  });
  const transferredLeave = await ownerA.client.rpc('leave_family', {
    target_family_id: familyA.familyId,
  });
  const transferredJoin = await join(ownerA, codeB);
  pass(
    'Owner transfers, leaves A, then joins B',
    !transfer.error &&
      !transferredLeave.error &&
      !transferredJoin.error &&
      membershipCount(ownerA) === 1,
  );
  pass(
    'A retains exactly one Owner after transfer',
    count(
      `select count(*) from public.family_members where family_id = '${familyA.familyId}'::uuid and role = 'owner'`,
    ) === 1,
  );
  const ownerC = await user('owner-c');
  const familyC = await createFamily(ownerC, 'C4I Zero Pet');
  const deletedPet = await ownerC.client.rpc('delete_family_pet', {
    target_pet_id: familyC.petId,
  });
  pass(
    'zero-Pet Family still counts as membership',
    !deletedPet.error &&
      count(
        `select count(*) from public.pets where family_id = '${familyC.familyId}'::uuid`,
      ) === 0 &&
      membershipCount(ownerC) === 1 &&
      hasError(
        await ownerC.client.rpc('create_pet', {
          pet_name: 'Forbidden',
          pet_species: 'other',
        }),
        'ALREADY_IN_FAMILY',
      ),
  );
  const deletedFamily = await ownerC.client.rpc('delete_family', {
    target_family_id: familyC.familyId,
  });
  const afterDelete = await join(ownerC, codeB);
  pass(
    'Owner deletes Family then joins B',
    !deletedFamily.error && !afterDelete.error && membershipCount(ownerC) === 1,
  );
  const prepared = await viewer.client.rpc('prepare_account_deletion');
  pass(
    'C4G Member/Viewer preparation clears membership',
    !prepared.error && membershipCount(viewer) === 0,
  );
  const preparedInvite = await invite(successor, familyA.familyId);
  const preparedJoin = await join(viewer, preparedInvite);
  const preparedCreate = await viewer.client.rpc('create_pet', {
    pet_name: 'Forbidden prepared',
    pet_species: 'other',
  });
  pass(
    `prepared account cannot join or create (${preparedJoin.error?.message ?? 'join succeeded'}; ${preparedCreate.error?.message ?? 'create succeeded'})`,
    Boolean(preparedJoin.error) &&
      Boolean(preparedCreate.error) &&
      membershipCount(viewer) === 0,
  );
  globalInvariant();
}
try {
  await run();
} finally {
  // All generated data lives only in the local reset database. Remove fixtures
  // without touching any pre-existing account or Family.
  for (const familyId of familyIds) {
    try {
      sql(
        `delete from public.pets where family_id = '${familyId}'::uuid; delete from public.families where id = '${familyId}'::uuid;`,
      );
    } catch (error) {
      console.error(
        `Fixture cleanup failed for Family ${familyId}: ${error.message}`,
      );
    }
  }
  for (const created of users) {
    const result = await admin.auth.admin.deleteUser(created.id);
    if (result.error)
      console.error(
        `Fixture cleanup failed for user ${created.id}: ${result.error.message}`,
      );
  }
}

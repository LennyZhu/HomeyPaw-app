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
  throw new Error('SAFETY STOP: Phase B1 verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error(
    'SAFETY STOP: Phase B1 requires a local Supabase DB container.',
  );
}

const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260919112419_multi_pet_family_phase_b1_compatibility_writes.sql',
  ),
  'utf8',
);
const users = [];
const createdFamilies = new Set();
const createdPets = new Set();

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

async function createUser(label) {
  const email = `phase-b1-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase B1 ${label}`, locale: 'en' },
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
    pet_breed: 'Phase B1 verifier',
    pet_description: 'Local membership and invite compatibility verification',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('create_pet failed.');
  }
  createdPets.add(created.data.id);
  createdFamilies.add(created.data.family_id);
  return created.data;
}

function backdateInvitePair(inviteId) {
  sql(`
    update public.pet_invites
    set created_at = created_at - interval '1 minute'
    where id = '${inviteId}'::uuid;
    update public.family_invites
    set created_at = created_at - interval '1 minute'
    where id = '${inviteId}'::uuid;
  `);
}

function expectDriftFree(label) {
  expectSql(
    label,
    `select
       not exists (select 1 from public.pets where family_id is null)
       and not exists (
         select pet.family_id
         from public.pets as pet
         left join public.families as family on family.id = pet.family_id
         where family.id is null
       )
       and not exists (
         select 1
         from public.pets as pet
         cross join public.family_members as family_member
         where family_member.family_id = pet.family_id
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
         where not exists (
           select 1
           from public.family_members as family_member
           where family_member.family_id = pet.family_id
             and family_member.user_id = pet_member.user_id
             and family_member.role = pet_member.role
             and family_member.created_at = pet_member.created_at
         )
       )
       and not exists (
         select pet.id
         from public.pets as pet
         left join public.pet_members as member
           on member.pet_id = pet.id and member.role = 'owner'
         group by pet.id
         having count(member.user_id) <> 1
       )
       and not exists (
         select 1
         from public.families as family
         where (
           select count(*)
           from public.family_members as member
           where member.family_id = family.id
             and member.role = 'owner'
         ) <> 1
       )
       and not exists (
         select 1
         from public.family_invites as family_invite
         where (
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
         ) <> case
           when exists (
             select 1
             from public.pets as family_pet
             where family_pet.family_id = family_invite.family_id
           ) then 1
           else 0
         end
       )
       and not exists (
         select 1
         from public.pet_invites as pet_invite
         where not exists (
           select 1
           from public.family_invites as family_invite
           where family_invite.id = pet_invite.id
         )
       );`,
  );
}

function installFailureTrigger(userId) {
  sql(`
    create or replace function private.phase_b1_inject_family_member_failure()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      if new.user_id = '${userId}'::uuid then
        raise exception 'phase_b1_injected_failure' using errcode = 'P0001';
      end if;
      return new;
    end;
    $$;
    revoke execute on function private.phase_b1_inject_family_member_failure()
      from public, anon, authenticated;
    create trigger phase_b1_inject_family_member_failure
    before insert on public.family_members
    for each row execute function private.phase_b1_inject_family_member_failure();
  `);
}

function removeFailureTrigger() {
  sql(`
    drop trigger if exists phase_b1_inject_family_member_failure
      on public.family_members;
    drop function if exists private.phase_b1_inject_family_member_failure();
  `);
}

async function cleanup() {
  removeFailureTrigger();
  for (const petId of createdPets) {
    sql(`delete from public.pets where id = '${petId}'::uuid;`);
  }
  for (const familyId of createdFamilies) {
    if (familyId) {
      sql(`delete from public.families where id = '${familyId}'::uuid;`);
    }
  }
  for (const user of users.reverse()) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

for (const requiredSql of [
  'create or replace function public.create_pet(',
  'create or replace function public.create_pet_invite(target_pet_id uuid)',
  'create or replace function public.revoke_pet_invite(target_pet_id uuid)',
  'create or replace function public.join_pet_with_invite(invite_code text)',
  'create or replace function public.remove_pet_member(',
  'join public.pet_members as member on member.pet_id = pet.id',
  'insert into public.family_members',
  'insert into public.family_invites',
  'set family_id = repair.family_id',
]) {
  expect(
    migration.includes(requiredSql),
    `B1 migration is missing: ${requiredSql}`,
  );
}

for (const forbiddenSql of [
  'create or replace function private.is_pet_member',
  'create or replace function private.is_pet_owner',
  'create or replace function private.can_contribute_to_pet',
  'chat_messages',
  'care_shifts',
  'family_notification_outbox',
  'post_videos',
]) {
  expect(
    !migration.includes(forbiddenSql),
    `B1 changed forbidden scope: ${forbiddenSql}`,
  );
}

expectSql(
  'Legacy public RPC signatures remain available.',
  `select
     to_regprocedure('public.create_pet(text,public.pet_species,text,public.pet_gender,date,date,numeric,text)') is not null
     and to_regprocedure('public.create_pet_invite(uuid)') is not null
     and to_regprocedure('public.preview_pet_invite(text)') is not null
     and to_regprocedure('public.join_pet_with_invite(text)') is not null
     and to_regprocedure('public.revoke_pet_invite(uuid)') is not null
     and to_regprocedure('public.remove_pet_member(uuid,uuid)') is not null
     and to_regprocedure('public.get_pet_members(uuid)') is not null;`,
);

expectDriftFree('The live transitional database has no Family mirror drift.');

if (process.env.PAWDAY_PHASE_B1_SKIP_MUTATION_MATRIX !== '1') {
  const owner = await createUser('owner');
  const member = await createUser('member');
  const failingPetOwner = await createUser('failing-pet-owner');
  const failingJoiner = await createUser('failing-joiner');
  const stranger = await createUser('stranger');

  try {
    const pet = await createPet(owner, 'Phase B1 Pet');
    expect(pet.family_id, 'create_pet returned a null Family ID.');
    expect(pet.family_id !== pet.id, 'A new Family reused its Pet ID.');
    expectSql(
      'create_pet created exact Owner rows in both membership tables.',
      `select
         exists (select 1 from public.families where id = '${pet.family_id}'::uuid)
         and (select count(*) from public.pet_members where pet_id = '${pet.id}'::uuid and role = 'owner') = 1
         and (select count(*) from public.family_members where family_id = '${pet.family_id}'::uuid and role = 'owner') = 1
         and exists (
           select 1
           from public.pet_members as pet_member
           join public.family_members as family_member
             on family_member.family_id = '${pet.family_id}'::uuid
            and family_member.user_id = pet_member.user_id
            and family_member.role = pet_member.role
            and family_member.created_at = pet_member.created_at
           where pet_member.pet_id = '${pet.id}'::uuid
             and pet_member.user_id = '${owner.id}'::uuid
       );`,
    );

    const forgedMember = await stranger.client.from('pet_members').insert({
      pet_id: pet.id,
      role: 'member',
      user_id: stranger.id,
    });
    expect(forgedMember.error, 'A Stranger forged a direct Pet membership.');

    const forgedInvite = await owner.client.from('pet_invites').insert({
      code_hash: 'f'.repeat(64),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      invited_by: owner.id,
      max_uses: 5,
      pet_id: pet.id,
      used_count: 0,
    });
    expect(
      forgedInvite.error,
      'An Owner bypassed the invite RPC with a direct write.',
    );

    const strangerMembers = await stranger.client.rpc('get_pet_members', {
      target_pet_id: pet.id,
    });
    expect(
      strangerMembers.error || strangerMembers.data?.length === 0,
      'A Stranger read the Pet membership list.',
    );
    console.log(
      'PASS: legacy invite/member direct-write and membership-read boundaries.',
    );

    const strangerInvite = await stranger.client.rpc('create_pet_invite', {
      target_pet_id: pet.id,
    });
    expect(strangerInvite.error, 'A Stranger created a Pet invite.');

    const createdInviteResult = await owner.client.rpc('create_pet_invite', {
      target_pet_id: pet.id,
    });
    const firstInvite = createdInviteResult.data?.[0];
    if (createdInviteResult.error || !firstInvite) {
      throw createdInviteResult.error ?? new Error('create_pet_invite failed.');
    }
    expectSql(
      'create_pet_invite wrote one exact invite identity to both tables.',
      `select exists (
         select 1
         from public.pet_invites as pet_invite
         join public.pets as pet on pet.id = pet_invite.pet_id
         join public.family_invites as family_invite
           on family_invite.id = pet_invite.id
          and family_invite.family_id = pet.family_id
          and family_invite.invited_by = pet_invite.invited_by
          and family_invite.code_hash = pet_invite.code_hash
          and family_invite.expires_at = pet_invite.expires_at
          and family_invite.max_uses = pet_invite.max_uses
          and family_invite.used_count = pet_invite.used_count
          and family_invite.revoked_at is not distinct from pet_invite.revoked_at
          and family_invite.created_at = pet_invite.created_at
         where pet_invite.id = '${firstInvite.invite_id}'::uuid
       );`,
    );

    const preview = await member.client.rpc('preview_pet_invite', {
      invite_code: firstInvite.invite_code,
    });
    expect(
      !preview.error && preview.data?.length === 1,
      'Legacy invite preview failed.',
    );

    const joined = await member.client.rpc('join_pet_with_invite', {
      invite_code: firstInvite.invite_code,
    });
    expect(
      !joined.error && joined.data?.[0]?.join_status === 'joined',
      `Invite join failed (${joined.error?.message ?? 'no result'}).`,
    );
    expectSql(
      'join_pet_with_invite matched membership and use-count state.',
      `select
         exists (
           select 1
           from public.pet_members as pet_member
           join public.pets as pet on pet.id = pet_member.pet_id
           join public.family_members as family_member
             on family_member.family_id = pet.family_id
            and family_member.user_id = pet_member.user_id
            and family_member.role = pet_member.role
            and family_member.created_at = pet_member.created_at
           where pet_member.pet_id = '${pet.id}'::uuid
             and pet_member.user_id = '${member.id}'::uuid
         )
         and exists (
           select 1
           from public.pet_invites as pet_invite
           join public.family_invites as family_invite
             on family_invite.id = pet_invite.id
            and family_invite.used_count = pet_invite.used_count
           where pet_invite.id = '${firstInvite.invite_id}'::uuid
             and pet_invite.used_count = 1
         );`,
    );

    const repeatedJoin = await member.client.rpc('join_pet_with_invite', {
      invite_code: firstInvite.invite_code,
    });
    expect(
      !repeatedJoin.error &&
        repeatedJoin.data?.[0]?.join_status === 'already_member',
      'Repeated invite join lost idempotency.',
    );
    expectSql(
      'Repeated invite join did not increment either use counter.',
      `select
         (select used_count from public.pet_invites where id = '${firstInvite.invite_id}'::uuid) = 1
         and (select used_count from public.family_invites where id = '${firstInvite.invite_id}'::uuid) = 1;`,
    );

    backdateInvitePair(firstInvite.invite_id);
    const replacementResult = await owner.client.rpc('create_pet_invite', {
      target_pet_id: pet.id,
    });
    const replacementInvite = replacementResult.data?.[0];
    if (replacementResult.error || !replacementInvite) {
      throw replacementResult.error ?? new Error('Replacement invite failed.');
    }
    expectSql(
      'Invite replacement revoked the prior invite on both sides.',
      `select exists (
         select 1
         from public.pet_invites as pet_invite
         join public.family_invites as family_invite on family_invite.id = pet_invite.id
         where pet_invite.id = '${firstInvite.invite_id}'::uuid
           and pet_invite.revoked_at is not null
           and family_invite.revoked_at = pet_invite.revoked_at
       );`,
    );

    const revoked = await owner.client.rpc('revoke_pet_invite', {
      target_pet_id: pet.id,
    });
    expect(
      !revoked.error && revoked.data === true,
      'Invite revocation failed.',
    );
    expectSql(
      'revoke_pet_invite wrote the exact revocation state to both tables.',
      `select exists (
         select 1
         from public.pet_invites as pet_invite
         join public.family_invites as family_invite on family_invite.id = pet_invite.id
         where pet_invite.id = '${replacementInvite.invite_id}'::uuid
           and pet_invite.revoked_at is not null
           and family_invite.revoked_at = pet_invite.revoked_at
       );`,
    );

    backdateInvitePair(replacementInvite.invite_id);
    const removalInviteResult = await owner.client.rpc('create_pet_invite', {
      target_pet_id: pet.id,
    });
    const removalInvite = removalInviteResult.data?.[0];
    if (removalInviteResult.error || !removalInvite) {
      throw removalInviteResult.error ?? new Error('Removal invite failed.');
    }
    const versionBeforeRemoval = await owner.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: pet.id },
    );
    if (versionBeforeRemoval.error) throw versionBeforeRemoval.error;

    const removed = await owner.client.rpc('remove_pet_member', {
      target_pet_id: pet.id,
      target_user_id: member.id,
    });
    expect(
      !removed.error && removed.data === 'removed',
      'Member removal failed.',
    );
    const versionAfterRemoval = await owner.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: pet.id },
    );
    if (versionAfterRemoval.error) throw versionAfterRemoval.error;
    expect(
      Number(versionAfterRemoval.data) ===
        Number(versionBeforeRemoval.data) + 1,
      'Member removal did not preserve Chat channel rotation.',
    );
    expectSql(
      'remove_pet_member removed both rows and revoked both invite mirrors.',
      `select
         not exists (
           select 1 from public.pet_members
           where pet_id = '${pet.id}'::uuid and user_id = '${member.id}'::uuid
         )
         and not exists (
           select 1 from public.family_members
           where family_id = '${pet.family_id}'::uuid and user_id = '${member.id}'::uuid
         )
         and exists (
           select 1
           from public.pet_invites as pet_invite
           join public.family_invites as family_invite on family_invite.id = pet_invite.id
           where pet_invite.id = '${removalInvite.invite_id}'::uuid
             and pet_invite.revoked_at is not null
             and family_invite.revoked_at = pet_invite.revoked_at
         );`,
    );

    const repeatedRemoval = await owner.client.rpc('remove_pet_member', {
      target_pet_id: pet.id,
      target_user_id: member.id,
    });
    expect(
      !repeatedRemoval.error && repeatedRemoval.data === 'not_found',
      'Repeated removal changed its legacy result.',
    );

    const invalidJoin = await stranger.client.rpc('join_pet_with_invite', {
      invite_code: 'ZZZZZZZZ',
    });
    expect(invalidJoin.error, 'An invalid invite code joined a Pet.');

    const familyCountBeforeFailure = Number(
      sql('select count(*) from public.families;'),
    );
    installFailureTrigger(failingPetOwner.id);
    const failedPet = await failingPetOwner.client.rpc('create_pet', {
      pet_gender: 'unknown',
      pet_name: 'Phase B1 injected create failure',
      pet_species: 'other',
    });
    removeFailureTrigger();
    expect(
      failedPet.error,
      'Injected Family Owner mirror failure did not fail.',
    );
    expectSql(
      'create_pet failure rolled back Pet, Family, and legacy membership.',
      `select
         (select count(*) from public.families) = ${familyCountBeforeFailure}
         and not exists (
           select 1 from public.pets where name = 'Phase B1 injected create failure'
         )
         and not exists (
           select 1 from public.pet_members where user_id = '${failingPetOwner.id}'::uuid
         )
         and not exists (
           select 1 from public.family_members where user_id = '${failingPetOwner.id}'::uuid
         );`,
    );

    backdateInvitePair(removalInvite.invite_id);
    const failureInviteResult = await owner.client.rpc('create_pet_invite', {
      target_pet_id: pet.id,
    });
    const failureInvite = failureInviteResult.data?.[0];
    if (failureInviteResult.error || !failureInvite) {
      throw (
        failureInviteResult.error ?? new Error('Failure-test invite failed.')
      );
    }
    const versionBeforeFailedJoin = await owner.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: pet.id },
    );
    if (versionBeforeFailedJoin.error) throw versionBeforeFailedJoin.error;
    installFailureTrigger(failingJoiner.id);
    const failedJoin = await failingJoiner.client.rpc('join_pet_with_invite', {
      invite_code: failureInvite.invite_code,
    });
    removeFailureTrigger();
    expect(
      failedJoin.error,
      'Injected Family membership failure did not fail.',
    );
    const versionAfterFailedJoin = await owner.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: pet.id },
    );
    if (versionAfterFailedJoin.error) throw versionAfterFailedJoin.error;
    expect(
      Number(versionAfterFailedJoin.data) ===
        Number(versionBeforeFailedJoin.data),
      'Failed join did not roll back Chat version rotation.',
    );
    expectSql(
      'Join failure rolled back memberships and both invite counters.',
      `select
         not exists (
           select 1 from public.pet_members
           where pet_id = '${pet.id}'::uuid and user_id = '${failingJoiner.id}'::uuid
         )
         and not exists (
           select 1 from public.family_members
           where family_id = '${pet.family_id}'::uuid and user_id = '${failingJoiner.id}'::uuid
         )
         and (select used_count from public.pet_invites where id = '${failureInvite.invite_id}'::uuid) = 0
         and (select used_count from public.family_invites where id = '${failureInvite.invite_id}'::uuid) = 0;`,
    );

    expectDriftFree(
      'All successful, repeated, rejected, and failed mutations are drift-free.',
    );
    console.log(
      'PASS: Phase B1 mutation matrix and transaction rollback checks.',
    );
  } finally {
    await cleanup();
  }
}

console.log(
  'PASS: Multi-Pet Family Phase B1 compatibility verification complete.',
);

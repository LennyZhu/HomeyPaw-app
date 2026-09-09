import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

const localUrl = process.env.SUPABASE_LOCAL_URL?.trim();
const localAnonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (!localUrl || !localAnonKey || !localServiceRoleKey) {
  throw new Error(
    'Local-only keys are required: SUPABASE_LOCAL_URL, SUPABASE_LOCAL_ANON_KEY, and SUPABASE_LOCAL_SERVICE_ROLE_KEY.',
  );
}
if (!['127.0.0.1', 'localhost'].includes(new URL(localUrl).hostname)) {
  throw new Error('SAFETY STOP: family cap verification is local only.');
}

const admin = createClient(localUrl, localServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
let petId = null;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function assertUuid(value) {
  expect(
    typeof value === 'string' && /^[0-9a-f-]{36}$/iu.test(value),
    'Invalid fixture UUID.',
  );
  return value;
}

function runLocalSql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      'supabase_db_pawday',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function createUser(label) {
  const email = `family-cap-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = createClient(localUrl, localAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const user = { client, id: created.data.user.id };
  users.push(user);
  return user;
}

async function activeMemberCount(owner) {
  const result = await owner.client.rpc('get_pet_members', {
    target_pet_id: petId,
  });
  if (result.error) throw result.error;
  return result.data.filter((row) =>
    ['owner', 'member'].includes(row.member_role),
  ).length;
}

async function main() {
  const owner = await createUser('owner');
  const candidates = [];
  for (let index = 0; index < 11; index += 1) {
    candidates.push(await createUser(`member-${index + 1}`));
  }
  const viewer = await createUser('viewer');

  try {
    const createdPet = await owner.client.rpc('create_pet', {
      pet_description: 'Local family cap verifier',
      pet_gender: 'unknown',
      pet_name: 'Family Cap Pet',
      pet_species: 'other',
    });
    if (createdPet.error || !createdPet.data) throw createdPet.error;
    petId = assertUuid(createdPet.data.id);

    const initialMembers = candidates.slice(0, 8);
    runLocalSql(`
      insert into public.pet_members (pet_id, user_id, role)
      values ${initialMembers
        .map(
          (user) =>
            `('${petId}'::uuid, '${assertUuid(user.id)}'::uuid, 'member'::public.pet_member_role)`,
        )
        .join(', ')};
    `);
    expect(
      (await activeMemberCount(owner)) === 9,
      'Fixture did not reach owner plus eight members.',
    );

    const inviteCodes = ['23456789', 'ABCDEFGH', '34567892'];
    runLocalSql(`
      insert into public.pet_invites (
        pet_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses
      ) values (
        '${petId}'::uuid,
        '${assertUuid(owner.id)}'::uuid,
        private.pet_invite_code_hash('${inviteCodes[0]}'),
        now() + interval '1 day',
        5
      );
    `);

    const concurrentAttempts = await Promise.all(
      [candidates[8], candidates[9]].map((user, index) =>
        user.client.rpc('join_pet_with_invite', {
          invite_code: inviteCodes[0],
        }),
      ),
    );
    const winners = concurrentAttempts
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => !result.error);
    const losers = concurrentAttempts
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.error);
    expect(
      winners.length === 1,
      'Concurrent family joins had no single winner.',
    );
    expect(losers.length === 1, 'Concurrent family joins had no single loser.');
    expect(
      losers[0].result.error.message.includes('family_member_limit_reached'),
      'Concurrent losing join did not return the family limit error.',
    );
    expect(
      (await activeMemberCount(owner)) === 10,
      'Concurrent joins exceeded or missed the ten-person cap.',
    );

    const winner = candidates[8 + winners[0].index];
    const winnerRepeat = await winner.client.rpc('join_pet_with_invite', {
      invite_code: inviteCodes[0],
    });
    expect(
      !winnerRepeat.error &&
        winnerRepeat.data?.[0]?.join_status === 'already_member',
      'Existing member reuse stopped being idempotent at capacity.',
    );

    runLocalSql(`
      update public.pet_invites
      set revoked_at = now()
      where pet_id = '${petId}'::uuid and revoked_at is null;

      insert into public.pet_invites (
        pet_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses
      ) values (
        '${petId}'::uuid,
        '${assertUuid(owner.id)}'::uuid,
        private.pet_invite_code_hash('${inviteCodes[1]}'),
        now() + interval '1 day',
        5
      );
    `);
    const eleventh = await candidates[10].client.rpc('join_pet_with_invite', {
      invite_code: inviteCodes[1],
    });
    expect(
      eleventh.error?.message.includes('family_member_limit_reached'),
      'The eleventh owner/member was not rejected.',
    );
    const forgedMembership = await candidates[10].client
      .from('pet_members')
      .insert({ pet_id: petId, role: 'member', user_id: candidates[10].id });
    expect(forgedMembership.error, 'Stranger forged a direct membership.');

    const removal = await owner.client.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: initialMembers[0].id,
    });
    if (removal.error) throw removal.error;
    expect(
      (await activeMemberCount(owner)) === 9,
      'Member removal did not free one family slot.',
    );

    runLocalSql(`
      insert into public.pet_invites (
        pet_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses
      ) values (
        '${petId}'::uuid,
        '${assertUuid(owner.id)}'::uuid,
        private.pet_invite_code_hash('${inviteCodes[2]}'),
        now() + interval '1 day',
        5
      );
    `);
    const retry = await candidates[10].client.rpc('join_pet_with_invite', {
      invite_code: inviteCodes[2],
    });
    expect(
      !retry.error && retry.data?.[0]?.join_status === 'joined',
      `A removed member slot could not be reused (${retry.error?.message ?? 'no joined result'}).`,
    );
    expect(
      (await activeMemberCount(owner)) === 10,
      'Reused family slot did not return the count to ten.',
    );

    runLocalSql(`
      insert into public.pet_members (pet_id, user_id, role)
      values ('${petId}'::uuid, '${assertUuid(viewer.id)}'::uuid, 'viewer'::public.pet_member_role);
    `);
    expect(
      (await activeMemberCount(owner)) === 10,
      'Dormant viewer incorrectly counted toward the product member cap.',
    );
    const viewerChat = await viewer.client.rpc('get_pet_chat_channel_version', {
      target_pet_id: petId,
    });
    expect(viewerChat.error, 'Viewer gained formal family Chat permission.');

    console.log(
      'PASS: owner plus eight members admits exactly one tenth person.',
    );
    console.log(
      'PASS: concurrent joins share one transaction-safe final slot.',
    );
    console.log(
      'PASS: a regenerated invite code cannot bypass the global cap.',
    );
    console.log(
      'PASS: the eleventh join is rejected and idempotency is preserved.',
    );
    console.log('PASS: removal frees one slot for a later join.');
    console.log(
      'PASS: direct forgery fails and viewer permissions remain dormant.',
    );
  } finally {
    if (petId) {
      runLocalSql(`delete from public.pets where id = '${petId}'::uuid;`);
    }
    for (const user of users) {
      await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    }
  }
}

await main();

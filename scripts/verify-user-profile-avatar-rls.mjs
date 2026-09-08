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
  throw new Error(
    'SAFETY STOP: profile avatar RLS verification is local only.',
  );
}

const admin = createClient(localUrl, localServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
let petId = null;
let avatarPath = null;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function runLocalSql(sql) {
  execFileSync(
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
  const email = `avatar-${label.toLowerCase()}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (error || !data.user) throw error ?? new Error(`${label} create failed`);

  const client = createClient(localUrl, localAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const user = { client, id: data.user.id };
  users.push(user);
  return user;
}

async function main() {
  const owner = await createUser('Owner');
  const member = await createUser('Member');
  const stranger = await createUser('Stranger');

  const pet = await owner.client.rpc('create_pet', {
    pet_description: 'Local profile avatar RLS fixture',
    pet_gender: 'unknown',
    pet_name: `Avatar Pet ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
  });
  if (pet.error || !pet.data) throw pet.error ?? new Error('Pet create failed');
  petId = pet.data.id;
  runLocalSql(
    `insert into public.pet_members (pet_id, user_id, role) values ('${petId}'::uuid, '${member.id}'::uuid, 'member'::public.pet_member_role);`,
  );

  avatarPath = `${owner.id}/${randomUUID()}.jpg`;
  const upload = await owner.client.storage
    .from('profile-avatars')
    .upload(avatarPath, new Uint8Array([255, 216, 255, 217]), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  expect(!upload.error, `Owner upload failed: ${upload.error?.message}`);

  const update = await owner.client
    .from('profiles')
    .update({ avatar_url: avatarPath })
    .eq('id', owner.id)
    .select('avatar_url')
    .single();
  expect(update.data?.avatar_url === avatarPath, 'Owner could not set avatar.');

  const memberRead = await member.client.storage
    .from('profile-avatars')
    .download(avatarPath);
  expect(!memberRead.error, 'Active family Member could not read avatar.');
  const strangerRead = await stranger.client.storage
    .from('profile-avatars')
    .download(avatarPath);
  expect(Boolean(strangerRead.error), 'Stranger read a private avatar.');

  const foreignUpload = await member.client.storage
    .from('profile-avatars')
    .upload(
      `${owner.id}/${randomUUID()}.jpg`,
      new Uint8Array([255, 216, 255, 217]),
      { contentType: 'image/jpeg' },
    );
  expect(Boolean(foreignUpload.error), 'Member uploaded into owner folder.');

  const foreignProfileUpdate = await member.client
    .from('profiles')
    .update({ avatar_url: `${member.id}/${randomUUID()}.jpg` })
    .eq('id', owner.id)
    .select('id');
  expect(
    !foreignProfileUpdate.error && foreignProfileUpdate.data.length === 0,
    'Member modified the owner profile.',
  );

  const forgedOwnUpdate = await owner.client
    .from('profiles')
    .update({ avatar_url: `${member.id}/${randomUUID()}.jpg` })
    .eq('id', owner.id);
  expect(
    Boolean(forgedOwnUpdate.error),
    'Owner referenced another user folder.',
  );

  const chatMembers = await member.client.rpc('get_pet_chat_members', {
    target_pet_id: petId,
  });
  expect(!chatMembers.error, 'Chat member projection failed.');
  expect(
    chatMembers.data.some(
      (row) =>
        row.member_user_id === owner.id && row.member_avatar_url === avatarPath,
    ),
    'Chat projection did not return the safe avatar path.',
  );
  const familyMembers = await member.client.rpc('get_pet_members', {
    target_pet_id: petId,
  });
  expect(!familyMembers.error, 'Family member projection failed.');
  expect(
    familyMembers.data.some(
      (row) =>
        row.member_user_id === owner.id &&
        row.member_avatar_path === avatarPath,
    ),
    'Family projection did not return the safe avatar path.',
  );

  runLocalSql(
    `delete from public.pet_members where pet_id = '${petId}'::uuid and user_id = '${member.id}'::uuid;`,
  );
  const removedMemberRead = await member.client.storage
    .from('profile-avatars')
    .download(avatarPath);
  expect(
    Boolean(removedMemberRead.error),
    'Removed Member retained avatar read.',
  );

  console.log('PASS: own profile avatar upload, update, and path validation.');
  console.log('PASS: active family read and stranger/removed-member denial.');
  console.log(
    'PASS: Chat and Family receive only the private avatar object path.',
  );
}

try {
  await main();
} finally {
  if (avatarPath && users[0]) {
    await users[0].client.storage.from('profile-avatars').remove([avatarPath]);
  }
  if (petId) {
    runLocalSql(`delete from public.pets where id = '${petId}'::uuid;`);
  }
  for (const user of users.reverse()) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

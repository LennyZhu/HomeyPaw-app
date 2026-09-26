import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { checkAppReleaseGate } from '../supabase/functions/_shared/app-release-gate.mjs';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
if (
  !url ||
  !anonKey ||
  !serviceKey ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
) {
  throw new Error('SAFETY STOP: local Supabase credentials are required.');
}

function sql(statement) {
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
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function expectLock(label, result) {
  assert.match(result.error?.message ?? '', /PRE_CUTOVER_RELEASE_LOCK/u, label);
  console.log(`PASS: ${label}`);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const client = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const initial = sql(
  'select enabled from private.pre_cutover_release_lock where singleton;',
);
assert.equal(initial, 't', 'Migration must default to locked.');
console.log('PASS: earliest migration defaults to locked');

let userId;
let newUserId;
let petId;
let familyId;
let postId;
let avatarPath;
let shiftTaskId;
let shiftAt;
try {
  // Fixture setup uses the same trusted direct-SQL operation as the runbook.
  sql(
    'update private.pre_cutover_release_lock set enabled=false where singleton;',
  );
  const email = `cutover-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Cutover Fixture' },
  });
  if (created.error || !created.data.user) throw created.error;
  userId = created.data.user.id;
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const newEmail = `cutover-new-${randomUUID()}@example.test`;
  const newPassword = `Local-${randomUUID()}-Aa1!`;
  const newUser = await admin.auth.admin.createUser({
    email: newEmail,
    password: newPassword,
    email_confirm: true,
  });
  if (newUser.error || !newUser.data.user) throw newUser.error;
  newUserId = newUser.data.user.id;
  const newClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const newSigned = await newClient.auth.signInWithPassword({
    email: newEmail,
    password: newPassword,
  });
  if (newSigned.error) throw newSigned.error;
  const pet = await client.rpc('create_pet', {
    pet_name: 'Cutover fixture',
    pet_species: 'other',
  });
  if (pet.error || !pet.data) throw pet.error;
  petId = pet.data.id;
  familyId = pet.data.family_id;
  postId = randomUUID();
  const post = await client.rpc('create_post', {
    post_id: postId,
    post_pet_id: petId,
    post_content: 'Cutover fixture',
    post_tag: 'other',
    post_event_date: new Date().toISOString().slice(0, 10),
    post_location_name: null,
  });
  if (post.error) throw post.error;
  shiftTaskId = randomUUID();
  shiftAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const task = await client.rpc('create_care_task', {
    task_id: shiftTaskId,
    target_pet_id: petId,
    task_title: 'Cutover shift fixture',
    task_care_type: 'other',
    task_note: null,
    task_schedule_type: 'once',
    task_scheduled_at: shiftAt,
    task_starts_on: null,
    task_local_time: null,
    task_time_zone: 'UTC',
    task_week_day: null,
    task_month_day: null,
  });
  if (task.error) throw task.error;
  avatarPath = `${userId}/${petId}/cutover-existing-${randomUUID()}.png`;
  const avatar = await client.storage
    .from('pet-avatars')
    .upload(avatarPath, new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
    });
  if (avatar.error) throw avatar.error;

  sql(
    'update private.pre_cutover_release_lock set enabled=true where singleton;',
  );
  assert.equal(
    sql(
      'select enabled from private.pre_cutover_release_lock where singleton;',
    ),
    't',
  );
  expectLock(
    'ordinary authenticated profile update blocked',
    await client
      .from('profiles')
      .update({ display_name: 'Blocked' })
      .eq('id', userId),
  );
  expectLock(
    'SECURITY DEFINER create_pet blocked',
    await newClient.rpc('create_pet', {
      pet_name: 'Blocked',
      pet_species: 'other',
    }),
  );
  expectLock(
    'SECURITY DEFINER create_family_pet blocked',
    await client.rpc('create_family_pet', {
      target_family_id: familyId,
      pet_name: 'Blocked',
      pet_species: 'other',
    }),
  );
  expectLock(
    'Family invite mutation blocked',
    await client.rpc('create_family_invite', { target_family_id: familyId }),
  );
  expectLock(
    'Journal mutation blocked',
    await client.rpc('create_post', {
      post_id: randomUUID(),
      post_pet_id: petId,
      post_content: 'Blocked',
      post_tag: 'other',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
    }),
  );
  expectLock(
    'Journal Video SECURITY DEFINER mutation blocked',
    await client.rpc('create_post_v2', {
      post_id: randomUUID(),
      post_pet_id: petId,
      post_content: 'Blocked video RPC',
      post_tag: 'other',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
    }),
  );
  expectLock(
    'Journal Video SECURITY DEFINER update blocked',
    await client.rpc('update_post_v2', {
      target_post_id: postId,
      post_content: 'Blocked video update',
      post_tag: 'other',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
    }),
  );
  expectLock(
    'Care mutation blocked',
    await client.rpc('create_care_log', {
      care_id: randomUUID(),
      target_pet_id: petId,
      care_kind: 'feeding',
      care_occurred_at: new Date().toISOString(),
      care_time_zone: 'UTC',
    }),
  );
  expectLock(
    'Chat mutation blocked',
    await client.rpc('send_chat_message', {
      target_pet_id: petId,
      target_client_message_id: randomUUID(),
      message_body: 'Blocked',
    }),
  );
  expectLock(
    'Schedule mutation blocked',
    await client.rpc('create_care_shift', {
      shift_id: randomUUID(),
      target_pet_id: petId,
      shift_local_date: shiftAt.slice(0, 10),
      target_assignee_user_id: userId,
      shift_note: null,
      task_items: [
        { care_task_id: shiftTaskId, source_scheduled_for: shiftAt },
      ],
    }),
  );
  const edgeGate = await checkAppReleaseGate(admin, new Request(url));
  assert.deepEqual(edgeGate, {
    status: 503,
    error: 'PRE_CUTOVER_RELEASE_LOCK',
  });
  for (const [functionName, body] of [
    ['delete-post', { postId }],
    ['delete-pet', { petId }],
    ['delete-account', { confirmation: 'DELETE_MY_ACCOUNT' }],
  ]) {
    const response = await fetch(`${url}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signed.data.session.access_token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 503, `${functionName} did not fail closed.`);
    assert.equal(payload.error, 'PRE_CUTOVER_RELEASE_LOCK');
  }
  console.log('PASS: all three destructive Edge functions blocked');
  const upload = await client.storage
    .from('pet-avatars')
    .upload(
      `${userId}/${petId}/cutover-${randomUUID()}.png`,
      new Uint8Array([1, 2, 3]),
      { contentType: 'image/png' },
    );
  assert.ok(upload.error, 'Authenticated Storage upload must be blocked.');
  console.log('PASS: authenticated Storage upload blocked');
  const replace = await client.storage
    .from('pet-avatars')
    .update(avatarPath, new Uint8Array([4, 5, 6]), {
      contentType: 'image/png',
    });
  assert.ok(
    replace.error,
    'Authenticated Storage replacement must be blocked.',
  );
  const directRemove = await client.storage
    .from('pet-avatars')
    .remove([avatarPath]);
  assert.ok(
    directRemove.error || directRemove.data?.length === 0,
    'Authenticated Storage delete unexpectedly removed an object.',
  );
  const stillPresent = await client.storage
    .from('pet-avatars')
    .download(avatarPath);
  assert.ok(!stillPresent.error, 'Authenticated Storage delete removed bytes.');
  const serviceUpload = await admin.storage
    .from('pet-avatars')
    .upload(
      `${userId}/${petId}/service-${randomUUID()}.png`,
      new Uint8Array([7]),
      {
        contentType: 'image/png',
      },
    );
  assert.ok(serviceUpload.error, 'Service-key Storage upload must be blocked.');
  console.log('PASS: Storage replace/delete and service-key upload blocked');
  const legacyEdgeRemove = await admin.storage
    .from('pet-avatars')
    .remove([avatarPath]);
  assert.ok(
    legacyEdgeRemove.error,
    'Service-key Storage delete must be blocked.',
  );
  const retained = await client.storage
    .from('pet-avatars')
    .download(avatarPath);
  assert.ok(!retained.error, 'Blocked Storage delete removed object bytes.');
  console.log('PASS: service-key Storage delete blocked with object retained');
  const tamper = await client.rpc('is_pre_cutover_release_locked');
  assert.equal(tamper.data, true);
  const disable = await client
    .schema('private')
    .from('pre_cutover_release_lock')
    .update({ enabled: false })
    .eq('singleton', true);
  assert.ok(disable.error, 'Ordinary caller must not update the lock.');
  assert.equal(
    sql(
      'select enabled from private.pre_cutover_release_lock where singleton;',
    ),
    't',
  );
  console.log('PASS: ordinary caller cannot disable lock');
  const serviceMutation = await admin.from('posts').delete().eq('id', postId);
  expectLock('service-role PostgREST write blocked', serviceMutation);
  const authDelete = await admin.auth.admin.deleteUser(userId);
  assert.ok(authDelete.error, 'Admin Auth deletion must be blocked.');
  console.log('PASS: legacy delete-account Auth deletion blocked');
  assert.equal(
    sql(
      'select enabled from private.pre_cutover_release_lock where singleton;',
    ),
    't',
    'Failed mutations must leave the lock enabled.',
  );
  assert.equal(
    sql("select to_regclass('public.app_release_policy') is not null;"),
    't',
    'R3 migration must be installed in the full-chain test.',
  );
  assert.throws(() =>
    sql(
      'begin; create table private.cutover_failed_migration_probe(id integer); select 1/0; commit;',
    ),
  );
  assert.equal(
    sql(
      "select to_regclass('private.cutover_failed_migration_probe') is null;",
    ),
    't',
    'Failed migration transaction was not rolled back.',
  );
  assert.equal(
    sql(
      'select enabled from private.pre_cutover_release_lock where singleton;',
    ),
    't',
    'Migration failure released the cutover lock.',
  );
  console.log('PASS: mid-migration failure leaves lock enabled');

  sql(
    'update private.pre_cutover_release_lock set enabled=false where singleton;',
  );
  const resumed = await client.rpc('create_family_pet', {
    target_family_id: familyId,
    pet_name: 'Resumed',
    pet_species: 'other',
  });
  assert.ok(!resumed.error && resumed.data, resumed.error?.message);
  console.log('PASS: trusted unlock restores supported writes');
} finally {
  // This verifier leaves the local DB unlocked for the regular regression suite.
  sql(
    'update private.pre_cutover_release_lock set enabled=false where singleton;',
  );
  if (avatarPath) await admin.storage.from('pet-avatars').remove([avatarPath]);
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
  }
  if (newUserId) {
    await admin.auth.admin.deleteUser(newUserId);
  }
}

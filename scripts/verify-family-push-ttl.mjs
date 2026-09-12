import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_LOCAL_URL?.trim();
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();
if (!url || !anonKey || !serviceKey) {
  throw new Error('Local Supabase credentials are required.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: Push TTL verification only runs locally.');
}

const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceKey, options);
const workerA = createClient(url, serviceKey, options);
const workerB = createClient(url, serviceKey, options);
const users = [];
const petIds = [];

function expect(value, message) {
  if (!value) throw new Error(message);
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
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
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

async function createUser(label) {
  const email = `push-ttl-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const client = createClient(url, anonKey, options);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const user = { client, id: created.data.user.id };
  users.push(user);
  return user;
}

async function createPet(owner, label) {
  const created = await owner.client.rpc('create_pet', {
    pet_description: 'Local Push TTL fixture',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 6)}`,
    pet_species: 'other',
  });
  if (created.error || !created.data) throw created.error;
  petIds.push(created.data.id);
  return created.data.id;
}

function addMember(petId, userId) {
  sql(
    `insert into public.pet_members (pet_id,user_id,role) values ('${petId}'::uuid,'${userId}'::uuid,'member');`,
  );
}

async function register(user, suffix) {
  const installationId = `ttl-installation-${suffix}-${randomUUID()}`;
  const token = `ExpoPushToken[ttl-${suffix}-${randomUUID()}]`;
  const result = await user.client.rpc('register_push_device', {
    device_app_version: '1.1.0-local',
    device_expo_push_token: token,
    device_installation_id: installationId,
    device_platform: 'ios',
  });
  if (result.error) throw result.error;
  return sql(
    `select id from private.push_devices where installation_id = '${installationId}';`,
  );
}

function insertEvent({
  actorId,
  age = '11 minutes',
  kind = 'journal',
  lease = null,
  petId,
  status = 'pending',
  type = 'journal_created',
}) {
  const sourceId = randomUUID();
  const leaseSql = lease ? `now() ${lease}` : 'null';
  return sql(
    `insert into private.family_notification_outbox (event_type,activity_kind,pet_id,actor_user_id,source_id,status,attempt_count,available_at,lease_until,created_at) values ('${type}','${kind}','${petId}'::uuid,'${actorId}'::uuid,'${sourceId}'::uuid,'${status}',${status === 'pending' ? 0 : 1},now(),${leaseSql},now() - interval '${age}') returning id;`,
  );
}

function insertDelivery(eventId, deviceId, recipientId, status) {
  return sql(
    `insert into private.family_notification_deliveries (event_id,push_device_id,recipient_user_id,status,attempt_count,available_at,ticket_id) values ('${eventId}'::uuid,'${deviceId}'::uuid,'${recipientId}'::uuid,'${status}',${status === 'pending' ? 0 : 1},now(),${status === 'ticketed' ? "'accepted-ticket'" : 'null'}) returning id;`,
  );
}

function eventStatus(eventId) {
  return sql(
    `select status from private.family_notification_outbox where id = '${eventId}'::uuid;`,
  );
}

function deliveryCount(eventId) {
  return count(
    `select count(*) from private.family_notification_deliveries where event_id = '${eventId}'::uuid;`,
  );
}

async function claim(client = admin) {
  const result = await client.rpc('claim_family_notification_event');
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260912160000_family_push_event_ttl.sql',
    import.meta.url,
  ),
  'utf8',
);
expect(
  migration.includes("created_at > now() - interval '10 minutes'") &&
    migration.includes("created_at <= now() - interval '10 minutes'") &&
    migration.includes("status = 'expired'") &&
    migration.includes('family_notification_outbox_expiry_idx'),
  'TTL migration does not contain the exact server-time boundary and expiry index.',
);

try {
  const owner = await createUser('owner');
  const member = await createUser('member');
  const petId = await createPet(owner, 'Primary');
  addMember(petId, member.id);
  const phoneId = await register(member, 'phone');
  const tabletId = await register(member, 'tablet');

  const fresh = insertEvent({ actorId: owner.id, age: '9 minutes', petId });
  const freshClaim = await claim();
  expect(
    freshClaim?.event_id === fresh,
    'A nine-minute event was not claimed.',
  );
  const freshTargets = await admin.rpc('claim_family_notification_targets', {
    requested_limit: 100,
    target_event_id: fresh,
  });
  expect(
    !freshTargets.error && freshTargets.data.length === 2,
    'Fresh multi-device delivery failed.',
  );
  for (const target of freshTargets.data) {
    await admin.rpc('record_family_push_delivery', {
      delivery_error: null,
      delivery_outcome: 'ticket',
      expo_ticket_id: `fresh-${target.delivery_id}`,
      retry_after_seconds: 60,
      target_delivery_id: target.delivery_id,
    });
  }
  await admin.rpc('finish_family_notification_event', {
    processing_error: null,
    target_event_id: fresh,
  });
  expect(
    eventStatus(fresh) === 'processed',
    'Fresh event did not reach a terminal state.',
  );
  console.log('PASS: nine-minute fresh event delivers normally.');

  const futureDeviceOwner = await createUser('future-device-owner');
  const futureDeviceMember = await createUser('future-device-member');
  const futureDevicePet = await createPet(futureDeviceOwner, 'Future device');
  addMember(futureDevicePet, futureDeviceMember.id);
  const futureDeviceEvent = insertEvent({
    actorId: futureDeviceOwner.id,
    petId: futureDevicePet,
  });
  await register(futureDeviceMember, 'future');
  await Promise.all([claim(workerA), claim(workerB)]);
  expect(
    eventStatus(futureDeviceEvent) === 'expired' &&
      deliveryCount(futureDeviceEvent) === 0,
    'A future device received a stale event.',
  );
  for (let attempt = 0; attempt < 10; attempt += 1) await claim();
  expect(
    deliveryCount(futureDeviceEvent) === 0,
    'Repeated expiry created a delivery.',
  );
  console.log(
    'PASS: stale event expires idempotently before future-device delivery.',
  );

  const noDeviceOwner = await createUser('no-device-owner');
  const noDeviceMember = await createUser('no-device-member');
  const noDevicePet = await createPet(noDeviceOwner, 'No device');
  addMember(noDevicePet, noDeviceMember.id);
  const noDeviceEvent = insertEvent({
    actorId: noDeviceOwner.id,
    age: '1 minute',
    petId: noDevicePet,
  });
  await claim();
  expect(
    eventStatus(noDeviceEvent) === 'processed' &&
      deliveryCount(noDeviceEvent) === 0,
    'No-device event stayed pending.',
  );
  await register(noDeviceMember, 'after-processed');
  await claim();
  expect(
    deliveryCount(noDeviceEvent) === 0,
    'Later device received a processed no-device event.',
  );
  console.log(
    'PASS: no-device event is terminal and cannot be delivered later.',
  );

  const futureMemberOwner = await createUser('future-member-owner');
  const futureMember = await createUser('future-member');
  const futureMemberPet = await createPet(futureMemberOwner, 'Future member');
  const futureMemberEvent = insertEvent({
    actorId: futureMemberOwner.id,
    petId: futureMemberPet,
  });
  addMember(futureMemberPet, futureMember.id);
  await register(futureMember, 'future-member');
  await claim();
  expect(
    eventStatus(futureMemberEvent) === 'expired' &&
      deliveryCount(futureMemberEvent) === 0,
    'Future member received an old event.',
  );

  const noRecipientEvent = insertEvent({
    actorId: futureMemberOwner.id,
    age: '1 minute',
    petId: futureMemberPet,
  });
  sql(
    `delete from public.pet_members where pet_id = '${futureMemberPet}'::uuid and user_id = '${futureMember.id}'::uuid;`,
  );
  await claim();
  expect(
    eventStatus(noRecipientEvent) === 'processed' &&
      deliveryCount(noRecipientEvent) === 0,
    'No-recipient event stayed pending.',
  );
  console.log(
    'PASS: future-member and no-recipient events remain zero-delivery terminal.',
  );

  for (const [type, kind] of [
    ['journal_created', 'journal'],
    ['care_log_created', 'care'],
    ['care_log_created', 'health'],
    ['reminder_created', 'reminder'],
  ]) {
    insertEvent({ actorId: owner.id, kind, petId, type });
  }
  await claim();
  expect(
    count(
      `select count(*) from private.family_notification_outbox where pet_id = '${petId}'::uuid and activity_kind in ('journal','care','health','reminder') and created_at <= now() - interval '10 minutes' and status <> 'expired';`,
    ) === 0 &&
      count(
        `select count(*) from private.family_notification_deliveries as delivery join private.family_notification_outbox as event on event.id = delivery.event_id where event.pet_id = '${petId}'::uuid and event.created_at <= now() - interval '10 minutes';`,
      ) === 0,
    'A stale activity type produced a delivery.',
  );
  console.log(
    'PASS: Journal, Care, Health, and Reminder stale events deliver zero.',
  );

  const staleRetry = insertEvent({ actorId: owner.id, petId, status: 'retry' });
  insertDelivery(staleRetry, phoneId, member.id, 'retry');
  const staleProcessing = insertEvent({
    actorId: owner.id,
    lease: "- interval '1 minute'",
    petId,
    status: 'processing',
  });
  insertDelivery(staleProcessing, phoneId, member.id, 'sending');
  await claim();
  expect(
    eventStatus(staleRetry) === 'expired' &&
      eventStatus(staleProcessing) === 'expired',
    'Stale retry or lease recovery was reclaimed.',
  );
  expect(
    sql(
      `select string_agg(status, ',' order by status) from private.family_notification_deliveries where event_id in ('${staleRetry}'::uuid,'${staleProcessing}'::uuid);`,
    ) === 'skipped,skipped',
    'Expired retry/processing deliveries were not terminalized.',
  );
  console.log(
    'PASS: stale retry and expired processing lease become terminal.',
  );

  const partial = insertEvent({ actorId: owner.id, petId, status: 'retry' });
  const accepted = insertDelivery(partial, phoneId, member.id, 'ticketed');
  const retrying = insertDelivery(partial, tabletId, member.id, 'retry');
  await claim();
  expect(
    sql(
      `select status from private.family_notification_deliveries where id = '${accepted}'::uuid;`,
    ) === 'ticketed' &&
      sql(
        `select status from private.family_notification_deliveries where id = '${retrying}'::uuid;`,
      ) === 'skipped' &&
      eventStatus(partial) === 'expired',
    'TTL rewrote accepted history or retained a retry.',
  );
  console.log(
    'PASS: partial multi-device expiry preserves accepted history and stops retry.',
  );

  const concurrentStale = insertEvent({ actorId: owner.id, petId });
  const staleClaims = await Promise.all([claim(workerA), claim(workerB)]);
  expect(
    staleClaims.every((result) => result === null) &&
      eventStatus(concurrentStale) === 'expired' &&
      deliveryCount(concurrentStale) === 0,
    'Concurrent workers delivered a stale event.',
  );

  const concurrentFresh = insertEvent({
    actorId: owner.id,
    age: '1 minute',
    petId,
  });
  const freshClaims = await Promise.all([claim(workerA), claim(workerB)]);
  expect(
    freshClaims.filter((result) => result?.event_id === concurrentFresh)
      .length === 1,
    'Fresh event was claimed more than once.',
  );
  console.log(
    'PASS: concurrent stale claim has zero delivery; fresh claim has one winner.',
  );

  const clientClaim = await member.client.rpc(
    'claim_family_notification_event',
  );
  expect(
    clientClaim.error,
    'Authenticated client invoked the trusted TTL claim path.',
  );
  console.log('PASS: TTL state and claims remain private/service-only.');
} finally {
  for (const petId of petIds) {
    sql(`delete from public.pets where id = '${petId}'::uuid;`);
  }
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
  }
}

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

const output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const values = Object.fromEntries(
  output
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/u))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/"$/u, '')]),
);
const url = values.API_URL;
const anonKey = values.ANON_KEY;
const serviceKey = values.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error('Local Supabase is unavailable.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: Edge verification only runs locally.');
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const endpoint = `${url}/functions/v1/family-push`;
const users = [];
let petId;
let postId;

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
      '-tA',
      '-c',
      statement,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function client() {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createUser(label) {
  const email = `family-push-edge-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (created.error || !created.data.user) throw created.error;
  const userClient = client();
  const signedIn = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signedIn.error) throw signedIn.error;
  const person = { client: userClient, id: created.data.user.id };
  users.push(person);
  return person;
}

async function invoke() {
  const response = await fetch(endpoint, {
    body: JSON.stringify({ maxEvents: 1 }),
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `family-push returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  expect(
    body.transport === 'mock',
    `Local family-push did not use mock transport: ${JSON.stringify(body)}`,
  );
  return body;
}

async function cleanup() {
  if (petId) sql(`delete from public.pets where id = '${petId}'::uuid;`);
  for (const person of users) {
    await admin.auth.admin.deleteUser(person.id).catch(() => undefined);
  }
}

const unauthorized = await fetch(endpoint, { method: 'POST' });
expect(
  unauthorized.status >= 400,
  'family-push accepted an unauthenticated invocation.',
);

try {
  const owner = await createUser('Edge owner');
  const member = await createUser('Edge member');
  const pet = await owner.client.rpc('create_pet', {
    pet_description: 'Local Edge mock transport fixture',
    pet_gender: 'unknown',
    pet_name: `Edge Push ${randomUUID().slice(0, 6)}`,
    pet_species: 'other',
  });
  if (pet.error || !pet.data) throw pet.error;
  petId = pet.data.id;
  sql(
    `insert into public.pet_members (pet_id, user_id, role) values ('${petId}'::uuid, '${member.id}'::uuid, 'member');`,
  );

  const tokens = [
    'ExpoPushToken[mock-success-token]',
    'ExpoPushToken[temporary-error-token]',
    'ExpoPushToken[ticket-device-not-registered-token]',
    'ExpoPushToken[receipt-device-not-registered-token]',
    'ExpoPushToken[malformed-response-token]',
    'ExpoPushToken[network-timeout-token]',
  ];
  for (const [index, token] of tokens.entries()) {
    const registration = await member.client.rpc('register_push_device', {
      device_app_version: '1.1.0-local',
      device_expo_push_token: token,
      device_installation_id: `edge-mock-installation-${index}`,
      device_platform: index % 2 === 0 ? 'ios' : 'android',
    });
    if (registration.error) throw registration.error;
  }

  postId = randomUUID();
  const journal = await owner.client.rpc('create_post', {
    media_items: [],
    post_content: 'This private body must not reach the mock transport output.',
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (journal.error) throw journal.error;
  sql(
    `update private.family_notification_outbox set created_at = '2000-01-01T00:00:00Z' where source_id = '${postId}'::uuid;`,
  );

  const first = await invoke();
  expect(
    first.eventsProcessed === 1 && first.deliveriesProcessed === tokens.length,
    `Edge function did not process all mock device deliveries: ${JSON.stringify(first)}`,
  );
  const statuses = Object.fromEntries(
    sql(
      `select device.expo_push_token || '|' || delivery.status from private.family_notification_deliveries as delivery join private.push_devices as device on device.id = delivery.push_device_id join private.family_notification_outbox as event on event.id = delivery.event_id where event.source_id = '${postId}'::uuid order by device.expo_push_token;`,
    )
      .split('\n')
      .filter(Boolean)
      .map((row) => row.split('|')),
  );
  expect(statuses[tokens[0]] === 'ticketed', 'Success ticket was not stored.');
  expect(
    statuses[tokens[1]] === 'retry',
    'Temporary failure was not queued for retry.',
  );
  expect(
    statuses[tokens[2]] === 'device_not_registered',
    'Ticket DeviceNotRegistered was not terminal.',
  );
  expect(
    statuses[tokens[3]] === 'ticketed',
    'Receipt test ticket was not stored.',
  );
  expect(
    statuses[tokens[4]] === 'failed',
    'Malformed response was not terminal.',
  );
  expect(
    statuses[tokens[5]] === 'failed',
    'Unknown network outcome was retried and could duplicate.',
  );

  sql(
    `update private.family_notification_deliveries set available_at = now() where status = 'ticketed' and event_id in (select id from private.family_notification_outbox where source_id = '${postId}'::uuid);`,
  );
  const receipts = await invoke();
  expect(receipts.receiptsProcessed >= 2, 'Mock receipts were not processed.');
  expect(
    Number(
      sql(
        `select count(*) from private.push_devices where expo_push_token in ('${tokens[2]}', '${tokens[3]}') and enabled = false;`,
      ),
    ) === 2,
    'DeviceNotRegistered did not disable ticket and receipt tokens.',
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    sql(
      `update private.family_notification_outbox set available_at = now() where source_id = '${postId}'::uuid and status = 'retry'; update private.family_notification_deliveries set available_at = now() where event_id in (select id from private.family_notification_outbox where source_id = '${postId}'::uuid) and status = 'retry';`,
    );
    await invoke();
  }
  expect(
    sql(
      `select delivery.status from private.family_notification_deliveries as delivery join private.family_notification_outbox as event on event.id = delivery.event_id join private.push_devices as device on device.id = delivery.push_device_id where event.source_id = '${postId}'::uuid and device.expo_push_token = '${tokens[1]}';`,
    ) === 'failed',
    'Temporary Expo failure retry was not bounded.',
  );
  expect(
    Number(
      sql(`select count(*) from public.posts where id = '${postId}'::uuid;`),
    ) === 1,
    'Push failures rolled back the Journal business row.',
  );
  const deliveryCountBefore = Number(
    sql(
      `select count(*) from private.family_notification_deliveries as delivery join private.family_notification_outbox as event on event.id = delivery.event_id where event.source_id = '${postId}'::uuid;`,
    ),
  );
  await invoke();
  expect(
    Number(
      sql(
        `select count(*) from private.family_notification_deliveries as delivery join private.family_notification_outbox as event on event.id = delivery.event_id where event.source_id = '${postId}'::uuid;`,
      ),
    ) === deliveryCountBefore,
    'A repeated Edge invocation duplicated a completed delivery.',
  );

  console.log(
    'PASS: family-push bundles and serves in the local Edge runtime.',
  );
  console.log(
    'PASS: unauthenticated invocation is rejected and LOCAL always uses mock transport.',
  );
  console.log(
    'PASS: success, transient retry, ticket/receipt invalidation, malformed response, timeout, and idempotent retry paths.',
  );
  console.log('PASS: push failures do not roll back the Journal business row.');
} finally {
  await cleanup();
}

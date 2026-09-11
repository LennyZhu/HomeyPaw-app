import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import {
  buildFamilyPushMessage,
  classifyExpoReceipt,
  classifyExpoTicket,
  isTrustedServiceAuthorization,
} from '../supabase/functions/family-push/push-core.ts';
import { getFamilyPushNavigationTarget } from '../src/features/reminders/family-push-navigation.ts';

function localCredentials() {
  if (
    process.env.SUPABASE_LOCAL_URL &&
    process.env.SUPABASE_LOCAL_ANON_KEY &&
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY
  ) {
    return {
      anonKey: process.env.SUPABASE_LOCAL_ANON_KEY,
      serviceKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY,
      url: process.env.SUPABASE_LOCAL_URL,
    };
  }
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
  return {
    anonKey: values.ANON_KEY,
    serviceKey: values.SERVICE_ROLE_KEY,
    url: values.API_URL,
  };
}

const { anonKey, serviceKey, url } = localCredentials();
if (!anonKey || !serviceKey || !url) {
  throw new Error('Local Supabase credentials are unavailable.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('SAFETY STOP: Family Push verification only runs locally.');
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
let petId;

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

function expect(value, message) {
  if (!value) throw new Error(message);
}

function count(statement) {
  return Number(sql(statement));
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

async function user(label, locale = 'zh-HK') {
  const email = `family-push-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`${label} creation failed.`);
  }
  const client = testClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const result = { client, email, id: created.data.user.id, label };
  users.push(result);
  const profile = await client
    .from('profiles')
    .update({ locale })
    .eq('id', result.id);
  if (profile.error) throw profile.error;
  return result;
}

async function register(person, installation, token, platform = 'ios') {
  const result = await person.client.rpc('register_push_device', {
    device_app_version: '1.1.0-local',
    device_expo_push_token: token,
    device_installation_id: installation,
    device_platform: platform,
  });
  if (result.error || !result.data) {
    throw result.error ?? new Error(`${person.label} registration failed.`);
  }
  return result.data;
}

async function addMember(person, role = 'member') {
  sql(
    `insert into public.pet_members (pet_id, user_id, role) values ('${petId}'::uuid, '${person.id}'::uuid, '${role}'::public.pet_member_role);`,
  );
}

async function claimExpected(sourceId, type, kind) {
  const claim = await admin.rpc('claim_family_notification_event');
  const event = claim.data?.[0];
  expect(!claim.error && event, `Could not claim ${type} event.`);
  expect(event.source_id === sourceId, `${type} source was not preserved.`);
  expect(event.event_type === type, `${type} was not classified correctly.`);
  expect(event.activity_kind === kind, `${type} activity kind was incorrect.`);
  return event;
}

async function targetEvent(event, expectedTokens) {
  const result = await admin.rpc('claim_family_notification_targets', {
    requested_limit: 100,
    target_event_id: event.event_id,
  });
  if (result.error) throw result.error;
  const tokens = result.data.map((target) => target.expo_push_token).sort();
  expect(
    JSON.stringify(tokens) === JSON.stringify([...expectedTokens].sort()),
    `Recipient devices were incorrect for ${event.event_type}.`,
  );
  for (const target of result.data) {
    const recorded = await admin.rpc('record_family_push_delivery', {
      delivery_error: null,
      delivery_outcome: 'ticket',
      expo_ticket_id: `mock-ok-${target.delivery_id}`,
      retry_after_seconds: 60,
      target_delivery_id: target.delivery_id,
    });
    expect(!recorded.error && recorded.data, 'Ticket result was not recorded.');
  }
  const finished = await admin.rpc('finish_family_notification_event', {
    processing_error: null,
    target_event_id: event.event_id,
  });
  expect(
    !finished.error && finished.data === 'processed',
    'Event did not finish.',
  );
  return result.data;
}

async function createJournal(actor, content) {
  const id = randomUUID();
  const result = await actor.client.rpc('create_post', {
    media_items: [],
    post_content: content,
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: id,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (result.error) throw result.error;
  return id;
}

async function createCare(actor, kind, healthSubtype, note) {
  const id = randomUUID();
  const result = await actor.client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_health_subtype: healthSubtype,
    care_id: id,
    care_kind: kind,
    care_note: note,
    care_occurred_at: new Date(Date.now() - 10_000).toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: petId,
  });
  if (result.error) throw result.error;
  return id;
}

async function createReminder(
  actor,
  scheduledAt = new Date(Date.now() + 600_000),
) {
  const id = randomUUID();
  const result = await actor.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'feeding',
    task_category: 'standard',
    task_id: id,
    task_local_time: null,
    task_month_day: null,
    task_note: 'private medication details',
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt.toISOString(),
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: 'Private reminder title',
    task_week_day: null,
  });
  if (result.error) throw result.error;
  return { id, scheduledAt };
}

async function cleanup() {
  if (petId) {
    sql(`delete from public.pets where id = '${petId}'::uuid;`);
  }
  for (const person of users) {
    await admin.auth.admin.deleteUser(person.id).catch(() => undefined);
  }
}

async function main() {
  const appConfig = JSON.parse(readFileSync('app.json', 'utf8'));
  const migration = readFileSync(
    'supabase/migrations/20260911140000_family_activity_remote_push.sql',
    'utf8',
  );
  const deviceService = readFileSync(
    'src/services/family-push-device.ts',
    'utf8',
  );
  const permissionService = readFileSync(
    'src/services/care-task-notifications.ts',
    'utf8',
  );
  const permissionCoordinator = readFileSync(
    'src/features/reminders/family-push-coordinator.tsx',
    'utf8',
  );
  const localStore = readFileSync(
    'src/services/care-task-notification-store.ts',
    'utf8',
  );
  expect(
    appConfig.expo.extra.eas.projectId ===
      '3623de2b-5a77-48ec-b2ec-45e8136d9ac7',
    'The existing EAS project ID changed.',
  );
  expect(
    appConfig.expo.plugins.every(
      (plugin) =>
        plugin !== './plugins/with-local-notifications-only' &&
        plugin?.[0] !== './plugins/with-local-notifications-only',
    ),
    'The local-only notification plugin is still configured.',
  );
  const notificationPlugin = appConfig.expo.plugins.find(
    (plugin) => plugin?.[0] === 'expo-notifications',
  );
  expect(
    notificationPlugin?.[1]?.enableBackgroundRemoteNotifications === false,
    'Visible push unexpectedly enabled background remote notifications.',
  );
  expect(
    deviceService.includes('Constants.expoConfig?.extra') &&
      deviceService.includes('getExpoPushTokenAsync({') &&
      deviceService.includes('projectId: getProjectId()'),
    'Expo token registration does not use the configured project ID.',
  );
  expect(
    permissionService.includes('IosAuthorizationStatus.AUTHORIZED') &&
      permissionService.includes('IosAuthorizationStatus.PROVISIONAL') &&
      permissionService.includes('IosAuthorizationStatus.EPHEMERAL'),
    'Authorized/provisional iOS permission handling is incomplete.',
  );
  expect(
    permissionCoordinator.includes("permission === 'granted'") &&
      permissionCoordinator.includes("permission === 'denied'") &&
      permissionCoordinator.includes('hasSharedFamilyForPush()') &&
      permissionCoordinator.includes('markFamilyPushPrepromptShown') &&
      permissionCoordinator.includes("state === 'active'") &&
      permissionCoordinator.includes('addPushTokenListener') &&
      !permissionCoordinator.includes('requestPermissionsAsync'),
    'Permission prompt, foreground retry, or token rotation flow is incomplete.',
  );
  expect(
    localStore.includes('care_task_notification_mappings') &&
      permissionService.includes('const rollingWindowDays = 30') &&
      permissionService.includes('const maximumScheduledNotifications = 48'),
    'Existing Phase 7 local notification architecture changed.',
  );
  expect(
    (migration.match(/create trigger enqueue_/gu) ?? []).length === 3 &&
      !migration.includes('chat_messages') &&
      !migration.includes('care_shifts'),
    'The server event scope is not limited to Journal, Care, and Reminder creates.',
  );
  const navigationPetId = randomUUID();
  const navigationSourceId = randomUUID();
  expect(
    getFamilyPushNavigationTarget({
      petId: navigationPetId,
      sourceId: navigationSourceId,
      type: 'journal_created',
      url: 'pawday://arbitrary',
    })?.href === `/posts/${navigationSourceId}`,
    'Journal notification route was not mapped through the whitelist.',
  );
  expect(
    getFamilyPushNavigationTarget({
      petId: navigationPetId,
      sourceId: navigationSourceId,
      type: 'care_log_created',
    })?.href === '/care',
    'Care notification route is incorrect.',
  );
  expect(
    getFamilyPushNavigationTarget({
      petId: navigationPetId,
      sourceId: navigationSourceId,
      type: 'reminder_created',
    })?.href === `/reminders/${navigationSourceId}`,
    'Reminder notification route is incorrect.',
  );
  expect(
    getFamilyPushNavigationTarget({
      petId: navigationPetId,
      sourceId: navigationSourceId,
      type: 'schedule_created',
      url: '/schedule',
    }) === null,
    'An untrusted notification route was accepted.',
  );

  const owner = await user('Owner', 'zh-HK');
  const memberA = await user('Member A', 'en');
  const memberB = await user('Member B', 'zh-HK');
  const viewer = await user('Viewer', 'en');
  const removed = await user('Removed member', 'en');
  const stranger = await user('Stranger', 'en');

  try {
    const pet = await owner.client.rpc('create_pet', {
      pet_description: 'Local-only Family Push verifier',
      pet_gender: 'unknown',
      pet_name: `Push Pet ${randomUUID().slice(0, 6)}`,
      pet_species: 'other',
    });
    if (pet.error || !pet.data)
      throw pet.error ?? new Error('Pet creation failed.');
    petId = pet.data.id;
    await addMember(memberA);
    await addMember(memberB);
    await addMember(viewer, 'viewer');
    await addMember(removed);

    const anonymous = testClient();
    const anonRegistration = await anonymous.rpc('register_push_device', {
      device_app_version: '1.1.0',
      device_expo_push_token: 'ExpoPushToken[anonymous00]',
      device_installation_id: 'anonymous-installation',
      device_platform: 'ios',
    });
    expect(
      Boolean(anonRegistration.error),
      'Anonymous device registration succeeded.',
    );
    const forgedBinding = await owner.client.rpc('register_push_device', {
      device_app_version: '1.1.0',
      device_expo_push_token: 'ExpoPushToken[forgeduser00]',
      device_installation_id: 'forged-user-installation',
      device_platform: 'ios',
      user_id: memberA.id,
    });
    expect(
      Boolean(forgedBinding.error),
      'Client supplied an arbitrary user_id.',
    );
    const serviceRpc = await owner.client.rpc(
      'claim_family_notification_event',
    );
    expect(
      Boolean(serviceRpc.error),
      'Authenticated client invoked service-only claim.',
    );
    const privateRead = await memberA.client
      .schema('private')
      .from('push_devices')
      .select('*');
    expect(
      Boolean(privateRead.error),
      'A family member read private push tokens.',
    );

    await register(
      owner,
      'account-switch-install',
      'ExpoPushToken[switchowner00]',
    );
    await register(
      memberA,
      'account-switch-install',
      'ExpoPushToken[switchmember00]',
    );
    expect(
      count(
        `select count(*) from private.push_devices where installation_id = 'account-switch-install' and user_id = '${memberA.id}'::uuid`,
      ) === 1,
      'Account switch did not rebind the installation.',
    );
    await register(
      memberA,
      'token-owner-install',
      'ExpoPushToken[uniquetoken00]',
    );
    await register(
      memberB,
      'token-new-installation',
      'ExpoPushToken[uniquetoken00]',
    );
    expect(
      count(
        `select count(*) from private.push_devices where expo_push_token = 'ExpoPushToken[uniquetoken00]' and user_id = '${memberB.id}'::uuid`,
      ) === 1,
      'Push token uniqueness/rebinding failed.',
    );
    const unregister = await memberB.client.rpc('unregister_push_device', {
      device_installation_id: 'token-new-installation',
    });
    expect(
      !unregister.error && unregister.data,
      'Logout unregister did not disable the device.',
    );

    const deletionUser = await user('Deletion user', 'en');
    await register(
      deletionUser,
      'delete-user-install',
      'ExpoPushToken[deleteuser00]',
    );
    await admin.auth.admin.deleteUser(deletionUser.id);
    expect(
      count(
        `select count(*) from private.push_devices where user_id = '${deletionUser.id}'::uuid`,
      ) === 0,
      'Account deletion did not cascade push devices.',
    );
    users.splice(users.indexOf(deletionUser), 1);

    sql(
      `delete from private.push_devices where user_id in ('${owner.id}'::uuid, '${memberA.id}'::uuid, '${memberB.id}'::uuid, '${viewer.id}'::uuid, '${removed.id}'::uuid, '${stranger.id}'::uuid);`,
    );
    const ownerTokens = [
      'ExpoPushToken[owneriphone00]',
      'ExpoPushToken[owneripad000]',
    ];
    const memberATokens = ['ExpoPushToken[memberaphone0]'];
    const memberBTokens = [
      'ExpoPushToken[memberbphone0]',
      'ExpoPushToken[memberbipad00]',
    ];
    await register(owner, 'owner-iphone-install', ownerTokens[0]);
    await register(owner, 'owner-ipad-installation', ownerTokens[1]);
    await register(memberA, 'member-a-installation', memberATokens[0]);
    await register(memberB, 'member-b-phone-install', memberBTokens[0]);
    await register(memberB, 'member-b-ipad-install', memberBTokens[1]);
    await register(
      viewer,
      'viewer-installation00',
      'ExpoPushToken[viewertoken00]',
    );
    await register(
      removed,
      'removed-installation0',
      'ExpoPushToken[removedtoken0]',
    );
    await register(
      stranger,
      'stranger-installation',
      'ExpoPushToken[strangertoken]',
    );
    const removal = await owner.client.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: removed.id,
    });
    expect(
      !removal.error && removal.data === 'removed',
      'Fixture removal failed.',
    );
    expect(
      (await owner.client.rpc('has_shared_family_for_push')).data === true,
      'Family eligibility failed.',
    );
    expect(
      (await viewer.client.rpc('has_shared_family_for_push')).data === false,
      'Viewer was prompt eligible.',
    );
    expect(
      (await stranger.client.rpc('has_shared_family_for_push')).data === false,
      'Stranger was prompt eligible.',
    );

    const expectedRecipients = [...memberATokens, ...memberBTokens];
    const journalBody = 'private journal body never sent';
    const journalId = await createJournal(owner, journalBody);
    const journalEvent = await claimExpected(
      journalId,
      'journal_created',
      'journal',
    );
    const journalTargets = await targetEvent(journalEvent, expectedRecipients);
    expect(
      journalTargets.find(
        (target) => target.expo_push_token === memberATokens[0],
      )?.recipient_locale === 'en',
      'Recipient locale was not loaded server-side.',
    );
    expect(
      count(
        `select count(*) from private.family_notification_deliveries where event_id = '${journalEvent.event_id}'::uuid and recipient_user_id in ('${owner.id}'::uuid, '${viewer.id}'::uuid, '${removed.id}'::uuid, '${stranger.id}'::uuid)`,
      ) === 0,
      'Actor/viewer/removed/stranger delivery was created.',
    );
    const retryJournal = await owner.client.rpc('create_post', {
      media_items: [],
      post_content: journalBody,
      post_event_date: new Date().toISOString().slice(0, 10),
      post_id: journalId,
      post_location_name: null,
      post_pet_id: petId,
      post_tag: 'other',
    });
    expect(
      Boolean(retryJournal.error),
      'Duplicate Journal source unexpectedly succeeded.',
    );
    expect(
      count(
        `select count(*) from private.family_notification_outbox where source_id = '${journalId}'::uuid`,
      ) === 1,
      'Journal retry duplicated its event.',
    );

    const careId = await createCare(
      owner,
      'feeding',
      null,
      'private care note',
    );
    await targetEvent(
      await claimExpected(careId, 'care_log_created', 'care'),
      expectedRecipients,
    );
    const healthId = await createCare(
      owner,
      'health',
      'energy',
      'private health note',
    );
    await targetEvent(
      await claimExpected(healthId, 'care_log_created', 'health'),
      expectedRecipients,
    );
    const reminder = await createReminder(owner);
    await targetEvent(
      await claimExpected(reminder.id, 'reminder_created', 'reminder'),
      expectedRecipients,
    );

    const raceId = await createJournal(owner, 'removal race body');
    const raceEvent = await claimExpected(raceId, 'journal_created', 'journal');
    const raceRemove = await owner.client.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: memberB.id,
    });
    expect(!raceRemove.error, 'Removal race setup failed.');
    await targetEvent(raceEvent, memberATokens);
    expect(
      count(
        `select count(*) from private.family_notification_deliveries where event_id = '${raceEvent.event_id}'::uuid and recipient_user_id = '${memberB.id}'::uuid and status = 'skipped'`,
      ) === memberBTokens.length,
      'Removed member deliveries were not skipped at send time.',
    );
    await addMember(memberB);

    const completionReminder = await createReminder(
      owner,
      new Date(Date.now() + 1_500),
    );
    await targetEvent(
      await claimExpected(
        completionReminder.id,
        'reminder_created',
        'reminder',
      ),
      expectedRecipients,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    const completionCareId = randomUUID();
    const completion = await owner.client.rpc('complete_care_task', {
      care_log_id: completionCareId,
      completion_duration_minutes: null,
      completion_id: randomUUID(),
      completion_note: 'private completion note',
      occurrence_scheduled_for: completionReminder.scheduledAt.toISOString(),
      target_task_id: completionReminder.id,
    });
    expect(
      !completion.error &&
        completion.data?.[0]?.completion_status === 'completed',
      'Trusted completion failed.',
    );
    await targetEvent(
      await claimExpected(completionCareId, 'care_log_created', 'care'),
      expectedRecipients,
    );

    const transientId = await createJournal(owner, 'transient retry body');
    const transientEvent = await claimExpected(
      transientId,
      'journal_created',
      'journal',
    );
    const transientTargets = await admin.rpc(
      'claim_family_notification_targets',
      {
        requested_limit: 100,
        target_event_id: transientEvent.event_id,
      },
    );
    expect(!transientTargets.error, 'Transient targets failed.');
    for (const target of transientTargets.data) {
      await admin.rpc('record_family_push_delivery', {
        delivery_error: 'temporary',
        delivery_outcome: 'retry',
        expo_ticket_id: null,
        retry_after_seconds: 15,
        target_delivery_id: target.delivery_id,
      });
    }
    const retryFinish = await admin.rpc('finish_family_notification_event', {
      processing_error: 'temporary',
      target_event_id: transientEvent.event_id,
    });
    expect(
      retryFinish.data === 'retry',
      'Transient delivery was not bounded for retry.',
    );

    const disabledDeviceId = sql(
      `select id from private.push_devices where expo_push_token = '${memberATokens[0]}'`,
    );
    sql(
      `update private.family_notification_deliveries set status = 'sending' where event_id = '${transientEvent.event_id}'::uuid and push_device_id = '${disabledDeviceId}'::uuid;`,
    );
    const disable = await admin.rpc('record_family_push_delivery', {
      delivery_error: 'DeviceNotRegistered',
      delivery_outcome: 'device_not_registered',
      expo_ticket_id: null,
      retry_after_seconds: 60,
      target_delivery_id: sql(
        `select id from private.family_notification_deliveries where event_id = '${transientEvent.event_id}'::uuid and push_device_id = '${disabledDeviceId}'::uuid`,
      ),
    });
    expect(!disable.error && disable.data, 'Invalid-token result failed.');
    expect(
      count(
        `select count(*) from private.push_devices where id = '${disabledDeviceId}'::uuid and enabled = false`,
      ) === 1,
      'Invalid token was not disabled.',
    );

    const message = buildFamilyPushMessage(journalEvent, journalTargets[0]);
    const serialized = JSON.stringify(message);
    expect(message.title === 'HomeyPaw', 'Push title changed.');
    expect(
      Object.keys(message.data).sort().join(',') === 'petId,sourceId,type',
      'Payload data was not minimal.',
    );
    for (const privateValue of [
      journalBody,
      'private care note',
      'private health note',
      owner.email,
      'private medication details',
    ]) {
      expect(
        !serialized.includes(privateValue),
        `Private content leaked: ${privateValue}`,
      );
    }
    expect(
      buildFamilyPushMessage(
        { ...journalEvent, activity_kind: 'journal' },
        { ...journalTargets[0], recipient_locale: 'unknown' },
      ).body === '家人新增了一篇日記',
      'Missing locale did not fall back to zh-HK.',
    );
    expect(
      classifyExpoTicket({ status: 'ok', id: 'ticket' }).outcome === 'ticket',
      'Success ticket classification failed.',
    );
    expect(
      classifyExpoTicket({
        status: 'error',
        details: { error: 'MessageRateExceeded' },
      }).outcome === 'retry',
      'Temporary error classification failed.',
    );
    expect(
      classifyExpoTicket(null).outcome === 'failed',
      'Malformed ticket was accepted.',
    );
    expect(
      classifyExpoReceipt({
        status: 'error',
        details: { error: 'DeviceNotRegistered' },
      }).outcome === 'device_not_registered',
      'Invalid receipt classification failed.',
    );
    expect(
      isTrustedServiceAuthorization(`Bearer ${serviceKey}`, serviceKey),
      'Service authorization failed.',
    );
    expect(
      !isTrustedServiceAuthorization(`Bearer ${anonKey}`, serviceKey),
      'Public authorization was trusted.',
    );

    console.log(
      'PASS: authenticated, user-bound registration; unique installation/token; account switch; unregister; account deletion cascade.',
    );
    console.log(
      'PASS: private tables and service-only claims reject client access.',
    );
    console.log(
      'PASS: Journal, Care, Health, Reminder, and trusted-completion events enqueue exactly once.',
    );
    console.log(
      'PASS: actor/viewer/stranger/removed recipients are zero; multi-device owner/member delivery is correct.',
    );
    console.log('PASS: send-time removal race skips the removed member.');
    console.log(
      'PASS: generic localized payload excludes private source content.',
    );
    console.log(
      'PASS: ticket, receipt, invalid token, malformed response, and bounded transient retry paths.',
    );
    console.log(
      'PASS: permission states, foreground/token retry, native scope, local reminders, and deep-link whitelist are preserved.',
    );
  } finally {
    await cleanup();
  }
}

await main();

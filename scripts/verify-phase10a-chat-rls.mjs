import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const localUrl = process.env.SUPABASE_LOCAL_URL?.trim();
const localAnonKey = process.env.SUPABASE_LOCAL_ANON_KEY?.trim();
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY?.trim();

if (!localUrl || !localAnonKey || !localServiceRoleKey) {
  throw new Error(
    'Local-only keys are required: SUPABASE_LOCAL_URL, SUPABASE_LOCAL_ANON_KEY, and SUPABASE_LOCAL_SERVICE_ROLE_KEY.',
  );
}

const parsedUrl = new URL(localUrl);
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
  throw new Error('SAFETY STOP: Phase 10A RLS verification only runs locally.');
}

const admin = createClient(localUrl, localServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function createTestClient() {
  return createClient(localUrl, localAnonKey, {
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sensitiveChatKeys = new Set([
  'body',
  'client_message_id',
  'created_at',
  'full_message',
  'member',
  'member_data',
  'members',
  'membership',
  'message',
  'pet',
  'pet_avatar',
  'pet_id',
  'pet_metadata',
  'pet_name',
  'private_metadata',
  'profile',
  'record',
  'row',
  'sender',
  'sender_id',
  'sender_profile',
  'updated_at',
]);

function collectPayloadKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectPayloadKeys(item, keys);
    return keys;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    keys.push(key.toLowerCase());
    collectPayloadKeys(nestedValue, keys);
  }
  return keys;
}

function expectNoSensitivePayload(payload, allowedSensitiveKeys, label) {
  const leakedKeys = collectPayloadKeys(payload).filter(
    (key) => sensitiveChatKeys.has(key) && !allowedSensitiveKeys.has(key),
  );
  expect(
    leakedKeys.length === 0,
    `${label} leaked sensitive payload keys: ${[...new Set(leakedKeys)].join(',')}`,
  );
}

function expectChatPayload(payload, expectedType, expectedMessageId) {
  expect(
    payload && typeof payload === 'object' && !Array.isArray(payload),
    `${expectedType} payload was not an object.`,
  );
  expect(
    ['message_created', 'message_updated', 'message_deleted'].includes(
      payload.type,
    ) && payload.type === expectedType,
    `${expectedType} payload had an invalid type.`,
  );
  expect(
    typeof payload.message_id === 'string' &&
      uuidPattern.test(payload.message_id) &&
      payload.message_id === expectedMessageId,
    `${expectedType} payload had an invalid message_id.`,
  );
  expectNoSensitivePayload(payload, new Set(), expectedType);
}

function expectControlPayload(payload, expectedPetId) {
  expect(
    payload && typeof payload === 'object' && !Array.isArray(payload),
    'Control payload was not an object.',
  );
  expect(
    payload.type === 'chat_channel_rotated',
    'Control payload had an invalid type.',
  );
  expect(
    typeof payload.pet_id === 'string' &&
      uuidPattern.test(payload.pet_id) &&
      payload.pet_id === expectedPetId,
    'Control payload had an invalid pet_id.',
  );
  expectNoSensitivePayload(payload, new Set(['pet_id']), 'Control Broadcast');
}

async function createUser(label) {
  const emailLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const email = `phase10a-${emailLabel}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: label, locale: 'en' },
  });
  if (error || !data.user) throw error ?? new Error(`${label} create failed`);

  const client = createTestClient();
  const { data: signIn, error: signInError } =
    await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) {
    throw signInError ?? new Error(`${label} sign-in failed`);
  }
  await client.realtime.setAuth(signIn.session.access_token);
  return { client, id: data.user.id };
}

async function createPet(ownerClient, name) {
  const { data, error } = await ownerClient.rpc('create_pet', {
    pet_gender: 'unknown',
    pet_name: name,
    pet_species: 'other',
  });
  if (error || !data) throw error ?? new Error('Pet creation failed');
  return data.id;
}

async function inviteAndJoin(ownerClient, memberClient, petId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: invites, error: inviteError } = await ownerClient.rpc(
      'create_pet_invite',
      { target_pet_id: petId },
    );
    if (inviteError?.message === 'invite creation rate limited') {
      await new Promise((resolve) => setTimeout(resolve, 10_250));
      continue;
    }
    if (inviteError || !invites?.[0]) throw inviteError;
    const { error: joinError } = await memberClient.rpc(
      'join_pet_with_invite',
      { invite_code: invites[0].invite_code },
    );
    if (joinError) throw joinError;
    return;
  }
  throw new Error('Local invite rate-limit retry exhausted.');
}

async function removeMember(ownerClient, petId, memberId) {
  const { data, error } = await ownerClient.rpc('remove_pet_member', {
    target_pet_id: petId,
    target_user_id: memberId,
  });
  if (error) throw error;
  return data;
}

async function getVersion(client, petId) {
  const { data, error } = await client.rpc('get_pet_chat_channel_version', {
    target_pet_id: petId,
  });
  if (error) throw error;
  return data;
}

function topicFor(petId, version) {
  return `pet:${petId}:chat:v${version}`;
}

function controlTopicFor(userId) {
  return `user:${userId}:chat-control`;
}

async function subscribeAllowed(client, topic, label) {
  const events = [];
  const channel = client
    .channel(topic, {
      config: { broadcast: { ack: true }, private: true },
    })
    .on('broadcast', { event: 'message_created' }, (event) =>
      events.push({ event: 'message_created', payload: event.payload }),
    )
    .on('broadcast', { event: 'message_updated' }, (event) =>
      events.push({ event: 'message_updated', payload: event.payload }),
    )
    .on('broadcast', { event: 'message_deleted' }, (event) =>
      events.push({ event: 'message_deleted', payload: event.payload }),
    );

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} subscription timed out`)),
      8000,
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        reject(new Error(`${label} subscription was denied`));
      }
    });
  });

  return { channel, events };
}

async function subscribeControlAllowed(client, userId, label) {
  const events = [];
  const channel = client
    .channel(controlTopicFor(userId), {
      config: { broadcast: { ack: true }, private: true },
    })
    .on('broadcast', { event: 'chat_channel_rotated' }, (event) =>
      events.push({ event: 'chat_channel_rotated', payload: event.payload }),
    );

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} control subscription timed out`)),
      8000,
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        reject(new Error(`${label} control subscription was denied`));
      }
    });
  });

  return { channel, events };
}

async function expectSubscriptionDenied(client, topic, label) {
  const channel = client.channel(topic, { config: { private: true } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} denial timed out`)),
        8000,
      );
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          reject(new Error(`SECURITY BREACH: ${label} subscribed`));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } finally {
    await client.removeChannel(channel);
  }
}

async function waitForEvent(events, eventName, predicate = () => true) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const match = events.find(
      (event) => event.event === eventName && predicate(event.payload),
    );
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Realtime event not received: ${eventName}`);
}

async function allSettledWithin(promises, label, timeoutMs = 12_000) {
  let timer;
  try {
    return await Promise.race([
      Promise.allSettled(promises),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out; possible deadlock.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function send(client, petId, body, clientMessageId = randomUUID()) {
  const { data, error } = await client.rpc('send_chat_message', {
    message_body: body,
    target_client_message_id: clientMessageId,
    target_pet_id: petId,
  });
  if (error) throw error;
  return data;
}

async function update(client, messageId, body) {
  const { data, error } = await client.rpc('update_chat_message', {
    message_body: body,
    target_message_id: messageId,
  });
  if (error) throw error;
  return data;
}

async function markRead(client, petId, messageId) {
  const { data, error } = await client.rpc('mark_chat_read', {
    target_message_id: messageId,
    target_pet_id: petId,
  });
  if (error) throw error;
  return data;
}

async function fetchAllPages(client, petId) {
  const result = [];
  let cursor = null;
  do {
    const { data, error } = await client.rpc('get_chat_messages_page', {
      before_created_at: cursor?.created_at ?? null,
      before_message_id: cursor?.id ?? null,
      requested_limit: 30,
      target_pet_id: petId,
    });
    if (error) throw error;
    expect(data.length <= 30, 'Pagination returned more than 30 messages.');
    result.push(...data);
    cursor = data.length === 30 ? data.at(-1) : null;
  } while (cursor);
  return result;
}

async function main() {
  const createdUserIds = [];
  const channels = [];
  let owner;
  let member;
  let stranger;
  let petId;
  let crossPetId;
  let ownerDeletePetId;
  let ownerDeletionUser;

  try {
    owner = await createUser('Owner A');
    member = await createUser('Member B');
    stranger = await createUser('Stranger C');
    createdUserIds.push(owner.id, member.id, stranger.id);

    petId = await createPet(owner.client, 'Phase 10A Chat Pet');
    crossPetId = await createPet(owner.client, 'Phase 10A Cross Pet');
    await inviteAndJoin(owner.client, member.client, petId);

    // Exercise the exact v7 -> v8 attack scenario without a test-only database
    // escape hatch. Every increment uses a real membership mutation path.
    const rotationMemberD = await createUser('Rotation Member D');
    const rotationMemberE = await createUser('Rotation Member E');
    const rotationMemberF = await createUser('Rotation Member F');
    createdUserIds.push(
      rotationMemberD.id,
      rotationMemberE.id,
      rotationMemberF.id,
    );
    await inviteAndJoin(owner.client, rotationMemberD.client, petId);
    await removeMember(owner.client, petId, rotationMemberD.id);
    await inviteAndJoin(owner.client, rotationMemberE.client, petId);
    await removeMember(owner.client, petId, rotationMemberE.id);
    await inviteAndJoin(owner.client, rotationMemberF.client, petId);

    const version = await getVersion(owner.client, petId);
    expect(version === 7, `Expected attack fixture v7, received v${version}.`);
    expect(
      version === (await getVersion(member.client, petId)),
      'Versions differ.',
    );
    const topic = topicFor(petId, version);
    const ownerControlSubscription = await subscribeControlAllowed(
      owner.client,
      owner.id,
      'Owner',
    );
    const memberControlSubscription = await subscribeControlAllowed(
      member.client,
      member.id,
      'Member',
    );
    const ownerSubscription = await subscribeAllowed(
      owner.client,
      topic,
      'Owner',
    );
    const memberSubscription = await subscribeAllowed(
      member.client,
      topic,
      'Member',
    );
    channels.push(
      [owner.client, ownerControlSubscription.channel],
      [member.client, memberControlSubscription.channel],
      [owner.client, ownerSubscription.channel],
      [member.client, memberSubscription.channel],
    );

    const memberEventsBeforeClientSend = memberSubscription.events.length;
    const ownerControlEventsBeforeClientSend =
      ownerControlSubscription.events.length;
    const clientPetBroadcastStatus = await ownerSubscription.channel.send({
      event: 'message_created',
      payload: { message_id: randomUUID(), type: 'message_created' },
      type: 'broadcast',
    });
    const clientControlBroadcastStatus =
      await ownerControlSubscription.channel.send({
        event: 'chat_channel_rotated',
        payload: { pet_id: petId, type: 'chat_channel_rotated' },
        type: 'broadcast',
      });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const memberClientSendDelta =
      memberSubscription.events.length - memberEventsBeforeClientSend;
    const controlClientSendDelta =
      ownerControlSubscription.events.length -
      ownerControlEventsBeforeClientSend;
    expect(
      clientPetBroadcastStatus !== 'ok' &&
        clientControlBroadcastStatus !== 'ok' &&
        memberClientSendDelta === 0 &&
        controlClientSendDelta === 0,
      `SECURITY BREACH: Authenticated client Broadcast result pet=${clientPetBroadcastStatus}/${memberClientSendDelta} control=${clientControlBroadcastStatus}/${controlClientSendDelta}.`,
    );

    for (const [guessedTopic, label] of [
      [topicFor(petId, version + 1), 'Member future v+1'],
      [topicFor(petId, version + 2), 'Member future v+2'],
      [topicFor(petId, version + 93), 'Member future v+93'],
      [`pet:${petId}:chat:v0`, 'Member malformed zero version'],
      [`pet:${petId}:chat:vnot-a-number`, 'Member malformed version'],
      [`pet:${petId}:chat:v${'9'.repeat(80)}`, 'Member overflowing version'],
      [`pet:not-a-uuid:chat:v${version}`, 'Member malformed pet'],
    ]) {
      await expectSubscriptionDenied(member.client, guessedTopic, label);
    }

    const { error: strangerVersionError } = await stranger.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: petId },
    );
    expect(
      strangerVersionError,
      'SECURITY BREACH: Stranger read topic version.',
    );
    await expectSubscriptionDenied(
      stranger.client,
      topic,
      'Stranger guessed topic',
    );
    await expectSubscriptionDenied(
      stranger.client,
      controlTopicFor(owner.id),
      'Stranger guessed Owner control topic',
    );

    const { data: strangerRows, error: strangerReadError } =
      await stranger.client
        .from('chat_messages')
        .select('id')
        .eq('pet_id', petId);
    expect(
      !strangerReadError && strangerRows.length === 0,
      'SECURITY BREACH: Stranger read messages.',
    );
    const { error: directInsertError } = await owner.client
      .from('chat_messages')
      .insert({
        body: 'spoof',
        client_message_id: randomUUID(),
        pet_id: petId,
        sender_id: stranger.id,
      });
    expect(
      directInsertError,
      'SECURITY BREACH: Direct sender spoof succeeded.',
    );

    const idempotencyId = randomUUID();
    const first = await send(owner.client, petId, 'Owner hello', idempotencyId);
    const retry = await send(
      owner.client,
      petId,
      '  Owner hello  ',
      idempotencyId,
    );
    expect(first.id === retry.id, 'Idempotent retry created a second message.');
    const { error: changedBodyCollision } = await owner.client.rpc(
      'send_chat_message',
      {
        message_body: 'Different semantic request',
        target_client_message_id: idempotencyId,
        target_pet_id: petId,
      },
    );
    const { error: crossPetCollision } = await owner.client.rpc(
      'send_chat_message',
      {
        message_body: 'Owner hello',
        target_client_message_id: idempotencyId,
        target_pet_id: crossPetId,
      },
    );
    expect(
      changedBodyCollision?.code === '23505' &&
        crossPetCollision?.code === '23505',
      'client_message_id collision did not fail closed across body or Pet.',
    );
    const createEvent = await waitForEvent(
      memberSubscription.events,
      'message_created',
      (payload) => payload.message_id === first.id,
    );
    expectChatPayload(createEvent.payload, 'message_created', first.id);
    console.log(
      `INFO: Supabase Chat Broadcast payload keys: ${Object.keys(createEvent.payload).sort().join(',')}`,
    );
    const { data: memberRead, error: memberReadError } =
      await member.client.rpc('get_chat_messages_page', {
        target_pet_id: petId,
      });
    expect(
      !memberReadError && memberRead.some((message) => message.id === first.id),
      'Member could not read Owner messages.',
    );

    const { error: whitespaceError } = await member.client.rpc(
      'send_chat_message',
      {
        message_body: '   ',
        target_client_message_id: randomUUID(),
        target_pet_id: petId,
      },
    );
    const { error: longError } = await member.client.rpc('send_chat_message', {
      message_body: 'x'.repeat(2001),
      target_client_message_id: randomUUID(),
      target_pet_id: petId,
    });
    expect(whitespaceError && longError, 'Message validation was bypassed.');

    const { error: crossPetSendError } = await member.client.rpc(
      'send_chat_message',
      {
        message_body: 'cross pet attempt',
        target_client_message_id: randomUUID(),
        target_pet_id: crossPetId,
      },
    );
    expect(crossPetSendError, 'SECURITY BREACH: Cross-pet send succeeded.');
    const { data: strangerDelete } = await stranger.client.rpc(
      'delete_chat_message',
      { target_message_id: first.id },
    );
    expect(
      strangerDelete === false,
      'SECURITY BREACH: Stranger deleted a message.',
    );
    const { error: directUpdateError } = await owner.client
      .from('chat_messages')
      .update({ body: 'No direct edits' })
      .eq('id', first.id);
    const { error: directDeleteError } = await owner.client
      .from('chat_messages')
      .delete()
      .eq('id', first.id);
    expect(
      directUpdateError && directDeleteError,
      'Direct message update or delete privilege was exposed.',
    );

    const memberMessage = await send(
      member.client,
      petId,
      'Member own message',
    );
    const editedMemberMessage = await update(
      member.client,
      memberMessage.id,
      '  Member edited own message  ',
    );
    expect(
      editedMemberMessage.body === 'Member edited own message' &&
        editedMemberMessage.id === memberMessage.id &&
        editedMemberMessage.pet_id === memberMessage.pet_id &&
        editedMemberMessage.sender_id === memberMessage.sender_id &&
        editedMemberMessage.created_at === memberMessage.created_at &&
        editedMemberMessage.updated_at >= memberMessage.updated_at,
      'Edit-own changed immutable fields or failed normalization.',
    );
    const updateEvent = await waitForEvent(
      ownerSubscription.events,
      'message_updated',
      (payload) => payload.message_id === memberMessage.id,
    );
    expectChatPayload(updateEvent.payload, 'message_updated', memberMessage.id);
    const { error: memberEditOwnerError } = await member.client.rpc(
      'update_chat_message',
      { message_body: 'forbidden', target_message_id: first.id },
    );
    const { error: ownerEditMemberError } = await owner.client.rpc(
      'update_chat_message',
      { message_body: 'forbidden', target_message_id: memberMessage.id },
    );
    const { error: emptyEditError } = await member.client.rpc(
      'update_chat_message',
      { message_body: '   ', target_message_id: memberMessage.id },
    );
    const { error: longEditError } = await member.client.rpc(
      'update_chat_message',
      { message_body: 'x'.repeat(2001), target_message_id: memberMessage.id },
    );
    expect(
      memberEditOwnerError &&
        ownerEditMemberError &&
        emptyEditError &&
        longEditError,
      'Edit-own authorization or validation was bypassed.',
    );
    const { data: memberCannotDeleteOwner } = await member.client.rpc(
      'delete_chat_message',
      { target_message_id: first.id },
    );
    expect(memberCannotDeleteOwner === false, 'Member deleted Owner message.');
    const { data: memberDeletedOwn } = await member.client.rpc(
      'delete_chat_message',
      { target_message_id: memberMessage.id },
    );
    expect(memberDeletedOwn === true, 'Member could not delete own message.');
    const deleteEvent = await waitForEvent(
      ownerSubscription.events,
      'message_deleted',
      (payload) => payload.message_id === memberMessage.id,
    );
    expectChatPayload(deleteEvent.payload, 'message_deleted', memberMessage.id);

    const moderationTarget = await send(
      member.client,
      petId,
      'Owner moderation target',
    );
    const { data: ownerModerated } = await owner.client.rpc(
      'delete_chat_message',
      { target_message_id: moderationTarget.id },
    );
    expect(ownerModerated === true, 'Owner moderation delete failed.');

    const visibleReadAnchor = await send(
      owner.client,
      petId,
      'Visible read anchor M10',
    );
    const unseenAfterAnchor = await send(
      owner.client,
      petId,
      'Already committed but not visible M11',
    );
    await markRead(member.client, petId, visibleReadAnchor.id);
    await send(member.client, petId, 'Own message is not unread');
    const { data: unread } = await member.client.rpc('get_chat_unread_count', {
      target_pet_id: petId,
    });
    expect(unread === 1, `Unread count was ${unread}, expected 1.`);
    await markRead(member.client, petId, unseenAfterAnchor.id);
    await markRead(member.client, petId, visibleReadAnchor.id);
    const { data: readStates, error: readStateError } = await member.client
      .from('chat_read_states')
      .select('last_read_at, last_read_message_id')
      .eq('pet_id', petId);
    expect(
      !readStateError &&
        readStates.length === 1 &&
        readStates[0].last_read_message_id === unseenAfterAnchor.id,
      'Read cursor moved backwards after an older visible message was submitted.',
    );
    const crossPetMessage = await send(
      owner.client,
      crossPetId,
      'Cross-pet read cursor target',
    );
    const { error: crossPetReadCursorError } = await owner.client.rpc(
      'mark_chat_read',
      {
        target_message_id: crossPetMessage.id,
        target_pet_id: petId,
      },
    );
    expect(
      crossPetReadCursorError,
      'SECURITY BREACH: mark-read accepted a message from another Pet.',
    );

    const concurrentIds = Array.from({ length: 8 }, () => randomUUID());
    const concurrentMessages = await Promise.all(
      concurrentIds.map((id, index) =>
        send(owner.client, petId, `Concurrent ${index}`, id),
      ),
    );
    for (let index = 0; index < 72; index += 1) {
      await send(owner.client, petId, `Pagination ${index}`);
    }
    const pages = await fetchAllPages(owner.client, petId);
    expect(pages.length > 70, 'Pagination fixture did not exceed 70 rows.');
    expect(
      new Set(pages.map((message) => message.id)).size === pages.length,
      'Cursor pagination returned duplicate rows.',
    );
    for (let index = 1; index < pages.length; index += 1) {
      const previous = pages[index - 1];
      const current = pages[index];
      expect(
        previous.created_at > current.created_at ||
          (previous.created_at === current.created_at &&
            previous.id > current.id),
        'Cursor pagination order was not deterministic.',
      );
    }

    const retainedMemberMessage = await send(
      member.client,
      petId,
      'Retained after Member removal',
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    memberSubscription.events.length = 0;
    memberControlSubscription.events.length = 0;
    ownerControlSubscription.events.length = 0;
    const [concurrentSend, concurrentRemoval] = await allSettledWithin(
      [
        send(member.client, petId, 'Concurrent with removal'),
        owner.client
          .rpc('remove_pet_member', {
            target_pet_id: petId,
            target_user_id: member.id,
          })
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          }),
      ],
      'remove vs send',
    );
    expect(
      concurrentRemoval.status === 'fulfilled' &&
        concurrentRemoval.value === 'removed',
      'Concurrent Member removal failed.',
    );
    if (concurrentSend.status === 'rejected') {
      expect(
        concurrentSend.reason?.code === '42501',
        'Concurrent send failed for a reason other than completed removal.',
      );
    }
    const rotationControl = await waitForEvent(
      ownerControlSubscription.events,
      'chat_channel_rotated',
      (payload) => payload.pet_id === petId,
    );
    expectControlPayload(rotationControl.payload, petId);
    console.log(
      `INFO: Supabase control Broadcast payload keys: ${Object.keys(rotationControl.payload).sort().join(',')}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      memberControlSubscription.events.length === 0,
      'SECURITY BREACH: Removed Member received a rotation control event.',
    );
    const oldMemberEventCount = memberSubscription.events.length;
    const rotatedVersion = await getVersion(owner.client, petId);
    expect(rotatedVersion === version + 1, 'Channel version did not rotate.');
    const newTopic = topicFor(petId, rotatedVersion);
    await expectSubscriptionDenied(
      member.client,
      newTopic,
      'Removed Member new topic',
    );
    for (const guessedVersion of [
      rotatedVersion + 1,
      rotatedVersion + 2,
      100,
    ]) {
      await expectSubscriptionDenied(
        member.client,
        topicFor(petId, guessedVersion),
        `Removed Member guessed v${guessedVersion}`,
      );
    }

    const newOwnerSubscription = await subscribeAllowed(
      owner.client,
      newTopic,
      'Owner rotated topic',
    );
    channels.push([owner.client, newOwnerSubscription.channel]);
    const postRemoval = await send(owner.client, petId, 'After removal');
    await waitForEvent(
      newOwnerSubscription.events,
      'message_created',
      (payload) => payload.message_id === postRemoval.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(
      memberSubscription.events.length === oldMemberEventCount,
      'SECURITY BREACH: Removed Member old topic received a future event.',
    );

    const { data: removedRows, error: removedReadError } = await member.client
      .from('chat_messages')
      .select('id')
      .eq('pet_id', petId);
    expect(
      !removedReadError && removedRows.length === 0,
      'SECURITY BREACH: Removed Member retained DB read access.',
    );
    const { error: removedVersionError } = await member.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: petId },
    );
    expect(
      removedVersionError,
      'SECURITY BREACH: Removed Member read the rotated topic version.',
    );
    const { error: removedSendError } = await member.client.rpc(
      'send_chat_message',
      {
        message_body: 'removed send',
        target_client_message_id: randomUUID(),
        target_pet_id: petId,
      },
    );
    expect(removedSendError, 'SECURITY BREACH: Removed Member sent a message.');
    const { error: removedEditError } = await member.client.rpc(
      'update_chat_message',
      {
        message_body: 'removed edit',
        target_message_id: retainedMemberMessage.id,
      },
    );
    const { data: removedDelete } = await member.client.rpc(
      'delete_chat_message',
      { target_message_id: retainedMemberMessage.id },
    );
    expect(
      removedEditError && removedDelete === false,
      'SECURITY BREACH: Removed Member edited or deleted an old message.',
    );

    const memberEventsBeforeDelete = memberSubscription.events.length;
    await owner.client.rpc('delete_chat_message', {
      target_message_id: postRemoval.id,
    });
    await waitForEvent(
      newOwnerSubscription.events,
      'message_deleted',
      (payload) => payload.message_id === postRemoval.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(
      memberSubscription.events.length === memberEventsBeforeDelete,
      'SECURITY BREACH: Removed Member received a delete event.',
    );
    member.client.realtime.disconnect();
    member.client.realtime.connect();
    await member.client.realtime.setAuth();
    await expectSubscriptionDenied(
      member.client,
      newTopic,
      'Removed Member reconnect to current topic',
    );
    const { error: reconnectVersionError } = await member.client.rpc(
      'get_pet_chat_channel_version',
      { target_pet_id: petId },
    );
    expect(
      reconnectVersionError,
      'SECURITY BREACH: Removed Member regained access after reconnect.',
    );

    const rejoinForConcurrentScenario = async (label) => {
      await inviteAndJoin(owner.client, member.client, petId);
      const scenarioVersion = await getVersion(owner.client, petId);
      const scenarioTopic = topicFor(petId, scenarioVersion);
      const memberScenarioSubscription = await subscribeAllowed(
        member.client,
        scenarioTopic,
        `${label} Member retained socket`,
      );
      channels.push([member.client, memberScenarioSubscription.channel]);
      await new Promise((resolve) => setTimeout(resolve, 700));
      memberScenarioSubscription.events.length = 0;
      memberControlSubscription.events.length = 0;
      ownerControlSubscription.events.length = 0;
      return { memberScenarioSubscription, scenarioVersion };
    };

    const deleteScenario = await rejoinForConcurrentScenario(
      'remove vs delete-own',
    );
    const deleteRaceTarget = await send(
      member.client,
      petId,
      'Concurrent delete target',
    );
    const [concurrentDelete, removeDuringDelete] = await allSettledWithin(
      [
        member.client
          .rpc('delete_chat_message', {
            target_message_id: deleteRaceTarget.id,
          })
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          }),
        removeMember(owner.client, petId, member.id),
      ],
      'remove vs delete-own',
    );
    expect(
      removeDuringDelete.status === 'fulfilled' &&
        removeDuringDelete.value === 'removed',
      'remove vs delete-own did not complete removal.',
    );
    if (concurrentDelete.status === 'fulfilled') {
      expect(
        concurrentDelete.value === true || concurrentDelete.value === false,
        'Concurrent delete returned an invalid result.',
      );
    } else {
      expect(
        concurrentDelete.reason?.code === '42501',
        'Concurrent delete failed for an unexpected reason.',
      );
    }
    await waitForEvent(
      ownerControlSubscription.events,
      'chat_channel_rotated',
      (payload) => payload.pet_id === petId,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      memberControlSubscription.events.length === 0,
      'SECURITY BREACH: Removed Member received delete-race control.',
    );
    const deleteRaceOldEventCount =
      deleteScenario.memberScenarioSubscription.events.length;
    const afterDeleteRace = await send(
      owner.client,
      petId,
      'After delete race removal',
    );
    await owner.client.rpc('delete_chat_message', {
      target_message_id: afterDeleteRace.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      deleteScenario.memberScenarioSubscription.events.length ===
        deleteRaceOldEventCount,
      'SECURITY BREACH: Old topic received an event after delete-race removal.',
    );

    const editScenario =
      await rejoinForConcurrentScenario('remove vs edit-own');
    const editRaceTarget = await send(
      member.client,
      petId,
      'Concurrent edit target',
    );
    const [concurrentEdit, removeDuringEdit] = await allSettledWithin(
      [
        update(member.client, editRaceTarget.id, 'Concurrent edited value'),
        removeMember(owner.client, petId, member.id),
      ],
      'remove vs edit-own',
    );
    expect(
      removeDuringEdit.status === 'fulfilled' &&
        removeDuringEdit.value === 'removed',
      'remove vs edit-own did not complete removal.',
    );
    if (concurrentEdit.status === 'fulfilled') {
      expect(
        concurrentEdit.value.body === 'Concurrent edited value',
        'Concurrent edit completed with unexpected content.',
      );
    } else {
      expect(
        concurrentEdit.reason?.code === '42501',
        'Concurrent edit failed for an unexpected reason.',
      );
    }
    await waitForEvent(
      ownerControlSubscription.events,
      'chat_channel_rotated',
      (payload) => payload.pet_id === petId,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    const editRaceOldEventCount =
      editScenario.memberScenarioSubscription.events.length;
    const afterEditRace = await send(
      owner.client,
      petId,
      'After edit race removal',
    );
    await owner.client.rpc('delete_chat_message', {
      target_message_id: afterEditRace.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      editScenario.memberScenarioSubscription.events.length ===
        editRaceOldEventCount && memberControlSubscription.events.length === 0,
      'SECURITY BREACH: Old topic/control received an event after edit-race removal.',
    );

    const ownerSendScenario = await rejoinForConcurrentScenario(
      'Owner send vs Member removal',
    );
    const [ownerConcurrentSend, removeDuringOwnerSend] = await allSettledWithin(
      [
        send(owner.client, petId, 'Owner concurrent with removal'),
        removeMember(owner.client, petId, member.id),
      ],
      'Owner send vs Member removal',
    );
    expect(
      ownerConcurrentSend.status === 'fulfilled' &&
        removeDuringOwnerSend.status === 'fulfilled' &&
        removeDuringOwnerSend.value === 'removed',
      'Owner send vs Member removal failed or deadlocked.',
    );
    await waitForEvent(
      ownerControlSubscription.events,
      'chat_channel_rotated',
      (payload) => payload.pet_id === petId,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    const ownerRaceOldEventCount =
      ownerSendScenario.memberScenarioSubscription.events.length;
    const afterOwnerRace = await send(
      owner.client,
      petId,
      'After Owner send race removal',
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      ownerSendScenario.memberScenarioSubscription.events.length ===
        ownerRaceOldEventCount && memberControlSubscription.events.length === 0,
      'SECURITY BREACH: Old topic/control received an event after Owner-send removal.',
    );

    await inviteAndJoin(owner.client, member.client, petId);
    const beforeAccountDeleteVersion = await getVersion(owner.client, petId);
    const accountDeleteTopic = topicFor(petId, beforeAccountDeleteVersion);
    const accountDeleteSubscription = await subscribeAllowed(
      member.client,
      accountDeleteTopic,
      'Member account-deletion retained socket',
    );
    channels.push([member.client, accountDeleteSubscription.channel]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    memberControlSubscription.events.length = 0;
    ownerControlSubscription.events.length = 0;
    accountDeleteSubscription.events.length = 0;
    const accountDeleteMessage = await send(
      member.client,
      petId,
      'Deleted with Member account',
    );
    await waitForEvent(
      accountDeleteSubscription.events,
      'message_created',
      (payload) => payload.message_id === accountDeleteMessage.id,
    );
    const { error: memberDeleteError } = await admin.auth.admin.deleteUser(
      member.id,
    );
    if (memberDeleteError) throw memberDeleteError;
    createdUserIds.splice(createdUserIds.indexOf(member.id), 1);
    expect(
      (await getVersion(owner.client, petId)) ===
        beforeAccountDeleteVersion + 1,
      'Member account deletion did not rotate the channel.',
    );
    await waitForEvent(
      ownerControlSubscription.events,
      'chat_channel_rotated',
      (payload) => payload.pet_id === petId,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      memberControlSubscription.events.length === 0,
      'SECURITY BREACH: Deleted Member received account-deletion control.',
    );
    const deletedAccountOldEventCount = accountDeleteSubscription.events.length;
    await send(owner.client, petId, 'After Member account deletion');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      accountDeleteSubscription.events.length === deletedAccountOldEventCount,
      'SECURITY BREACH: Deleted Member old topic received a future event.',
    );
    const { data: deletedSenderMessage, error: deletedSenderReadError } =
      await owner.client
        .from('chat_messages')
        .select('id')
        .eq('id', accountDeleteMessage.id);
    expect(
      !deletedSenderReadError && deletedSenderMessage.length === 0,
      'Member account deletion retained own chat message.',
    );

    ownerDeletionUser = await createUser('Owner deletion fixture');
    createdUserIds.push(ownerDeletionUser.id);
    ownerDeletePetId = await createPet(
      ownerDeletionUser.client,
      'Owner deletion Pet',
    );
    const ownerDeletionMessage = await send(
      ownerDeletionUser.client,
      ownerDeletePetId,
      'Cascaded with owned Pet',
    );
    const { error: ownedPetDeleteError } = await ownerDeletionUser.client
      .from('pets')
      .delete()
      .eq('id', ownerDeletePetId);
    if (ownedPetDeleteError) throw ownedPetDeleteError;
    ownerDeletePetId = null;
    const { error: ownerAuthDeleteError } = await admin.auth.admin.deleteUser(
      ownerDeletionUser.id,
    );
    if (ownerAuthDeleteError) throw ownerAuthDeleteError;
    createdUserIds.splice(createdUserIds.indexOf(ownerDeletionUser.id), 1);
    const { data: ownerDeletedMessageRows, error: ownerDeletedMessageError } =
      await ownerDeletionUser.client
        .from('chat_messages')
        .select('id')
        .eq('id', ownerDeletionMessage.id);
    expect(
      !ownerDeletedMessageError && ownerDeletedMessageRows.length === 0,
      'Owner Plan A deletion retained owned-Pet Chat data.',
    );

    await new Promise((resolve) => setTimeout(resolve, 700));
    const ownerControlEventsBeforePetDelete =
      ownerControlSubscription.events.length;
    const { error: petDeleteError } = await owner.client
      .from('pets')
      .delete()
      .eq('id', petId);
    if (petDeleteError) throw petDeleteError;
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(
      ownerControlSubscription.events.length ===
        ownerControlEventsBeforePetDelete,
      'SECURITY BREACH: Pet cascade emitted a chat control event.',
    );
    const [messageRows, readRows] = await Promise.all([
      owner.client.from('chat_messages').select('id').eq('pet_id', petId),
      owner.client
        .from('chat_read_states')
        .select('pet_id')
        .eq('pet_id', petId),
    ]);
    expect(
      !messageRows.error &&
        !readRows.error &&
        messageRows.data.length === 0 &&
        readRows.data.length === 0,
      'Pet deletion did not cascade Chat data safely.',
    );

    console.log('PASS: Owner, Member, Stranger, and cross-pet RLS matrix.');
    console.log(
      'PASS: minimal private Chat Broadcast and per-user rotation control.',
    );
    console.log(
      'PASS: future-version guesses denied; old topics stayed fully silent.',
    );
    console.log(
      'PASS: send/edit/delete races serialized against Member removal.',
    );
    console.log(
      'PASS: validation, edit-own, idempotency, cursor unread, and 70+ pages.',
    );
    console.log(
      'PASS: account and pet deletion cascades with version rotation.',
    );
  } finally {
    for (const [client, channel] of channels) {
      await client.removeChannel(channel).catch(() => undefined);
    }
    if (crossPetId && owner) {
      await owner.client.from('pets').delete().eq('id', crossPetId);
    }
    if (ownerDeletePetId && ownerDeletionUser) {
      await ownerDeletionUser.client
        .from('pets')
        .delete()
        .eq('id', ownerDeletePetId);
    }
    if (petId && owner) {
      await owner.client.from('pets').delete().eq('id', petId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

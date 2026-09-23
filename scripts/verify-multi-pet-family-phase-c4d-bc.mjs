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
  throw new Error('SAFETY STOP: Phase C4D-BC verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C4D-BC requires a local DB container.');
}

const migrationPath =
  'supabase/migrations/20260922155805_multi_pet_family_phase_c4d_bc_shared_actor_retention.sql';
const migration = readFileSync(join(root, migrationPath), 'utf8');
const databaseTypes = readFileSync(join(root, 'src/types/database.ts'), 'utf8');
const deletePostEdge = readFileSync(
  join(root, 'supabase/functions/delete-post/index.ts'),
  'utf8',
);
const journalScreen = readFileSync(
  join(root, 'src/features/journal/journal-screen.tsx'),
  'utf8',
);
const careScreen = readFileSync(
  join(root, 'src/features/care/care-history-screen.tsx'),
  'utf8',
);
const chatList = readFileSync(
  join(root, 'src/features/chat/components/production-chat-message-list.tsx'),
  'utf8',
);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const deletedUsers = new Set();
const familyIds = new Set();

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
  const email = `phase-c4d-bc-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      display_name: `Phase C4D-BC ${label}`,
      locale: 'en',
    },
  });
  if (created.error || !created.data.user) throw created.error;

  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;

  const user = { client, id: created.data.user.id };
  users.push(user);
  return user;
}

async function deleteAuthUser(user) {
  const deleted = await admin.auth.admin.deleteUser(user.id);
  if (deleted.error) throw deleted.error;
  deletedUsers.add(user.id);
}

async function createFamily(owner, label) {
  const result = await owner.client.rpc('create_pet', {
    pet_adoption_date: null,
    pet_birthday: null,
    pet_breed: 'Phase C4D-BC verifier',
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

async function createPost(actor, petId, label) {
  const id = randomUUID();
  const result = await actor.client.rpc('create_post', {
    media_items: [],
    post_content: label,
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: id,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (result.error || result.data?.author_id !== actor.id) throw result.error;
  return id;
}

async function createHealth(actor, petId, label) {
  const id = randomUUID();
  const result = await actor.client.rpc('create_care_log', {
    care_duration_minutes: null,
    care_health_subtype: 'energy',
    care_id: id,
    care_kind: 'health',
    care_note: label,
    care_occurred_at: new Date().toISOString(),
    care_time_zone: 'Asia/Hong_Kong',
    target_pet_id: petId,
  });
  if (result.error || result.data?.performed_by !== actor.id)
    throw result.error;
  return id;
}

async function createChat(actor, petId, label) {
  const result = await actor.client.rpc('send_chat_message', {
    message_body: label,
    target_client_message_id: randomUUID(),
    target_pet_id: petId,
  });
  if (result.error || result.data?.sender_id !== actor.id) throw result.error;
  return result.data.id;
}

async function createFutureTask(actor, petId, label) {
  const id = randomUUID();
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  const result = await actor.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: id,
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
  if (result.error || result.data?.created_by !== actor.id) throw result.error;
  return { id, scheduledAt };
}

async function createDueCompletion(actor, petId, label) {
  const taskId = randomUUID();
  const completionId = randomUUID();
  const careLogId = randomUUID();

  sql(`
    insert into public.care_tasks (
      id, pet_id, created_by, title, care_type, note, schedule_type,
      starts_on, local_time, time_zone, week_day, month_day
    )
    values (
      '${taskId}'::uuid,
      '${petId}'::uuid,
      '${actor.id}'::uuid,
      '${label}',
      'medicine'::public.care_type,
      '${label}',
      'daily'::public.care_task_schedule_type,
      (clock_timestamp() at time zone 'Asia/Hong_Kong')::date,
      date_trunc('minute', clock_timestamp() at time zone 'Asia/Hong_Kong')::time(0),
      'Asia/Hong_Kong',
      null,
      null
    );
  `);

  const occurrence = sql(`
    select to_char(
      ((starts_on + local_time) at time zone time_zone) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
    from public.care_tasks
    where id = '${taskId}'::uuid;
  `);

  const result = await actor.client.rpc('complete_care_task', {
    care_log_id: careLogId,
    completion_duration_minutes: null,
    completion_id: completionId,
    completion_note: label,
    occurrence_scheduled_for: occurrence,
    target_task_id: taskId,
  });
  if (
    result.error ||
    result.data?.[0]?.result_completed_by !== actor.id ||
    result.data?.[0]?.completion_status !== 'completed'
  ) {
    throw result.error ?? new Error('Task completion attribution failed.');
  }

  return { careLogId, completionId, occurrence, taskId };
}

async function createCanceledSchedule(actor, petId, label) {
  const task = await createFutureTask(actor, petId, label);
  const shiftId = randomUUID();
  const created = await actor.client.rpc('create_care_shift', {
    shift_id: shiftId,
    shift_local_date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(task.scheduledAt)),
    shift_note: label,
    target_assignee_user_id: actor.id,
    target_pet_id: petId,
    task_items: [
      {
        care_task_id: task.id,
        source_scheduled_for: task.scheduledAt,
      },
    ],
  });
  if (created.error) throw created.error;

  const canceled = await actor.client.rpc('cancel_care_shift', {
    target_shift_id: shiftId,
  });
  if (canceled.error || canceled.data !== 'canceled') throw canceled.error;

  return { shiftId, taskId: task.id };
}

async function createHistory(actor, petId, label, extended = false) {
  const postId = await createPost(actor, petId, `${label} post`);
  const careId = await createHealth(actor, petId, `${label} health`);
  const completion = await createDueCompletion(
    actor,
    petId,
    `${label} completion`,
  );
  const chatId = await createChat(actor, petId, `${label} chat`);
  const moderatedCareId = await createHealth(
    actor,
    petId,
    `${label} owner moderation`,
  );
  const moderatedCompletion = await createDueCompletion(
    actor,
    petId,
    `${label} owner undo`,
  );
  const moderatedChatId = await createChat(
    actor,
    petId,
    `${label} owner delete`,
  );

  const result = {
    careId,
    chatId,
    completion,
    moderatedCareId,
    moderatedChatId,
    moderatedCompletion,
    postId,
  };

  if (!extended) return result;

  const photoPostId = await createPost(actor, petId, `${label} photo`);
  const videoPostId = await createPost(actor, petId, `${label} video`);
  const photoId = randomUUID();
  const videoId = randomUUID();
  const schedule = await createCanceledSchedule(
    actor,
    petId,
    `${label} schedule`,
  );

  sql(`
    insert into public.post_media (
      id, post_id, storage_path, position, width, height, mime_type
    )
    values (
      '${photoId}'::uuid,
      '${photoPostId}'::uuid,
      '${actor.id}/${petId}/${photoPostId}/${photoId}.jpg',
      0, 1200, 900, 'image/jpeg'
    );

    insert into public.post_videos (
      id, post_id, storage_path, thumbnail_path, duration_ms,
      file_size_bytes, width, height, mime_type
    )
    values (
      '${videoId}'::uuid,
      '${videoPostId}'::uuid,
      '${actor.id}/${petId}/${videoPostId}/${videoId}.mp4',
      '${actor.id}/${petId}/${videoPostId}/${videoId}.jpg',
      5000, 1024, 1280, 720, 'video/mp4'
    );

    update public.pets
    set avatar_path = '${actor.id}/${petId}/avatar.jpg'
    where id = '${petId}'::uuid;

    insert into private.push_devices (
      user_id, installation_id, expo_push_token, platform, app_version
    )
    values (
      '${actor.id}'::uuid,
      'c4dbc-${randomUUID()}',
      'ExpoPushToken[${randomUUID().replaceAll('-', '')}]',
      'ios',
      '1.1.0'
    );
  `);

  return {
    ...result,
    photoId,
    photoPostId,
    schedule,
    videoId,
    videoPostId,
  };
}

async function expectDenied(label, promise) {
  const result = await promise;
  expect(Boolean(result.error), `${label} unexpectedly succeeded.`);
  console.log(`PASS: ${label}`);
  return result;
}

async function expectHidden(label, promise) {
  const result = await promise;
  expect(!result.error && result.data?.length === 0, `${label} was visible.`);
  console.log(`PASS: ${label}`);
}

async function cleanup() {
  for (const familyId of familyIds) {
    sql(`
      delete from public.pets where family_id = '${familyId}'::uuid;
      delete from public.families where id = '${familyId}'::uuid;
    `);
  }
  for (const user of users) {
    if (deletedUsers.has(user.id)) continue;
    await user.client.auth.signOut();
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
}

try {
  for (const [table, column, constraint] of [
    ['posts', 'author_id', 'posts_author_id_fkey'],
    ['care_logs', 'performed_by', 'care_logs_performed_by_fkey'],
    [
      'care_task_completions',
      'completed_by',
      'care_task_completions_completed_by_fkey',
    ],
    ['chat_messages', 'sender_id', 'chat_messages_sender_id_fkey'],
  ]) {
    expect(
      migration.includes(`drop constraint ${constraint}`) &&
        migration.includes(`alter column ${column} drop not null`) &&
        migration.includes('on delete set null'),
      `Missing C4D-BC migration change for ${table}.${column}.`,
    );
  }

  for (const token of [
    'existing_post.author_id is distinct from caller_id',
    'existing_log.performed_by is distinct from caller_id',
    'existing_completion.completed_by is distinct from caller_id',
    'message_sender_id is distinct from caller_id',
    'message.sender_id is distinct from caller_id',
  ]) {
    expect(migration.includes(token), `Missing NULL-safe guard: ${token}`);
  }
  expect(
    !migration.includes('existing_post.author_id <> caller_id') &&
      !migration.includes('existing_log.performed_by <> caller_id') &&
      !migration.includes('existing_completion.completed_by <> caller_id') &&
      !migration.includes('message_sender_id <> caller_id') &&
      !migration.includes('message.sender_id <> caller_id'),
    'Nullable actor authorization still uses a NULL-unsafe comparison.',
  );
  expect(
    migration.match(/create or replace function public\.update_post\(/gu)
      ?.length === 1 &&
      migration.includes('create or replace function public.update_post_v2(') &&
      migration.includes(
        'create or replace function public.get_chat_unread_count(',
      ),
    'Atomic migration is missing an affected function replacement.',
  );
  expect(
    databaseTypes.includes('author_id: string | null;') &&
      databaseTypes.includes('performed_by: string | null;') &&
      databaseTypes.includes('completed_by: string | null;') &&
      databaseTypes.includes('sender_id: string | null;'),
    'Database Types do not expose nullable shared actors.',
  );
  expect(
    journalScreen.includes('item.post.author_id') &&
      careScreen.includes('item.log.performed_by') &&
      chatList.includes('const member = item.sender_id') &&
      chatList.includes('memberById.get(item.sender_id)'),
    'Minimal nullable-actor client fallback is missing.',
  );
  expect(
    deletePostEdge.includes(".from('pets')") &&
      deletePostEdge.includes("'get_family_members'") &&
      !deletePostEdge.includes(".from('pet_members')") &&
      deletePostEdge.includes("membership?.member_role === 'owner'") &&
      deletePostEdge.includes(
        "membership?.member_role === 'member' && post.author_id === user.id",
      ),
    'Canonical Family authorization or Journal moderation semantics changed.',
  );
  console.log(
    'PASS: Atomic schema, NULL-safe functions, types, client fallbacks, and existing Journal moderation are present.',
  );

  expectSql(
    'All four actor columns are nullable ON DELETE SET NULL.',
    `
      select count(*) = 4
      from information_schema.columns as column_info
      join pg_catalog.pg_class as relation
        on relation.relname = column_info.table_name
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
        and namespace.nspname = column_info.table_schema
      join pg_catalog.pg_constraint as constraint_info
        on constraint_info.conrelid = relation.oid
        and constraint_info.contype = 'f'
        and constraint_info.confdeltype = 'n'
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = relation.oid
        and attribute.attnum = any (constraint_info.conkey)
        and attribute.attname = column_info.column_name
      where column_info.table_schema = 'public'
        and (column_info.table_name, column_info.column_name) in (
          ('posts', 'author_id'),
          ('care_logs', 'performed_by'),
          ('care_task_completions', 'completed_by'),
          ('chat_messages', 'sender_id')
        )
        and column_info.is_nullable = 'YES';
    `,
  );

  const owner = await createUser('member-delete-owner');
  const member = await createUser('member-delete-actor');
  const ordinaryMember = await createUser('ordinary-member');
  const removedMember = await createUser('removed-member');
  const mainFamily = await createFamily(owner, 'Member delete');
  addMember(mainFamily.familyId, member.id);
  addMember(mainFamily.familyId, ordinaryMember.id);
  addMember(mainFamily.familyId, removedMember.id);

  const versionBeforeDelete = Number(
    (
      await owner.client.rpc('get_pet_chat_channel_version', {
        target_pet_id: mainFamily.petId,
      })
    ).data,
  );
  const history = await createHistory(
    member,
    mainFamily.petId,
    'Member delete',
    true,
  );

  const read = await member.client.rpc('mark_chat_read', {
    target_message_id: history.chatId,
    target_pet_id: mainFamily.petId,
  });
  if (read.error) throw read.error;

  expectSql(
    'All normal mutation paths bind new content to auth.uid().',
    `
      select
        (select author_id = '${member.id}'::uuid from public.posts where id = '${history.postId}'::uuid)
        and (select performed_by = '${member.id}'::uuid from public.care_logs where id = '${history.careId}'::uuid)
        and (select completed_by = '${member.id}'::uuid from public.care_task_completions where id = '${history.completion.completionId}'::uuid)
        and (select sender_id = '${member.id}'::uuid from public.chat_messages where id = '${history.chatId}'::uuid)
        and (select created_by = '${member.id}'::uuid from public.care_tasks where id = '${history.schedule.taskId}'::uuid);
    `,
  );

  await expectDenied(
    'Authenticated clients cannot INSERT an anonymous Post directly.',
    member.client.from('posts').insert({
      author_id: null,
      content: 'anonymous direct insert',
      event_date: new Date().toISOString().slice(0, 10),
      id: randomUUID(),
      location_name: null,
      pet_id: mainFamily.petId,
      tag: null,
    }),
  );
  await expectDenied(
    'Authenticated clients cannot clear an existing actor directly.',
    member.client
      .from('posts')
      .update({ author_id: null })
      .eq('id', history.postId),
  );

  await deleteAuthUser(member);

  const versionAfterDelete = Number(
    (
      await owner.client.rpc('get_pet_chat_channel_version', {
        target_pet_id: mainFamily.petId,
      })
    ).data,
  );
  expect(
    versionAfterDelete > versionBeforeDelete,
    'Raw Auth deletion did not rotate the Chat channel version.',
  );

  expectSql(
    'Member raw Auth deletion removes personal/access rows and preserves all shared history.',
    `
      select
        not exists (select 1 from public.profiles where id = '${member.id}'::uuid)
        and not exists (select 1 from public.family_members where user_id = '${member.id}'::uuid)
        and not exists (select 1 from public.pet_members where user_id = '${member.id}'::uuid)
        and not exists (select 1 from public.chat_read_states where user_id = '${member.id}'::uuid)
        and not exists (select 1 from private.push_devices where user_id = '${member.id}'::uuid)
        and exists (select 1 from public.posts where id = '${history.postId}'::uuid and author_id is null)
        and exists (select 1 from public.care_logs where id = '${history.careId}'::uuid and performed_by is null)
        and exists (select 1 from public.care_task_completions where id = '${history.completion.completionId}'::uuid and completed_by is null)
        and exists (select 1 from public.care_logs where id = '${history.completion.careLogId}'::uuid and performed_by is null)
        and exists (select 1 from public.chat_messages where id = '${history.chatId}'::uuid and sender_id is null)
        and exists (select 1 from public.care_tasks where id = '${history.schedule.taskId}'::uuid and created_by is null)
        and exists (
          select 1 from public.care_shifts
          where id = '${history.schedule.shiftId}'::uuid
            and assignee_user_id is null
            and created_by is null
            and canceled_by is null
            and status = 'canceled'
        )
        and exists (
          select 1 from public.care_shift_tasks
          where shift_id = '${history.schedule.shiftId}'::uuid
            and canceled_by is null
            and status = 'canceled'
        )
        and exists (select 1 from public.families where id = '${mainFamily.familyId}'::uuid)
        and exists (select 1 from public.pets where id = '${mainFamily.petId}'::uuid);
    `,
  );

  expectSql(
    'Journal photo/video metadata and Pet avatar reference survive actor deletion.',
    `
      select
        exists (select 1 from public.post_media where id = '${history.photoId}'::uuid)
        and exists (select 1 from public.post_videos where id = '${history.videoId}'::uuid)
        and exists (
          select 1 from public.pets
          where id = '${mainFamily.petId}'::uuid
            and avatar_path = '${member.id}/${mainFamily.petId}/avatar.jpg'
        );
    `,
  );

  const ownerPosts = await owner.client
    .from('posts')
    .select('id, author_id')
    .eq('id', history.postId);
  const ownerCare = await owner.client
    .from('care_logs')
    .select('id, performed_by')
    .eq('id', history.careId);
  const ownerCompletion = await owner.client
    .from('care_task_completions')
    .select('id, completed_by, care_log_id')
    .eq('id', history.completion.completionId);
  const ownerChat = await owner.client
    .from('chat_messages')
    .select('id, sender_id, body')
    .eq('id', history.chatId);
  expect(
    !ownerPosts.error &&
      ownerPosts.data?.[0]?.author_id === null &&
      ownerCare.data?.[0]?.performed_by === null &&
      ownerCompletion.data?.[0]?.completed_by === null &&
      ownerChat.data?.[0]?.sender_id === null,
    'Remaining Owner could not read nullable-actor shared history.',
  );
  console.log(
    'PASS: Remaining Family members can read anonymous Journal, Care, Completion, and Chat records.',
  );

  const unread = await ordinaryMember.client.rpc('get_chat_unread_count', {
    target_pet_id: mainFamily.petId,
  });
  expect(
    !unread.error && Number(unread.data) > 0,
    'Anonymous Chat was not counted as unread.',
  );
  console.log('PASS: Anonymous Chat retains unread semantics.');

  await expectDenied(
    'Ordinary Member cannot update an anonymous Post.',
    ordinaryMember.client.rpc('update_post', {
      media_items: [],
      post_content: 'attack',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
      post_tag: null,
      target_post_id: history.postId,
    }),
  );
  await expectDenied(
    'Ordinary Member cannot update an anonymous Care log.',
    ordinaryMember.client.rpc('update_care_log', {
      care_duration_minutes: null,
      care_note: 'attack',
      care_occurred_at: new Date().toISOString(),
      care_time_zone: 'Asia/Hong_Kong',
      target_care_log_id: history.careId,
    }),
  );
  await expectDenied(
    'Ordinary Member cannot undo an anonymous Completion.',
    ordinaryMember.client.rpc('undo_care_task_completion', {
      target_completion_id: history.completion.completionId,
    }),
  );
  await expectDenied(
    'Ordinary Member cannot edit an anonymous Chat message.',
    ordinaryMember.client.rpc('update_chat_message', {
      message_body: 'attack',
      target_message_id: history.chatId,
    }),
  );
  const memberChatDelete = await ordinaryMember.client.rpc(
    'delete_chat_message',
    { target_message_id: history.chatId },
  );
  expect(
    !memberChatDelete.error && memberChatDelete.data === false,
    'Ordinary Member deleted an anonymous Chat message.',
  );
  console.log('PASS: Ordinary Member cannot delete an anonymous Chat message.');

  const memberCareDelete = await ordinaryMember.client
    .from('care_logs')
    .delete()
    .eq('id', history.careId)
    .select('id');
  expect(
    !memberCareDelete.error && memberCareDelete.data?.length === 0,
    'Ordinary Member deleted an anonymous Care log.',
  );
  console.log('PASS: Ordinary Member cannot delete an anonymous Care log.');

  await expectDenied(
    'Owner cannot edit an anonymous Post.',
    owner.client.rpc('update_post', {
      media_items: [],
      post_content: 'owner edit',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
      post_tag: null,
      target_post_id: history.postId,
    }),
  );
  await expectDenied(
    'Owner cannot edit an anonymous Care log.',
    owner.client.rpc('update_care_log', {
      care_duration_minutes: null,
      care_note: 'owner edit',
      care_occurred_at: new Date().toISOString(),
      care_time_zone: 'Asia/Hong_Kong',
      target_care_log_id: history.careId,
    }),
  );
  await expectDenied(
    'Owner cannot edit an anonymous Chat message.',
    owner.client.rpc('update_chat_message', {
      message_body: 'owner edit',
      target_message_id: history.chatId,
    }),
  );

  const ownerCareDelete = await owner.client
    .from('care_logs')
    .delete()
    .eq('id', history.moderatedCareId)
    .select('id');
  expect(
    !ownerCareDelete.error && ownerCareDelete.data?.length === 1,
    'Existing Owner Care moderation was not preserved.',
  );
  const ownerUndo = await owner.client.rpc('undo_care_task_completion', {
    target_completion_id: history.moderatedCompletion.completionId,
  });
  expect(
    !ownerUndo.error && ownerUndo.data === 'undone',
    'Existing Owner Completion moderation was not preserved.',
  );
  const ownerChatDelete = await owner.client.rpc('delete_chat_message', {
    target_message_id: history.moderatedChatId,
  });
  expect(
    !ownerChatDelete.error && ownerChatDelete.data === true,
    'Existing Owner Chat moderation was not preserved.',
  );
  console.log(
    'PASS: Owner delete/undo moderation remains available without adding edit rights.',
  );

  const otherOwner = await createUser('other-family-owner');
  const otherFamily = await createFamily(otherOwner, 'Other Family');
  await expectHidden(
    'Cross-Family Owner cannot read anonymous Journal.',
    otherOwner.client.from('posts').select('id').eq('id', history.postId),
  );
  await expectHidden(
    'Cross-Family Owner cannot read anonymous Care.',
    otherOwner.client.from('care_logs').select('id').eq('id', history.careId),
  );
  await expectHidden(
    'Cross-Family Owner cannot read anonymous Completion.',
    otherOwner.client
      .from('care_task_completions')
      .select('id')
      .eq('id', history.completion.completionId),
  );
  await expectHidden(
    'Cross-Family Owner cannot read anonymous Chat.',
    otherOwner.client
      .from('chat_messages')
      .select('id')
      .eq('id', history.chatId),
  );
  await expectDenied(
    'Cross-Family Owner cannot update anonymous Journal.',
    otherOwner.client.rpc('update_post', {
      media_items: [],
      post_content: 'cross-family attack',
      post_event_date: new Date().toISOString().slice(0, 10),
      post_location_name: null,
      post_tag: null,
      target_post_id: history.postId,
    }),
  );

  const removeResult = await owner.client.rpc('remove_family_member', {
    target_family_id: mainFamily.familyId,
    target_user_id: removedMember.id,
  });
  if (removeResult.error || removeResult.data !== 'removed') {
    throw removeResult.error;
  }
  await expectHidden(
    'Removed Member cannot read anonymous Journal.',
    removedMember.client.from('posts').select('id').eq('id', history.postId),
  );
  await expectDenied(
    'Removed Member cannot edit anonymous Chat.',
    removedMember.client.rpc('update_chat_message', {
      message_body: 'removed attack',
      target_message_id: history.chatId,
    }),
  );

  await expectHidden(
    'Deleted Auth session cannot read retained Journal after membership cascade.',
    member.client.from('posts').select('id').eq('id', history.postId),
  );

  const transferOwner = await createUser('transfer-old-owner');
  const transferTarget = await createUser('transfer-new-owner');
  const transferFamily = await createFamily(transferOwner, 'Transfer');
  addMember(transferFamily.familyId, transferTarget.id);
  const transferHistory = await createHistory(
    transferOwner,
    transferFamily.petId,
    'Transfer old owner',
  );

  const transferred = await transferOwner.client.rpc(
    'transfer_family_ownership',
    {
      new_owner_user_id: transferTarget.id,
      target_family_id: transferFamily.familyId,
    },
  );
  if (transferred.error || transferred.data !== 'transferred') {
    throw transferred.error;
  }
  const left = await transferOwner.client.rpc('leave_family', {
    target_family_id: transferFamily.familyId,
  });
  if (left.error || left.data !== 'left') throw left.error;
  await deleteAuthUser(transferOwner);

  expectSql(
    'Transferred old Owner can be deleted while Family, Pet, new Owner, and old shared history survive.',
    `
      select
        (select count(*) = 1 from public.family_members where family_id = '${transferFamily.familyId}'::uuid and user_id = '${transferTarget.id}'::uuid and role = 'owner')
        and exists (select 1 from public.pets where id = '${transferFamily.petId}'::uuid and family_id = '${transferFamily.familyId}'::uuid)
        and exists (select 1 from public.posts where id = '${transferHistory.postId}'::uuid and author_id is null)
        and exists (select 1 from public.care_logs where id = '${transferHistory.careId}'::uuid and performed_by is null)
        and exists (select 1 from public.care_task_completions where id = '${transferHistory.completion.completionId}'::uuid and completed_by is null)
        and exists (select 1 from public.chat_messages where id = '${transferHistory.chatId}'::uuid and sender_id is null);
    `,
  );

  console.log(
    'PASS: Phase C4D-BC retention, attribution, authorization, isolation, membership revocation, and Owner transfer matrix completed.',
  );
} finally {
  await cleanup();
}

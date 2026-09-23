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
  throw new Error('SAFETY STOP: Phase C3 verification is local only.');
}
if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase C3 requires a local DB container.');
}

const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260920153000_multi_pet_family_phase_c3_pet_lifecycle.sql',
  ),
  'utf8',
);
const petQueries = readFileSync(
  join(root, 'src/features/pets/pet-queries.ts'),
  'utf8',
);
const petDetail = readFileSync(
  join(root, 'src/features/pets/pet-detail-screen.tsx'),
  'utf8',
);
const familyContextState = readFileSync(
  join(root, 'src/features/family/family-context-state.ts'),
  'utf8',
);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const users = [];
const familyIds = new Set();
const storageObjects = new Map([
  ['pet-avatars', new Set()],
  ['post-media', new Set()],
]);
let rollbackTriggerInstalled = false;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function reconcileFamilyContext(input) {
  const compareStableIdentity = (left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id);
  const families = [...input.families].sort(compareStableIdentity);
  const familyIds = new Set(families.map((family) => family.id));
  const pets = [...input.pets]
    .filter((pet) => pet.family_id && familyIds.has(pet.family_id))
    .sort(compareStableIdentity);
  const storedFamilyId =
    input.storedFamilyUserId === input.userId ? input.storedFamilyId : null;
  const storedPetId =
    input.storedPetUserId === input.userId ? input.storedPetId : null;
  const storedPet = pets.find((pet) => pet.id === storedPetId) ?? null;
  const currentFamily =
    families.find((family) => family.id === storedFamilyId) ??
    families.find((family) => family.id === storedPet?.family_id) ??
    families[0] ??
    null;
  const familyPets = currentFamily
    ? pets.filter((pet) => pet.family_id === currentFamily.id)
    : [];
  const currentPet =
    familyPets.find((pet) => pet.id === storedPetId) ?? familyPets[0] ?? null;
  return { currentFamily, currentPet, familyPets };
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

function count(statement) {
  return Number(sql(statement));
}

function runCleanupWorker() {
  execFileSync(
    process.execPath,
    ['scripts/process-journal-video-cleanup.mjs'],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    },
  );
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

function findVisibleCreateFamilyPetUsage() {
  try {
    return execFileSync(
      'rg',
      [
        '-l',
        'createFamilyPet\\(',
        'src',
        '--glob',
        '!src/features/pets/pet-queries.ts',
      ],
      { cwd: root, encoding: 'utf8' },
    ).trim();
  } catch (error) {
    if (error?.status === 1) return '';
    throw error;
  }
}

async function createUser(label) {
  const email = `phase-c3-${label}-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { display_name: `Phase C3 ${label}`, locale: 'en' },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}.`);
  }
  const client = testClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    throw signed.error ?? new Error(`Could not sign in ${label}.`);
  }
  const user = {
    client,
    id: created.data.user.id,
    token: signed.data.session.access_token,
  };
  users.push(user);
  return user;
}

async function createLegacyPet(owner, label) {
  const created = await owner.client.rpc('create_pet', {
    pet_adoption_date: '2025-01-02',
    pet_birthday: '2024-01-02',
    pet_breed: 'Phase C3 verifier',
    pet_description: 'Legacy new-Family plus first-Pet flow',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: 7.5,
  });
  if (created.error || !created.data?.family_id) {
    throw created.error ?? new Error('create_pet failed.');
  }
  familyIds.add(created.data.family_id);
  return created.data;
}

async function createFamilyPet(actor, familyId, label) {
  return actor.client.rpc('create_family_pet', {
    pet_adoption_date: '2025-02-03',
    pet_birthday: '2024-02-03',
    pet_breed: 'Phase C3 verifier',
    pet_description: 'Existing-Family Pet flow',
    pet_gender: 'unknown',
    pet_name: `${label} ${randomUUID().slice(0, 8)}`,
    pet_species: 'other',
    pet_weight: 8.25,
    target_family_id: familyId,
  });
}

function addCanonicalMember(familyId, userId, role) {
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

function mirrorInvariant(familyId) {
  return `
    (
      select count(*) = 1
      from public.family_members
      where family_id = '${familyId}'::uuid
        and role = 'owner'
    )
    and not exists (
      select 1
      from public.pets as pet
      cross join public.family_members as family_member
      where pet.family_id = '${familyId}'::uuid
        and family_member.family_id = pet.family_id
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
      where pet.family_id = '${familyId}'::uuid
        and not exists (
          select 1
          from public.family_members as family_member
          where family_member.family_id = pet.family_id
            and family_member.user_id = pet_member.user_id
            and family_member.role = pet_member.role
            and family_member.created_at = pet_member.created_at
        )
    )`;
}

async function invokeDeletePet(actor, petId) {
  const response = await fetch(`${url}/functions/v1/delete-pet`, {
    body: JSON.stringify({ petId }),
    headers: {
      Authorization: `Bearer ${actor.token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  return { payload: await response.json(), status: response.status };
}

async function upload(bucket, path) {
  const uploaded = await admin.storage
    .from(bucket)
    .upload(path, new Uint8Array([255, 216, 255, 217]), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploaded.error) throw uploaded.error;
  storageObjects.get(bucket).add(path);
}

async function createPost(actor, petId, label) {
  const postId = randomUUID();
  const mediaId = randomUUID();
  const path = `${actor.id}/${petId}/${postId}/${mediaId}.jpg`;
  await upload('post-media', path);
  const created = await actor.client.rpc('create_post', {
    media_items: [
      {
        height: 32,
        id: mediaId,
        mime_type: 'image/jpeg',
        position: 0,
        storage_path: path,
        width: 32,
      },
    ],
    post_content: label,
    post_event_date: new Date().toISOString().slice(0, 10),
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error('Could not create post fixture.');
  }
  return { id: postId, path };
}

async function addScopedResources(actor, assignee, petId, label) {
  const chat = await actor.client.rpc('send_chat_message', {
    message_body: `${label} chat`,
    target_client_message_id: randomUUID(),
    target_pet_id: petId,
  });
  if (chat.error) throw chat.error;

  const scheduledAt = new Date(Date.now() + 3_600_000);
  const taskId = randomUUID();
  const task = await actor.client.rpc('create_care_task', {
    target_pet_id: petId,
    task_care_type: 'medicine',
    task_category: 'standard',
    task_id: taskId,
    task_local_time: null,
    task_month_day: null,
    task_note: `${label} schedule`,
    task_schedule_type: 'once',
    task_scheduled_at: scheduledAt.toISOString(),
    task_starts_on: null,
    task_time_zone: 'Asia/Hong_Kong',
    task_title: `${label} task`,
    task_week_day: null,
  });
  if (task.error || !task.data) {
    throw task.error ?? new Error('Could not create task fixture.');
  }
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
    })
      .formatToParts(scheduledAt)
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const shift = await actor.client.rpc('create_care_shift', {
    shift_id: randomUUID(),
    shift_local_date: localDate,
    shift_note: `${label} shift`,
    target_assignee_user_id: assignee.id,
    target_pet_id: petId,
    task_items: [
      {
        care_task_id: task.data.id,
        source_scheduled_for: task.data.scheduled_at,
      },
    ],
  });
  if (shift.error) throw shift.error;

  return { taskId };
}

async function normalizedMembers(actor, petId) {
  const result = await actor.client.rpc('get_pet_members', {
    target_pet_id: petId,
  });
  if (result.error) throw result.error;
  return result.data
    .map(({ member_role, member_user_id }) => ({
      role: member_role,
      user_id: member_user_id,
    }))
    .sort((left, right) => left.user_id.localeCompare(right.user_id));
}

async function cleanup() {
  if (rollbackTriggerInstalled) {
    sql(`
      drop trigger if exists phase_c3_fail_pet_member on public.pet_members;
      drop function if exists private.phase_c3_fail_pet_member();
    `);
  }
  for (const familyId of familyIds) {
    sql(`
      delete from public.pets where family_id = '${familyId}'::uuid;
      delete from public.families where id = '${familyId}'::uuid;
    `);
  }
  for (const [bucket, paths] of storageObjects) {
    if (paths.size > 0) await admin.storage.from(bucket).remove([...paths]);
  }
  for (const user of users) {
    await user.client.auth.signOut();
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
}

try {
  expect(
    migration.includes(
      'create or replace function public.create_family_pet(',
    ) &&
      migration.includes(
        'create or replace function public.delete_family_pet(',
      ),
    'C3 lifecycle RPCs are missing from the migration.',
  );
  expect(
    !migration.includes('post_videos') &&
      !migration.includes("'post-videos'") &&
      !migration.includes("'video-thumbnails'"),
    'Core C3 migration depends on Journal Video schema or buckets.',
  );
  expect(
    petQueries.includes('export async function createFamilyPet(') &&
      petDetail.includes('setCurrentPetId(result.nextPetId') &&
      familyContextState.includes('familyPets[0] ?? null'),
    'Client lifecycle wrapper/context cleanup is not wired.',
  );
  const visibleSource = findVisibleCreateFamilyPetUsage();
  expect(visibleSource === '', 'createFamilyPet is exposed by visible UI.');
  console.log(
    'PASS: C3 lifecycle APIs are typed, core migration is Video-independent, and no Multi-Pet UI entry exists.',
  );

  const owner = await createUser('owner');
  const member = await createUser('member');
  const viewer = await createUser('viewer');
  const stranger = await createUser('stranger');
  const petA = await createLegacyPet(owner, 'C3 Pet A');
  const familyId = petA.family_id;
  const familyCount = count('select count(*) from public.families;');
  addCanonicalMember(familyId, member.id, 'member');
  addCanonicalMember(familyId, viewer.id, 'viewer');

  const createdB = await createFamilyPet(owner, familyId, 'C3 Pet B');
  if (createdB.error || !createdB.data) {
    throw createdB.error ?? new Error('Owner could not create second Pet.');
  }
  const petB = createdB.data;
  expectSql(
    'Legacy create_pet creates one Family/first Pet; create_family_pet adds the second Pet without another Family.',
    `select
       (select count(*) from public.families) = ${familyCount}
       and (select count(*) from public.pets where family_id = '${familyId}'::uuid) = 2
       and '${petA.family_id}'::uuid = '${petB.family_id}'::uuid
       and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = 3
       and ${mirrorInvariant(familyId)};`,
  );
  expect(
    JSON.stringify(await normalizedMembers(owner, petA.id)) ===
      JSON.stringify(await normalizedMembers(owner, petB.id)),
    'get_pet_members differs between Family Pets.',
  );
  console.log(
    'PASS: A/B authorization and get_pet_members views are identical with exact role/timestamp mirrors.',
  );

  for (const [label, actor] of [
    ['Member', member],
    ['Viewer', viewer],
    ['Stranger', stranger],
  ]) {
    const denied = await createFamilyPet(actor, familyId, `Denied ${label}`);
    expect(Boolean(denied.error), `${label} added a Family Pet.`);
  }
  console.log('PASS: Member, Viewer, and Stranger cannot add Family Pets.');

  sql(`
    create or replace function private.phase_c3_fail_pet_member()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if exists (
        select 1 from public.pets
        where id = new.pet_id and name like 'C3 Rollback%'
      ) then
        raise exception 'phase_c3_injected_mirror_failure';
      end if;
      return new;
    end;
    $$;
    create trigger phase_c3_fail_pet_member
    before insert on public.pet_members
    for each row execute function private.phase_c3_fail_pet_member();
  `);
  rollbackTriggerInstalled = true;
  const beforeRollbackPets = count(
    `select count(*) from public.pets where family_id = '${familyId}'::uuid;`,
  );
  const failed = await createFamilyPet(owner, familyId, 'C3 Rollback');
  expect(
    Boolean(failed.error),
    'Injected mirror failure unexpectedly succeeded.',
  );
  expect(
    count(
      `select count(*) from public.pets where family_id = '${familyId}'::uuid;`,
    ) === beforeRollbackPets,
    'Mirror failure left a partial Pet.',
  );
  sql(`
    drop trigger phase_c3_fail_pet_member on public.pet_members;
    drop function private.phase_c3_fail_pet_member();
  `);
  rollbackTriggerInstalled = false;
  console.log(
    'PASS: injected mirror failure rolls back the whole Pet mutation.',
  );

  const createdC = await createFamilyPet(owner, familyId, 'C3 Pet C');
  if (createdC.error || !createdC.data) throw createdC.error;
  const petC = createdC.data;
  const inviteResult = await owner.client.rpc('create_family_invite', {
    target_family_id: familyId,
  });
  const invite = inviteResult.data?.[0];
  if (inviteResult.error || !invite) {
    throw inviteResult.error ?? new Error('Could not create Family invite.');
  }
  const inviteSnapshot = sql(`
    select row_to_json(snapshot)::text
    from (
      select id, family_id, invited_by, code_hash, expires_at, max_uses,
             used_count, revoked_at, created_at
      from public.family_invites
      where id = '${invite.invite_id}'::uuid
    ) as snapshot;
  `);
  expectSql(
    'Family invite has one exact legacy representation on stable anchor Pet A.',
    `select (select pet_id from public.pet_invites where id = '${invite.invite_id}'::uuid) = '${petA.id}'::uuid;`,
  );

  const avatarA = `${owner.id}/${petA.id}/${randomUUID()}.jpg`;
  const avatarB = `${owner.id}/${petB.id}/${randomUUID()}.jpg`;
  await upload('pet-avatars', avatarA);
  await upload('pet-avatars', avatarB);
  const avatarUpdates = await Promise.all([
    owner.client
      .from('pets')
      .update({ avatar_path: avatarA })
      .eq('id', petA.id),
    owner.client
      .from('pets')
      .update({ avatar_path: avatarB })
      .eq('id', petB.id),
  ]);
  if (avatarUpdates.some((result) => result.error)) {
    throw avatarUpdates.find((result) => result.error).error;
  }
  const postA = await createPost(owner, petA.id, 'C3 A post');
  const postB = await createPost(owner, petB.id, 'C3 B post');
  await addScopedResources(owner, member, petA.id, 'C3 A');
  await addScopedResources(owner, member, petB.id, 'C3 B');

  const memberDelete = await invokeDeletePet(member, petB.id);
  const strangerDelete = await invokeDeletePet(stranger, petB.id);
  expect(
    memberDelete.status === 404,
    `Member delete response changed: ${JSON.stringify(memberDelete)}`,
  );
  expect(
    strangerDelete.status === 404,
    `Stranger delete response changed: ${JSON.stringify(strangerDelete)}`,
  );
  const deleteB = await invokeDeletePet(owner, petB.id);
  expect(
    deleteB.status === 200 &&
      deleteB.payload.deleted === true &&
      deleteB.payload.familyId === familyId &&
      deleteB.payload.nextPetId === petA.id,
    `Owner delete Pet B failed: ${JSON.stringify(deleteB)}`,
  );
  expectSql(
    'Deleting middle Pet B keeps Family, A/C, canonical members/invite, and A resources while removing B resources.',
    `select
       exists (select 1 from public.families where id = '${familyId}'::uuid)
       and (select count(*) from public.pets where id in ('${petA.id}'::uuid, '${petC.id}'::uuid)) = 2
       and not exists (select 1 from public.pets where id = '${petB.id}'::uuid)
       and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = 3
       and exists (select 1 from public.family_invites where id = '${invite.invite_id}'::uuid)
       and exists (select 1 from public.posts where id = '${postA.id}'::uuid)
       and not exists (select 1 from public.posts where id = '${postB.id}'::uuid)
       and exists (select 1 from public.chat_messages where pet_id = '${petA.id}'::uuid)
       and not exists (select 1 from public.chat_messages where pet_id = '${petB.id}'::uuid)
       and exists (select 1 from private.pet_chat_states where pet_id = '${petA.id}'::uuid)
       and not exists (select 1 from private.pet_chat_states where pet_id = '${petB.id}'::uuid)
       and exists (select 1 from public.care_shifts where pet_id = '${petA.id}'::uuid)
       and not exists (select 1 from public.care_shifts where pet_id = '${petB.id}'::uuid)
       and exists (select 1 from public.care_shift_tasks where pet_id = '${petA.id}'::uuid)
       and not exists (select 1 from public.care_shift_tasks where pet_id = '${petB.id}'::uuid)
       and ${mirrorInvariant(familyId)};`,
  );
  runCleanupWorker();
  expectSql(
    'Storage cleanup removes only Pet B avatar/media paths.',
    `select
       exists (select 1 from storage.objects where bucket_id = 'pet-avatars' and name = '${avatarA}')
       and exists (select 1 from storage.objects where bucket_id = 'post-media' and name = '${postA.path}')
       and not exists (select 1 from storage.objects where bucket_id = 'pet-avatars' and name = '${avatarB}')
       and not exists (select 1 from storage.objects where bucket_id = 'post-media' and name = '${postB.path}');`,
  );
  console.log(
    'PASS: middle-Pet deletion is isolated across Family, Chat, Schedule, Journal, and Storage scopes.',
  );

  const deleteA = await invokeDeletePet(owner, petA.id);
  expect(
    deleteA.status === 200 && deleteA.payload.nextPetId === petC.id,
    `Anchor delete did not return Pet C: ${JSON.stringify(deleteA)}`,
  );
  expect(
    sql(`
      select row_to_json(snapshot)::text
      from (
        select id, family_id, invited_by, code_hash, expires_at, max_uses,
               used_count, revoked_at, created_at
        from public.family_invites
        where id = '${invite.invite_id}'::uuid
      ) as snapshot;
    `) === inviteSnapshot,
    'Canonical invite changed while deleting its anchor.',
  );
  expectSql(
    'Deleting anchor Pet A moves exactly one unchanged legacy invite representation to stable Pet C.',
    `select
       (select count(*) from public.pet_invites where id = '${invite.invite_id}'::uuid) = 1
       and (select pet_id from public.pet_invites where id = '${invite.invite_id}'::uuid) = '${petC.id}'::uuid;`,
  );

  const familyRow = JSON.parse(
    sql(
      `select row_to_json(f)::text from (select id, created_at from public.families where id = '${familyId}'::uuid) as f;`,
    ),
  );
  const petCRow = JSON.parse(
    sql(
      `select row_to_json(p)::text from (select id, family_id, created_at from public.pets where id = '${petC.id}'::uuid) as p;`,
    ),
  );
  const beforeFinalContext = reconcileFamilyContext({
    families: [familyRow],
    pets: [petCRow],
    storedFamilyId: familyId,
    storedFamilyUserId: owner.id,
    storedPetId: petC.id,
    storedPetUserId: owner.id,
    userId: owner.id,
  });
  expect(
    beforeFinalContext.currentFamily?.id === familyId &&
      beforeFinalContext.currentPet?.id === petC.id,
    'Context could not represent the remaining Family Pet.',
  );
  const deleteC = await invokeDeletePet(owner, petC.id);
  expect(
    deleteC.status === 200 && deleteC.payload.nextPetId === null,
    `Final Pet delete failed: ${JSON.stringify(deleteC)}`,
  );
  expectSql(
    'Deleting the final Pet leaves a legal zero-Pet Family with canonical members/invite and no legacy invite row.',
    `select
       exists (select 1 from public.families where id = '${familyId}'::uuid)
       and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = 3
       and exists (select 1 from public.family_invites where id = '${invite.invite_id}'::uuid)
       and not exists (select 1 from public.pets where family_id = '${familyId}'::uuid)
       and not exists (select 1 from public.pet_invites where id = '${invite.invite_id}'::uuid);`,
  );
  const zeroPetContext = reconcileFamilyContext({
    families: [familyRow],
    pets: [],
    storedFamilyId: familyId,
    storedFamilyUserId: owner.id,
    storedPetId: petC.id,
    storedPetUserId: owner.id,
    userId: owner.id,
  });
  expect(
    zeroPetContext.currentFamily?.id === familyId &&
      zeroPetContext.currentPet === null,
    'Zero-Pet context cleared the Family or retained a deleted Pet.',
  );
  console.log(
    'PASS: final-Pet deletion preserves current Family semantics and reconciles currentPet to null.',
  );

  const recreated = await createFamilyPet(owner, familyId, 'C3 Recreated');
  if (recreated.error || !recreated.data) throw recreated.error;
  expectSql(
    'Adding a Pet back to a zero-Pet Family rehydrates the unchanged canonical invite on the new stable anchor.',
    `select
       (select count(*) from public.pet_invites where id = '${invite.invite_id}'::uuid) = 1
       and (select pet_id from public.pet_invites where id = '${invite.invite_id}'::uuid) = '${recreated.data.id}'::uuid
       and ${mirrorInvariant(familyId)};`,
  );

  const concurrentOwner = await createUser('concurrent-owner');
  const concurrentFirst = await createLegacyPet(
    concurrentOwner,
    'C3 Concurrent First',
  );
  const concurrentFamilyId = concurrentFirst.family_id;
  const familyCountBeforeConcurrency = count(
    'select count(*) from public.families;',
  );
  const [concurrentOne, concurrentTwo] = await Promise.all([
    createFamilyPet(concurrentOwner, concurrentFamilyId, 'C3 Concurrent One'),
    createFamilyPet(concurrentOwner, concurrentFamilyId, 'C3 Concurrent Two'),
  ]);
  expect(
    !concurrentOne.error && !concurrentTwo.error,
    `Concurrent create failed: ${concurrentOne.error?.message ?? concurrentTwo.error?.message}`,
  );
  expectSql(
    'Concurrent Owner creates serialize safely into one Family with complete mirrors and no product Pet limit.',
    `select
       (select count(*) from public.families) = ${familyCountBeforeConcurrency}
       and (select count(*) from public.pets where family_id = '${concurrentFamilyId}'::uuid) = 3
       and ${mirrorInvariant(concurrentFamilyId)};`,
  );
  expectSql(
    'Cross-Family creation and deletion remained isolated.',
    `select
       exists (select 1 from public.pets where id = '${recreated.data.id}'::uuid and family_id = '${familyId}'::uuid)
       and (select count(*) from public.pets where family_id = '${concurrentFamilyId}'::uuid) = 3;`,
  );

  console.log('PASS: Phase C3 Family Pet lifecycle matrix completed.');
} finally {
  await cleanup();
}

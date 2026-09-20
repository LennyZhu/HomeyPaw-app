import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const container =
  process.env.SUPABASE_LOCAL_DB_CONTAINER?.trim() ?? 'supabase_db_pawday';

if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error('SAFETY STOP: Phase B2 verification is local only.');
}

const migration = readFileSync(
  join(
    root,
    'supabase/migrations/20260919123354_multi_pet_family_phase_b2_authorization_cutover.sql',
  ),
  'utf8',
);

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

for (const requiredSql of [
  'Phase B2 requires every Pet to have a Family',
  'Phase B2 requires clean B1 membership mirror parity',
  'create or replace function private.is_pet_member',
  'create or replace function private.is_pet_owner',
  'create or replace function private.can_contribute_to_pet',
  'create or replace function private.is_family_member',
  'create or replace function private.is_family_owner',
  'create or replace function private.can_read_profile_avatar',
  'join public.family_members as membership',
  'from public.family_members as viewer_membership',
]) {
  expect(
    migration.includes(requiredSql),
    `B2 migration is missing: ${requiredSql}`,
  );
}

for (const forbiddenSql of [
  'chat_messages',
  'pet_chat_states',
  'care_shifts',
  'family_notification_outbox',
  'post_videos',
  'activeFamily',
]) {
  expect(
    !migration.includes(forbiddenSql),
    `B2 migration changed forbidden scope: ${forbiddenSql}`,
  );
}
console.log('PASS: Phase B2 migration scope is authorization-only.');

for (const signature of [
  'private.is_pet_member(uuid)',
  'private.is_pet_owner(uuid)',
  'private.can_contribute_to_pet(uuid)',
  'private.is_family_member(uuid)',
  'private.is_family_owner(uuid)',
  'private.can_read_profile_avatar(text)',
]) {
  expectSql(
    `${signature} uses Family membership without legacy authorization.`,
    `select
       pg_get_functiondef('${signature}'::regprocedure) like '%public.family_members%'
       and pg_get_functiondef('${signature}'::regprocedure) not like '%public.pet_members%';`,
  );
}

expectSql(
  'Normal migrated data has no null Family and clean B1 membership parity.',
  `select
     not exists (select 1 from public.pets where family_id is null)
     and not exists (
       select pet.family_id, member.user_id, member.role, member.created_at
       from public.pets as pet
       join public.pet_members as member on member.pet_id = pet.id
       except
       select family_id, user_id, role, created_at
       from public.family_members
     )
     and not exists (
       select family_id, user_id, role, created_at
       from public.family_members
       except
       select pet.family_id, member.user_id, member.role, member.created_at
       from public.pets as pet
       join public.pet_members as member on member.pet_id = pet.id
     );`,
);

expectSql(
  'Legacy public RPC signatures remain unchanged.',
  `select
     to_regprocedure('public.create_pet(text,public.pet_species,text,public.pet_gender,date,date,numeric,text)') is not null
     and to_regprocedure('public.create_pet_invite(uuid)') is not null
     and to_regprocedure('public.preview_pet_invite(text)') is not null
     and to_regprocedure('public.join_pet_with_invite(text)') is not null
     and to_regprocedure('public.revoke_pet_invite(uuid)') is not null
     and to_regprocedure('public.remove_pet_member(uuid,uuid)') is not null
     and to_regprocedure('public.get_pet_members(uuid)') is not null;`,
);

const ids = Object.fromEntries(
  [
    'owner',
    'member',
    'viewer',
    'stranger',
    'removed',
    'reverse',
    'crossOwner',
    'familyA',
    'familyB',
    'petA',
    'petB',
    'petC',
    'nullPet',
    'postA',
    'postB',
    'postC',
    'mediaA',
    'mediaB',
    'mediaC',
    'logA',
    'logB',
    'logC',
    'taskA',
    'taskB',
    'taskC',
    'completionA',
    'completionB',
    'completionC',
    'inviteA',
  ].map((name) => [name, randomUUID()]),
);

const petAvatarA = `${ids.owner}/${ids.petA}/${randomUUID()}.jpg`;
const petAvatarB = `${ids.owner}/${ids.petB}/${randomUUID()}.jpg`;
const petAvatarC = `${ids.crossOwner}/${ids.petC}/${randomUUID()}.jpg`;
const profileAvatar = `${ids.owner}/${randomUUID()}.jpg`;

sql(`
  begin;

  create function pg_temp.assert_true(condition boolean, label text)
  returns void
  language plpgsql
  as $$
  begin
    if condition is not true then
      raise exception 'Phase B2 assertion failed: %', label;
    end if;
  end;
  $$;

  insert into auth.users (
    id, aud, role, email, raw_user_meta_data, created_at, updated_at
  ) values
    ('${ids.owner}', 'authenticated', 'authenticated', 'b2-owner@example.test', '{"display_name":"B2 Owner","locale":"en"}'::jsonb, now(), now()),
    ('${ids.member}', 'authenticated', 'authenticated', 'b2-member@example.test', '{"display_name":"B2 Member","locale":"en"}'::jsonb, now(), now()),
    ('${ids.viewer}', 'authenticated', 'authenticated', 'b2-viewer@example.test', '{"display_name":"B2 Viewer","locale":"en"}'::jsonb, now(), now()),
    ('${ids.stranger}', 'authenticated', 'authenticated', 'b2-stranger@example.test', '{"display_name":"B2 Stranger","locale":"en"}'::jsonb, now(), now()),
    ('${ids.removed}', 'authenticated', 'authenticated', 'b2-removed@example.test', '{"display_name":"B2 Removed","locale":"en"}'::jsonb, now(), now()),
    ('${ids.reverse}', 'authenticated', 'authenticated', 'b2-reverse@example.test', '{"display_name":"B2 Reverse","locale":"en"}'::jsonb, now(), now()),
    ('${ids.crossOwner}', 'authenticated', 'authenticated', 'b2-cross@example.test', '{"display_name":"B2 Cross","locale":"en"}'::jsonb, now(), now());

  insert into public.families (id) values
    ('${ids.familyA}'),
    ('${ids.familyB}');

  insert into public.pets (id, name, species, gender, family_id) values
    ('${ids.petA}', 'B2 Pet A', 'other', 'unknown', '${ids.familyA}'),
    ('${ids.petB}', 'B2 Pet B', 'other', 'unknown', '${ids.familyA}'),
    ('${ids.petC}', 'B2 Pet C', 'other', 'unknown', '${ids.familyB}'),
    ('${ids.nullPet}', 'B2 Null Family Pet', 'other', 'unknown', null);

  insert into public.family_members (family_id, user_id, role, created_at) values
    ('${ids.familyA}', '${ids.owner}', 'owner', '2026-09-19 00:00:00+00'),
    ('${ids.familyA}', '${ids.member}', 'member', '2026-09-19 00:01:00+00'),
    ('${ids.familyA}', '${ids.viewer}', 'viewer', '2026-09-19 00:02:00+00'),
    ('${ids.familyA}', '${ids.removed}', 'member', '2026-09-19 00:03:00+00'),
    ('${ids.familyA}', '${ids.reverse}', 'member', '2026-09-19 00:04:00+00'),
    ('${ids.familyB}', '${ids.crossOwner}', 'owner', '2026-09-19 00:00:00+00');

  insert into public.pet_members (pet_id, user_id, role, created_at) values
    ('${ids.petA}', '${ids.owner}', 'owner', '2026-09-19 00:00:00+00'),
    ('${ids.petA}', '${ids.member}', 'member', '2026-09-19 00:01:00+00'),
    ('${ids.petA}', '${ids.viewer}', 'viewer', '2026-09-19 00:02:00+00'),
    ('${ids.petA}', '${ids.removed}', 'member', '2026-09-19 00:03:00+00'),
    ('${ids.petB}', '${ids.owner}', 'owner', '2026-09-19 00:00:00+00'),
    ('${ids.petB}', '${ids.member}', 'member', '2026-09-19 00:01:00+00'),
    ('${ids.petB}', '${ids.viewer}', 'viewer', '2026-09-19 00:02:00+00'),
    ('${ids.petB}', '${ids.removed}', 'member', '2026-09-19 00:03:00+00'),
    ('${ids.petC}', '${ids.crossOwner}', 'owner', '2026-09-19 00:00:00+00'),
    ('${ids.nullPet}', '${ids.stranger}', 'owner', '2026-09-19 00:00:00+00');

  -- Removed-member stale attack: the Family row is gone while both legacy
  -- Pet rows remain. Reverse drift is the exact opposite for another user.
  delete from public.family_members
  where family_id = '${ids.familyA}' and user_id = '${ids.removed}';

  insert into public.posts (id, pet_id, author_id, content) values
    ('${ids.postA}', '${ids.petA}', '${ids.owner}', 'B2 post A'),
    ('${ids.postB}', '${ids.petB}', '${ids.owner}', 'B2 post B'),
    ('${ids.postC}', '${ids.petC}', '${ids.crossOwner}', 'B2 post C');
  insert into public.post_media (
    id, post_id, storage_path, position, width, height
  ) values
    ('${ids.mediaA}', '${ids.postA}', 'b2/media-a.jpg', 0, 1, 1),
    ('${ids.mediaB}', '${ids.postB}', 'b2/media-b.jpg', 0, 1, 1),
    ('${ids.mediaC}', '${ids.postC}', 'b2/media-c.jpg', 0, 1, 1);

  insert into public.care_logs (
    id, pet_id, performed_by, care_type, occurred_at, time_zone, local_date
  ) values
    ('${ids.logA}', '${ids.petA}', '${ids.owner}', 'feeding', now(), 'UTC', current_date),
    ('${ids.logB}', '${ids.petB}', '${ids.owner}', 'feeding', now(), 'UTC', current_date),
    ('${ids.logC}', '${ids.petC}', '${ids.crossOwner}', 'feeding', now(), 'UTC', current_date);

  insert into public.care_tasks (
    id, pet_id, created_by, title, schedule_type, scheduled_at, time_zone
  ) values
    ('${ids.taskA}', '${ids.petA}', '${ids.owner}', 'B2 task A', 'once', now() + interval '1 day', 'UTC'),
    ('${ids.taskB}', '${ids.petB}', '${ids.owner}', 'B2 task B', 'once', now() + interval '1 day', 'UTC'),
    ('${ids.taskC}', '${ids.petC}', '${ids.crossOwner}', 'B2 task C', 'once', now() + interval '1 day', 'UTC');

  insert into public.care_task_completions (
    id, task_id, pet_id, completed_by, scheduled_for, care_log_id
  ) values
    ('${ids.completionA}', '${ids.taskA}', '${ids.petA}', '${ids.owner}', now() + interval '1 day', '${ids.logA}'),
    ('${ids.completionB}', '${ids.taskB}', '${ids.petB}', '${ids.owner}', now() + interval '1 day', '${ids.logB}'),
    ('${ids.completionC}', '${ids.taskC}', '${ids.petC}', '${ids.crossOwner}', now() + interval '1 day', '${ids.logC}');

  insert into public.family_invites (
    id, family_id, invited_by, code_hash, expires_at
  ) values (
    '${ids.inviteA}', '${ids.familyA}', '${ids.owner}', repeat('a', 64),
    now() + interval '1 day'
  );

  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('pet-avatars', '${petAvatarA}', '${ids.owner}', '${ids.owner}', '{}'::jsonb),
    ('pet-avatars', '${petAvatarB}', '${ids.owner}', '${ids.owner}', '{}'::jsonb),
    ('pet-avatars', '${petAvatarC}', '${ids.crossOwner}', '${ids.crossOwner}', '{}'::jsonb),
    ('profile-avatars', '${profileAvatar}', '${ids.owner}', '${ids.owner}', '{}'::jsonb);

  set local role authenticated;
  select set_config('request.jwt.claim.sub', '${ids.owner}', true);
  select pg_temp.assert_true(private.is_pet_member('${ids.petA}'), 'Owner member A');
  select pg_temp.assert_true(private.is_pet_member('${ids.petB}'), 'Owner member B');
  select pg_temp.assert_true(private.is_pet_owner('${ids.petA}'), 'Owner role A');
  select pg_temp.assert_true(private.can_contribute_to_pet('${ids.petB}'), 'Owner contribute B');
  select pg_temp.assert_true(not private.is_pet_member('${ids.petC}'), 'Owner cross-family deny');
  select pg_temp.assert_true((select count(*) = 2 from public.pets where id in ('${ids.petA}', '${ids.petB}')), 'Owner Pet reads');
  select pg_temp.assert_true((select count(*) = 2 from public.posts where id in ('${ids.postA}', '${ids.postB}')), 'Owner post reads');
  select pg_temp.assert_true((select count(*) = 2 from public.post_media where id in ('${ids.mediaA}', '${ids.mediaB}')), 'Owner media reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_logs where id in ('${ids.logA}', '${ids.logB}')), 'Owner care log reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_tasks where id in ('${ids.taskA}', '${ids.taskB}')), 'Owner care task reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_task_completions where id in ('${ids.completionA}', '${ids.completionB}')), 'Owner completion reads');
  select pg_temp.assert_true((select count(*) = 2 from storage.objects where bucket_id = 'pet-avatars' and name in ('${petAvatarA}', '${petAvatarB}')), 'Owner avatar reads');
  select pg_temp.assert_true((select count(*) = 1 from storage.objects where bucket_id = 'profile-avatars' and name = '${profileAvatar}'), 'Owner profile avatar read');
  select pg_temp.assert_true((select count(*) = 1 from public.family_invites where id = '${ids.inviteA}'), 'Owner invite metadata read');
  with changed as (
    update public.pets set breed = 'B2 Owner'
    where id = '${ids.petB}' returning id
  )
  select pg_temp.assert_true(count(*) = 1, 'Owner update same-family Pet')
  from changed;
  reset role;

  set local role authenticated;
  select set_config('request.jwt.claim.sub', '${ids.member}', true);
  select pg_temp.assert_true(private.is_pet_member('${ids.petA}'), 'Member A');
  select pg_temp.assert_true(private.is_pet_member('${ids.petB}'), 'Member B');
  select pg_temp.assert_true(not private.is_pet_owner('${ids.petA}'), 'Member not Owner');
  select pg_temp.assert_true(private.can_contribute_to_pet('${ids.petB}'), 'Member contributes B');
  select pg_temp.assert_true(not private.is_pet_member('${ids.petC}'), 'Member cross-family deny');
  select pg_temp.assert_true((select count(*) = 2 from public.pets where id in ('${ids.petA}', '${ids.petB}', '${ids.petC}')), 'Member Pet reads');
  select pg_temp.assert_true((select count(*) = 2 from public.posts where id in ('${ids.postA}', '${ids.postB}', '${ids.postC}')), 'Member post reads');
  select pg_temp.assert_true((select count(*) = 2 from public.post_media where id in ('${ids.mediaA}', '${ids.mediaB}', '${ids.mediaC}')), 'Member media reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_logs where id in ('${ids.logA}', '${ids.logB}', '${ids.logC}')), 'Member care log reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_tasks where id in ('${ids.taskA}', '${ids.taskB}', '${ids.taskC}')), 'Member care task reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_task_completions where id in ('${ids.completionA}', '${ids.completionB}', '${ids.completionC}')), 'Member completion reads');
  select pg_temp.assert_true((select count(*) = 2 from storage.objects where bucket_id = 'pet-avatars' and name in ('${petAvatarA}', '${petAvatarB}', '${petAvatarC}')), 'Member pet avatar reads');
  select pg_temp.assert_true((select count(*) = 1 from storage.objects where bucket_id = 'profile-avatars' and name = '${profileAvatar}'), 'Member profile avatar read');
  select pg_temp.assert_true((select count(*) = 0 from public.family_invites where id = '${ids.inviteA}'), 'Member invite metadata deny');
  with changed as (
    update public.pets set breed = 'B2 Member'
    where id = '${ids.petA}' returning id
  )
  select pg_temp.assert_true(count(*) = 0, 'Member Pet update deny')
  from changed;
  reset role;

  set local role authenticated;
  select set_config('request.jwt.claim.sub', '${ids.viewer}', true);
  select pg_temp.assert_true(private.is_pet_member('${ids.petA}'), 'Viewer member A');
  select pg_temp.assert_true(private.is_pet_member('${ids.petB}'), 'Viewer member B');
  select pg_temp.assert_true(not private.is_pet_owner('${ids.petA}'), 'Viewer not Owner');
  select pg_temp.assert_true(not private.can_contribute_to_pet('${ids.petA}'), 'Viewer cannot contribute');
  select pg_temp.assert_true((select count(*) = 2 from public.pets where id in ('${ids.petA}', '${ids.petB}', '${ids.petC}')), 'Viewer Pet reads');
  select pg_temp.assert_true((select count(*) = 2 from public.posts where id in ('${ids.postA}', '${ids.postB}', '${ids.postC}')), 'Viewer post reads');
  select pg_temp.assert_true((select count(*) = 2 from public.post_media where id in ('${ids.mediaA}', '${ids.mediaB}', '${ids.mediaC}')), 'Viewer media reads');
  select pg_temp.assert_true((select count(*) = 0 from public.care_logs where id in ('${ids.logA}', '${ids.logB}', '${ids.logC}')), 'Viewer care log deny');
  select pg_temp.assert_true((select count(*) = 2 from public.care_tasks where id in ('${ids.taskA}', '${ids.taskB}', '${ids.taskC}')), 'Viewer care task reads');
  select pg_temp.assert_true((select count(*) = 2 from public.care_task_completions where id in ('${ids.completionA}', '${ids.completionB}', '${ids.completionC}')), 'Viewer completion reads');
  select pg_temp.assert_true((select count(*) = 2 from storage.objects where bucket_id = 'pet-avatars' and name in ('${petAvatarA}', '${petAvatarB}', '${petAvatarC}')), 'Viewer pet avatar reads');
  select pg_temp.assert_true((select count(*) = 1 from storage.objects where bucket_id = 'profile-avatars' and name = '${profileAvatar}'), 'Viewer profile avatar read');
  reset role;

  set local role authenticated;
  select set_config('request.jwt.claim.sub', '${ids.stranger}', true);
  select pg_temp.assert_true(not private.is_pet_member('${ids.petA}'), 'Stranger member deny');
  select pg_temp.assert_true(not private.is_pet_owner('${ids.petA}'), 'Stranger owner deny');
  select pg_temp.assert_true(not private.can_contribute_to_pet('${ids.petA}'), 'Stranger contribute deny');
  select pg_temp.assert_true(not private.is_pet_member('${ids.nullPet}'), 'Null Family fail closed');
  select pg_temp.assert_true(not private.is_pet_owner('${ids.nullPet}'), 'Null Family owner fail closed');
  select pg_temp.assert_true(not private.can_contribute_to_pet('${ids.nullPet}'), 'Null Family contributor fail closed');
  select pg_temp.assert_true((select count(*) = 0 from public.pets where id in ('${ids.petA}', '${ids.petB}', '${ids.petC}', '${ids.nullPet}')), 'Stranger Pet deny');
  select pg_temp.assert_true((select count(*) = 0 from public.posts where id in ('${ids.postA}', '${ids.postB}', '${ids.postC}')), 'Stranger post deny');
  select pg_temp.assert_true((select count(*) = 0 from public.post_media where id in ('${ids.mediaA}', '${ids.mediaB}', '${ids.mediaC}')), 'Stranger media deny');
  select pg_temp.assert_true((select count(*) = 0 from public.care_logs where id in ('${ids.logA}', '${ids.logB}', '${ids.logC}')), 'Stranger care log deny');
  select pg_temp.assert_true((select count(*) = 0 from public.care_tasks where id in ('${ids.taskA}', '${ids.taskB}', '${ids.taskC}')), 'Stranger care task deny');
  select pg_temp.assert_true((select count(*) = 0 from public.care_task_completions where id in ('${ids.completionA}', '${ids.completionB}', '${ids.completionC}')), 'Stranger completion deny');
  select pg_temp.assert_true((select count(*) = 0 from storage.objects where name in ('${petAvatarA}', '${petAvatarB}', '${petAvatarC}', '${profileAvatar}')), 'Stranger avatar deny');
  reset role;

  set local role authenticated;
  select set_config('request.jwt.claim.sub', '${ids.removed}', true);
  select pg_temp.assert_true(not private.is_pet_member('${ids.petA}'), 'Stale legacy member deny A');
  select pg_temp.assert_true(not private.is_pet_member('${ids.petB}'), 'Stale legacy member deny B');
  select pg_temp.assert_true(not private.is_pet_owner('${ids.petA}'), 'Stale legacy owner deny');
  select pg_temp.assert_true(not private.can_contribute_to_pet('${ids.petA}'), 'Stale legacy contributor deny');
  select pg_temp.assert_true((select count(*) = 0 from public.pets where id in ('${ids.petA}', '${ids.petB}')), 'Removed Pet deny');
  select pg_temp.assert_true((select count(*) = 0 from public.posts where id in ('${ids.postA}', '${ids.postB}')), 'Removed post deny');
  select pg_temp.assert_true((select count(*) = 0 from public.post_media where id in ('${ids.mediaA}', '${ids.mediaB}')), 'Removed media deny');
  select pg_temp.assert_true((select count(*) = 0 from public.care_logs where id in ('${ids.logA}', '${ids.logB}')), 'Removed care log deny');
  select pg_temp.assert_true((select count(*) = 0 from public.care_tasks where id in ('${ids.taskA}', '${ids.taskB}')), 'Removed care task deny');
  select pg_temp.assert_true((select count(*) = 0 from public.care_task_completions where id in ('${ids.completionA}', '${ids.completionB}')), 'Removed completion deny');
  select pg_temp.assert_true((select count(*) = 0 from storage.objects where name in ('${petAvatarA}', '${petAvatarB}', '${profileAvatar}')), 'Removed avatar deny');
  reset role;

  set local role authenticated;
  select set_config('request.jwt.claim.sub', '${ids.reverse}', true);
  select pg_temp.assert_true(private.is_pet_member('${ids.petA}'), 'Reverse drift member A');
  select pg_temp.assert_true(private.is_pet_member('${ids.petB}'), 'Reverse drift member B');
  select pg_temp.assert_true(not private.is_pet_owner('${ids.petA}'), 'Reverse drift not Owner');
  select pg_temp.assert_true(private.can_contribute_to_pet('${ids.petA}'), 'Reverse drift contributor');
  select pg_temp.assert_true((select count(*) = 2 from public.pets where id in ('${ids.petA}', '${ids.petB}')), 'Reverse drift Pet access');
  select pg_temp.assert_true((select count(*) = 2 from public.posts where id in ('${ids.postA}', '${ids.postB}')), 'Reverse drift post access');
  select pg_temp.assert_true((select count(*) = 2 from public.post_media where id in ('${ids.mediaA}', '${ids.mediaB}')), 'Reverse drift media access');
  select pg_temp.assert_true((select count(*) = 2 from public.care_logs where id in ('${ids.logA}', '${ids.logB}')), 'Reverse drift care log access');
  select pg_temp.assert_true((select count(*) = 2 from public.care_tasks where id in ('${ids.taskA}', '${ids.taskB}')), 'Reverse drift care task access');
  select pg_temp.assert_true((select count(*) = 2 from public.care_task_completions where id in ('${ids.completionA}', '${ids.completionB}')), 'Reverse drift completion access');
  select pg_temp.assert_true((select count(*) = 3 from public.family_members where family_id = '${ids.familyA}' and user_id in ('${ids.owner}', '${ids.member}', '${ids.reverse}')), 'Family RLS avoids recursion');
  select pg_temp.assert_true((select count(*) = 1 from storage.objects where bucket_id = 'profile-avatars' and name = '${profileAvatar}'), 'Reverse drift profile avatar access');
  reset role;

  select pg_temp.assert_true(
    exists (
      select pet.family_id, member.user_id, member.role, member.created_at
      from public.pets as pet
      join public.pet_members as member on member.pet_id = pet.id
      except
      select family_id, user_id, role, created_at from public.family_members
    ) and exists (
      select family_id, user_id, role, created_at from public.family_members
      except
      select pet.family_id, member.user_id, member.role, member.created_at
      from public.pets as pet
      join public.pet_members as member on member.pet_id = pet.id
    ),
    'B1 drift health check detects both stale and reverse drift'
  );

  rollback;
`);

console.log('PASS: Owner, Member, Viewer, and Stranger helper semantics.');
console.log('PASS: null-Family and stale legacy membership fail closed.');
console.log('PASS: reverse drift authorizes strictly from family_members.');
console.log('PASS: two Pets in one Family share authorization across Pet IDs.');
console.log('PASS: different-Family access remains denied.');
console.log(
  'PASS: Pet, Journal, Care, Health, pet avatar, and profile avatar RLS matrix.',
);
console.log('PASS: Family-table RLS is Family-backed and recursion-free.');
console.log(
  'PASS: B1 parity health check still detects mirror drift separately.',
);
console.log(
  'PASS: Multi-Pet Family Phase B2 authorization verification complete.',
);

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const container =
  process.env.SUPABASE_LOCAL_DB_CONTAINER?.trim() ?? 'supabase_db_pawday';

if (!/^supabase_db_[a-z0-9_-]+$/u.test(container)) {
  throw new Error(
    'SAFETY STOP: Phase A verification only accepts a local Supabase container.',
  );
}

const migrationPath = join(
  root,
  'supabase/migrations/20260919091047_multi_pet_family_phase_a_foundation.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const databaseTypes = readFileSync(join(root, 'src/types/database.ts'), 'utf8');

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
  expect(sql(statement) === 't', label);
  console.log(`PASS: ${label}`);
}

for (const requiredSql of [
  'create table public.families',
  'create table public.family_members',
  'create table public.family_invites',
  'add column family_id uuid',
  'references public.families (id) on delete restrict',
  'insert into public.families (id, created_at)',
  'set family_id = pet.id',
  'from public.pet_members as membership',
  'from public.pet_invites as invite',
  'alter table public.families enable row level security',
  'alter table public.family_members enable row level security',
  'alter table public.family_invites enable row level security',
  'join public.pet_members as membership on membership.pet_id = pet.id',
]) {
  expect(
    migration.includes(requiredSql),
    `Migration is missing: ${requiredSql}`,
  );
}

expect(
  !/update\s+public\.(pet_members|pet_invites)\b/iu.test(migration) &&
    !/delete\s+from\s+public\.(pet_members|pet_invites)\b/iu.test(migration),
  'Phase A mutates a legacy membership or invite table.',
);
expect(
  !migration.includes('post_videos') &&
    !migration.includes('post-videos') &&
    !migration.includes('journal_video'),
  'Phase A unexpectedly depends on Journal Video.',
);
expect(
  databaseTypes.includes('family_invites: {') &&
    databaseTypes.includes('family_members: {') &&
    databaseTypes.includes('families: {') &&
    databaseTypes.includes('family_id: string | null;') &&
    databaseTypes.includes("foreignKeyName: 'pets_family_id_fkey'"),
  'Local database types do not describe the Phase A schema.',
);
console.log('PASS: migration scope and local database types are additive.');

expectSql(
  'Family tables exist and pets.family_id remains nullable.',
  `select
     to_regclass('public.families') is not null
     and to_regclass('public.family_members') is not null
     and to_regclass('public.family_invites') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'pets'
         and column_name = 'family_id'
         and is_nullable = 'YES'
         and data_type = 'uuid'
     );`,
);

expectSql(
  'Every backfilled Pet has exactly one transitional Family mapping.',
  `select
     not exists (select 1 from public.pets where family_id is null)
     and not exists (
       select family.id
       from public.families as family
       left join public.pets as pet on pet.family_id = family.id
       group by family.id
       having count(pet.id) <> 1
     );`,
);

if (process.env.PAWDAY_PHASE_A_REQUIRE_FIXTURE === '1') {
  expectSql(
    'The backfill verification database contains legacy fixture data.',
    'select exists (select 1 from public.pets);',
  );
}

expectSql(
  'Family memberships exactly match legacy memberships.',
  `select
     not exists (
       select pet.family_id, member.user_id, member.role, member.created_at
       from public.pet_members as member
       join public.pets as pet on pet.id = member.pet_id
       except
       select family_id, user_id, role, created_at
       from public.family_members
     )
     and not exists (
       select family_id, user_id, role, created_at
       from public.family_members
       except
       select pet.family_id, member.user_id, member.role, member.created_at
       from public.pet_members as member
       join public.pets as pet on pet.id = member.pet_id
     );`,
);

expectSql(
  'Each transitional Family has exactly one legacy Owner.',
  `select not exists (
     select family.id
     from public.families as family
     left join public.family_members as member
       on member.family_id = family.id
      and member.role = 'owner'
     group by family.id
     having count(member.user_id) <> 1
   );`,
);

expectSql(
  'Family invitations exactly preserve legacy invitation state.',
  `select
     not exists (
       select
         invite.id, pet.family_id, invite.invited_by, invite.code_hash,
         invite.expires_at, invite.max_uses, invite.used_count,
         invite.revoked_at, invite.created_at
       from public.pet_invites as invite
       join public.pets as pet on pet.id = invite.pet_id
       except
       select
         id, family_id, invited_by, code_hash, expires_at, max_uses,
         used_count, revoked_at, created_at
       from public.family_invites
     )
     and not exists (
       select
         id, family_id, invited_by, code_hash, expires_at, max_uses,
         used_count, revoked_at, created_at
       from public.family_invites
       except
       select
         invite.id, pet.family_id, invite.invited_by, invite.code_hash,
         invite.expires_at, invite.max_uses, invite.used_count,
         invite.revoked_at, invite.created_at
       from public.pet_invites as invite
       join public.pets as pet on pet.id = invite.pet_id
     );`,
);

expectSql(
  'No Phase A Family foreign key is orphaned.',
  `select
     not exists (
       select 1 from public.pets as pet
       left join public.families as family on family.id = pet.family_id
       where pet.family_id is not null and family.id is null
     )
     and not exists (
       select 1 from public.family_members as member
       left join public.families as family on family.id = member.family_id
       where family.id is null
     )
     and not exists (
       select 1 from public.family_invites as invite
       left join public.families as family on family.id = invite.family_id
       where family.id is null
     );`,
);

expectSql(
  'Phase A foreign keys have safe delete actions.',
  `select
     (select confdeltype = 'r'
      from pg_constraint
      where conname = 'pets_family_id_fkey')
     and (select confdeltype = 'c'
          from pg_constraint
          where conname = 'family_members_family_id_fkey')
     and (select confdeltype = 'c'
          from pg_constraint
          where conname = 'family_invites_family_id_fkey');`,
);

expectSql(
  'Family Owner uniqueness, retention, and ten-person cap guards exist.',
  `select
     to_regclass('public.family_members_one_owner_per_family') is not null
     and exists (
       select 1 from pg_trigger
       where tgrelid = 'public.family_members'::regclass
         and tgname = 'validate_family_keeps_owner'
         and not tgisinternal
     )
     and exists (
       select 1 from pg_trigger
       where tgrelid = 'public.family_members'::regclass
         and tgname = 'enforce_family_member_limit_before_membership'
         and not tgisinternal
     );`,
);

expectSql(
  'Family RLS is enabled and authenticated clients have no direct write grants.',
  `select
     (select relrowsecurity from pg_class where oid = 'public.families'::regclass)
     and (select relrowsecurity from pg_class where oid = 'public.family_members'::regclass)
     and (select relrowsecurity from pg_class where oid = 'public.family_invites'::regclass)
     and not has_table_privilege('anon', 'public.families', 'select,insert,update,delete')
     and not has_table_privilege('anon', 'public.family_members', 'select,insert,update,delete')
     and not has_table_privilege('anon', 'public.family_invites', 'select,insert,update,delete')
     and not has_table_privilege('authenticated', 'public.families', 'insert,update,delete')
     and not has_table_privilege('authenticated', 'public.family_members', 'insert,update,delete')
     and not has_table_privilege('authenticated', 'public.family_invites', 'insert,update,delete')
     and not has_column_privilege('authenticated', 'public.family_invites', 'code_hash', 'select');`,
);

expectSql(
  'Family read policies match legacy member and Owner boundaries.',
  `select
     exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'families'
         and policyname = 'Family members can read families'
     )
     and exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'family_members'
         and policyname = 'Family members can read memberships'
     )
     and exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'family_invites'
         and policyname = 'Family owners can read invite metadata'
     );`,
);

const phaseB1Applied =
  sql(`select pg_get_functiondef(
    'public.create_pet(text,public.pet_species,text,public.pet_gender,date,date,numeric,text)'::regprocedure
  ) like '%insert into public.family_members%';`) === 't';
const phaseB2Applied =
  sql(`select
    pg_get_functiondef('private.is_family_member(uuid)'::regprocedure)
      like '%from public.family_members%'
    and pg_get_functiondef('private.is_family_member(uuid)'::regprocedure)
      not like '%public.pet_members%';`) === 't';

expectSql(
  phaseB1Applied
    ? 'B1 create_pet keeps the Phase A Family foundation consistent.'
    : 'Legacy create_pet still creates its Owner membership with nullable family_id.',
  `begin;
   insert into auth.users (
     id, aud, role, email, raw_user_meta_data, created_at, updated_at
   ) values (
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
     'authenticated',
     'authenticated',
     'phase-a-create-pet@example.test',
     '{"display_name":"Phase A create_pet","locale":"en"}'::jsonb,
     now(),
     now()
   );
   set local role authenticated;
   set local request.jwt.claim.sub = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
   do $$
   begin
     perform public.create_pet(
       'Phase A compatibility Pet',
       'other'::public.pet_species,
       null,
       'unknown'::public.pet_gender,
       null,
       null,
       null,
       null
     );
   end;
   $$;
   select exists (
     select 1
     from public.pets as pet
     join public.pet_members as member on member.pet_id = pet.id
     ${
       phaseB1Applied
         ? 'join public.families as family on family.id = pet.family_id\n     join public.family_members as family_member\n       on family_member.family_id = pet.family_id\n      and family_member.user_id = member.user_id\n      and family_member.role = member.role\n      and family_member.created_at = member.created_at'
         : ''
     }
     where pet.name = 'Phase A compatibility Pet'
       and pet.family_id is ${phaseB1Applied ? 'not null' : 'null'}
       ${phaseB1Applied ? 'and pet.family_id <> pet.id' : ''}
       and member.user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
       and member.role = 'owner'
   );
   rollback;`,
);

const familyId = sql('select id from public.families order by id limit 1;');
if (familyId) {
  expect(
    /^[0-9a-f-]{36}$/u.test(familyId),
    'Verifier selected an invalid Family UUID.',
  );
  const ownerId = sql(
    `select user_id from public.family_members
     where family_id = '${familyId}'::uuid and role = 'owner'
     limit 1;`,
  );
  const memberId = sql(
    `select user_id from public.family_members
     where family_id = '${familyId}'::uuid and role = 'member'
     limit 1;`,
  );
  const viewerId = sql(
    `select user_id from public.family_members
     where family_id = '${familyId}'::uuid and role = 'viewer'
     limit 1;`,
  );
  const memberCount = Number(
    sql(
      `select count(*) from public.family_members
       where family_id = '${familyId}'::uuid;`,
    ),
  );
  const inviteCount = Number(
    sql(
      `select count(*) from public.family_invites
       where family_id = '${familyId}'::uuid;`,
    ),
  );

  expectSql(
    'Family Owner can read the Family, memberships, and invite metadata.',
    `begin;
     set local role authenticated;
     set local request.jwt.claim.sub = '${ownerId}';
     select
       (select count(*) from public.families where id = '${familyId}'::uuid) = 1
       and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = ${memberCount}
       and (select count(*) from public.family_invites where family_id = '${familyId}'::uuid) = ${inviteCount};
     rollback;`,
  );

  for (const [role, userId] of [
    ['Member', memberId],
    ['Viewer', viewerId],
  ]) {
    if (!userId) continue;
    expectSql(
      `Family ${role} can read Family membership but not invite metadata.`,
      `begin;
       set local role authenticated;
       set local request.jwt.claim.sub = '${userId}';
       select
         (select count(*) from public.families where id = '${familyId}'::uuid) = 1
         and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = ${memberCount}
         and (select count(*) from public.family_invites where family_id = '${familyId}'::uuid) = 0;
       rollback;`,
    );
  }

  if (memberId) {
    if (phaseB2Applied) {
      expectSql(
        'B2 Family reads remain authorized when only the legacy mirror is missing.',
        `begin;
         delete from public.pet_members
         where pet_id = (
           select id from public.pets where family_id = '${familyId}'::uuid
         )
           and user_id = '${memberId}'::uuid;
         set local role authenticated;
         set local request.jwt.claim.sub = '${memberId}';
         select
           (select count(*) from public.families where id = '${familyId}'::uuid) = 1
           and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = ${memberCount}
           and (select count(*) from public.family_invites where family_id = '${familyId}'::uuid) = 0;
         rollback;`,
      );
      expectSql(
        'B2 Family removal denies reads despite a stale legacy membership.',
        `begin;
         delete from public.family_members
         where family_id = '${familyId}'::uuid
           and user_id = '${memberId}'::uuid;
         set local role authenticated;
         set local request.jwt.claim.sub = '${memberId}';
         select
           (select count(*) from public.families where id = '${familyId}'::uuid) = 0
           and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = 0
           and (select count(*) from public.family_invites where family_id = '${familyId}'::uuid) = 0;
         rollback;`,
      );
    } else {
      expectSql(
        'Removing legacy membership immediately denies Family reads despite a stale mirror row.',
        `begin;
         delete from public.pet_members
         where pet_id = (
           select id from public.pets where family_id = '${familyId}'::uuid
         )
           and user_id = '${memberId}'::uuid;
         set local role authenticated;
         set local request.jwt.claim.sub = '${memberId}';
         select
           (select count(*) from public.families where id = '${familyId}'::uuid) = 0
           and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = 0
           and (select count(*) from public.family_invites where family_id = '${familyId}'::uuid) = 0;
         rollback;`,
      );
    }
  }

  expectSql(
    'A non-member cannot read any Family mirror row.',
    `begin;
     set local role authenticated;
     set local request.jwt.claim.sub = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
     select
       (select count(*) from public.families where id = '${familyId}'::uuid) = 0
       and (select count(*) from public.family_members where family_id = '${familyId}'::uuid) = 0
       and (select count(*) from public.family_invites where family_id = '${familyId}'::uuid) = 0;
     rollback;`,
  );

  expectSql(
    'Deleting new mirror children cannot delete the legacy Pet or legacy rows.',
    `begin;
     delete from public.family_invites where family_id = '${familyId}'::uuid;
     delete from public.family_members where family_id = '${familyId}'::uuid;
     select
       exists (select 1 from public.pets where family_id = '${familyId}'::uuid)
       and exists (
         select 1 from public.pet_members as member
         join public.pets as pet on pet.id = member.pet_id
         where pet.family_id = '${familyId}'::uuid
       );
     rollback;`,
  );
  expectSql(
    'Deleting a referenced Family root is blocked without deleting its Pet.',
    `do $$
     begin
       begin
         delete from public.families where id = '${familyId}'::uuid;
       exception
         when others then null;
       end;
       if not exists (
         select 1 from public.families where id = '${familyId}'::uuid
       ) then
         raise exception 'Family deletion unexpectedly succeeded';
       end if;
     end;
     $$;
     select exists (
       select 1 from public.pets where family_id = '${familyId}'::uuid
     );`,
  );
} else {
  console.log('SKIP: destructive cascade checks require a backfilled fixture.');
}

console.log('PASS: Multi-Pet Family Phase A foundation verification complete.');

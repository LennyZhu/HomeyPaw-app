import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cli = 'node_modules/.bin/supabase';
const migration = readFileSync(
  'supabase/migrations/20260920113000_multi_pet_family_phase_c2_membership_invite_canonicalization.sql',
  'utf8',
);
const reconciliation =
  migration.split('-- A canonical Family invite')[0] + '\ncommit;';
function sql(statement) {
  return spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_pawday',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: statement, encoding: 'utf8' },
  );
}
function value(statement) {
  const r = sql(statement);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function reset(version) {
  const args = ['db', 'reset', '--local', '--no-seed'];
  if (version) args.push('--version', version);
  const r = spawnSync(cli, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
const pet = '91e0acfd-0d22-43b5-b0f1-096912713000';
const family = '91e0acfd-0d22-43b5-b0f1-096912714000';
const user = (n) => `91e0acfd-0d22-43b5-b0f1-${String(n).padStart(12, '0')}`;
function write(statement) {
  return value(
    `begin; set local homeypaw.pre_cutover_migration_bypass='on'; ${statement} commit;`,
  );
}
function check() {
  assert.equal(
    value(
      `select count(*) from public.pet_members where pet_id='${pet}' and role in ('owner','member');`,
    ),
    '10',
  );
  assert.equal(
    value(
      `select count(*) from public.family_members f full join public.pet_members p on p.user_id=f.user_id and p.pet_id='${pet}' where (f.family_id='${family}' or p.pet_id='${pet}') and (f.user_id is null or p.user_id is null or f.role is distinct from p.role or f.created_at is distinct from p.created_at);`,
    ),
    '0',
  );
  assert.equal(
    value(
      'select enabled from private.pre_cutover_release_lock where singleton;',
    ),
    't',
  );
}
try {
  reset('20260919123354');
  let fixture = `insert into public.families(id) values ('${family}'); insert into public.pets(id,name,species,family_id) values ('${pet}','Cap fixture','other','${family}');`;
  for (let n = 1; n <= 11; n++) {
    fixture += `insert into auth.users(id,email,raw_user_meta_data) values ('${user(n)}','cap-migration-${n}@example.test','{"display_name":"Cap"}');`;
    if (n <= 10)
      fixture += `insert into public.family_members(family_id,user_id,role,created_at) values ('${family}','${user(n)}','${n === 1 ? 'owner' : 'member'}','2026-09-01'); insert into public.pet_members(pet_id,user_id,role,created_at) values ('${pet}','${user(n)}','${n === 1 ? 'owner' : 'member'}','2026-09-01');`;
  }
  write(fixture);
  const oldUpsert = sql(
    `begin; set local homeypaw.pre_cutover_migration_bypass='on'; insert into public.pet_members(pet_id,user_id,role) values ('${pet}','${user(2)}','member') on conflict(pet_id,user_id) do update set role=excluded.role; commit;`,
  );
  assert.notEqual(oldUpsert.status, 0);
  assert.match(oldUpsert.stderr, /family_member_limit_reached/u);
  console.log(
    'PASS: original existing-row UPSERT reproduces BEFORE INSERT cap failure',
  );
  const snapshot = () =>
    value(
      `select md5(string_agg(row(pet_id,user_id,role,created_at,xmin)::text, '|' order by user_id)) from public.pet_members where pet_id='${pet}';`,
    );
  const before = snapshot();
  value(migration);
  check();
  assert.equal(snapshot(), before);
  console.log(
    'PASS: Case A — exact 10, full C2 succeeds without changing mirror rows',
  );
  write(
    `delete from public.pet_members where pet_id='${pet}' and user_id='${user(10)}';`,
  );
  value(reconciliation);
  check();
  console.log('PASS: Case B — missing legal tenth inserted');
  const illegal = sql(
    `begin; set local homeypaw.pre_cutover_migration_bypass='on'; insert into public.pet_members(pet_id,user_id,role) values ('${pet}','${user(11)}','member'); commit;`,
  );
  assert.notEqual(illegal.status, 0);
  assert.match(illegal.stderr, /family_member_limit_reached/u);
  check();
  console.log(
    'PASS: Case C — actual eleventh rejected even with migration flag',
  );
  // Owner validity is deferred: repair the drift before committing the fixture.
  value(`begin; set local homeypaw.pre_cutover_migration_bypass='on';
    update public.pet_members set role='member' where pet_id='${pet}' and user_id='${user(1)}';
    do $$begin
      if (select count(*) from public.pet_members where pet_id='${pet}' and role in ('owner','member')) <> 10 then
        raise exception 'role drift fixture must remain at active cap';
      end if;
    end$$;
    ${reconciliation.replace(/^begin;/u, '')}`);
  check();
  console.log('PASS: Case D — existing role drift repaired at active cap');
  const exact = snapshot();
  value(migration);
  check();
  assert.equal(snapshot(), exact);
  console.log(
    'PASS: Case E — exact mirror full C2 replay is idempotent, no row updates',
  );
  assert.equal(
    value(
      "select count(*) from pg_trigger where tgrelid='public.pet_members'::regclass and tgname='enforce_pet_family_member_limit_before_membership' and tgenabled='O';",
    ),
    '1',
  );
} finally {
  reset();
}
console.log('PASS: cap preserved, lock ON, complete local chain restored');

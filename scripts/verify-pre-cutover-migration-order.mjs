import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

// All database operations use local Docker or explicit --local reset.
const cli = 'node_modules/.bin/supabase';
const directory = 'supabase/migrations';
const migrations = readdirSync(directory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const pending = migrations.filter(
  (name) => name.slice(0, 14) > '20260912160000',
);
assert.equal(pending.length, 17);
assert.equal(pending[0], '20260914110000_pre_cutover_release_lock.sql');
assert.equal(pending[1], '20260914120000_journal_video_backend_foundation.sql');
assert.equal(
  pending[2],
  '20260914130000_pre_cutover_trusted_migration_bypass.sql',
);
assert.equal(
  migrations.filter((name) => name.endsWith('_pre_cutover_release_lock.sql'))
    .length,
  1,
);

function sql(statement, user = 'postgres') {
  return spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_pawday',
      'sh',
      '-c',
      'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 -U "$1" -d postgres -tA -v ON_ERROR_STOP=1',
      'cutover-local-probe',
      user,
    ],
    { input: statement, encoding: 'utf8' },
  );
}
function value(statement, user = 'postgres') {
  const result = sql(statement, user);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function reset(version) {
  const args = ['db', 'reset', '--local', '--no-seed'];
  if (version) args.push('--version', version);
  const result = spawnSync(cli, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  console.log(`PASS: local reset through ${version ?? 'complete chain'}`);
}
function locked(tables) {
  assert.equal(
    value(
      'select enabled from private.pre_cutover_release_lock where singleton;',
    ),
    't',
  );
  value(`create function public.cutover_guard_probe(target regclass)
    returns void language plpgsql security definer set search_path = '' as $$
    begin execute format('insert into %s default values', target); end; $$;
    revoke execute on function public.cutover_guard_probe(regclass) from public;
    grant execute on function public.cutover_guard_probe(regclass) to authenticated, service_role;`);
  for (const table of tables) {
    const role =
      table === 'public.media_cleanup_jobs' ? 'service_role' : 'authenticated';
    const result = sql(
      `set role ${role}; select public.cutover_guard_probe('${table}'::regclass);`,
      'authenticator',
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /PRE_CUTOVER_RELEASE_LOCK/u,
      `${table}: ${result.stderr}`,
    );
  }
  value('drop function public.cutover_guard_probe(regclass);');
  console.log(`PASS: lock ON; guarded inserts: ${tables.join(', ')}`);
}
function failMigration(filename, absentTable) {
  // Some migrations own BEGIN/COMMIT; inject failure inside that transaction.
  const migration = readFileSync(`${directory}/${filename}`, 'utf8')
    .replace(/^begin;$/gmu, '')
    .replace(/^commit;$/gmu, '');
  const result = sql(
    `begin;\n${migration}\ncreate table private.cutover_failure_probe(id integer);\nselect 1/0;\ncommit;`,
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /division by zero/u,
    'Migration must run to the injected failure.',
  );
  assert.equal(value(`select to_regclass('${absentTable}') is null;`), 't');
}

function verifyBypass() {
  // Reproduce the verified hosted CLI login identity in local Docker only.
  value(
    `do $$begin
    if not exists (select 1 from pg_roles where rolname='cli_login_postgres') then
      create role cli_login_postgres login;
    end if;
  end$$; grant postgres to cli_login_postgres;`,
    'supabase_admin',
  );
  const trusted = (statement) =>
    sql(
      `set session authorization cli_login_postgres; ${statement}`,
      'supabase_admin',
    );
  const denied = (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PRE_CUTOVER_RELEASE_LOCK/u);
  };
  const pet = '19cd08aa-0b97-48c5-8b25-2e1801e6e222';
  const user = '19cd08aa-0b97-48c5-8b25-2e1801e6e111';
  denied(
    trusted(
      "insert into public.pets(name,species) values ('No flag','other');",
    ),
  );
  // Auth fixture setup uses the local Auth-admin equivalent, not CLI privileges.
  value(`begin; set local homeypaw.pre_cutover_migration_bypass='on';
    insert into auth.users(id,email,raw_user_meta_data) values ('${user}','migration-local@example.test','{"display_name":"Migration"}'); commit;`);
  const allowed = trusted(`begin;
    set local homeypaw.pre_cutover_migration_bypass='on';
    insert into public.pets(id,name,species) values ('${pet}','Legacy fixture','other');
    insert into public.pet_members(pet_id,user_id,role) values ('${pet}','${user}','owner');
    commit;
    select coalesce(current_setting('homeypaw.pre_cutover_migration_bypass',true),'')='on';`);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout.trim().split('\n').at(-1), 'f');
  const expired =
    trusted(`begin; set local homeypaw.pre_cutover_migration_bypass='on'; commit;
    insert into public.pets(name,species) values ('Expired','other');`);
  denied(expired);
  value(`create function public.cutover_flag_spoof() returns void
    language plpgsql security definer set search_path='' as $$begin
      perform set_config('homeypaw.pre_cutover_migration_bypass','on',true);
      insert into public.pets(name,species) values ('Spoof','other');
    end$$;
    revoke all on function public.cutover_flag_spoof() from public;
    grant execute on function public.cutover_flag_spoof() to authenticated,service_role;`);
  for (const role of ['authenticated', 'service_role']) {
    denied(
      sql(
        `set role ${role}; select public.cutover_flag_spoof();`,
        'authenticator',
      ),
    );
  }
  value('drop function public.cutover_flag_spoof();');
  // Apply the exact pending files with the hosted CLI session identity and real data.
  for (const filename of pending.slice(3)) {
    const result = trusted(readFileSync(`${directory}/${filename}`, 'utf8'));
    assert.equal(result.status, 0, `${filename}: ${result.stderr}`);
    assert.equal(
      value(
        'select enabled from private.pre_cutover_release_lock where singleton;',
      ),
      't',
    );
    if (filename.startsWith('20260919091047')) {
      assert.equal(
        value(`select count(*) from public.pets p join public.family_members m
        on m.family_id=p.family_id where p.id='${pet}' and m.user_id='${user}' and m.role='owner';`),
        '1',
      );
      console.log('PASS: actual CLI identity + Phase A legacy backfill');
    }
  }
  denied(
    trusted(
      "insert into public.pets(name,species) values ('After chain','other');",
    ),
  );
  console.log(
    'PASS: trusted identity AND LOCAL flag; spoofed API SECURITY DEFINER blocked; flag expires; exact remaining chain succeeds',
  );
  reset('20260914130000');
}

const legacy = [
  'public.profiles',
  'public.posts',
  'public.post_media',
  'public.pets',
  'storage.objects',
];
const video = ['public.post_videos', 'public.media_cleanup_jobs'];
const family = [
  'public.families',
  'public.family_members',
  'public.family_invites',
];
try {
  reset('20260914110000');
  failMigration(pending[1], 'public.post_videos');
  locked(legacy);
  console.log(
    'PASS: Case A — failed Video migration rolls back; legacy remains locked',
  );
  reset('20260914130000');
  verifyBypass();
  failMigration(
    '20260919091047_multi_pet_family_phase_a_foundation.sql',
    'public.families',
  );
  locked([...legacy, ...video]);
  console.log(
    'PASS: Case B — failed Phase A rolls back; Video and legacy remain locked',
  );
  reset('20260919091047');
  failMigration(
    '20260919112419_multi_pet_family_phase_b1_compatibility_writes.sql',
    'private.cutover_failure_probe',
  );
  locked([...legacy, ...video, ...family]);
  console.log(
    'PASS: Case C — failed later migration retains Family/Pet guards',
  );
  reset('20260923125000');
  assert.equal(
    value("select to_regclass('public.app_release_policy') is not null;"),
    't',
  );
  // C4G rejects the deliberately NULL membership fixture before the lock trigger.
  // Case C covers Family writes; here verify R3 preserves the lock and guards.
  locked([...legacy, ...video]);
  for (const table of family) {
    assert.equal(
      value(
        `select count(*) from pg_trigger where tgrelid = '${table}'::regclass and tgname = 'pre_cutover_release_lock' and tgenabled = 'O';`,
      ),
      '1',
    );
  }
  console.log('PASS: Case D — R3 preserves lock ON');
} finally {
  reset();
}
console.log('PASS: pending order, stage interruptions, and full-chain replay');

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
assert.equal(pending.length, 16);
assert.equal(pending[0], '20260914110000_pre_cutover_release_lock.sql');
assert.equal(pending[1], '20260914120000_journal_video_backend_foundation.sql');
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
function value(statement) {
  const result = sql(statement);
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
  reset('20260914120000');
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

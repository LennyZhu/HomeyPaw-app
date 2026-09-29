import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

// No URL/key/env/linked-project override: only the known local Docker stack.
const container = 'supabase_db_pawday';
const database = `homeypaw_post_read_verify_${process.pid}`;
const migrationPath =
  'supabase/migrations/20260929070417_journal_post_read_receipts_v1.sql';
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = (input, db = database, user = 'postgres') =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      user,
      '-d',
      db,
      '-X',
      '-q',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  ).trim();
const tables = [
  'auth.users',
  'public.profiles',
  'public.posts',
  'public.post_media',
  'public.post_videos',
  'public.families',
  'public.family_members',
  'public.pet_members',
  'public.pets',
  'private.family_notification_outbox',
  'private.family_notification_deliveries',
  'public.app_release_policy',
  'private.pre_cutover_release_lock',
  'supabase_migrations.schema_migrations',
];
const state = () =>
  sql(
    `select json_build_array(to_regclass('public.post_read_states') is not null,
  to_regprocedure('public.mark_post_read(uuid)') is not null,
  to_regprocedure('public.get_post_readers(uuid)') is not null,
  exists(select 1 from supabase_migrations.schema_migrations where version='20260929070417'));`,
    'postgres',
  );
const beforeState = state();
const flags = JSON.parse(beforeState);
assert.ok(
  flags.every(Boolean) || flags.every((value) => !value),
  'Schema/history must agree; no development repair is performed.',
);
const applied = flags.every(Boolean);
if (applied) tables.push('public.post_read_states');
const fingerprintSql = `select json_build_array(${tables.map((table) => `(select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) from ${table} t)`).join(',')},
  (select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')));`;
const before = sql(fingerprintSql, 'postgres');
let created = false;
try {
  const schema = execFileSync(
    'docker',
    [
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--schema-only',
    ],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  );
  execFileSync('docker', [
    'exec',
    container,
    'createdb',
    '-U',
    'postgres',
    '-T',
    'template0',
    database,
  ]);
  created = true;
  sql(schema, database, 'supabase_admin');
  if (!applied) sql(read(migrationPath));
  sql(`set homeypaw.pre_cutover_migration_bypass='on';
    set request.jwt.claim.role='service_role';
    set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.2.0","x-homeypaw-build":"9"}';
    ${read('scripts/sql/post-read-receipts.sql')}`);
  assert.equal(
    sql('select count(*) from public.post_read_states;'),
    '0',
    'Rollback removes every receipt fixture.',
  );
  assert.equal(
    sql('select count(*) from auth.users;'),
    '0',
    'Rollback removes synthetic accounts.',
  );
  // Concurrent RPCs use committed synthetic rows ONLY in the scratch DB.
  const owner = randomUUID(),
    reader = randomUUID(),
    family = randomUUID(),
    pet = randomUUID(),
    post = randomUUID();
  const trusted =
    "set homeypaw.pre_cutover_migration_bypass='on'; set request.jwt.claim.role='service_role';";
  sql(`${trusted} begin;
    insert into public.app_release_policy(platform,minimum_app_version,minimum_build,enforce_mutation_gate) values('ios','1.2.0',9,true);
    insert into auth.users(id,raw_user_meta_data) values('${owner}','{"display_name":"Owner","locale":"en"}'),('${reader}','{"display_name":"Reader","locale":"en"}');
    insert into public.families(id) values('${family}');
    insert into public.family_members(family_id,user_id,role) values('${family}','${owner}','owner'),('${family}','${reader}','viewer');
    insert into public.pets(id,name,species,family_id) values('${pet}','Concurrent receipt','dog','${family}');
    insert into public.posts(id,pet_id,author_id,content) values('${post}','${pet}','${owner}','Concurrent receipt'); commit;`);
  const actor = `${trusted} set request.jwt.claim.role='authenticated';
    set request.jwt.claim.sub='${reader}';
    set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.2.0","x-homeypaw-build":"9"}'; set role authenticated;`;
  const barrier = 929000000 + (process.pid % 100000);
  const run = promisify(execFile);
  const start = (statement) =>
    run(
      'docker',
      [
        'exec',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        database,
        '-X',
        '-q',
        '-tA',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        statement,
      ],
      { timeout: 15_000 },
    );
  const waitForBarrier = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (
        sql(
          `select exists(select 1 from pg_locks where locktype='advisory' and classid=0 and objid=${barrier} and granted and database=(select oid from pg_database where datname=current_database()));`,
        ) === 't'
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Concurrent RPC did not reach the lock barrier.');
  };
  const first = start(
    `${actor} begin; select public.mark_post_read('${post}'); select pg_advisory_xact_lock(${barrier}); select pg_sleep(1); commit;`,
  );
  try {
    await waitForBarrier();
    await start(`${actor} select public.mark_post_read('${post}');`);
  } finally {
    await first;
  }
  assert.equal(
    sql('select count(*) from public.post_read_states;'),
    '1',
    'Concurrent marks create one row.',
  );
  const preparing = start(
    `${actor} begin; select public.prepare_account_deletion(); select pg_advisory_xact_lock(${barrier}); select pg_sleep(1); commit;`,
  );
  try {
    await waitForBarrier();
    await assert.rejects(
      start(`${actor} select public.mark_post_read('${post}');`),
      (error) =>
        error.stderr.includes('post not found') &&
        !error.stderr.includes('deadlock'),
    );
  } finally {
    await preparing;
  }
  assert.equal(
    sql('select count(*) from public.post_read_states;'),
    '1',
    'Account preparation retains receipt history.',
  );
  sql(`${trusted} delete from auth.users where id='${reader}';`);
  assert.equal(
    sql('select count(*) from public.post_read_states where user_id is null;'),
    '1',
    'Concurrent lifecycle anonymizes after preparation.',
  );
  console.log(
    'PASS: concurrent duplicate marks and account preparation serialize; post-removal mark denied without deadlock; history retained/anonymized.',
  );
  console.log(
    'PASS: isolated migration, RLS/ACL, author skip, role authorization, stale-mirror denial, unique/first-time semantics, current reader filtering, account preparation/anonymization, Post/Pet/Family cascade, NULL author and release guards.',
  );
} catch (error) {
  process.stderr.write(error.stderr?.toString() ?? error.message);
  throw error;
} finally {
  if (created)
    execFileSync('docker', [
      'exec',
      container,
      'dropdb',
      '-U',
      'postgres',
      '--force',
      database,
    ]);
  assert.equal(state(), beforeState, 'Development schema/history unchanged.');
  assert.equal(
    sql(fingerprintSql, 'postgres'),
    before,
    'Development data/outbox/release policy/functions unchanged.',
  );
  console.log(
    `PASS: scratch DB removed; development fingerprint unchanged; migration ${applied ? 'already applied before test' : 'remains pending'}.`,
  );
}

import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

// No URL/env override/linked project: only a schema-only disposable local DB.
const container = 'supabase_db_pawday';
const database = `homeypaw_recurrence_v2_verify_${process.pid}`;
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const query = (sql, db = database, user = 'postgres') =>
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
    {
      input:
        db === database && user === 'postgres'
          ? `set homeypaw.pre_cutover_migration_bypass='on';
set request.jwt.claim.role='service_role';
set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.2.0","x-homeypaw-build":"9"}';
${sql}`
          : sql,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  ).trim();
const tables = [
  'auth.users',
  'public.profiles',
  'public.families',
  'public.family_members',
  'public.pet_members',
  'public.pets',
  'public.care_tasks',
  'public.care_task_completions',
  'public.care_logs',
  'public.care_shifts',
  'public.care_shift_tasks',
  'private.family_notification_outbox',
  'private.family_notification_deliveries',
  'supabase_migrations.schema_migrations',
];
const fingerprint = `select json_build_array(${tables.map((name) => `(select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text),'')) from ${name} t)`).join(',')},(select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')));`;
const before = query(fingerprint, 'postgres');
const schemaState = JSON.parse(
  query(
    `select json_build_array(
      exists(select 1 from supabase_migrations.schema_migrations where version='20260928102325'),
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='care_tasks' and column_name='week_days'),
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='care_tasks' and column_name='ends_on'),
      (select count(*)=3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_care_task_v2','update_care_task_v2','get_care_task_occurrences_v2'))
    );`,
    'postgres',
  ),
);
const applied = schemaState.every(Boolean);
assert.ok(
  applied || schemaState.every((value) => !value),
  'Migration history and v2 schema must agree; the verifier never repairs or downgrades development schema.',
);
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
  query(schema, database, 'supabase_admin');
  query(
    `begin; ${read('scripts/sql/reminder-recurrence-v2-before.sql')} commit;`,
  );
  if (!applied)
    query(
      read('supabase/migrations/20260928102325_reminder_recurrence_v2.sql'),
    );
  console.log(
    applied
      ? 'PASS: persistently applied v2 schema cloned into disposable local DB; legacy fixtures use the compatibility trigger.'
      : 'PASS: migration applied only to schema-only disposable local DB.',
  );
  query(read('scripts/sql/reminder-recurrence-v2-after.sql'));
  // A newly created Shift holds a task SHARE lock. The concurrent recurrence
  // update must wait, then reconcile the now-committed associated item.
  const auth = `set homeypaw.pre_cutover_migration_bypass='on';
    set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.2.0","x-homeypaw-build":"9"}';
    set request.jwt.claim.role='authenticated';
    select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,false);
    set role authenticated;`;
  const run = promisify(execFile);
  const creating = run(
    'docker',
    [
      'exec',
      '-i',
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
      `${auth} begin;
      select public.create_care_shift(public.rv2_id('concurrent-shift'),public.rv2_id('pet'),current_date+4,public.rv2_id('owner'),null,
        jsonb_build_array(jsonb_build_object('care_task_id',public.rv2_id('daily'),'source_scheduled_for',((current_date+4)+time '18:00') at time zone 'Asia/Hong_Kong')));
      select pg_advisory_xact_lock(92828001); select pg_sleep(1); commit;`,
    ],
    { timeout: 15_000 },
  );
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (
      query(
        "select exists(select 1 from pg_locks where locktype='advisory' and classid=0 and objid=92828001 and granted);",
      ) === 't'
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    ready,
    'Concurrent create session must reach the task-lock barrier.',
  );
  query(
    `${auth} select public.update_care_task_v2(public.rv2_id('daily'),'Concurrent shorter end',null,null,'daily',null,'2026-01-01','18:00','Asia/Hong_Kong',null,null,current_date+2);`,
  );
  await creating;
  query(
    "select public.rv2_assert((select status='canceled' from public.care_shift_tasks where shift_id=public.rv2_id('concurrent-shift')),'concurrent new associated item reconciled');",
  );
  console.log(
    'PASS: concurrent Schedule create and recurrence update serialize without leaving an invalid future item.',
  );
  console.log(
    'PASS: backfill, v1 bridge/advanced protection, v2, constraints, inclusive end, history union, Schedule reconciliation, canonical Family authorization and legacy recurrence SQL.',
  );
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
  assert.equal(
    query(fingerprint, 'postgres'),
    before,
    'Development data, outbox jobs, migration history and functions must remain unchanged.',
  );
  console.log(
    `PASS: scratch DB removed; development DB fingerprint unchanged; migration remains ${applied ? 'persistently applied' : 'pending'}.`,
  );
}

import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

// Fixed local Docker target. No linked-project, password or URL/environment override.
const container = 'supabase_db_pawday';
const database = `homeypaw_actual_care_verify_${process.pid}`;
const migration =
  'supabase/migrations/20261014055524_care_completion_actual_time.sql';
const nowMigration =
  'supabase/migrations/20261014070450_care_completion_server_now.sql';
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const prefix = `set homeypaw.pre_cutover_migration_bypass='on';
set request.jwt.claim.role='service_role';
set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.3.0","x-homeypaw-build":"10"}';`;
const args = (db = database, user = 'postgres') => [
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
];
const query = (sql, db = database, user = 'postgres') =>
  execFileSync('docker', args(db, user), {
    input: db === database && user === 'postgres' ? `${prefix}\n${sql}` : sql,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
const tables = [
  'auth.users',
  'public.profiles',
  'public.families',
  'public.family_members',
  'public.pet_members',
  'public.pets',
  'public.care_logs',
  'public.care_tasks',
  'public.care_task_completions',
  'public.care_shifts',
  'public.care_shift_tasks',
  'private.family_notification_outbox',
  'private.family_notification_deliveries',
  'supabase_migrations.schema_migrations',
];
const fingerprint = `select json_build_array(${tables.map((t) => `(select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) from ${t} r)`).join(',')}, (select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')));`;
const before = query(fingerprint, 'postgres');
const applied =
  query(
    "select exists(select 1 from supabase_migrations.schema_migrations where version='20261014055524');",
    'postgres',
  ) === 't';
const nowApplied =
  query(
    "select exists(select 1 from supabase_migrations.schema_migrations where version='20261014070450');",
    'postgres',
  ) === 't';
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
  const legacyDefinitions = `select json_build_array(pg_get_functiondef('public.complete_care_task(uuid,uuid,uuid,timestamptz,text,integer)'::regprocedure),pg_get_functiondef('public.complete_care_shift_task(uuid,uuid,uuid,text,integer)'::regprocedure));`;
  const legacyBefore = query(legacyDefinitions);
  query(`insert into public.care_logs(id,pet_id,performed_by,care_type,occurred_at,time_zone,local_date,note)
    values(public.rv2_id('pre-existing-care'),public.rv2_id('pet'),public.rv2_id('owner'),'feeding','2020-01-01T01:00Z','Asia/Hong_Kong','2020-01-01','No inferred historical occurrence');`);
  const historySql =
    "select to_jsonb(l) from public.care_logs l where id=public.rv2_id('pre-existing-care');";
  const historyBefore = query(historySql);
  if (!applied) query(read(migration));
  const wrapperDefinition = `select pg_get_functiondef('public.complete_care_shift_task_v2(uuid,uuid,uuid,timestamptz,text,integer)'::regprocedure);`;
  const wrapperBefore = query(wrapperDefinition);
  if (!nowApplied) query(read(nowMigration));
  assert.equal(
    query(wrapperDefinition),
    wrapperBefore,
    'Shift wrapper unchanged.',
  );
  assert.equal(
    query(legacyDefinitions),
    legacyBefore,
    'Legacy completion definitions must remain identical.',
  );
  assert.equal(
    query(historySql),
    historyBefore,
    'Migration must not rewrite historical facts.',
  );
  const compatibility = read(
    'supabase/migrations/20261025051859_care_log_legacy_time_compatibility.sql',
  );
  const v2Before = query(wrapperDefinition);
  query(compatibility);
  query(compatibility); // Repeat application must preserve behavior and identity.
  assert.equal(query(wrapperDefinition), v2Before);
  query(read('scripts/sql/care-completion-actual-time.sql'));
  console.log(
    'PASS: actual/audit/planned separation, server-now NULL, planned/custom/early/midnight, today filtering/sorting, author-only correction, future/infinity rejection, legacy compatibility, canceled state, canonical roles and exactly-one Care Push event.',
  );

  const auth = (actor) =>
    `${prefix} set request.jwt.claim.role='authenticated'; select set_config('request.jwt.claim.sub',public.rv2_id('${actor}')::text,false); set role authenticated;`;
  const run = promisify(execFile);
  // A real transaction completes and holds its row locks until the second
  // actor has attempted completion. Different UUIDs and server-now retries cannot
  // replace the first completed fact.
  const first = run(
    'docker',
    [
      ...args(),
      '-c',
      `${auth('owner')} begin;
    select * from public.complete_care_shift_task_v2(public.ct_id('race-first'),public.ct_id('race-log-first'),public.ct_id('item-concurrent'),null);
    select pg_advisory_xact_lock(10140555); select pg_sleep(1); commit;`,
    ],
    { timeout: 15_000 },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (
      query(
        "select exists(select 1 from pg_locks where locktype='advisory' and classid=0 and objid=10140555 and granted);",
      ) === 't'
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(ready, 'First actor must reach the completion lock barrier.');
  const second = await run(
    'docker',
    [
      ...args(),
      '-c',
      `${auth('member')} select * from public.complete_care_shift_task_v2(public.ct_id('race-second'),public.ct_id('race-log-second'),public.ct_id('item-concurrent'),null);`,
    ],
    { timeout: 15_000 },
  );
  await first;
  assert.match(second.stdout, /already_completed/u);
  query(`select public.ct_assert((select count(*)=1 from public.care_task_completions where task_id=public.ct_id('concurrent')),'concurrent single completion');
    select public.ct_assert((select count(*)=1 from public.care_logs where id in(public.ct_id('race-log-first'),public.ct_id('race-log-second'))),'concurrent single Care fact');
    select public.ct_assert((select l.occurred_at=c.completed_at and clock_timestamp()-l.occurred_at>interval '1 second' from public.care_logs l join public.care_task_completions c on c.care_log_id=l.id where l.id=public.ct_id('race-log-first')),'second request preserves first server time');
    select public.ct_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.ct_id('race-log-first') and event_type='care_log_created'),'concurrent single Push event');`);
  console.log(
    'PASS: two real concurrent Owner/Member transactions serialize; one completion, one Care Log, original actual time and one Push event.',
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
    'Existing development data/outbox/schema/history unchanged.',
  );
  console.log(
    `PASS: isolated DB removed; persistent development fingerprint unchanged; actual-time migration ${applied ? 'applied' : 'pending'}, server-now migration ${nowApplied ? 'applied' : 'pending'}.`,
  );
}

import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

// Hard-coded local Docker stack only. No URL, credentials, linked CLI or remote
// connection. A schema-only disposable DB allows real two-session concurrency
// tests without committing fixtures/schema changes to the development DB.
const container = 'supabase_db_pawday';
const database = `homeypaw_chat_push_verify_${process.pid}`;
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read(
  'supabase/migrations/20260928072854_family_chat_remote_push_v1.sql',
);
const args = (db, user = 'postgres') => [
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
    input:
      db === database && user === 'postgres'
        ? `set homeypaw.pre_cutover_migration_bypass='on';
         set request.jwt.claim.role='service_role';
         set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.2.0","x-homeypaw-build":"9"}';
         ${sql}`
        : sql,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const tables = [
  'auth.users',
  'public.profiles',
  'public.families',
  'public.family_members',
  'public.pets',
  'public.pet_members',
  'public.posts',
  'public.care_logs',
  'public.care_tasks',
  'public.chat_messages',
  'public.family_chat_read_states',
  'private.push_devices',
  'private.family_notification_outbox',
  'private.family_notification_deliveries',
  'public.app_release_policy',
  'private.pre_cutover_release_lock',
  'supabase_migrations.schema_migrations',
];
const fingerprint = `select json_build_array(${tables
  .map(
    (table) =>
      `(select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from ${table} t)`,
  )
  .join(
    ',',
  )}, (select md5(string_agg(pg_get_functiondef(p.oid), ',' order by p.oid)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')));`;
const before = query(fingerprint, 'postgres');
const schemaState = JSON.parse(
  query(
    `select json_build_array(
      exists(select 1 from supabase_migrations.schema_migrations where version='20260928072854'),
      exists(select 1 from information_schema.columns where table_schema='private'
        and table_name='push_devices' and column_name='chat_push_v1'),
      exists(select 1 from information_schema.columns where table_schema='private'
        and table_name='family_notification_outbox' and column_name='family_id'),
      to_regprocedure('public.validate_family_notification_delivery(uuid)') is not null);`,
    'postgres',
  ),
);
const applied = schemaState.every(Boolean);
if (!applied && schemaState.some(Boolean))
  throw new Error(
    'Partial Chat Push schema/history; verifier will not alter it.',
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
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    },
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
  // Restore original ownership/ACLs, including Supabase-owned extensions and
  // Realtime functions, using the local built-in admin only in the scratch DB.
  // Application migration/fixtures still run as postgres, as on the dev DB.
  query(schema, database, 'supabase_admin');
  // Family/Owner creation is one transaction, matching the production RPC's
  // deferred exactly-one-Owner constraint.
  // In applied mode the schema-only clone already contains the migration.
  // Disable ONLY the scratch trigger while inserting historical fixtures;
  // re-enable it before exercising new messages and every existing SQL test.
  query(`begin;
    ${applied ? 'alter table public.chat_messages disable trigger enqueue_chat_message_notification;' : ''}
    ${read('scripts/sql/family-chat-push-before.sql')}
    ${applied ? 'alter table public.chat_messages enable trigger enqueue_chat_message_notification;' : ''}
    commit;`);
  if (!applied) query(migration);
  console.log(
    applied
      ? 'MODE: already-applied schema cloned; historical fixtures seeded only in scratch; migration not re-applied.'
      : 'MODE: pending migration applied only in disposable schema-only DB.',
  );
  query(read('scripts/sql/family-chat-push-after.sql'));

  // New Chat events created through the actual RPC, then claimed by independent
  // PostgreSQL worker sessions while the first deliberately retains its lease lock.
  query(`set request.jwt.claim.role='authenticated';
    select set_config('request.jwt.claim.sub',public.push_test_id('owner')::text,false);
    select public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'concurrency A');
    select public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'concurrency B');`);
  const run = promisify(execFile);
  const worker = async (hold) => {
    const result = await run(
      'docker',
      [
        ...args(database),
        '-c',
        `begin;
      set local homeypaw.pre_cutover_migration_bypass='on';
    set local request.jwt.claim.role='service_role';
      select event_id from public.claim_family_notification_event();
      select pg_sleep(${hold}); commit;`,
      ],
      { timeout: 30_000 },
    );
    return result.stdout.trim();
  };
  const claimed = await Promise.all([worker(0.3), worker(0.3)]);
  assert.equal(
    claimed.every((id) => /^[0-9a-f-]{36}$/u.test(id)),
    true,
  );
  assert.equal(
    new Set(claimed).size,
    2,
    'two concurrent workers must claim distinct events',
  );
  const eventId = claimed[0];
  const targets = async () =>
    (
      await run(
        'docker',
        [
          ...args(database),
          '-c',
          `begin;
    set local homeypaw.pre_cutover_migration_bypass='on';
    set local request.jwt.claim.role='service_role';
    select delivery_id from public.claim_family_notification_targets('${eventId}'::uuid);
    select pg_sleep(0.3); commit;`,
        ],
        { timeout: 30_000 },
      )
    ).stdout
      .trim()
      .split('\n')
      .filter(Boolean);
  const competing = await Promise.all([targets(), targets()]);
  const deliveries = competing.flat();
  assert.equal(deliveries.length, 3);
  assert.equal(
    new Set(deliveries).size,
    3,
    'concurrent target claims cannot duplicate a delivery',
  );
  assert.equal(
    query(
      `select count(*) from private.family_notification_deliveries where event_id='${eventId}'::uuid;`,
    ),
    '3',
  );
  console.log(
    'PASS: Chat Push schema, historical fixture baseline, INSERT/edit/delete/read/retry, capability lifecycle, canonical roles/missing+stale mirrors, 0 Pet, deleted source, existing activity Push, multi-device, token invalidation, worker retry and two-session event/delivery concurrency.',
  );
} catch (error) {
  process.stderr.write(error.stderr?.toString() ?? `${error.stack}\n`);
  process.exitCode = 1;
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
    'development data/functions/history/release gates must remain unchanged',
  );
  console.log(
    'PASS: disposable local schema-only verification DB removed; development DB/schema/migration history/release gates unchanged; no Production connection.',
  );
}

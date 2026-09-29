import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Deliberately hard-coded to the local Docker stack; no URL, keys or linked CLI.
const args = [
  'exec',
  '-i',
  'supabase_db_pawday',
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-X',
  '-q',
  '-v',
  'ON_ERROR_STOP=1',
  '-tA',
];
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read(
  'supabase/migrations/20260927103354_family_chat_scope.sql',
);
const query = (input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();
const schemaQuery = `select json_build_object(
  'read_states', to_regclass('public.family_chat_read_states') is not null,
  'channel_states', to_regclass('private.family_chat_states') is not null,
  'family_column', exists(select 1 from information_schema.columns where table_schema='public' and table_name='chat_messages' and column_name='family_id'),
  'migration_applied', exists(select 1 from supabase_migrations.schema_migrations where version='20260927103354'));`;
const schemaBefore = JSON.parse(query(schemaQuery));
const flags = Object.values(schemaBefore);
const applied = flags.every(Boolean);
if (!applied && flags.some(Boolean))
  throw new Error(
    'Partial Family Chat schema/history detected; verifier will not alter it.',
  );
// Snapshot persisted data/history. Only aggregate hashes leave PostgreSQL.
const tables = [
  'public.chat_messages',
  'public.chat_read_states',
  'public.pets',
  'public.families',
  'public.family_members',
  'public.pet_members',
  'public.app_release_policy',
  'private.pre_cutover_release_lock',
  'private.pet_chat_states',
  'supabase_migrations.schema_migrations',
  ...(applied
    ? ['public.family_chat_read_states', 'private.family_chat_states']
    : []),
];
const dataQuery =
  'select json_build_array(' +
  tables
    .map(
      (table) =>
        `(select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text), '')) from ${table} t)`,
    )
    .join(',') +
  ');';
const persistedBefore = query(dataQuery);
// Never execute the migration's COMMIT inside the rollback test transaction.
if (!migration.startsWith('begin;\n') || !migration.endsWith('\ncommit;\n'))
  throw new Error('Expected explicit outer migration transaction.');
const migrationBody = migration.slice('begin;\n'.length, -'\ncommit;\n'.length);
const readMerge = migrationBody.match(
  /insert into public\.family_chat_read_states[\s\S]*?(?=\n\ncreate table private\.family_chat_states)/,
)?.[0];
if (!readMerge)
  throw new Error('Migration read-state merge fixture SQL missing.');
const fixtureReadMerge = readMerge.replace(
  "where fm.role in ('owner', 'member')",
  "where fm.family_id in (select id from pg_temp.chat_test_ids where label like 'family_%') and fm.role in ('owner', 'member')",
);
if (fixtureReadMerge === readMerge)
  throw new Error('Cannot isolate read-state merge to synthetic Families.');
const input = `
\\set QUIET on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Trusted local harness only; never changes the lock or release policy.
select set_config('homeypaw.pre_cutover_migration_bypass', 'on', true);
${read('scripts/sql/family-chat-before.sql')}
${
  applied
    ? `-- Existing schema: seed ONLY synthetic Family cursors/versions.
update private.family_chat_states set channel_version=1
where family_id in (select id from chat_test_ids where label like 'family_%');
${fixtureReadMerge}`
    : migrationBody
}
${read('scripts/sql/family-chat-after.sql')}
rollback;
`;
try {
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
} catch (error) {
  // Synthetic fixture values only. Never read credentials or remote user rows.
  process.stderr.write(error.stderr?.toString() ?? error.message);
  process.exit(1);
}
if (
  JSON.stringify(JSON.parse(query(schemaQuery))) !==
  JSON.stringify(schemaBefore)
)
  throw new Error('Rollback changed persisted schema/migration history.');
if (query(dataQuery) !== persistedBefore)
  throw new Error('Rollback changed persisted local data/history/policy.');
console.log(
  applied
    ? 'MODE: already-applied local schema; compatibility fixtures rolled back; migration not re-applied.'
    : 'MODE: pending local migration; migration body and fixtures rolled back.',
);
console.log(
  'PASS: local rollback fixtures/history, conservative read merge, Family RPC/RLS/roles, zero Pet, Pet deletion, actor retention, membership rotation and expired Family-version rejection.',
);
console.log(
  'PASS A: legacy Pet A identities/fetch/unread/read/current version/event; B: current Pet topic Owner/Member allowed, Viewer/Removed/Former denied; C: Family NULL-Pet send/fetch/event; D: no row duplication; E: dual hints share one row and retry emits once.',
);
console.log(
  'Persisted schema, migration history, local data and policy unchanged by verifier; no Production connection.',
);

// Fixed LOCAL Docker socket target only. No cloud connection or credentials.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Buffer } from 'node:buffer';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildYearlyMigrationTransaction,
  readYearlySource,
  historyFingerprint,
  yearlyVersion,
  sandboxPsqlInvocation,
  matchesHistorySource,
} from './lib/billing-sandbox-session.mjs';
import {
  sandboxRef,
  sandboxSessionHost,
} from '../supabase/functions/_shared/family-billing-target.mjs';

const database = `homeypaw_session_verify_${process.pid}_${randomUUID().slice(0, 8)}`;
const env = Object.fromEntries(
  ['PATH', 'HOME'].map((key) => [key, process.env[key]]),
);
const docker = (args, input = '') =>
  spawnSync('docker', args, { env, input, encoding: 'utf8', timeout: 15000 });
const args = [
  'exec',
  '-i',
  'supabase_db_pawday',
  'psql',
  '-X',
  '-qAt',
  '-U',
  'postgres',
  '-d',
  database,
  '-v',
  'ON_ERROR_STOP=1',
];
const query = (sql) => {
  const result = docker(args, sql);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const original = readYearlySource();
const batch = buildYearlyMigrationTransaction();
assert.ok(
  matchesHistorySource(
    '-- header\nselect 1; /* outer /* nested */ comment */',
    ['select 1'],
  ),
);
assert.ok(!matchesHistorySource('select 1; select 2;', ['select 1']));
assert.ok(!matchesHistorySource('select 2; select 1;', ['select 1']));
assert.ok(!matchesHistorySource('select 1; /* unterminated', ['select 1']));
assert.ok(batch.includes(`array['${original.replaceAll("'", "''")}']::text[]`));
assert.ok(
  batch.indexOf('insert into supabase_migrations.schema_migrations') <
    batch.lastIndexOf('\ncommit;'),
);
const invalid = {
  mode: 'cloud',
  projectRef: sandboxRef,
  url: `https://${sandboxRef}.supabase.co`,
  serviceKey: 'invalid',
  anonKey: 'invalid',
  databaseUrl: `postgresql://postgres.${sandboxRef}:synthetic@${sandboxSessionHost}:5432/postgres?sslmode=verify-full&sslrootcert=/nonexistent`,
};
assert.throws(() =>
  sandboxPsqlInvocation(invalid, sandboxRef, '/nonexistent', 'select 1;'),
);
const cli = process.argv.slice(2);
assert.ok(cli.length === 0 || (cli.length === 2 && cli[0] === '--ca-file'));
if (cli.length) {
  const key = (role) =>
    `e30.${Buffer.from(JSON.stringify({ role, ref: sandboxRef })).toString('base64url')}.synthetic`;
  const manifest = {
    ...invalid,
    serviceKey: key('service_role'),
    anonKey: key('anon'),
    applePublicKey: 'appl_synthetic',
    revenueCatProjectId: 'proj_fixture',
    revenueCatAppId: 'app_fixture',
    entitlementId: 'ent_fixture',
    monthlyProductId: 'sandbox.monthly',
    yearlyProductId: 'sandbox.yearly',
  };
  const url = new URL(manifest.databaseUrl);
  url.searchParams.set('sslrootcert', cli[1]);
  manifest.databaseUrl = url.href;
  const saved = { ...process.env };
  const temp = realpathSync(
    mkdtempSync(join(tmpdir(), 'homeypaw-session-ca-')),
  );
  try {
    process.env.PGSERVICE = 'untrusted';
    process.env.PGHOSTADDR = '127.0.0.2';
    process.env.PGOPTIONS = '-c default_transaction_read_only=off';
    const invocation = sandboxPsqlInvocation(
      manifest,
      sandboxRef,
      cli[1],
      'select 1;',
    );
    assert.equal(invocation.options.env.PGSSLMODE, 'verify-full');
    assert.ok(
      invocation.options.env.PGOPTIONS.includes(
        'default_transaction_read_only=on',
      ),
    );
    assert.equal(invocation.options.env.PGSERVICE, undefined);
    assert.equal(invocation.options.env.PGHOSTADDR, undefined);
    assert.ok(
      invocation.args.join(' ').includes('env -u PGHOSTADDR -u PGSERVICE psql'),
    );
    assert.ok(!invocation.args.join(' ').includes('synthetic'));
    assert.ok(!invocation.args.join(' ').includes('postgresql://'));
    const direct = { ...manifest };
    url.hostname = `db.${sandboxRef}.supabase.co`;
    url.username = 'postgres';
    url.search = '?sslmode=require';
    direct.databaseUrl = url.href;
    assert.equal(
      sandboxPsqlInvocation(direct, sandboxRef, cli[1], 'select 1;').options.env
        .PGSSLMODE,
      'verify-full',
    );
    assert.throws(() =>
      sandboxPsqlInvocation(
        manifest,
        sandboxRef,
        cli[1],
        'select 1;',
        yearlyVersion,
      ),
    );
    assert.throws(() =>
      sandboxPsqlInvocation(
        manifest,
        sandboxRef,
        cli[1],
        batch,
        '20261026074212',
      ),
    );
    // Construct only; never spawn the deployment invocation.
    assert.ok(
      sandboxPsqlInvocation(
        manifest,
        sandboxRef,
        cli[1],
        batch,
        yearlyVersion,
      ).options.env.PGOPTIONS.includes('default_transaction_read_only=off'),
    );
    const wrongCa = join(temp, 'wrong.crt');
    writeFileSync(wrongCa, 'untrusted certificate', { mode: 0o600 });
    assert.throws(() =>
      sandboxPsqlInvocation(direct, sandboxRef, wrongCa, 'select 1;'),
    );
    console.log(
      'PASS: pinned CA and verify-full for both modes; inherited host/service overrides removed; no password/URI argv; wrong CA, batch and version denied. Construction only, no cloud connection.',
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(temp, { recursive: true, force: true });
  }
}
const before = docker([
  'exec',
  'supabase_db_pawday',
  'psql',
  '-X',
  '-qAt',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-c',
  'select count(*) from supabase_migrations.schema_migrations;',
]).stdout;
let created = false;
let holder;
try {
  assert.equal(
    docker([
      'exec',
      'supabase_db_pawday',
      'createdb',
      '-U',
      'postgres',
      '-T',
      'template0',
      database,
    ]).status,
    0,
  );
  created = true;
  query(`create schema private; create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    insert into supabase_migrations.schema_migrations select lpad(n::text,14,'0'),'fixture',array['select 1;'] from generate_series(1,59)n;
    create table private.family_billing_config(singleton bool,environment text,enabled bool);
    insert into private.family_billing_config values(true,'SANDBOX',false);
    create table private.pre_cutover_release_lock(singleton bool,enabled bool);
    insert into private.pre_cutover_release_lock values(true,true);
    create table private.family_media_quota_policy(singleton bool,storage_enforcement_enabled bool);
    insert into private.family_media_quota_policy values(true,false);
    create table private.family_billing_test_accounts(enabled bool,expires_at timestamptz);
    create table private.family_billing_intents(id uuid);
    create table private.family_billing_intent_abandonments(intent_id uuid);
    create table private.family_billing_intent_ambiguities(id uuid);
    create function private.abandon_family_billing_intent(uuid,uuid,uuid,uuid,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb;$$;
    create function private.assert_family_billing_app_review_maintenance() returns void language plpgsql as $$begin
      if session_user<>'postgres' or current_user<>'postgres'
        or (select environment from private.family_billing_config)<>'SANDBOX' then raise exception 'MAINTENANCE_DENIED'; end if; end;$$;`);
  const fixtureHash = query(
    "select md5(string_agg(row(version,name,statements)::text,',' order by version)) from supabase_migrations.schema_migrations;",
  );
  // Only the ephemeral database name and synthetic History pin differ from the
  // real batch; the entire pinned Yearly SQL and transaction layout are real.
  const local = batch
    .replace(
      "current_database()<>'postgres'",
      `current_database()<>'${database}'`,
    )
    .replace(historyFingerprint, fixtureHash);
  const unchanged = () =>
    assert.equal(
      query(
        `select count(*)=59 and to_regprocedure('private.abandon_family_billing_yearly_intent(uuid,uuid,uuid,text,uuid,text,jsonb)') is null from supabase_migrations.schema_migrations;`,
      ),
      't',
    );
  query('update private.family_billing_config set enabled=true;');
  assert.throws(() => query(local), /CLOSED_BASELINE_REQUIRED/);
  unchanged();
  query(
    "update private.family_billing_config set enabled=false,environment='PRODUCTION';",
  );
  assert.throws(() => query(local), /IDENTITY_DENIED/);
  unchanged();
  query("update private.family_billing_config set environment='SANDBOX';");
  assert.throws(
    () => query(`set role authenticated;${local}`),
    /permission denied|IDENTITY_DENIED/,
  );
  unchanged();
  query(`create function supabase_migrations.fail_history() returns trigger language plpgsql as $$begin raise exception 'HISTORY_COMMIT_FAILURE'; end;$$;
    create constraint trigger fail_commit after insert on supabase_migrations.schema_migrations deferrable initially deferred for each row execute function supabase_migrations.fail_history();`);
  assert.throws(() => query(local), /HISTORY_COMMIT_FAILURE/);
  unchanged();
  query('drop trigger fail_commit on supabase_migrations.schema_migrations;');
  holder = spawn('docker', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const held = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('LOCAL_LOCK_TIMEOUT')),
      5000,
    );
    holder.stdout.on('data', (data) => {
      if (data.toString().includes('LOCK_HELD')) {
        clearTimeout(timer);
        resolve();
      }
    });
    holder.on('error', reject);
  });
  holder.stdin.write(
    "begin;lock table supabase_migrations.schema_migrations in exclusive mode;select 'LOCK_HELD';\n",
  );
  await held;
  assert.throws(() => query(local), /lock timeout/);
  const ended = once(holder, 'exit');
  holder.stdin.end('rollback;\n');
  await ended;
  holder = undefined;
  unchanged();
  query(local);
  assert.equal(
    query(
      `select count(*)=60 and to_regprocedure('private.abandon_family_billing_yearly_intent(uuid,uuid,uuid,text,uuid,text,jsonb)') is not null from supabase_migrations.schema_migrations;`,
    ),
    't',
  );
  assert.equal(
    query(
      `select statements[1] from supabase_migrations.schema_migrations where version='${yearlyVersion}';`,
    ),
    original.trim(),
  );
  assert.throws(() => query(local), /HISTORY_DENIED/);
  assert.equal(
    query('select count(*) from supabase_migrations.schema_migrations;'),
    '60',
  );
  console.log(
    'PASS: pinned Yearly batch only; local schema+History commit together; deferred History failure rolls back both; concurrency lock timeout leaves neither; closed/environment/role guards reject; replay cannot duplicate History.',
  );
} finally {
  if (holder) {
    holder.stdin.end('rollback;\n');
    holder.kill('SIGTERM');
  }
  if (created)
    assert.equal(
      docker([
        'exec',
        'supabase_db_pawday',
        'dropdb',
        '-U',
        'postgres',
        '--force',
        database,
      ]).status,
      0,
    );
  assert.equal(
    docker([
      'exec',
      'supabase_db_pawday',
      'psql',
      '-X',
      '-qAt',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      'select count(*) from supabase_migrations.schema_migrations;',
    ]).stdout,
    before,
  );
}

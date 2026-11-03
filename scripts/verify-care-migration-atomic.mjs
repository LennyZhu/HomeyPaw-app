import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// No remote URLs, dotenv, linked refs, or persistent Local database access.
const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'node_modules/.bin/supabase');
const dir = mkdtempSync(join(tmpdir(), 'homeypaw-care-atomic-'));
const project = `careatomic${process.pid}`;
const container = `supabase_db_${project}`;
const files = readdirSync(join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
assert.equal(files.length, 57);
const read = (f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const hashes = files.map((f) =>
  createHash('sha256').update(read(f)).digest('hex'),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(PG|SUPABASE_|DATABASE_URL)/.test(k),
  ),
);
const prefix = `set homeypaw.pre_cutover_migration_bypass='on'; set request.jwt.claim.role='service_role'; set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.3.0","x-homeypaw-build":"10"}';`;
const pgOptions =
  '-c homeypaw.pre_cutover_migration_bypass=on -c request.jwt.claim.role=service_role -c lock_timeout=2s -c statement_timeout=30s';
const qstr = (s) => `'${s.replaceAll("'", "''")}'`;
const report = { project, hashes, stages: [], locks: [] };
const pass = (message) => {
  report.stages.push(message);
  console.log(`PASS: ${message}`);
};
const docker = (args, input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
const pgArgs = (db = 'postgres', user = 'postgres') => [
  'exec',
  '-i',
  container,
  'psql',
  '-U',
  user,
  '-d',
  db,
  '-X',
  '-qtA',
  '-v',
  'ON_ERROR_STOP=1',
];
const query = (sql, db = 'postgres') =>
  docker(pgArgs(db), `${prefix}\n${sql}`).trim();
const command = (args, label, extra = {}) => {
  try {
    const output = execFileSync(cli, [...args, '--workdir', dir], {
      cwd: dir,
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
    });
    writeFileSync(join(dir, `${label}.log`), output, { mode: 0o600 });
    return output;
  } catch (error) {
    writeFileSync(
      join(dir, `${label}.log`),
      String(error.stdout ?? '') + String(error.stderr ?? ''),
      { mode: 0o600 },
    );
    throw new Error(`${label} failed; evidence: ${dir}`);
  }
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sessions = new Set();
function session(label) {
  const child = spawn('docker', pgArgs(), { env });
  sessions.add(child);
  let output = '',
    errors = '',
    exited = false,
    counter = 0;
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    errors += d;
  });
  child.on('exit', () => {
    exited = true;
    sessions.delete(child);
  });
  return {
    async run(sql) {
      const marker = `done_${label}_${++counter}`;
      const offset = output.length;
      child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      const start = Date.now();
      while (!output.includes(marker, offset)) {
        if (exited) throw new Error(`${label}: ${errors}`);
        assert.ok(Date.now() - start < 12000, `${label} bounded response`);
        await delay(10);
      }
      return output.slice(offset, output.indexOf(marker, offset)).trim();
    },
    close() {
      sessions.delete(child);
      child.stdin.end('rollback;\n\\q\n');
    },
  };
}
const fn =
  "'public.update_care_log(uuid,timestamptz,text,text,integer)'::regprocedure";
const definition = `select pg_get_functiondef(${fn});`;
const history =
  "select coalesce(json_agg(to_jsonb(m) order by version),'[]') from supabase_migrations.schema_migrations m;";
const auth = `set request.jwt.claim.role='authenticated'; select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,false); set role authenticated;`;
const legacyCalls = `do $$ declare delta integer; stamp timestamptz; actual timestamptz; begin foreach delta in array array[0,1,60,299,300] loop stamp:=clock_timestamp()+make_interval(secs=>delta); select occurred_at into actual from public.update_care_log(public.rv2_id('edit-log'),stamp,'Asia/Hong_Kong',null,null); if actual is distinct from stamp then raise exception 'timestamp changed'; end if; end loop; end $$;`;
const legacy = () => query(`begin; ${auth} ${legacyCalls} rollback;`);
let started = false;
try {
  command(['init'], 'init');
  const config = join(dir, 'supabase/config.toml');
  writeFileSync(
    config,
    readFileSync(config, 'utf8')
      .replace(/^project_id = .*$/m, `project_id = "${project}"`)
      .replace(/543\d\d/g, (p) => String(Number(p) + 400)),
  );
  const migrations = join(dir, 'supabase/migrations');
  mkdirSync(migrations, { recursive: true });
  for (const f of files.slice(0, 43))
    copyFileSync(join(root, 'supabase/migrations', f), join(migrations, f));
  started = true;
  command(
    [
      'start',
      '--exclude',
      'studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy',
    ],
    'start43',
  );
  assert.match(query('show server_version;'), /^17\./);
  report.postgres = query('show server_version;');
  const baselineHistory = JSON.parse(query(history));
  assert.equal(baselineHistory.length, 43);
  // Only synthetic data, in the disposable cluster. Match Production's actual lock OFF.
  query(
    `begin; update private.pre_cutover_release_lock set enabled=false; delete from public.app_release_policy; ${readFileSync(join(root, 'scripts/sql/reminder-recurrence-v2-before.sql'), 'utf8')} insert into public.care_logs(id,pet_id,performed_by,care_type,occurred_at,time_zone,local_date) values(public.rv2_id('edit-log'),public.rv2_id('pet'),public.rv2_id('owner'),'feeding',clock_timestamp(),'Asia/Hong_Kong',current_date); commit;`,
  );
  legacy();
  pass(
    'PostgreSQL 17, standard CLI baseline 43/43; legacy 0–300 seconds accepted',
  );
  const baselineFunction = query(definition);
  // The CLI itself supplies the oracle for the parsed statements/name/version.
  docker([
    'exec',
    container,
    'createdb',
    '-U',
    'postgres',
    '-T',
    'template0',
    'history_oracle',
  ]);
  const dump = docker([
    'exec',
    container,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
  ]);
  docker(pgArgs('history_oracle', 'supabase_admin'), dump);
  copyFileSync(
    join(root, 'supabase/migrations', files[43]),
    join(migrations, files[43]),
  );
  const url = (db) =>
    `postgresql://postgres:postgres@127.0.0.1:54722/${db}?sslmode=disable`;
  command(
    ['migration', 'up', '--db-url', url('history_oracle'), '--yes'],
    'oracle44',
    { PGOPTIONS: pgOptions },
  );
  const oracleRows = JSON.parse(query(history, 'history_oracle'));
  assert.equal(oracleRows.length, 44);
  assert.deepEqual(oracleRows.slice(0, 43), baselineHistory);
  const row = oracleRows[43];
  assert.equal(row.version, files[43].split('_')[0]);
  // CLI-parsed top-level commands, not regex over PL/pgSQL BEGIN/END bodies.
  const heads = row.statements.map((s) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim(),
  );
  assert.ok(
    heads.every((s) =>
      /^(create (or replace )?function|revoke |grant )/i.test(s),
    ),
  );
  report.topLevelCommands = heads.map((s) => s.split('\n')[0]);
  const historyInsert = `insert into supabase_migrations.schema_migrations select * from json_populate_record(null::supabase_migrations.schema_migrations,${qstr(JSON.stringify(row))}::json);`;
  const original = read(files[43]);
  const repair = read(files[56]);
  const setup = `${prefix} begin; set local lock_timeout='800ms'; set local statement_timeout='5s'; set local idle_in_transaction_session_timeout='10s';`;
  writeFileSync(
    join(dir, 'atomic-44.sql'),
    `${setup}\n${original}\n${repair}\n${historyInsert}\ncommit;\n`,
    { mode: 0o600 },
  );
  const snapshot = () =>
    JSON.parse(
      query(
        `select json_build_object('history',(select json_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m),'functions',(select json_agg(json_build_array(pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')));`,
      ),
    );
  const baseline = snapshot();
  for (const [label, sql] of [
    ['failure_before_repair', `${original}\nselect 1/0;`],
    ['failure_before_history', `${original}\n${repair}\nselect 1/0;`],
    [
      'history_insert_failure',
      `${original}\n${repair}\n${historyInsert}\n${historyInsert}`,
    ],
  ]) {
    let failed = false;
    try {
      query(`${setup}\n${sql}\ncommit;`);
    } catch {
      failed = true;
    }
    assert.ok(failed, label);
    assert.deepEqual(snapshot(), baseline, label);
    legacy();
    pass(
      `${label}: all function definitions and 43-row History rolled back exactly`,
    );
  }
  // Force contention at the real history INSERT, and prove bounded full rollback.
  const blocker = session('history_blocker');
  await blocker.run(
    'begin; lock table supabase_migrations.schema_migrations in access exclusive mode;',
  );
  const began = Date.now();
  let lockFailed = false;
  try {
    query(`${setup}\n${original}\n${repair}\n${historyInsert}\ncommit;`);
  } catch (e) {
    assert.match(e.stderr?.toString() ?? e.message, /lock timeout/);
    lockFailed = true;
  }
  assert.ok(lockFailed);
  report.lockTimeoutMs = Date.now() - began;
  assert.ok(report.lockTimeoutMs < 5000);
  await blocker.run('rollback;');
  blocker.close();
  assert.deepEqual(snapshot(), baseline);
  legacy();
  pass(
    '800ms lock timeout aborts the entire migration, including function replacements',
  );
  const a = session('migration_a');
  const b = session('legacy_b');
  await b.run(`${prefix} ${auth} set application_name='care_legacy_inflight';`);
  await a.run(setup);
  await a.run(original);
  // Internal A sees strict intermediate state. Independent B must see old code.
  assert.doesNotMatch(await a.run(definition), /interval '5 minutes'/);
  assert.equal(await b.run(definition), baselineFunction);
  await b.run(
    `begin; set local statement_timeout='3s'; ${legacyCalls} commit;`,
  );
  assert.equal(JSON.parse(query(history)).length, 43);
  // Hold the row separately so B is genuinely inside update_care_log while
  // A replaces and commits its function definitions, not merely idle in a txn.
  const rowBlocker = session('row_blocker');
  await rowBlocker.run(
    `${prefix} begin; update public.care_logs set note=note where id=public.rv2_id('edit-log');`,
  );
  const inFlight = b.run(
    `begin; set local statement_timeout='4s'; ${legacyCalls} commit;`,
  );
  let waiting = false;
  for (let i = 0; i < 100; i++) {
    if (
      query(
        "select exists(select 1 from pg_stat_activity where application_name='care_legacy_inflight' and wait_event_type='Lock');",
      ) === 't'
    ) {
      waiting = true;
      break;
    }
    await delay(10);
  }
  assert.ok(
    waiting,
    'B must actually be inside a legacy RPC blocked at its row UPDATE',
  );
  await a.run(repair);
  await a.run(historyInsert);
  report.locks = JSON.parse(
    await a.run(
      "select coalesce(json_agg(json_build_object('relation',relation::regclass::text,'mode',mode,'granted',granted)),'[]') from pg_locks where pid=pg_backend_pid() and relation is not null;",
    ),
  );
  await a.run('commit;');
  await rowBlocker.run('rollback;');
  rowBlocker.close();
  await inFlight;
  await b.run(`begin; ${legacyCalls} commit;`);
  a.close();
  b.close();
  assert.equal(query(definition).includes("interval '5 minutes'"), true);
  assert.deepEqual(JSON.parse(query(history)), oracleRows);
  pass(
    'two independent connections: before, during, in-flight and after COMMIT legacy calls succeed; no 22023 window',
  );
  pass(
    'atomic 44 History is byte-for-byte equivalent as JSON to standard CLI 2.115.0 oracle',
  );
  for (const f of files.slice(44)) {
    copyFileSync(join(root, 'supabase/migrations', f), join(migrations, f));
    command(
      ['migration', 'up', '--db-url', url('postgres'), '--yes'],
      `migration-${f.split('_')[0]}`,
      { PGOPTIONS: pgOptions },
    );
    legacy();
    assert.equal(query(definition).includes("interval '5 minutes'"), true, f);
  }
  const final = JSON.parse(query(history));
  assert.equal(final.length, 57);
  assert.deepEqual(
    final.map((r) => r.version),
    files.map((f) => f.split('_')[0]),
  );
  // Replay normal CLI against oracle as well; every recorded statement must match.
  command(
    ['migration', 'up', '--db-url', url('history_oracle'), '--yes'],
    'oracle57',
    { PGOPTIONS: pgOptions },
  );
  assert.deepEqual(final, JSON.parse(query(history, 'history_oracle')));
  command(
    ['migration', 'up', '--db-url', url('postgres'), '--yes'],
    'final-no-pending',
    { PGOPTIONS: pgOptions },
  );
  // The dedicated legacy exercise log must not pollute the existing today-count fixture.
  query(
    `begin; ${auth} select public.update_care_log(public.rv2_id('edit-log'),'2020-01-01T00:00Z','Asia/Hong_Kong',null,null); commit;`,
  );
  query(
    readFileSync(
      join(root, 'scripts/sql/care-completion-actual-time.sql'),
      'utf8',
    ),
  );
  pass(
    '45–57 sequential standard CLI, 57/57 History identical to oracle, no pending migrations, legacy and v2 permission/time regression PASS',
  );
  assert.deepEqual(
    hashes,
    files.map((f) => createHash('sha256').update(read(f)).digest('hex')),
  );
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message;
  throw error;
} finally {
  for (const child of sessions) {
    if (!child.stdin.writableEnded) child.stdin.end('rollback;\n\\q\n');
  }
  if (started)
    command(['stop', '--no-backup', '--project-id', project], 'cleanup');
  // Evidence contains synthetic data only. No API keys or container environments.
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  rmSync(join(dir, 'supabase/.temp'), { recursive: true, force: true });
  console.log(`Evidence: ${dir}/report.json`);
}

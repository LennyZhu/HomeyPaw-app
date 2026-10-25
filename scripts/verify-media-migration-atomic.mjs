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
const dir = mkdtempSync(join(tmpdir(), 'homeypaw-media-atomic-'));
const project = `mediaatomic${process.pid}`;
const container = `supabase_db_${project}`;
const files = readdirSync(join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
assert.equal(files.length, 58);
const read = (f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const hashes = files.map((f) =>
  createHash('sha256').update(read(f)).digest('hex'),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(PG|SUPABASE_|DATABASE_URL)/.test(k),
  ),
);
const prefix = '';
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
  child.stdin.on('error', (error) => {
    errors += error.message;
    exited = true;
  });
  child.on('exit', () => {
    exited = true;
    sessions.delete(child);
  });
  return {
    async run(sql) {
      if (exited || child.stdin.writableEnded)
        throw new Error(`${label}: ${errors || 'session closed'}`);
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
const migration46 = read(files[45]);
const migration58 = read(files[57]);
const gate = "'private.require_supported_client_mutation()'::regprocedure";
const gateMeta = `select jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl,'definer',prosecdef,'config',proconfig,'body',prosrc) from pg_proc where oid=${gate};`;
const gateDefinition = `select pg_get_functiondef(${gate});`;
const history =
  "select coalesce(json_agg(to_jsonb(m) order by version),'[]') from supabase_migrations.schema_migrations m;";
const admin = (sql) => docker(pgArgs('postgres', 'supabase_admin'), sql).trim();
const pathA =
  "public.rv2_id('owner')::text||'/'||public.rv2_id('pet')::text||'/'||public.rv2_id('base-post')::text||'/'||public.rv2_id('photo-a')::text||'.jpg'";
const journalUpdate = `select public.update_post(public.rv2_id('base-post'),'Synthetic baseline','other',current_date,null,jsonb_build_array(jsonb_build_object('id',public.rv2_id('photo-a'),'storage_path',${pathA},'position',0,'width',10,'height',10,'mime_type','image/jpeg')));`;
const headers = (version) =>
  JSON.stringify({
    'x-homeypaw-platform': 'ios',
    'x-homeypaw-app-version': version,
    'x-homeypaw-build': '10',
  });
const auth = (actor = 'owner', version = '1.3.0') =>
  `set local role authenticated; set local request.jwt.claim.role='authenticated'; select set_config('request.jwt.claim.sub',public.rv2_id(${qstr(actor)})::text,true); set local request.headers=${qstr(headers(version))};`;
const sample = `select jsonb_build_object('a',(select used_bytes from private.family_media_usage where family_id=public.rv2_id('family')),'b',(select used_bytes from private.family_media_usage where family_id=public.rv2_id('other')),'registry',(select count(*) from private.family_media_objects),'errors',(select count(*) from private.family_media_measurement_errors),'enforcement',(select storage_enforcement_enabled from private.family_media_quota_policy),'entitlements',(select count(*) from private.family_media_entitlements));`;
const expectedSample = {
  a: 330,
  b: 70,
  registry: 4,
  errors: 0,
  enforcement: false,
  entitlements: 0,
};
const snapshot = () =>
  query(`select jsonb_build_object(
 'history',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m),
 'tables',(select jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object('oid',c.oid,'rls',c.relrowsecurity,'hash',(xpath('/row/v/text()',query_to_xml(format($q$select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) as v from %I.%I r$q$,n.nspname,c.relname),false,true,'')))[1]::text)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private','storage')),
 'functions',(select jsonb_agg(jsonb_build_array(pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f'),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and not t.tgisinternal));`);
let started = false;
try {
  command(['init'], 'init');
  const config = join(dir, 'supabase/config.toml');
  writeFileSync(
    config,
    readFileSync(config, 'utf8')
      .replace(/^project_id = .*$/m, `project_id = "${project}"`)
      .replace(/543\d\d/g, (p) => String(Number(p) + 600)),
  );
  const migrations = join(dir, 'supabase/migrations');
  mkdirSync(migrations, { recursive: true });
  for (const f of files.slice(0, 45))
    copyFileSync(join(root, 'supabase/migrations', f), join(migrations, f));
  started = true;
  command(
    [
      'start',
      '--exclude',
      'studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy',
    ],
    'start45',
  );
  assert.match(query('show server_version;'), /^17\.6/);
  report.postgres = query('show server_version;');
  query(read(files[56])); // Production's already-committed Care compatibility bridge.
  query('update private.pre_cutover_release_lock set enabled=false;');
  const oldGate = query(gateDefinition);
  const oldMeta = JSON.parse(query(gateMeta));
  const h45 = JSON.parse(query(history));
  assert.equal(h45.length, 45);
  // Empty standard-CLI oracle: default client policy is OFF. This database is
  // solely the History parser oracle, never the security/usage acceptance target.
  docker([
    'exec',
    container,
    'createdb',
    '-U',
    'postgres',
    '-T',
    'template0',
    'cli_oracle',
  ]);
  docker(
    pgArgs('cli_oracle', 'supabase_admin'),
    docker(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres']),
  );
  for (const f of files.slice(45))
    copyFileSync(join(root, 'supabase/migrations', f), join(migrations, f));
  const url = (db) =>
    `postgresql://postgres:postgres@127.0.0.1:54922/${db}?sslmode=disable`;
  command(
    ['migration', 'up', '--db-url', url('cli_oracle'), '--yes'],
    'oracle58',
  );
  const oracle = JSON.parse(query(history, 'cli_oracle'));
  assert.equal(oracle.length, 58);
  assert.deepEqual(oracle.slice(0, 45), h45);
  const row = oracle[45];
  assert.equal(row.version, '20261014104554');
  // Top-level statements are parsed by the actual CLI, so function/DO BEGIN/END
  // cannot be confused with transaction control. No transaction-external command.
  const heads = row.statements.map((s) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim(),
  );
  assert.ok(
    heads.every((s) => /^(create |insert |alter |do |revoke |grant )/i.test(s)),
  );
  report.migration46Commands = heads.map((s) => s.split('\n')[0]);
  const insertHistory = `insert into supabase_migrations.schema_migrations select * from json_populate_record(null::supabase_migrations.schema_migrations,${qstr(JSON.stringify(row))}::json);`;
  // Real postgres in cloud is not superuser; retain normal ownership/BYPASSRLS.
  admin(
    `do $$ begin if not exists(select 1 from pg_roles where rolname='cli_login_postgres') then create role cli_login_postgres nologin; end if; end $$; grant postgres to cli_login_postgres; create role context_other nologin; grant postgres to context_other;`,
  );
  let fixture = readFileSync(
    join(root, 'scripts/sql/reminder-recurrence-v2-before.sql'),
    'utf8',
  )
    .split('insert into public.care_tasks')[0]
    .replace(
      "insert into public.app_release_policy(platform,minimum_app_version,minimum_build,enforce_mutation_gate) values('ios','1.2.0',9,true);",
      '',
    )
    .replace(
      "select md5('recurrence-v2:' || $1)::uuid;",
      "select overlay(overlay(md5('recurrence-v2:' || $1) placing '4' from 13) placing 'a' from 17)::uuid;",
    );
  admin(`begin; ${fixture}
 insert into public.pets(id,name,species,family_id) values(public.rv2_id('other-pet'),'Synthetic B pet','dog',public.rv2_id('other'));
 insert into public.care_logs(id,pet_id,performed_by,care_type,occurred_at,time_zone,local_date) values(public.rv2_id('legacy-log'),public.rv2_id('pet'),public.rv2_id('owner'),'feeding','2020-01-01T00:00Z','Asia/Hong_Kong','2020-01-01');
 insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
 select public.rv2_id(label),bucket,public.rv2_id(actor)::text||'/'||public.rv2_id(pet)::text||'/'||public.rv2_id('base-post')::text||'/'||public.rv2_id(label)::text||suffix,public.rv2_id(actor)::text,'synthetic-only',jsonb_build_object('size',size)
 from (values('photo-a','post-media','owner','pet','.jpg',100),('video-a','post-videos','owner','pet','.mp4',200),('thumb-a','post-video-thumbnails','owner','pet','.jpg',30),('photo-b','post-media','stranger','other-pet','.jpg',70)) x(label,bucket,actor,pet,suffix,size);
 insert into public.posts(id,pet_id,author_id,content) values(public.rv2_id('base-post'),public.rv2_id('pet'),public.rv2_id('owner'),'Synthetic baseline');
 insert into public.post_media(id,post_id,storage_path,position,width,height) values(public.rv2_id('photo-a'),public.rv2_id('base-post'),${pathA},0,10,10);
 create table public.context_gate_probe(id integer);
 create trigger context_gate before insert on public.context_gate_probe for each row execute function private.require_supported_client_mutation();
 grant insert on public.context_gate_probe to postgres,cli_login_postgres,context_other,anon,authenticated,authenticator,service_role;
 update public.app_release_policy set minimum_app_version='1.2.0',minimum_build=9,enforce_mutation_gate=true,maintenance_mode=false; commit;`);
  // Fault-injection fixture: AFTER the second Family usage INSERT, raise while
  // the first Family already has a populated registry. Never part of a migration.
  admin(`create function public.atomic_fail_usage() returns trigger language plpgsql security definer set search_path='' as $$
 begin if (select count(*) from private.family_media_usage)>=2 then raise exception 'ATOMIC_MIDWAY_FAILURE objects=%',(select count(*) from private.family_media_objects); end if; return new; end $$;
 create function public.atomic_ddl_fault() returns event_trigger language plpgsql security definer set search_path='' as $$
 begin if tg_tag='CREATE TABLE' and current_setting('homeypaw.test_midway',true)='on' and to_regclass('private.family_media_usage') is not null
 and not exists(select 1 from pg_trigger where tgname='atomic_midway_failure') then
 execute 'create trigger atomic_midway_failure after insert on private.family_media_usage for each row execute function public.atomic_fail_usage()'; end if; end $$;
 create event trigger atomic_fixture_fault on ddl_command_end execute function public.atomic_ddl_fault();
 alter role postgres nosuperuser;`);
  assert.equal(
    query("select rolsuper from pg_roles where rolname='postgres';"),
    'f',
  );
  const baseline = snapshot();
  pass(
    'PostgreSQL17.6 45/58, Production-equivalent gate ON/lock OFF, non-superuser postgres and synthetic two-Family media',
  );
  // Standalone58 tests, then restore exactly the old gate before atomic46.
  query(migration58);
  const fixedMeta = JSON.parse(query(gateMeta));
  for (const k of ['owner', 'acl', 'definer', 'config'])
    assert.deepEqual(fixedMeta[k], oldMeta[k], k);
  report.roleMatrix = [];
  const test = (
    label,
    sessionUser,
    role,
    settings,
    ok,
    code = 'APP_UPDATE_REQUIRED',
  ) => {
    let error = '';
    try {
      admin(
        `begin; set session authorization ${sessionUser}; ${role ? `set local role ${role};` : ''} ${settings} insert into public.context_gate_probe values(1); rollback;`,
      );
    } catch (e) {
      error = e.stderr?.toString() ?? e.message;
    }
    if (ok) assert.equal(error, '', label);
    else assert.match(error, new RegExp(code), label);
    report.roleMatrix.push({ label, result: 'PASS' });
  };
  test('postgres null context', 'postgres', null, '', true);
  test(
    'postgres empty context',
    'postgres',
    null,
    "set local request.jwt.claim.role='';set local request.jwt.claim.sub='';set local request.jwt.claims='';set local request.headers='';set local request.method='';set local request.path='';set local request.cookies='';",
    true,
  );
  test('cli_login_postgres member', 'cli_login_postgres', null, '', true);
  admin('revoke postgres from cli_login_postgres;');
  test('cli login without membership', 'cli_login_postgres', null, '', false);
  admin('grant postgres to cli_login_postgres;');
  test('other postgres-member login', 'context_other', null, '', false);
  for (const user of ['anon', 'authenticated', 'authenticator']) {
    test(
      user + ' cannot impersonate maintenance',
      user,
      null,
      "set local homeypaw.pre_cutover_migration_bypass='on';set local homeypaw.maintenance='true';",
      false,
    );
  }
  const valid = `set local request.jwt.claim.role='authenticated'; set local request.headers=${qstr(headers('1.3.0'))};`;
  test('1.3 App normal', 'authenticator', 'authenticated', valid, true);
  test(
    '1.4 App normal',
    'authenticator',
    'authenticated',
    valid.replace('1.3.0', '1.4.0'),
    true,
  );
  test(
    'JSON claims App normal',
    'authenticator',
    'authenticated',
    `set local request.jwt.claims='{"role":"authenticated"}';set local request.headers=${qstr(headers('1.3.0'))};`,
    true,
  );
  test(
    'SECURITY DEFINER owner cannot authorize caller',
    'authenticator',
    'authenticated',
    "set local request.jwt.claim.role='authenticated';set local homeypaw.pre_cutover_migration_bypass='on';",
    false,
  );
  test(
    'old client remains rejected',
    'authenticator',
    'authenticated',
    valid.replace('1.3.0', '1.1.0'),
    false,
  );
  test(
    'invalid client version rejected',
    'authenticator',
    'authenticated',
    valid.replace('1.3.0', 'invalid'),
    false,
  );
  test(
    'missing version rejected',
    'authenticator',
    'authenticated',
    "set local request.jwt.claim.role='authenticated';set local request.headers='{}';",
    false,
  );
  test(
    'forged service JWT does not select DB role',
    'authenticator',
    'authenticated',
    "set local request.jwt.claim.role='service_role';",
    false,
  );
  test(
    'forged postgres JWT is not maintenance',
    'authenticator',
    'authenticated',
    "set local request.jwt.claim.role='postgres';",
    false,
  );
  test(
    'genuine service-role API preserved',
    'authenticator',
    'service_role',
    "set local request.jwt.claim.role='service_role';set local request.headers='{}';",
    true,
  );
  test(
    'admin with App context cannot skip old version',
    'postgres',
    'authenticated',
    valid.replace('1.3.0', '1.1.0'),
    false,
  );
  for (const [label, settings] of [
    ['claims empty object', "set local request.jwt.claims='{}';"],
    ['HTTP method present', "set local request.method='POST';"],
    ['HTTP path present', "set local request.path='/rpc/create_pet';"],
    ['HTTP cookies present', "set local request.cookies='{}';"],
    ['HTTP empty object', "set local request.headers='{}';"],
  ])
    test(label, 'postgres', null, settings, false);
  for (const [label, settings] of [
    ['malformed claims', "set local request.jwt.claims='invalid';"],
    ['JWT JSON null', "set local request.jwt.claims='null';"],
    ['JWT JSON array', "set local request.jwt.claims='[]';"],
    ['malformed header', "set local request.headers='invalid';"],
    ['header JSON scalar', "set local request.headers='true';"],
    ['whitespace context', "set local request.headers=' ';"],
    ['invalid sub', "set local request.jwt.claim.sub='not-uuid';"],
    [
      'conflicting claims',
      'set local request.jwt.claim.role=\'authenticated\';set local request.jwt.claims=\'{"role":"service_role"}\';',
    ],
  ])
    test(
      label,
      'postgres',
      null,
      settings,
      false,
      'APP_REQUEST_CONTEXT_INVALID',
    );
  assert.equal(
    query(
      `select has_function_privilege('authenticated',${gate},'EXECUTE') or has_function_privilege('anon',${gate},'EXECUTE');`,
    ),
    'f',
  );
  // Version-gate maintenance recognition cannot grant an App access to private
  // quota tables or another Family. All real RLS definitions remain untouched.
  for (const actor of ['owner', 'member', 'viewer', 'stranger']) {
    const expectedPet = actor === 'stranger' ? 'other-pet' : 'pet';
    const petRows = query(
      `begin; ${auth(actor)} select count(*)=1 and bool_and(id=public.rv2_id('${expectedPet}')) from public.pets; rollback;`,
    )
      .split('\n')
      .at(-1);
    assert.equal(petRows, 't', actor);
  }
  query(oldGate + ';');
  assert.equal(snapshot(), baseline);
  pass(
    '58 role/context matrix, genuine service API, owner/ACL/search_path, RLS/Family isolation PASS; exact45 restored',
  );
  const setup =
    "begin; set local lock_timeout='800ms';set local statement_timeout='5s';set local idle_in_transaction_session_timeout='10s';";
  const atomic = `${setup}\n${migration58}\n${migration46}\n${insertHistory}\ncommit;`;
  writeFileSync(join(dir, 'atomic-46.sql'), atomic, { mode: 0o600 });
  const failureCases = [
    ['after58', `${setup}${migration58} select 1/0;commit;`],
    [
      'during_media',
      `${setup}set local homeypaw.test_midway='on';${migration58}${migration46}${insertHistory}commit;`,
    ],
    [
      'history_failure',
      `${setup}${migration58}${migration46}${insertHistory}${insertHistory}commit;`,
    ],
    [
      'before_commit',
      `${setup}${migration58}${migration46}${insertHistory}select 1/0;commit;`,
    ],
  ];
  for (const [label, sql] of failureCases) {
    let error = '';
    try {
      query(sql);
    } catch (e) {
      error = e.stderr?.toString() ?? e.message;
    }
    assert.ok(error, label);
    if (label === 'during_media')
      assert.match(error, /ATOMIC_MIDWAY_FAILURE objects=[1-9]/);
    writeFileSync(join(dir, `${label}.error.txt`), error, { mode: 0o600 });
    assert.equal(snapshot(), baseline, label);
    pass(
      `${label}: full45 restore (function, ACL, tables, row hashes, RLS, triggers, History)`,
    );
  }
  const blocker = session('history_lock');
  await blocker.run(
    'begin;lock table supabase_migrations.schema_migrations in access exclusive mode;',
  );
  let lockError = '';
  const start = Date.now();
  try {
    query(atomic);
  } catch (e) {
    lockError = e.stderr?.toString() ?? e.message;
  }
  report.lockWaitMs = Date.now() - start;
  assert.match(lockError, /lock timeout/);
  assert.ok(report.lockWaitMs < 5000);
  await blocker.run('rollback;');
  blocker.close();
  assert.equal(snapshot(), baseline);
  const idle = session('idle_timeout');
  await idle.run(
    "begin;set local idle_in_transaction_session_timeout='500ms';" +
      migration58,
  );
  await delay(800);
  let idleFailed = false;
  try {
    await idle.run('select 1;');
  } catch {
    idleFailed = true;
  }
  assert.ok(idleFailed);
  assert.equal(snapshot(), baseline);
  pass(
    'bounded lock wait and idle timeout roll back the entire uncommitted bridge',
  );
  const a = session('atomic46');
  const b = session('old_client');
  await b.run(
    `set application_name='media-atomic-old-client';begin;${auth()}commit;`,
  );
  await a.run(setup);
  await a.run(migration58);
  assert.equal(query(gateDefinition), oldGate);
  await a.run(migration46);
  assert.deepEqual(JSON.parse(await a.run(sample)), expectedSample);
  assert.equal(
    query("select to_regclass('private.family_media_usage') is null;"),
    't',
  );
  assert.equal(JSON.parse(query(history)).length, 45);
  // Unrelated old Care work continues. Journal metadata writes may queue on the
  // real DDL lock, and must succeed after the bounded atomic commit.
  await b.run(
    `begin;${auth()} select public.update_care_log(public.rv2_id('legacy-log'),clock_timestamp()+interval '300 seconds','Asia/Hong_Kong',null,null);rollback;`,
  );
  let pendingFailure;
  const pending = b
    .run(
      `begin;set local statement_timeout='4s';${auth()} ${journalUpdate}commit;`,
    )
    .catch((error) => {
      pendingFailure = error;
    });
  let waiting = false;
  for (let i = 0; i < 100; i++) {
    if (pendingFailure) throw pendingFailure;
    if (
      query(
        "select exists(select 1 from pg_stat_activity where application_name='media-atomic-old-client' and wait_event_type='Lock');",
      ) === 't'
    ) {
      waiting = true;
      break;
    }
    await delay(10);
  }
  assert.ok(waiting, 'Journal write must exercise the actual DDL lock');
  report.commitLocks = JSON.parse(
    await a.run(
      "select json_agg(json_build_object('relation',relation::regclass::text,'mode',mode)) from pg_locks where pid=pg_backend_pid() and relation is not null;",
    ),
  );
  await a.run(insertHistory);
  await a.run('commit;');
  await pending;
  if (pendingFailure) throw pendingFailure;
  a.close();
  b.close();
  assert.deepEqual(JSON.parse(query(history)), oracle.slice(0, 46));
  assert.deepEqual(JSON.parse(query(sample)), expectedSample);
  assert.equal(JSON.parse(query(gateMeta)).body, fixedMeta.body);
  pass(
    'dual connections: no partial schema/History visible; old Care succeeds; Journal queues and commits successfully; 46 CLI record exact, no duplicate usage',
  );
  // Stage one new original file per normal CLI invocation; no spoofed JWT or
  // startup options are required after the trusted gate has become committed.
  for (const f of files.slice(46)) rmSync(join(migrations, f));
  for (let i = 46; i < 58; i++) {
    copyFileSync(
      join(root, 'supabase/migrations', files[i]),
      join(migrations, files[i]),
    );
    command(
      ['migration', 'up', '--db-url', url('postgres'), '--yes'],
      `migration-${i + 1}`,
    );
    assert.deepEqual(JSON.parse(query(history)), oracle.slice(0, i + 1));
    assert.deepEqual(JSON.parse(query(sample)), expectedSample);
  }
  command(
    ['migration', 'up', '--db-url', url('postgres'), '--yes'],
    'no-pending',
  );
  const finalGate = JSON.parse(query(gateMeta));
  for (const k of ['owner', 'acl', 'definer', 'config'])
    assert.deepEqual(finalGate[k], oldMeta[k]);
  assert.equal(finalGate.body, fixedMeta.body);
  assert.equal(
    query(
      'select (select enabled from private.family_billing_config) or (select release_ready from private.family_billing_config) or (select storage_enforcement_enabled or legacy_tus_residual_risk_accepted from private.family_media_quota_policy) or exists(select 1 from private.family_media_entitlements) or exists(select 1 from private.family_billing_test_accounts) or (select legacy_transition_started_at is not null from private.family_media_quota_policy);',
    ),
    'f',
  );
  assert.equal(
    query(
      "select (select limit_bytes from private.family_media_limits(public.rv2_id('family'),clock_timestamp()))=314572800;",
    ),
    't',
  );
  // Isolated, transaction-scoped entitlement fixture only. It never commits.
  assert.equal(
    query(
      "begin;insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference) values(public.rv2_id('family'),'plus',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',false,'isolated-only');select (select limit_bytes from private.family_media_limits(public.rv2_id('family'),clock_timestamp()))=5368709120;rollback;",
    ),
    't',
  );
  query(
    readFileSync(
      join(root, 'scripts/sql/care-completion-actual-time.sql'),
      'utf8',
    ),
  );
  query(
    `begin;${auth()} ${journalUpdate}set constraints all immediate;select public.rv2_assert((select count(*)=1 from public.posts where id=public.rv2_id('base-post')),'own Journal readable');rollback;`,
  );
  // Existing Storage RLS remains usable for legacy direct uploads; rollback all.
  query(
    `begin;${auth()} insert into storage.objects(id,bucket_id,name,owner_id,version,metadata) values(public.rv2_id('direct-upload'),'post-media',public.rv2_id('owner')::text||'/'||public.rv2_id('pet')::text||'/'||public.rv2_id('base-post')::text||'/'||public.rv2_id('direct-upload')::text||'.jpg',public.rv2_id('owner')::text,'synthetic',jsonb_build_object('size',42));rollback;`,
  );
  assert.deepEqual(JSON.parse(query(sample)), expectedSample);
  assert.deepEqual(
    hashes,
    files.map((f) => createHash('sha256').update(read(f)).digest('hex')),
  );
  pass(
    '58/58 exact standard-CLI History; 58 reapplication identical; Free/Plus limits, defaults OFF, legacy Care/Journal/Storage PASS',
  );
  report.result = 'PASS';
} catch (e) {
  report.result = 'FAIL';
  report.error = e.message;
  throw e;
} finally {
  for (const child of sessions)
    if (!child.stdin.writableEnded) child.stdin.end('rollback;\n\\q\n');
  if (started)
    command(['stop', '--no-backup', '--project-id', project], 'cleanup');
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  rmSync(join(dir, 'supabase/.temp'), { recursive: true, force: true });
  console.log(`Evidence: ${dir}/report.json`);
}

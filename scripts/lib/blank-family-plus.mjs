import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const cli = join(root, 'node_modules/.bin/supabase');
export const read = (path) => readFileSync(join(root, path), 'utf8');
export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const docker = (args, input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
const persistent = () =>
  docker([
    'exec',
    'supabase_db_pawday',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-X',
    '-q',
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `begin read only; select json_build_object(
  'cluster',(select system_identifier::text from pg_control_system()),
  'history',(select json_agg(version order by version) from supabase_migrations.schema_migrations),
  'stats',(select json_agg(row(table_schema,table_name,(xpath('/row/v/text()',query_to_xml(format($q$select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) as v from %I.%I r$q$,table_schema,table_name),false,true,'')))[1]::text) order by table_schema,table_name) from information_schema.tables where table_type='BASE TABLE' and table_schema in('public','private','auth','storage'))); commit;`,
  ]);

export async function withBlankFamilyPlus(run) {
  const dir = mkdtempSync(join(tmpdir(), 'homeypaw-4d1-blank-'));
  const project = 'hp4d1-' + dir.split('-').at(-1).toLowerCase();
  const container = `supabase_db_${project}`;
  const before = persistent();
  const command = (args) =>
    execFileSync(cli, [...args, '--workdir', dir], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  const query = (sql) =>
    docker(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-q',
        '-tA',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      sql,
    ).trim();
  let started = false;
  try {
    command(['init']);
    const configPath = join(dir, 'supabase/config.toml');
    const config = readFileSync(configPath, 'utf8')
      .replace(/^project_id = .*$/m, `project_id = "${project}"`)
      .replace(/543\d\d/g, (port) => String(Number(port) + 140));
    writeFileSync(configPath, config);
    cpSync(
      join(root, 'supabase/migrations'),
      join(dir, 'supabase/migrations'),
      { recursive: true },
    );
    started = true;
    console.log(
      `Starting disposable blank Supabase ${project}; API 54461, DB 54462. No linked ref or repository env copied.`,
    );
    command([
      'start',
      '--exclude',
      'studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy',
    ]);
    assert.notEqual(
      query('select system_identifier::text from pg_control_system();'),
      JSON.parse(before).cluster,
      'Fixtures must run in a new cluster, not the persistent Local database.',
    );
    const versions = readdirSync(join(root, 'supabase/migrations'))
      .filter((p) => p.endsWith('.sql'))
      .map((p) => p.split('_')[0])
      .sort();
    assert.deepEqual(
      JSON.parse(
        query(
          'select json_agg(version order by version) from supabase_migrations.schema_migrations;',
        ),
      ),
      versions,
    );
    console.log(
      `PASS: blank standard Supabase replayed ${versions.length}/${versions.length} migrations.`,
    );
    const fixture = readFileSync(
      join(root, 'scripts/sql/reminder-recurrence-v2-before.sql'),
      'utf8',
    )
      .split('insert into public.care_tasks')[0]
      .replace(
        "select md5('recurrence-v2:' || $1)::uuid;",
        "select overlay(overlay(md5('recurrence-v2:' || $1) placing '4' from 13) placing 'a' from 17)::uuid;",
      );
    const prefix = `set homeypaw.pre_cutover_migration_bypass='on'; set request.jwt.claim.role='service_role';
      set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.3.0","x-homeypaw-build":"10"}';`;
    const scopedQuery = (sql) => query(`${prefix}\n${sql}`);
    assert.equal(
      query(`select (select enabled from private.family_billing_config)
        or (select storage_enforcement_enabled from private.family_media_quota_policy)
        or exists(select 1 from private.family_media_entitlements);`),
      'f',
      'Full-chain initialization must not activate Billing, quotas or grants.',
    );
    query(`${prefix} begin; update private.pre_cutover_release_lock set enabled=false;
      delete from public.app_release_policy; ${fixture}
      insert into public.pets(id,name,species,family_id) values(public.rv2_id('other-pet'),'Other synthetic pet','dog',public.rv2_id('other')); commit;`);
    const status = JSON.parse(command(['status', '-o', 'json']));
    assert.equal(new URL(status.API_URL).hostname, '127.0.0.1');
    await run({
      query: scopedQuery,
      id: (label) => scopedQuery(`select public.rv2_id(${quote(label)});`),
      auth: (actor, sql) =>
        scopedQuery(`begin; set local role authenticated;
          set local request.jwt.claim.role='authenticated';
          select set_config('request.jwt.claim.sub',public.rv2_id(${quote(actor)})::text,true);
          ${sql} commit;`),
      api: status.API_URL,
      anonKey: status.ANON_KEY,
      jwtSecret: JSON.parse(docker(['inspect', `supabase_auth_${project}`]))[0]
        .Config.Env.find((s) => s.startsWith('GOTRUE_JWT_SECRET='))
        .split('=')
        .slice(1)
        .join('='),
    });
  } finally {
    if (started) command(['stop', '--no-backup', '--project-id', project]);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(
      persistent(),
      before,
      'Persistent Local DB all row hashes and history must remain unchanged.',
    );
    console.log(
      'PASS: disposable containers/volumes removed; persistent Local row fingerprints and migration history unchanged.',
    );
  }
}

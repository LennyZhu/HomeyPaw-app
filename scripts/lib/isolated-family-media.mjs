import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbContainer = 'supabase_db_pawday';
const sourceStorage = 'supabase_storage_pawday';
const prefix = `set homeypaw.pre_cutover_migration_bypass='on';
set request.jwt.claim.role='service_role';
set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.3.0","x-homeypaw-build":"10"}';`;
export const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const docker = (args, options = {}) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
const fingerprint = `select json_build_object('tables',(
 select json_object_agg(table_schema||'.'||table_name,fingerprint) from (
 select t.table_schema,t.table_name,(xpath('/row/value/text()',query_to_xml(
 format('select md5(coalesce(string_agg(to_jsonb(r)::text,'','' order by to_jsonb(r)::text),'''')) as value from %I.%I r',t.table_schema,t.table_name),false,true,'')))[1]::text fingerprint
 from information_schema.tables t where table_type='BASE TABLE' and table_schema in('auth','public','private','storage','supabase_migrations'))x),
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')),
 'policies',(select md5(string_agg(to_jsonb(p)::text,',' order by policyname)) from pg_policies p));`;

export async function withIsolatedMedia(
  run,
  {
    migration,
    storage = false,
    tusExpiryMs = 60_000,
    storageFileSizeLimitBytes,
  } = {},
) {
  // Fixed local targets only. No URL, linked project or Production credential option.
  const database = `homeypaw_media_verify_${process.pid}_${randomUUID().slice(0, 8)}`;
  const storageName = `homeypaw-media-verify-${process.pid}`;
  const query = (sql, db = database, user = 'postgres') =>
    docker(
      [
        'exec',
        '-i',
        dbContainer,
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
          user === 'postgres' && db === database ? `${prefix}\n${sql}` : sql,
      },
    ).trim();
  const before = query(fingerprint, 'postgres');
  let created = false,
    storageStarted = false,
    temp;
  try {
    const schema = docker([
      'exec',
      dbContainer,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--schema-only',
    ]);
    const bucketConfig = docker([
      'exec',
      dbContainer,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--data-only',
      '--table=storage.buckets',
      '--table=storage.migrations',
    ]);
    docker([
      'exec',
      dbContainer,
      'createdb',
      '-U',
      'postgres',
      '-T',
      'template0',
      database,
    ]);
    created = true;
    query(schema, database, 'supabase_admin');
    query(bucketConfig, database, 'supabase_admin');
    const fixtures = read(
      'scripts/sql/reminder-recurrence-v2-before.sql',
    ).replace(
      "select md5('recurrence-v2:' || $1)::uuid;",
      "select overlay(overlay(md5('recurrence-v2:' || $1) placing '4' from 13) placing 'a' from 17)::uuid;",
    );
    query(`begin; ${fixtures}
      insert into private.pre_cutover_release_lock(singleton,enabled) values(true,false);
      insert into public.pets(id,name,species,family_id) values(public.rv2_id('other-pet'),'Other media fixture','dog',public.rv2_id('other'));
      commit;`);
    if (migration) {
      const beforeContracts = query(`select json_build_array(
        (select json_agg(p order by policyname) from pg_policies p where schemaname='storage'),
        (select json_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in('create_post','update_post','create_post_v2','update_post_v2','complete_care_task_v2','complete_care_shift_task_v2')));`);
      const version = migration.split('/').at(-1).split('_')[0];
      const applied =
        query(
          `select exists(select 1 from supabase_migrations.schema_migrations where version=${quote(version)});`,
          'postgres',
        ) === 't';
      if (!applied) query(read(migration));
      else
        query(
          'insert into private.family_media_quota_policy(singleton) values(true);',
        );
      assert.equal(
        query(`select json_build_array(
        (select json_agg(p order by policyname) from pg_policies p where schemaname='storage'),
        (select json_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in('create_post','update_post','create_post_v2','update_post_v2','complete_care_task_v2','complete_care_shift_task_v2')));`),
        beforeContracts,
        'Prototype leaves existing Storage policies, Journal and Care RPC definitions unchanged.',
      );
      console.log(
        'PASS: prototype preserves Storage policies and all existing Journal/Care RPC definitions.',
      );
    }
    const auth = (actor, sql) =>
      query(`begin;set local role authenticated;
      set local request.jwt.claim.role='authenticated';
      select set_config('request.jwt.claim.sub',public.rv2_id(${quote(actor)})::text,true);
      ${sql} commit;`);
    const id = (label) => query(`select public.rv2_id(${quote(label)});`);
    let baseUrl, token;
    if (storage) {
      const inspected = JSON.parse(docker(['inspect', sourceStorage]))[0];
      assert.ok(
        inspected.Config.Image.includes('supabase/storage-api:'),
        'Existing local Storage image required.',
      );
      const env = Object.fromEntries(
        inspected.Config.Env.map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1)];
        }),
      );
      for (const key of Object.keys(env).filter((key) =>
        key.endsWith('DATABASE_URL'),
      )) {
        if (!env[key]) continue;
        const url = new URL(env[key]);
        assert.equal(
          url.hostname,
          dbContainer,
          'DB connection must target the fixed local container.',
        );
        url.pathname = `/${database}`;
        env[key] = url.toString();
      }
      assert.ok(env.AUTH_JWT_SECRET, 'Local JWT signing secret required.');
      env.PORT = '5000';
      env.STORAGE_BACKEND = 'file';
      env.FILE_STORAGE_BACKEND_PATH = '/var/lib/storage';
      env.TUS_URL_EXPIRY_MS = String(tusExpiryMs);
      if (storageFileSizeLimitBytes !== undefined) {
        assert.ok(
          Number.isSafeInteger(storageFileSizeLimitBytes) &&
            storageFileSizeLimitBytes > 0,
        );
        env.UPLOAD_FILE_SIZE_LIMIT = String(storageFileSizeLimitBytes);
      }
      temp = mkdtempSync(join(tmpdir(), 'homeypaw-media-verify-'));
      const envFile = join(temp, 'storage.env');
      assert.ok(
        Object.values(env).every((value) => !/[\r\n]/u.test(value)),
        'Single-line environment values required.',
      );
      writeFileSync(
        envFile,
        Object.entries(env)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
        { mode: 0o600 },
      );
      docker([
        'run',
        '-d',
        '--name',
        storageName,
        '--label',
        'homeypaw.isolated-media-verifier=true',
        '--network',
        inspected.HostConfig.NetworkMode,
        '-p',
        '127.0.0.1::5000',
        '--tmpfs',
        '/var/lib/storage:rw,size=96m',
        '--env-file',
        envFile,
        inspected.Config.Image,
      ]);
      storageStarted = true;
      const port = docker(['port', storageName, '5000/tcp'])
        .trim()
        .split(':')
        .at(-1);
      baseUrl = `http://127.0.0.1:${port}`;
      assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
      let ready = false;
      for (let i = 0; i < 120; i++) {
        try {
          if ((await fetch(`${baseUrl}/status`)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* startup */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.ok(ready, 'Isolated Storage API must become ready.');
      token = (actor, role = 'authenticated') => {
        const header = Buffer.from(
          JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
        ).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({
            role,
            sub: id(actor),
            aud: 'authenticated',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString('base64url');
        const signature = createHmac('sha256', env.AUTH_JWT_SECRET)
          .update(`${header}.${payload}`)
          .digest('base64url');
        return `${header}.${payload}.${signature}`;
      };
    }
    await run({
      query,
      auth,
      id,
      database,
      baseUrl,
      token,
      storageName,
      docker,
      prefix,
      dbContainer,
    });
  } finally {
    if (storageStarted) docker(['rm', '-f', storageName]);
    if (temp) rmSync(temp, { recursive: true, force: true });
    if (created)
      docker([
        'exec',
        dbContainer,
        'dropdb',
        '-U',
        'postgres',
        '--force',
        database,
      ]);
    assert.equal(
      query(fingerprint, 'postgres'),
      before,
      'Persistent local data/schema/policies/history must be unchanged.',
    );
    console.log(
      'PASS: isolated resources removed; persistent local DB, Storage, policies, outbox and migration history fingerprints unchanged.',
    );
  }
}

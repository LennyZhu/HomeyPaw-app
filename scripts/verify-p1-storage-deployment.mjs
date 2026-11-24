// Executes the FULL file-based installer only in a disposable local database.
// No cloud credentials, URLs, uploads, migration push or business regression.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  read,
  quote,
  withIsolatedMedia,
} from './lib/isolated-family-media.mjs';

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(manifest.project_ref, 'tknaobmlwmodsqtpqwkr');
assert.equal(manifest.version, '20261124125009');
const migrationPath =
  'supabase/migrations/20261124125009_family_media_storage_probe_rollback.sql';
const original = read(migrationPath);
const digest = (s) => createHash('sha256').update(s).digest('hex');
assert.equal(digest(original), manifest.migration_sha256);
assert.equal(
  manifest.migration_sha256,
  'd87028d2a3e89ff37a94bc6b5a6a862d3c8d34bea3895914e62cc347c5fafe17',
);
const productionFile = readFileSync(manifest.sql_file, 'utf8');
assert.ok(
  productionFile.includes(
    `array[$p1_original_source$${original}$p1_original_source$]`,
  ),
  'History embeds the unchanged original file',
);
assert.equal(
  productionFile.split('insert into supabase_migrations.schema_migrations')
    .length - 1,
  1,
);
const expectedFunctions = [
  ...original.matchAll(/create(?: or replace)? function private\.(\w+)\(/gu),
].map((m) => {
  const start = original.indexOf('as $$', m.index) + 5;
  const end = original.indexOf('$$;', start);
  return {
    name: m[1],
    hash: digest(original.slice(start, end).replace(/^ +| +$/gu, '')),
  };
});

await withIsolatedMedia(
  async ({ query, database, docker, dbContainer }) => {
    assert.ok(database.startsWith('homeypaw_media_verify_'));
    for (const file of [
      '20261023044929_family_billing_auth_identity.sql',
      '20261023045414_family_billing_release_contract.sql',
    ])
      query(read(`supabase/migrations/${file}`));
    query('insert into private.family_billing_config(singleton) values(true);');
    for (const file of [
      '20261023055340_family_media_capacity_enforcement.sql',
      '20261023074855_family_media_transition_fifteen_days.sql',
      '20261024114459_family_media_capacity_release_readiness.sql',
    ])
      query(read(`supabase/migrations/${file}`));
    query(`update private.family_billing_config set enabled=true,environment='PRODUCTION',release_ready=true;
    update private.family_media_quota_policy set storage_enforcement_enabled=true;
    create schema if not exists cron;
    create table if not exists cron.job(jobid bigint primary key,jobname text,active boolean,schedule text,command text);
    insert into cron.job(jobid,jobname,active,schedule,command)
    values(3,'isolated-recovery-metadata-only',false,'* * * * *','select 1');`);
    const files = readdirSync(
      new URL('../supabase/migrations/', import.meta.url),
    )
      .filter(
        (f) => /^\d+_.*\.sql$/u.test(f) && f.slice(0, 14) <= '20261104135554',
      )
      .sort();
    assert.equal(files.length, 59);
    assert.equal(
      query('select count(*) from supabase_migrations.schema_migrations;'),
      '0',
    );
    query(
      `insert into supabase_migrations.schema_migrations(version,name,statements) values ${files
        .map((f) => {
          const version = f.slice(0, 14),
            name = f.slice(15, -4);
          return `(${quote(version)},${quote(name)},array['isolated baseline metadata'])`;
        })
        .join(',')};`,
    );
    const baseline = JSON.parse(
      query(`select json_build_object(
    'history',(select md5(string_agg(row(version,name,statements)::text,',' order by version)) from supabase_migrations.schema_migrations),
    'cron',(select md5(string_agg(to_jsonb(j)::text,',' order by jobid)) from cron.job j));`),
    );
    // Only these three environment bindings differ. Every statement, guard,
    // Migration byte and History registration is executed, with ON_ERROR_STOP.
    const bindings = [
      [
        "current_database()<>'postgres'",
        `current_database()<>${quote(database)}`,
      ],
      [manifest.history_fingerprint, baseline.history],
      [manifest.cron_fingerprint, baseline.cron],
    ];
    let fixtureFile = productionFile;
    for (const [from, to] of bindings) {
      assert.ok(from && to && fixtureFile.includes(from));
      fixtureFile = fixtureFile.replaceAll(from, to);
    }
    let restored = fixtureFile;
    for (const [from, to] of [...bindings].reverse())
      restored = restored.replaceAll(to, from);
    assert.equal(
      restored,
      productionFile,
      'no test-only omission or SQL bypass',
    );
    const temp = mkdtempSync(join(tmpdir(), 'p1-full-installer-'));
    const localFile = join(temp, 'complete-deployment.sql');
    const containerFile = `/tmp/p1-full-installer-${randomUUID()}.sql`;
    writeFileSync(localFile, fixtureFile, { mode: 0o600 });
    chmodSync(localFile, 0o600);
    const executeFile = () =>
      docker([
        'exec',
        dbContainer,
        'psql',
        '-U',
        'postgres',
        '-d',
        database,
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        containerFile,
      ]);
    const state = () =>
      query(`select json_build_object(
    'count',(select count(*) from supabase_migrations.schema_migrations),
    'history',(select md5(string_agg(row(version,name,statements)::text,',' order by version)) from supabase_migrations.schema_migrations),
    'old_capacity',(select encode(sha256(convert_to(btrim(prosrc),'UTF8')),'hex') from pg_proc where oid='private.enforce_family_media_capacity()'::regprocedure),
    'guard_table',to_regclass('private.family_media_storage_probe_guards') is not null,
    'guard_function',to_regprocedure('private.require_family_media_storage_probe_rollback()') is not null);`);
    try {
      docker(['cp', localFile, `${dbContainer}:${containerFile}`]);
      const before = state();
      // Fail the actual History INSERT after the actual DDL and postchecks.
      query(`alter table supabase_migrations.schema_migrations add constraint p1_injected_history_failure
      check(version<>'20261124125009');`);
      assert.throws(
        executeFile,
        (e) =>
          /ERROR:[\s\S]*violates check constraint "p1_injected_history_failure"/u.test(
            e.stderr,
          ),
        'must reach the injected failure, not fail earlier on wrapper syntax',
      );
      assert.equal(
        state(),
        before,
        'all DDL/function/History changes roll back on the same connection closing',
      );
      query(
        'alter table supabase_migrations.schema_migrations drop constraint p1_injected_history_failure;',
      );
      console.log(
        'PASS: full SQL file reaches History insertion; injected failure rolls back all DDL and old function remains unchanged.',
      );
      const out = executeFile();
      assert.ok(out.includes('"committed": true'));
      assert.equal(
        query('select count(*) from supabase_migrations.schema_migrations;'),
        '60',
      );
      assert.equal(
        query(
          `select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version='20261124125009';`,
        ),
        manifest.migration_sha256,
      );
      assert.equal(
        query(
          `select md5(string_agg(row(version,name,statements)::text,',' order by version)) from supabase_migrations.schema_migrations where version<>'20261124125009';`,
        ),
        baseline.history,
      );
      for (const f of expectedFunctions)
        assert.equal(
          query(
            `select encode(sha256(convert_to(btrim(prosrc),'UTF8')),'hex') from pg_proc where oid=${quote(`private.${f.name}()`)}::regprocedure;`,
          ),
          f.hash,
        );
      assert.equal(
        query(
          `select tgdeferrable and tginitdeferred and tgenabled='O' from pg_trigger where tgname='family_media_storage_probe_rollback';`,
        ),
        't',
      );
      assert.equal(
        query(
          'select count(*) from private.family_media_storage_probe_guards;',
        ),
        '0',
      );
      const installed = state();
      assert.throws(executeFile, (e) =>
        /ERROR:[\s\S]*P1_PRODUCTION_BASELINE_CHANGED/u.test(e.stderr),
      );
      assert.equal(
        state(),
        installed,
        'replay rejection makes no additional change',
      );
      assert.equal(
        digest(readFileSync(manifest.sql_file, 'utf8')),
        digest(productionFile),
      );
      console.log(
        `PASS: full SQL commits History 59 -> 60, original source hash, both function bodies, deferred guard/ACL checks and unchanged old history; only target version installed; replay rejected. Production file SHA-256 ${digest(productionFile)}`,
      );
    } finally {
      docker(['exec', dbContainer, 'rm', '-f', '--', containerFile]);
      rmSync(temp, { recursive: true, force: true });
    }
  },
  {
    migration:
      'supabase/migrations/20261014104554_family_storage_quota_prototype.sql',
  },
);

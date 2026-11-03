// Synthetic local checks only. Optional SQL uses a new, network-isolated cluster.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import {
  productionRecoverySql,
  productionRef,
} from './prepare-production-recovery.mjs';
import { assessFreeUsage } from './check-production-free-usage.mjs';

for (const op of ['install', 'enable', 'disable', 'health']) {
  const sql = productionRecoverySql(op, productionRef);
  assert.doesNotMatch(
    sql,
    /__PRODUCTION_GUARD__|cron\.unschedule|vault\.create_secret/,
  );
  assert.doesNotMatch(
    sql,
    /update\s+private\.(?:family_billing_config|family_media_quota_policy|pre_cutover_release_lock)/i,
  );
  assert.throws(() => productionRecoverySql(op, 'yhxxsawcaffxonpconaq'));
}
assert.throws(() => productionRecoverySql('arbitrary SQL', productionRef));
assert.match(productionRecoverySql('install', productionRef), /active:=false/);
assert.match(
  productionRecoverySql('health', productionRef),
  /^begin read only;/,
);
assert.doesNotMatch(
  productionRecoverySql('disable', productionRef),
  /vault\.decrypted_secrets/,
);

const now = Date.parse('2026-11-03T08:00:00Z');
const usage = {
  projectRef: productionRef,
  plan: 'free',
  verified: true,
  observedAt: '2026-11-03T08:00:00Z',
  cycleStartedAt: '2026-10-22T00:00:00Z',
  cycleEndsAt: '2026-11-22T00:00:00Z',
  usage: {
    databaseBytes: 120_000_000,
    organizationDatabaseBytes: 160_000_000,
    diskUsedBytes: 300_000_000,
    storageBytes: 540_000_000,
    egressBytes: 210_000_000,
    cachedEgressBytes: 43_000_000,
    mau: 8,
    functionInvocations: 21_000,
    realtimeMessages: 14,
    realtimePeakConnections: 5,
  },
};
assert.equal(assessFreeUsage(usage, now).status, 'OK');
for (const [bytes, status] of [
  [700_000_000, 'WARN'],
  [850_000_000, 'UPGRADE_NOW'],
  [950_000_000, 'CRITICAL'],
]) {
  assert.equal(
    assessFreeUsage(
      { ...usage, usage: { ...usage.usage, storageBytes: bytes } },
      now,
    ).status,
    status,
  );
}
assert.equal(
  assessFreeUsage(
    { ...usage, usage: { ...usage.usage, egressBytes: 3_000_000_000 } },
    now,
  ).status,
  'UPGRADE_NOW',
  'Projected exhaustion before period end needs action',
);
for (const change of [
  { projectRef: 'yhxxsawcaffxonpconaq' },
  { verified: false },
  { plan: 'pro' },
  { observedAt: '2026-11-01T08:00:00Z' },
  { observedAt: '2026-11-04T08:00:00Z' },
  { usage: { ...usage.usage, storageBytes: undefined } },
  { usage: { ...usage.usage, egressBytes: -1 } },
])
  assert.throws(() => assessFreeUsage({ ...usage, ...change }, now));
assert.throws(
  () =>
    assessFreeUsage(
      JSON.parse(
        readFileSync(
          new URL(
            '../supabase/production-free-usage.example.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      now,
    ),
  'Illustrative snapshot never becomes real monitoring evidence',
);
console.log(
  'PASS (offline): explicit Production target; disabled install; safe control SQL; no business switch writes; stale/missing metric refusal; thresholds and forecast. No collector or automatic alert installed.',
);

const options = process.argv.slice(2);
assert.ok(
  options.length === 0 ||
    (options.length === 1 && options[0] === '--isolated-sql'),
);
if (options.length) {
  const container = `homeypaw-production-ops-${randomUUID().slice(0, 8)}`;
  const image = 'public.ecr.aws/supabase/postgres:17.11.0.003';
  const run = (args, input = '') =>
    spawnSync('docker', args, {
      input,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    });
  const query = (sql, ok = true) => {
    const r = run(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-h',
        '/tmp',
        '-X',
        '-qAt',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      sql,
    );
    if (ok) assert.equal(r.status, 0, r.stderr);
    else assert.notEqual(r.status, 0, 'Expected SQL rejection');
    return ok ? r.stdout.trim() : r.stderr;
  };
  let created = false;
  try {
    const r = run([
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--network',
      'none',
      '--name',
      container,
      '--user',
      'postgres',
      '--entrypoint',
      '/bin/sh',
      image,
      '-c',
      'initdb -D /tmp/homeypaw-ops-db -A trust -U postgres --no-locale >/dev/null && exec postgres -D /tmp/homeypaw-ops-db -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron,pg_net -c cron.database_name=postgres -c cron.launch_active_jobs=off',
    ]);
    assert.equal(r.status, 0, r.stderr);
    created = true;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (
        run(['exec', container, 'pg_isready', '-h', '/tmp', '-U', 'postgres'])
          .status === 0
      ) {
        ready = true;
        break;
      }
      await setTimeout(250);
    }
    assert.ok(ready, 'Disposable cluster starts');
    assert.equal(
      JSON.parse(
        run([
          'inspect',
          container,
          '--format',
          '{{json .HostConfig.NetworkMode}}',
        ]).stdout,
      ),
      'none',
    );
    const versions = readdirSync(
      new URL('../supabase/migrations/', import.meta.url),
    )
      .filter((x) => x.endsWith('.sql'))
      .map((x) => x.split('_')[0]);
    assert.equal(versions.length, 58);
    query(`create role anon; create role authenticated; create role service_role;
      create extension pg_cron; create extension pg_net; create extension supabase_vault;
      create schema private; create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key);
      insert into supabase_migrations.schema_migrations values ${versions.map((v) => `('${v}')`).join(',')};
      create table private.family_billing_config(singleton boolean,enabled boolean,release_ready boolean,environment text,rc_project_id text,rc_app_id text,rc_entitlement_id text,monthly_product_id text,yearly_product_id text);
      insert into private.family_billing_config values(true,false,false,'PRODUCTION','synthetic-project','synthetic-app','synthetic-entitlement','homeypaw.familyplus.monthly','homeypaw.familyplus.yearly');
      create table private.family_media_quota_policy(singleton boolean,storage_enforcement_enabled boolean);
      insert into private.family_media_quota_policy values(true,false);
      create table private.pre_cutover_release_lock(singleton boolean,enabled boolean);
      insert into private.pre_cutover_release_lock values(true,false);
      create function public.get_family_billing_recovery_health() returns jsonb language sql as $$select '{"attention_required":false}'::jsonb$$;
      create function public.get_family_billing_reconciliation_work(integer) returns uuid[] language sql as $$select '{}'::uuid[]$$;
      create function public.finish_family_billing_recovery(uuid,bigint,text,text) returns void language plpgsql as $$begin return;end$$;
      -- Synthetic Vault view and HTTP transport: never touch real secrets/network.
      create table private.fixture_vault(name text,decrypted_secret text);
      insert into private.fixture_vault values
      ('homeypaw_production_billing_recovery_url','https://${productionRef}.supabase.co/functions/v1/family-billing-reconcile'),
      ('homeypaw_production_billing_recovery_authorization','Bearer synthetic-internal-recovery-bearer-000000');
      create or replace view vault.decrypted_secrets as select null::uuid id,name,null::text description,
        decrypted_secret as secret,decrypted_secret collate "C" as decrypted_secret,null::uuid key_id,null::bytea nonce,now() created_at,now() updated_at
        from private.fixture_vault;
      create sequence private.fixture_http;
      create or replace function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds integer default 5000)
      returns bigint language plpgsql as $$ begin
        if url<>'https://${productionRef}.supabase.co/functions/v1/family-billing-reconcile'
          or headers->>'Authorization'<>'Bearer synthetic-internal-recovery-bearer-000000'
          or body<>'{}'::jsonb or timeout_milliseconds<>90000 then raise exception 'FIXTURE_HTTP_DENIED'; end if;
        return nextval('private.fixture_http'); end $$;`);
    const install = productionRecoverySql('install', productionRef);
    assert.match(
      query('set role authenticated;\n' + install, false),
      /ADMIN_DENIED/,
    );
    query("update private.family_billing_config set environment='SANDBOX';");
    assert.match(query(install, false), /DATABASE_DENIED/);
    query(
      "update private.family_billing_config set environment='PRODUCTION'; update private.fixture_vault set decrypted_secret='https://wrong.invalid' where name like '%_url';",
    );
    assert.match(query(install, false), /VAULT_DENIED/);
    query(
      `update private.fixture_vault set decrypted_secret='https://${productionRef}.supabase.co/functions/v1/family-billing-reconcile' where name like '%_url';`,
    );
    // Force a failure after CREATE TABLE/FUNCTION to prove the installer rolls back.
    const failLate = install.replace(
      'perform cron.alter_job(installed_job,active:=false);',
      "raise exception 'FIXTURE_LATE_FAILURE';",
    );
    assert.match(query(failLate, false), /FIXTURE_LATE_FAILURE/);
    assert.equal(
      query(
        "select to_regclass('private.production_billing_recovery_dispatches') is null and to_regprocedure('private.enqueue_production_family_billing_recovery()') is null and not exists(select 1 from cron.job where jobname='homeypaw-production-billing-recovery');",
      ),
      't',
    );
    query(install);
    assert.equal(
      query(
        "select active from cron.job where jobname='homeypaw-production-billing-recovery';",
      ),
      'f',
    );
    assert.match(query(install, false), /ALREADY_EXISTS/);
    assert.equal(
      query(
        'select private.enqueue_production_family_billing_recovery() is null;',
      ),
      't',
      'Billing OFF never enqueues',
    );
    assert.match(
      query(productionRecoverySql('enable', productionRef), false),
      /LIFECYCLE_NOT_READY/,
    );
    query('update private.family_billing_config set enabled=true;');
    query(
      'grant execute on function private.enqueue_production_family_billing_recovery() to authenticated;',
    );
    assert.match(
      query(productionRecoverySql('enable', productionRef), false),
      /PRIVATE_ACL_DENIED/,
    );
    query(
      'revoke execute on function private.enqueue_production_family_billing_recovery() from authenticated;',
    );
    query(productionRecoverySql('enable', productionRef));
    query(
      'set role authenticated; select private.enqueue_production_family_billing_recovery();',
      false,
    );
    assert.equal(
      query('select private.enqueue_production_family_billing_recovery();'),
      '1',
    );
    assert.equal(
      query(
        'select private.enqueue_production_family_billing_recovery() is null;',
      ),
      't',
      'Outstanding invocation suppresses duplicate dispatch',
    );
    query(
      'insert into net._http_response(id,status_code,timed_out,created) values(1,200,false,now());',
    );
    let health = JSON.parse(
      query(productionRecoverySql('health', productionRef)),
    );
    assert.equal(health.last_http_status, 200);
    assert.equal(health.http_failures_1h, 0);
    assert.equal(
      query('select private.enqueue_production_family_billing_recovery();'),
      '2',
    );
    query(
      'insert into net._http_response(id,status_code,timed_out,created) values(2,503,false,now());',
    );
    health = JSON.parse(query(productionRecoverySql('health', productionRef)));
    assert.equal(
      health.http_failures_1h,
      1,
      'HTTP failure cannot be hidden by enqueue success',
    );
    query(
      "update private.fixture_vault set decrypted_secret='invalid' where name like '%_authorization';",
    );
    query(productionRecoverySql('disable', productionRef));
    assert.equal(
      query(
        "select active from cron.job where jobname='homeypaw-production-billing-recovery';",
      ),
      'f',
      'Disable works with broken Vault',
    );
    assert.equal(
      query(
        'select not release_ready and enabled and not (select storage_enforcement_enabled from private.family_media_quota_policy) and not (select enabled from private.pre_cutover_release_lock) from private.family_billing_config;',
      ),
      't',
      'Business gates and ordinary writes preserved',
    );
    assert.equal(
      query('select count(*) from supabase_migrations.schema_migrations;'),
      '58',
    );
    console.log(
      'PASS (isolated SQL, synthetic Vault/HTTP): atomic rollback; wrong environment/endpoint rejected; disabled install; private ACL; source validation; bounded dispatch; correlated HTTP health; safe disable; 58 History rows and business gates unchanged. No cloud/StoreKit/Cron rehearsal.',
    );
  } finally {
    if (created) {
      const stopped = run(['rm', '--force', container]);
      assert.equal(stopped.status, 0, 'Disposable test container cleanup');
    }
  }
}

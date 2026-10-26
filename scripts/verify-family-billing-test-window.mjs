import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { withIsolatedMedia, read } from './lib/isolated-family-media.mjs';
import { scopeBillingTestUserRuntime } from '../supabase/functions/_shared/family-billing-sandbox.mjs';

const migration = '20261025143824_family_billing_test_window_guards.sql';
const calls = [];
const runtime = {
  url: 'https://yhxxsawcaffxonpconaq.supabase.co',
  rpc: async (name, args) => calls.push({ name, args }),
};
await scopeBillingTestUserRuntime(runtime, 'verified-user').rpc(
  'start_family_billing_refresh',
  { target_customer_id: 'payer' },
);
assert.deepEqual(calls, [
  {
    name: 'execute_family_billing_test_user_operation',
    args: {
      actor_user_id: 'verified-user',
      operation: 'start_family_billing_refresh',
      arguments: { target_customer_id: 'payer' },
    },
  },
]);
const production = {
  ...runtime,
  url: 'https://tknaobmlwmodsqtpqwkr.supabase.co',
};
assert.equal(scopeBillingTestUserRuntime(production, 'user'), production);
assert.equal(calls.length, 1, 'Trusted runtime is not mutated or invoked.');
const edge = read('supabase/functions/family-billing-reconcile/index.ts');
assert.match(edge, /scopeBillingTestUserRuntime\(runtime, user\.user\.id\)/u);
assert.match(edge, /runBillingRecovery\(runtime\)/u);
console.log(
  'PASS: Sandbox user RPCs are scoped to the verified Auth user; Production and trusted Recovery runtime remain unchanged.',
);

await withIsolatedMedia(async ({ query, auth, id, database, dbContainer }) => {
  query(
    'insert into private.family_billing_config(singleton) values(true);insert into private.family_media_quota_policy(singleton) values(true);',
  );
  for (const name of [
    '20261023044929_family_billing_auth_identity.sql',
    '20261023045414_family_billing_release_contract.sql',
    '20261023055340_family_media_capacity_enforcement.sql',
    '20261023074855_family_media_transition_fifteen_days.sql',
    '20261024114459_family_media_capacity_release_readiness.sql',
    '20261024123640_family_billing_test_account_access.sql',
    '20261025001522_family_billing_recovery_operations.sql',
  ])
    query(read('supabase/migrations/' + name));
  const contract = () =>
    query(`select jsonb_agg(jsonb_build_array(proname,pg_get_userbyid(proowner),proacl,prosecdef,proconfig) order by proname)
    from pg_proc where oid in('public.get_family_billing_customer()'::regprocedure,'public.begin_family_billing_purchase(uuid,uuid,text)'::regprocedure,'public.update_family_billing_intent(uuid,text)'::regprocedure);`);
  const trusted = () =>
    query(`select jsonb_agg(md5(pg_get_functiondef(oid)) order by proname) from pg_proc
    where proname in('receive_family_billing_webhook','apply_family_billing_snapshot','start_family_billing_refresh','finish_family_billing_recovery');`);
  const before = contract(),
    trustedBefore = trusted();
  query(read('supabase/sandbox-migrations/' + migration));
  assert.equal(contract(), before);
  assert.equal(trusted(), trustedBefore);
  query(`update public.app_release_policy set enforce_mutation_gate=false;
    update private.family_billing_config set enabled=true,environment='SANDBOX',rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';`);
  const admission = (
    end = "clock_timestamp()+interval '1 minute'",
    start = "clock_timestamp()-interval '1 minute'",
  ) =>
    query(`
    insert into private.family_billing_test_accounts(user_id,family_id,enabled,approved_at,expires_at)
    values(public.rv2_id('owner'),public.rv2_id('family'),true,${start},${end})
    on conflict(user_id) do update set enabled=true,family_id=excluded.family_id,approved_at=excluded.approved_at,expires_at=excluded.expires_at;`);
  const expired = () => admission("clock_timestamp()-interval '1 second'");
  const service = (sql) =>
    query(
      `begin;set local role service_role;set local request.jwt.claim.role='service_role';${sql}commit;`,
    );
  const op = (name, args = {}, actor = 'owner') =>
    service(
      `select public.execute_family_billing_test_user_operation(public.rv2_id('${actor}'),'${name}','${JSON.stringify(args)}'::jsonb);`,
    );
  const maintenance = (sql) =>
    query(
      `set homeypaw.pre_cutover_migration_bypass='off';set request.jwt.claim.role='';set request.jwt.claim.sub='';set request.jwt.claims='';set request.headers='';${sql}`,
    );
  const closeSql = () =>
    `select private.close_expired_family_billing_test_window(user_id,approved_at,expires_at) from private.family_billing_test_accounts where user_id=public.rv2_id('owner');`;
  const state = () =>
    query(
      `select jsonb_build_array((select enabled from private.family_billing_config),(select enabled from private.pre_cutover_release_lock),(select enabled from private.family_billing_test_accounts where user_id=public.rv2_id('owner')));`,
    );
  const denied = (fn) => assert.throws(fn, /BILLING_TEST_ACCESS_DENIED/u);
  denied(() => auth('owner', 'select public.get_family_billing_customer();'));
  admission();
  assert.ok(
    auth('owner', 'select public.get_family_billing_customer();').endsWith(
      id('owner'),
    ),
  );
  for (const actor of ['member', 'viewer', 'removed', 'stranger'])
    denied(() => auth(actor, 'select public.get_family_billing_customer();'));
  // An admission alone must not turn a read-only or Member role into Owner.
  for (const actor of ['member', 'viewer']) {
    query(`insert into private.family_billing_test_accounts(user_id,family_id,enabled,approved_at,expires_at)
      values(public.rv2_id('${actor}'),public.rv2_id('family'),true,clock_timestamp(),clock_timestamp()+interval '1 minute');`);
    denied(() => auth(actor, 'select public.get_family_billing_customer();'));
    query(
      `delete from private.family_billing_test_accounts where user_id=public.rv2_id('${actor}');`,
    );
  }
  denied(() =>
    auth(
      'owner',
      "select public.begin_family_billing_purchase(public.rv2_id('other'),public.rv2_id('request'),'monthly');",
    ),
  );
  query(
    `insert into private.family_billing_intents(id,family_id,customer_id,product_id) values(public.rv2_id('intent'),public.rv2_id('family'),public.rv2_id('owner'),'sandbox.monthly');`,
  );
  auth(
    'owner',
    "select public.update_family_billing_intent(public.rv2_id('intent'),'failed');",
  );
  for (const mutation of [
    'update private.family_billing_test_accounts set enabled=false;',
    "update private.family_billing_test_accounts set approved_at=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()+interval '2 minutes';",
    "update private.family_billing_test_accounts set expires_at=approved_at+interval '91 minutes';",
    "update private.family_billing_test_accounts set family_id=public.rv2_id('other');",
  ]) {
    query(mutation);
    denied(() => auth('owner', 'select public.get_family_billing_customer();'));
    admission();
  }
  expired();
  denied(() => auth('owner', 'select public.get_family_billing_customer();'));
  denied(() =>
    auth(
      'owner',
      "select public.begin_family_billing_purchase(public.rv2_id('family'),public.rv2_id('request'),'monthly');",
    ),
  );
  denied(() =>
    auth(
      'owner',
      "select public.update_family_billing_intent(public.rv2_id('intent'),'cancelled');",
    ),
  );
  denied(() =>
    op('start_family_billing_refresh', { target_customer_id: id('owner') }),
  );
  assert.equal(
    query(
      "select status from private.family_billing_intents where id=public.rv2_id('intent');",
    ),
    'failed',
  );
  admission();
  denied(() =>
    op('get_family_billing_purchase_preflight_context', {
      target_user_id: id('stranger'),
    }),
  );
  denied(() =>
    op('finish_family_billing_purchase_preflight', {
      target_user_id: id('owner'),
      target_family_id: id('other'),
    }),
  );
  assert.throws(() => op('arbitrary_sql'), /BILLING_TEST_OPERATION_DENIED/u);
  assert.throws(
    () =>
      auth(
        'owner',
        "select public.execute_family_billing_test_user_operation(auth.uid(),'start_family_billing_refresh','{}');",
      ),
    /permission denied/u,
  );
  assert.equal(
    Number(
      op('start_family_billing_refresh', { target_customer_id: id('owner') }),
    ),
    1,
  );
  expired();
  assert.equal(
    Number(
      service(
        "select public.start_family_billing_refresh(public.rv2_id('owner'));",
      ),
    ),
    2,
    'Trusted Recovery still works without a user admission.',
  );
  service(
    "select public.finish_family_billing_recovery(public.rv2_id('owner'),2,'empty');",
  );
  service(
    "select public.receive_family_billing_webhook(jsonb_build_object('id','trusted-window-fixture','environment','SANDBOX','app_id','app_fixture','app_user_id',public.rv2_id('owner')::text,'type','RENEWAL','event_timestamp_ms',1),repeat('a',64));",
  );
  console.log(
    'PASS: direct user RPCs, preflight and refresh reject expired/disabled/future/overlong/wrong-Family/non-Owner access; trusted provider/Recovery RPCs and ACLs are preserved.',
  );

  // Expire while the existing operation is in progress: post-check rolls it back.
  const original = query(
    "select pg_get_functiondef('private.test_window_original_get_family_billing_customer()'::regprocedure);",
  );
  query(`create or replace function private.test_window_original_get_family_billing_customer() returns uuid language plpgsql security definer set search_path='' as $$ begin
    perform pg_sleep(0.3);update private.family_billing_customers set refresh_generation=999 where id=auth.uid();return auth.uid();end;$$;`);
  admission("clock_timestamp()+interval '150 milliseconds'");
  denied(() => auth('owner', 'select public.get_family_billing_customer();'));
  assert.equal(
    query(
      "select refresh_generation from private.family_billing_customers where id=public.rv2_id('owner');",
    ),
    '2',
  );
  query(original);

  async function holder(sql, seconds) {
    const child = spawn('docker', [
      'exec',
      '-i',
      dbContainer,
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-X',
      '-q',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ]);
    const exited = once(child, 'exit');
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        if (data.toString().includes('WINDOW_LOCK_HELD')) resolve();
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) reject(new Error('lock holder failed'));
      });
    });
    child.stdin.end(
      `begin;${sql}select 'WINDOW_LOCK_HELD';select pg_sleep(${seconds});commit;`,
    );
    await ready;
    return { exited };
  }
  admission("clock_timestamp()+interval '250 milliseconds'");
  const lock = await holder(
    'select 1 from private.family_billing_test_accounts for update;',
    0.5,
  );
  denied(() => auth('owner', 'select public.get_family_billing_customer();'));
  await lock.exited;
  assert.equal(maintenance(closeSql()), 't');
  assert.deepEqual(JSON.parse(state()), [false, true, false]);
  assert.equal(maintenance(closeSql()), 't', 'Close is idempotent.');

  query(
    'update private.pre_cutover_release_lock set enabled=false;update private.family_billing_config set enabled=true;',
  );
  admission();
  assert.equal(maintenance(closeSql()), 'f', 'Before deadline must not close.');
  expired();
  query('update private.pre_cutover_release_lock set enabled=true;');
  const failureBefore = state();
  query(`create function private.window_failure_fixture() returns trigger language plpgsql as $$begin raise exception 'WINDOW_FAILURE_FIXTURE';end;$$;
    create trigger window_failure_fixture before update on private.family_billing_config for each row execute function private.window_failure_fixture();`);
  assert.throws(() => maintenance(closeSql()), /WINDOW_FAILURE_FIXTURE/u);
  assert.equal(
    state(),
    failureBefore,
    'Failed close rolls back the internal unlock.',
  );
  query(
    'drop trigger window_failure_fixture on private.family_billing_config;drop function private.window_failure_fixture();',
  );
  const closingLock = await holder(
    'select 1 from private.pre_cutover_release_lock for update;',
    1.2,
  );
  assert.throws(() => maintenance(closeSql()), /lock timeout/u);
  assert.equal(state(), failureBefore);
  await closingLock.exited;
  assert.equal(maintenance(closeSql()), 't');
  assert.deepEqual(JSON.parse(state()), [false, true, false]);
  query('update private.pre_cutover_release_lock set enabled=false;');
  admission();
  assert.equal(
    maintenance(
      `select private.close_expired_family_billing_test_window(user_id,approved_at-interval '1 second',expires_at) from private.family_billing_test_accounts;`,
    ),
    't',
  );
  assert.equal(
    query('select enabled from private.family_billing_test_accounts;'),
    't',
    'Old job cannot revoke a replacement admission.',
  );
  console.log(
    'PASS: deadline checked after waits and delegated writes; atomic cleanup from Lock ON, early no-op, idempotency, stale-job isolation, injected rollback and bounded lock timeout/retry.',
  );
  // SQL-only scheduler fixture: actual pg_cron execution is verified separately
  // in the explicitly authorized Sandbox, never claimed from this stub.
  query(`create schema cron;
    create table cron.job(jobid bigint generated always as identity,jobname text,command text,schedule text,active boolean default true,username text default session_user,database text default current_database());
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid;$$;
    create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1;$$;`);
  admission("clock_timestamp()+interval '2 seconds'");
  const job = maintenance(
    "select private.schedule_family_billing_test_window_close(public.rv2_id('owner'));",
  );
  assert.equal(
    maintenance(
      "select private.schedule_family_billing_test_window_close(public.rv2_id('owner'));",
    ),
    job,
  );
  const command = query('select command from cron.job;');
  maintenance(command);
  assert.equal(query('select active from cron.job;'), 't');
  await new Promise((resolve) => setTimeout(resolve, 2100));
  maintenance(command);
  assert.equal(query('select active from cron.job;'), 'f');
  assert.deepEqual(JSON.parse(state()), [false, true, false]);
  console.log(
    'PASS (synthetic scheduler): installation is idempotent; generated SQL keeps an early job active, closes at deadline and disables only its own job.',
  );
});

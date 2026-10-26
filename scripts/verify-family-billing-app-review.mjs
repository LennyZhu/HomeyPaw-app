import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import {
  withIsolatedMedia,
  read,
  quote,
} from './lib/isolated-family-media.mjs';
import {
  createBillingWebhookHandler,
  scopeBillingTestUserRuntime,
} from '../supabase/functions/_shared/family-billing-sandbox.mjs';

const migration = '20261026051034_family_billing_app_review_access.sql';
assert.ok(!readdirSync('supabase/migrations').includes(migration));
const runtime = {
  url: 'https://yhxxsawcaffxonpconaq.supabase.co',
  rpc: async (operation, arguments_) => ({ operation, arguments_ }),
};
assert.equal(
  (
    await scopeBillingTestUserRuntime(runtime, 'verified-user').rpc(
      'start_family_billing_refresh',
    )
  ).operation,
  'execute_family_billing_test_user_operation',
);
const production = {
  ...runtime,
  url: 'https://tknaobmlwmodsqtpqwkr.supabase.co',
};
assert.equal(
  scopeBillingTestUserRuntime(production, 'verified-user'),
  production,
);
let providerWrites = 0;
const webhook = createBillingWebhookHandler({
  webhookSecret: 'review-test-fixture-authorization-value',
  rpc: async (name) => {
    if (name === 'get_family_billing_server_context')
      return { config: { environment: 'SANDBOX', rc_app_id: 'app_fixture' } };
    providerWrites++;
    assert.fail('Wrong-environment event must never write.');
  },
});
const event = {
  id: 'wrong-environment-fixture',
  event_timestamp_ms: 1,
  app_id: 'app_fixture',
  environment: 'PRODUCTION',
};
assert.equal(
  (
    await webhook(
      new Request('https://fixture.invalid', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer review-test-fixture-authorization-value',
        },
        body: JSON.stringify({ event }),
      }),
    )
  ).status,
  403,
);
assert.equal(providerWrites, 0);

await withIsolatedMedia(async ({ query, auth, id, database, dbContainer }) => {
  query(
    'insert into private.family_billing_config(singleton) values(true);insert into private.family_media_quota_policy(singleton) values(true);',
  );
  for (const file of [
    '20261023044929_family_billing_auth_identity.sql',
    '20261023045414_family_billing_release_contract.sql',
    '20261023055340_family_media_capacity_enforcement.sql',
    '20261023074855_family_media_transition_fifteen_days.sql',
    '20261024114459_family_media_capacity_release_readiness.sql',
    '20261024123640_family_billing_test_account_access.sql',
    '20261025001522_family_billing_recovery_operations.sql',
  ])
    query(read('supabase/migrations/' + file));
  query(
    read(
      'supabase/sandbox-migrations/20261025143824_family_billing_test_window_guards.sql',
    ),
  );
  const trusted = () =>
    query(`select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl,p.proowner,p.prosecdef,p.proconfig) order by p.oid)
    from pg_proc p where p.oid in ('public.receive_family_billing_webhook(jsonb,text)'::regprocedure,
      'public.apply_family_billing_snapshot(uuid,bigint,jsonb,text)'::regprocedure,
      'public.start_family_billing_refresh(uuid)'::regprocedure,
      'public.finish_family_billing_recovery(uuid,bigint,text,text)'::regprocedure,
      'private.close_expired_family_billing_test_window(uuid,timestamptz,timestamptz)'::regprocedure,
      'private.schedule_family_billing_test_window_close(uuid)'::regprocedure);`);
  const contracts = () =>
    query(`select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proacl,p.proowner,p.prosecdef,p.provolatile,p.proconfig) order by p.oid)
    from pg_proc p where p.oid in('public.get_family_billing_customer()'::regprocedure,
      'public.begin_family_billing_purchase(uuid,uuid,text)'::regprocedure,'public.update_family_billing_intent(uuid,text)'::regprocedure,
      'public.get_family_plus_summary(uuid)'::regprocedure,'public.get_family_billing_state(uuid)'::regprocedure,
      'public.get_family_billing_test_access()'::regprocedure);`);
  const policies = () =>
    query(
      'select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p;',
    );
  const beforePolicies = policies();
  const beforeTrusted = trusted(),
    beforeContracts = contracts();
  query("update private.family_billing_config set environment='PRODUCTION';");
  assert.throws(
    () => query(read('supabase/sandbox-migrations/' + migration)),
    /BILLING_REVIEW_SANDBOX_REQUIRED/u,
  );
  assert.equal(
    query(
      "select exists(select 1 from information_schema.columns where table_schema='private' and table_name='family_billing_test_accounts' and column_name='admission_kind');",
    ),
    'f',
  );
  query("update private.family_billing_config set environment='SANDBOX';");
  query(read('supabase/sandbox-migrations/' + migration));
  assert.equal(trusted(), beforeTrusted);
  assert.equal(contracts(), beforeContracts);
  assert.equal(
    query('select count(*) from private.family_billing_test_accounts;'),
    '0',
  );
  assert.equal(
    query('select enabled from private.family_billing_config;'),
    'f',
  );
  assert.equal(
    query(
      'select storage_enforcement_enabled from private.family_media_quota_policy;',
    ),
    'f',
  );
  query(`update public.app_release_policy set enforce_mutation_gate=false;
    update private.family_billing_config set rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';
    create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,command text,schedule text,active boolean default true,username text default current_user,database text default current_database());
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid;$$;
    create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1;$$;
    insert into cron.job(jobname,schedule,command,active) values('homeypaw-billing-recovery','* * * * *','select 1;',false);
    update private.pre_cutover_release_lock set enabled=true;`);
  const maint = (sql) =>
    query(
      `set request.jwt.claim.role='';set request.jwt.claim.sub='';set request.jwt.claims='';set request.headers='';set homeypaw.pre_cutover_migration_bypass='off';${sql}`,
    );
  const approve = (seconds = 1209600, actor = 'owner', family = 'family') =>
    JSON.parse(
      maint(
        `select private.approve_family_billing_app_review(public.rv2_id('${actor}'),public.rv2_id('${family}'),${seconds});`,
      ),
    );
  const denied = (fn) => assert.throws(fn, /BILLING_TEST_ACCESS_DENIED/u);
  const close = (generation, force = false) =>
    maint(
      `select private.close_family_billing_app_review_window(public.rv2_id('owner'),${quote(generation)}::uuid,${force});`,
    );
  const state = () =>
    query(`select jsonb_build_array((select enabled from private.family_billing_config),(select enabled from private.pre_cutover_release_lock),
    (select enabled from private.family_billing_test_accounts where user_id=public.rv2_id('owner')));`);
  const openFixture = () =>
    query(
      'update private.pre_cutover_release_lock set enabled=false;update private.family_billing_config set enabled=true;',
    );
  const userOp = (operation, args = {}, actor = 'owner') =>
    query(`begin;set local role service_role;set local request.jwt.claim.role='service_role';
    select public.execute_family_billing_test_user_operation(public.rv2_id('${actor}'),${quote(operation)},${quote(JSON.stringify(args))}::jsonb);commit;`);
  const admissionSql = () => 'select public.get_family_billing_test_access();';
  for (const [seconds, actor, family, error] of [
    [0, 'owner', 'family', /WINDOW_INVALID/u],
    [1209601, 'owner', 'family', /WINDOW_INVALID/u],
    [1, 'member', 'family', /ACCESS_DENIED/u],
    [1, 'viewer', 'family', /ACCESS_DENIED/u],
    [1, 'owner', 'other', /ACCESS_DENIED/u],
    [1, 'removed', 'family', /ACCESS_DENIED/u],
  ])
    assert.throws(() => approve(seconds, actor, family), error);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      query(
        `select has_table_privilege('${role}','private.family_billing_test_accounts','INSERT,UPDATE,DELETE');`,
      ),
      'f',
    );
    assert.equal(
      query(
        `select has_function_privilege('${role}','private.approve_family_billing_app_review(uuid,uuid,integer)','EXECUTE');`,
      ),
      'f',
    );
  }
  assert.throws(
    () =>
      auth(
        'owner',
        "select private.approve_family_billing_app_review(auth.uid(),public.rv2_id('family'));",
      ),
    /permission denied/u,
  );
  assert.throws(
    () =>
      query(
        "set request.jwt.claim.role='authenticated';select private.approve_family_billing_app_review(public.rv2_id('owner'),public.rv2_id('family'));",
      ),
    /MAINTENANCE_REQUIRED/u,
  );
  for (const [name, value] of [
    ['request.jwt.claims', '{}'],
    ['request.headers', '{}'],
    ['request.method', 'POST'],
    ['request.path', '/rpc/fixture'],
    ['request.cookies', 'fixture'],
  ])
    assert.throws(
      () =>
        maint(
          `set ${name}=${quote(value)};select private.assert_family_billing_app_review_maintenance();`,
        ),
      /MAINTENANCE_REQUIRED/u,
    );
  query(`create function public.review_definer_fixture() returns void language plpgsql security definer set search_path='' as $$begin perform private.assert_family_billing_app_review_maintenance();end;$$;
    grant execute on function public.review_definer_fixture() to authenticated;`);
  assert.throws(
    () =>
      query(
        'set session authorization authenticator;set role authenticated;select public.review_definer_fixture();',
        database,
        'supabase_admin',
      ),
    /MAINTENANCE_REQUIRED/u,
  );
  query('drop function public.review_definer_fixture();');
  const first = approve();
  assert.equal(
    Date.parse(first.expires_at) - Date.parse(first.approved_at),
    14 * 24 * 3600 * 1000,
  );
  assert.deepEqual(
    JSON.parse(state()),
    [false, true, true],
    'Approval never opens Billing/Lock.',
  );
  const binding = JSON.parse(auth('owner', admissionSql()).split('\n').at(-1));
  assert.equal(binding.family_id, id('family'));
  assert.equal(binding.role, 'owner');
  assert.equal(binding.environment, 'SANDBOX');
  query(
    "begin;update public.family_members set role='member' where user_id=public.rv2_id('owner');update public.family_members set role='owner' where user_id=public.rv2_id('member');commit;",
  );
  denied(() => auth('owner', admissionSql()));
  denied(() => auth('owner', 'select public.get_family_billing_customer();'));
  query(
    "begin;update public.family_members set role='member' where user_id=public.rv2_id('member');update public.family_members set role='owner' where user_id=public.rv2_id('owner');commit;",
  );
  for (const actor of ['member', 'viewer', 'removed', 'stranger']) {
    denied(() => auth(actor, admissionSql()));
    denied(() => auth(actor, 'select public.get_family_billing_customer();'));
  }
  openFixture();
  auth(
    'owner',
    "select public.get_family_plus_summary(public.rv2_id('family'));select public.get_family_billing_state(public.rv2_id('family'));select public.get_family_billing_customer();",
  );
  denied(() =>
    auth(
      'owner',
      "select public.get_family_plus_summary(public.rv2_id('other'));",
    ),
  );
  denied(() =>
    auth(
      'owner',
      "select public.get_family_billing_state(public.rv2_id('other'));",
    ),
  );
  query(
    `insert into private.family_billing_purchase_checks(family_id,owner_id,verified_at) values(public.rv2_id('family'),public.rv2_id('owner'),clock_timestamp());`,
  );
  const intent = JSON.parse(
    auth(
      'owner',
      "select public.begin_family_billing_purchase(public.rv2_id('family'),public.rv2_id('review-intent'),'monthly');",
    )
      .split('\n')
      .at(-1),
  );
  assert.equal(intent.status, 'prepared');
  auth(
    'owner',
    "select public.update_family_billing_intent(public.rv2_id('review-intent'),'store_pending');select public.update_family_billing_intent(public.rv2_id('review-intent'),'failed');",
  );
  userOp('get_family_billing_purchase_preflight_context', {
    target_user_id: id('owner'),
  });
  assert.equal(
    Number(
      userOp('start_family_billing_refresh', {
        target_customer_id: id('owner'),
      }),
    ),
    1,
  );
  userOp('finish_family_billing_recovery', {
    target_customer_id: id('owner'),
    generation: 1,
    result: 'empty',
  });
  denied(() =>
    userOp(
      'start_family_billing_refresh',
      { target_customer_id: id('owner') },
      'stranger',
    ),
  );
  assert.throws(
    () =>
      maint(
        "update private.family_billing_test_accounts set expires_at=expires_at+interval '1 second';",
      ),
    /NEW_GENERATION_REQUIRED/u,
  );
  assert.throws(
    () =>
      maint(
        "insert into private.family_billing_test_accounts(user_id,family_id,enabled,expires_at) values(public.rv2_id('stranger'),public.rv2_id('other'),true,clock_timestamp()+interval '1 minute');",
      ),
    /CONCURRENT_WINDOW/u,
  );
  // A member's existing Family reads stay intact; no role/RLS expansion.
  auth(
    'member',
    "select public.get_family_plus_summary(public.rv2_id('family'));",
  );
  assert.throws(
    () =>
      auth(
        'member',
        "select public.get_family_plus_summary(public.rv2_id('other'));",
      ),
    /family not found/u,
  );

  const second = approve();
  assert.notEqual(second.generation, first.generation);
  assert.equal(
    query(`select active from cron.job where jobid=${first.close_job_id};`),
    'f',
  );
  const beforeStale = state();
  assert.equal(close(first.generation, true), 't');
  assert.equal(state(), beforeStale);
  const command = (job) =>
    query(`select command from cron.job where jobid=${job};`);
  maint(command(second.close_job_id));
  assert.equal(
    query(`select active from cron.job where jobid=${second.close_job_id};`),
    't',
    'An early job must stay active.',
  );
  assert.equal(close(second.generation, true), 't');
  assert.equal(close(second.generation, true), 't');
  assert.deepEqual(JSON.parse(state()), [false, true, false]);
  maint(command(second.close_job_id));
  assert.equal(
    query(`select active from cron.job where jobid=${second.close_job_id};`),
    'f',
  );

  const expiring = approve(1);
  openFixture();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  for (const sql of [
    admissionSql(),
    "select public.get_family_plus_summary(public.rv2_id('family'));",
    "select public.get_family_billing_state(public.rv2_id('family'));",
    'select public.get_family_billing_customer();',
    "select public.begin_family_billing_purchase(public.rv2_id('family'),public.rv2_id('expired-intent'),'monthly');",
    "select public.update_family_billing_intent(public.rv2_id('review-intent'),'cancelled');",
  ])
    denied(() => auth('owner', sql));
  for (const operation of [
    'get_family_billing_server_context',
    'get_family_billing_recovery_anchors',
    'start_family_billing_refresh',
    'finish_family_billing_recovery',
    'receive_family_billing_webhook',
    'apply_family_billing_snapshot',
    'get_family_billing_purchase_preflight_context',
    'finish_family_billing_purchase_preflight',
  ])
    denied(() => userOp(operation));
  assert.deepEqual(
    JSON.parse(state()),
    [true, false, true],
    'Deadline rejects even while global switches remain open.',
  );
  query(`begin;set local role service_role;set local request.jwt.claim.role='service_role';
    select public.start_family_billing_refresh(public.rv2_id('owner'));
    select public.receive_family_billing_webhook(jsonb_build_object('id','review-trusted-fixture','environment','SANDBOX','app_id','app_fixture','app_user_id',public.rv2_id('owner')::text,'type','RENEWAL','event_timestamp_ms',1),repeat('a',64));commit;`);
  maint(command(expiring.close_job_id));
  assert.deepEqual(JSON.parse(state()), [false, true, false]);
  assert.equal(
    query(`select active from cron.job where jobid=${expiring.close_job_id};`),
    'f',
  );

  const failure = approve(1);
  openFixture();
  query(`create function private.review_failure_fixture() returns trigger language plpgsql as $$begin raise exception 'REVIEW_FAILURE_FIXTURE';end;$$;
    create trigger review_failure_fixture before update on private.family_billing_config for each row execute function private.review_failure_fixture();
    update private.pre_cutover_release_lock set enabled=true;`);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const failureBefore = state();
  assert.throws(
    () => maint(command(failure.close_job_id)),
    /REVIEW_FAILURE_FIXTURE/u,
  );
  assert.equal(
    state(),
    failureBefore,
    'Failure must roll back the internal unlock.',
  );
  assert.equal(
    query(`select active from cron.job where jobid=${failure.close_job_id};`),
    't',
  );
  query(
    'drop trigger review_failure_fixture on private.family_billing_config;drop function private.review_failure_fixture();',
  );
  const holder = spawn('docker', [
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
  const exited = once(holder, 'exit');
  const ready = new Promise((resolve, reject) => {
    holder.stdout.on('data', (data) => {
      if (data.toString().includes('REVIEW_LOCK_HELD')) resolve();
    });
    holder.once('error', reject);
  });
  holder.stdin.end(
    "begin;select 1 from private.pre_cutover_release_lock for update;select 'REVIEW_LOCK_HELD';select pg_sleep(5);commit;",
  );
  await ready;
  assert.throws(() => maint(command(failure.close_job_id)), /lock timeout/u);
  assert.equal(state(), failureBefore);
  await exited;
  maint(command(failure.close_job_id));
  assert.deepEqual(JSON.parse(state()), [false, true, false]);

  // Legacy development admissions and closers still use the original 90m cap.
  maint(
    "begin;update private.pre_cutover_release_lock set enabled=false;delete from private.family_billing_test_accounts;insert into private.family_billing_test_accounts(user_id,family_id,enabled,approved_at,expires_at) values(public.rv2_id('owner'),public.rv2_id('family'),true,statement_timestamp(),statement_timestamp()+interval '90 minutes');update private.pre_cutover_release_lock set enabled=true;commit;",
  );
  auth('owner', admissionSql());
  openFixture();
  auth('owner', 'select public.get_family_billing_customer();');
  maint(
    "update private.family_billing_test_accounts set expires_at=approved_at+interval '91 minutes';",
  );
  denied(() => auth('owner', admissionSql()));
  denied(() => auth('owner', 'select public.get_family_billing_customer();'));
  maint(
    "update private.family_billing_test_accounts set approved_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second';select private.close_expired_family_billing_test_window(user_id,approved_at,expires_at) from private.family_billing_test_accounts;",
  );
  assert.deepEqual(JSON.parse(state()), [false, true, false]);

  query("update private.family_billing_config set environment='PRODUCTION';");
  denied(() => auth('owner', admissionSql()));
  assert.throws(() => approve(), /MAINTENANCE_REQUIRED/u);
  denied(() => userOp('start_family_billing_refresh'));
  query("update private.family_billing_config set environment='SANDBOX';");
  assert.equal(trusted(), beforeTrusted);
  assert.equal(contracts(), beforeContracts);
  assert.equal(policies(), beforePolicies);
  assert.equal(
    query(
      "select relrowsecurity from pg_class where oid='private.family_billing_test_accounts'::regclass;",
    ),
    't',
  );
  assert.equal(
    query(
      "select active from cron.job where jobname='homeypaw-billing-recovery';",
    ),
    'f',
  );
  assert.equal(
    query('select count(*) from private.family_store_subscriptions;'),
    '0',
  );
  assert.equal(
    query('select count(*) from private.family_media_entitlements;'),
    '0',
  );
  console.log(
    'PASS: Owner/Family/Sandbox identity, API ACLs, 90m/14d limits, direct Summary/State and all user Billing operation deadline denials.',
  );
  console.log(
    'PASS: approval/extension + generation Cron installation, stale-generation isolation, early no-op, expiry/forced/idempotent close, injected rollback and bounded-lock retry.',
  );
  console.log(
    'PASS: trusted provider/Recovery and legacy closers unchanged, no fake Plus, RLS/contracts intact, Production environment denied and wrong-environment webhook rejected (Mock).',
  );
  console.log(
    'Cron result is local generated-SQL execution with a scheduler fixture, NOT hosted Cron acceptance.',
  );
});

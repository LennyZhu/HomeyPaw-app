// Fixed local Docker target only; disposable SQL database and synthetic evidence.
// No cloud credentials, HTTP, StoreKit, real pg_cron execution or Secret changes.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  withIsolatedMedia,
  read,
  quote,
} from './lib/isolated-family-media.mjs';

const migration = '20261031141904_family_billing_yearly_abandonment.sql';
const oldFiles = [
  '20261025143824_family_billing_test_window_guards.sql',
  '20261026051034_family_billing_app_review_access.sql',
  '20261026074212_family_billing_abandoned_intent.sql',
];
for (const file of [...oldFiles, migration])
  assert.ok(!readdirSync('supabase/migrations').includes(file));

await withIsolatedMedia(
  async ({ query: raw, auth, id, database, dbContainer }) => {
    raw(
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
      '20261025072929_trusted_database_maintenance_client_gate.sql',
    ])
      raw(read('supabase/migrations/' + file));
    raw(read('supabase/sandbox-migrations/' + oldFiles[0]));
    const clear = `set request.jwt.claim.role='';set request.jwt.claim.sub='';set request.jwt.claims='';
    set request.headers='';set request.method='';set request.path='';set request.cookies='';
    set homeypaw.pre_cutover_migration_bypass='off';`;
    const maint = (sql) => raw(clear + sql);
    const query = (sql) =>
      raw(clear + "set homeypaw.pre_cutover_migration_bypass='on';" + sql);
    for (const file of oldFiles.slice(1))
      maint(read('supabase/sandbox-migrations/' + file));
    const owner = id('owner'),
      family = id('family'),
      other = id('other'),
      stranger = id('stranger');
    const intent = id('yearly-request'),
      operation = id('yearly-abandon-operation');
    query(`update public.app_release_policy set enforce_mutation_gate=false;
    update private.family_billing_config set rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';
    insert into private.family_billing_customers(id,user_id) values(${quote(owner)},${quote(owner)});
    insert into private.family_billing_intents(id,customer_id,family_id,product_id,status,created_at,expires_at)
      values(${quote(intent)},${quote(owner)},${quote(family)},'sandbox.yearly','store_pending',clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '15 minutes');
    update private.pre_cutover_release_lock set enabled=true,updated_at=clock_timestamp();
    create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,command text,schedule text,active boolean default true,username text default current_user,database text default current_database());
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid;$$;
    create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1;$$;
    insert into cron.job(jobname,schedule,command,active) values('homeypaw-billing-recovery','* * * * *','select 1;',false);
    insert into private.family_billing_test_accounts(user_id,family_id,enabled,approved_at,expires_at)
      values(${quote(stranger)},${quote(other)},false,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day'+interval '90 minutes');`);
    const signatures = () =>
      query(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl,p.proowner,p.prosecdef,p.proconfig) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')),
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p));`);
    const state = () =>
      query(`select jsonb_build_object('billing',(select enabled from private.family_billing_config),
    'quota',(select storage_enforcement_enabled from private.family_media_quota_policy),
    'lock',(select enabled from private.pre_cutover_release_lock),
    'admissions',(select jsonb_agg(to_jsonb(a) order by user_id) from private.family_billing_test_accounts a),
    'jobs',(select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j));`);
    const ddlBefore = signatures(),
      stateBefore = state();
    query("update private.family_billing_config set environment='PRODUCTION';");
    assert.throws(
      () => maint(read('supabase/sandbox-migrations/' + migration)),
      /BILLING_REVIEW_MAINTENANCE_REQUIRED/,
    );
    query("update private.family_billing_config set environment='SANDBOX';");
    maint(read('supabase/sandbox-migrations/' + migration));
    assert.equal(
      state(),
      stateBefore,
      'Installing the forward changes no configuration, admission, Intent or job',
    );
    assert.equal(
      query(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl,p.proowner,p.prosecdef,p.proconfig) order by p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname<>'abandon_family_billing_yearly_intent'),
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p));`),
      ddlBefore,
    );
    const signature =
      'private.abandon_family_billing_yearly_intent(uuid,uuid,uuid,text,uuid,text,jsonb)';
    assert.equal(
      query(`select not prosecdef and proconfig=array['search_path=""']::text[]
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('service_role',oid,'execute') from pg_proc where oid=${quote(signature)}::regprocedure;`),
      't',
    );
    const evidence = (product = 'sandbox.yearly', target = intent) =>
      JSON.parse(
        query(`select jsonb_build_object(
    'observed_at',clock_timestamp(),'project_ref','yhxxsawcaffxonpconaq','rc_project_id','proj_fixture','app_id','app_fixture','entitlement_id','ent_fixture',
    'customer_id',${quote(owner)},'original_customer_id',${quote(owner)},'intent_id',${quote(target)},'product_id',${quote(product)},
    'environment','SANDBOX','store','APP_STORE','transaction_outcome','unknown','pagination_complete',true,
    'transactions_since_intent',0,'events_since_intent',0,'active_entitlements',0,'pending_payments',0,'identity_conflicts',0,'unresolved_ambiguities',0,
    'functions_billing',jsonb_build_object('project_ref','yhxxsawcaffxonpconaq','environment','SANDBOX','enabled',false,'observed_at',clock_timestamp()),
    'evidence_sha256',repeat('a',64));`),
      );
    const call = (
      e = evidence(),
      {
        user = owner,
        fam = family,
        product = 'sandbox.yearly',
        op = operation,
        target = intent,
      } = {},
    ) =>
      `select private.abandon_family_billing_yearly_intent(${quote(target)}::uuid,${quote(user)}::uuid,${quote(fam)}::uuid,${quote(product)},${quote(op)}::uuid,'local_request_ended_apple_outcome_unknown',${quote(JSON.stringify(e))}::jsonb);`;
    const denied = (sql, pattern) => assert.throws(() => maint(sql), pattern);
    for (const change of [
      { user: stranger },
      { fam: other },
      { product: 'sandbox.monthly' },
      { target: id('wrong-request') },
    ])
      denied(call(evidence(), change), /BILLING_ABANDONMENT_BINDING_DENIED/);
    for (const role of ['anon', 'authenticated', 'service_role'])
      denied(`set role ${role};${call()}`, /permission denied/);
    denied(
      `set request.jwt.claim.role='service_role';${call()}`,
      /BILLING_REVIEW_MAINTENANCE_REQUIRED/,
    );
    for (const patch of [
      { transactions_since_intent: 1 },
      { events_since_intent: 1 },
      { active_entitlements: 1 },
      { pending_payments: 1 },
      { identity_conflicts: 1 },
      { unresolved_ambiguities: 1 },
      { pagination_complete: false },
      { transaction_outcome: 'failed' },
      { observed_at: '2020-01-01T00:00:00Z' },
      { original_customer_id: stranger },
      { environment: 'PRODUCTION' },
      { project_ref: 'wrong' },
      { functions_billing: null },
      { functions_billing: { ...evidence().functions_billing, enabled: true } },
      {
        functions_billing: {
          ...evidence().functions_billing,
          project_ref: 'wrong',
        },
      },
      {
        functions_billing: {
          ...evidence().functions_billing,
          observed_at: '2020-01-01T00:00:00Z',
        },
      },
    ])
      denied(
        call({ ...evidence(), ...patch }),
        /BILLING_ABANDONMENT_EVIDENCE_DENIED/,
      );
    const rejection = (
      setup,
      pattern = /BILLING_ABANDONMENT_TRANSACTION_REVIEW_REQUIRED/,
    ) =>
      denied(
        `begin;set local homeypaw.pre_cutover_migration_bypass='on';${setup}${clear}${call()}commit;`,
        pattern,
      );
    rejection(
      `update private.family_billing_intents set status='prepared' where id=${quote(intent)};`,
      /EXPECTED_PENDING_YEARLY/,
    );
    rejection(
      `update private.family_billing_intents set expires_at=clock_timestamp()+interval '1 minute' where id=${quote(intent)};`,
      /EXPECTED_PENDING_YEARLY/,
    );
    rejection(
      "update private.family_billing_config set environment='PRODUCTION';",
      /MAINTENANCE_REQUIRED/,
    );
    rejection(
      'update private.family_billing_config set enabled=true;',
      /CLOSED_STATE_REQUIRED/,
    );
    rejection(
      'update private.pre_cutover_release_lock set enabled=false;',
      /CLOSED_STATE_REQUIRED/,
    );
    rejection(
      'update private.family_media_quota_policy set storage_enforcement_enabled=true;',
      /CLOSED_STATE_REQUIRED/,
    );
    rejection(
      `update private.family_billing_customers set review_required=true where id=${quote(owner)};`,
    );
    rejection(
      `update private.family_billing_customers set recovery_error='BILLING_PROVIDER_IDENTITY_DENIED' where id=${quote(owner)};`,
    );
    rejection(`insert into private.family_billing_webhook_inbox(event_id,payload_hash,customer_id,event_type,product_id,event_at)
    values('confirmed-yearly',repeat('b',64),${quote(owner)},'INITIAL_PURCHASE','sandbox.yearly',clock_timestamp());`);
    rejection(`insert into private.family_store_subscriptions(environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
    values('SANDBOX','APP_STORE','already-confirmed','rc-confirmed',${quote(owner)},${quote(family)},${quote(intent)},'sandbox.yearly','expired',false,'will_not_renew',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',0,clock_timestamp());`);
    rejection(`insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
    values(${quote(family)},'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',false,'confirmed-access');`);
    // An older expired chain with a Family-consensus audit has no active access,
    // new transaction or other blocking request. Its non-null resolved_at does
    // NOT settle exact Intent attribution and must independently stop closure.
    const oldMonthly = id('older-monthly'),
      oldMonthlyNext = id('older-monthly-next');
    const oldMonthlyEvidence = evidence('sandbox.monthly', oldMonthly);
    const oldSnapshot = {
      environment: 'SANDBOX',
      store: 'APP_STORE',
      customer_id: owner,
      original_customer_id: owner,
      app_id: 'app_fixture',
      entitlement_id: 'ent_fixture',
      ownership: 'purchased',
      original_transaction_id: 'old-monthly-chain',
      rc_subscription_id: 'rc-old-monthly-chain',
      product_id: 'sandbox.monthly',
      started_at: new Date(Date.now() - 2 * 86400000 + 60000).toISOString(),
      access_until: new Date(Date.now() - 86400000).toISOString(),
      status: 'expired',
      auto_renewal_status: 'will_not_renew',
      gives_access: false,
    };
    rejection(`update private.family_billing_intents set status='cancelled' where id=${quote(intent)};
    insert into private.family_billing_intents(id,customer_id,family_id,product_id,status,created_at,expires_at)
    values(${quote(oldMonthly)},${quote(owner)},${quote(family)},'sandbox.monthly','store_pending',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days'+interval '15 minutes');
    ${clear}select private.abandon_family_billing_intent(${quote(oldMonthly)}::uuid,${quote(owner)}::uuid,${quote(family)}::uuid,public.rv2_id('old-monthly-operation'),'old-monthly-unknown',${quote(JSON.stringify(oldMonthlyEvidence))}::jsonb);
    set local homeypaw.pre_cutover_migration_bypass='on';
    update private.family_billing_intents set status='store_pending' where id=${quote(intent)};
    insert into private.family_billing_intents(id,customer_id,family_id,product_id,status,created_at,expires_at)
    values(${quote(oldMonthlyNext)},${quote(owner)},${quote(family)},'sandbox.monthly','prepared',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days'+interval '15 minutes');
    insert into private.family_billing_webhook_inbox(event_id,payload_hash,customer_id,original_transaction_id,event_type,product_id,event_at,status)
    values('old-monthly-anchor',repeat('a',64),${quote(owner)},'old-monthly-chain','INITIAL_PURCHASE','sandbox.monthly',clock_timestamp()-interval '2 days','processed');
    update private.family_billing_config set enabled=true;
    select public.apply_family_billing_snapshot(${quote(owner)}::uuid,0,${quote(JSON.stringify(oldSnapshot))}::jsonb,'old-monthly-anchor');
    update private.family_billing_config set enabled=false;
    select public.rv2_assert((select resolved_at is not null from private.family_billing_intent_ambiguities),'Family resolution timestamp exists');
    select public.rv2_assert(not exists(select 1 from private.family_media_entitlements where revoked_at is null),'old audit has no usable entitlement');`);
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '0',
    );
    console.log(
      'PASS: Yearly exact binding, maintenance/role/environment, evidence/Functions proof, real transaction/access and recovery-conflict rejection; unchanged Monthly/90-minute/14-day code and policies.',
    );

    // Local cron catalog double only: no scheduler is installed or exercised.
    const first = JSON.parse(
      maint(
        `select private.approve_family_billing_app_review(${quote(owner)}::uuid,${quote(family)}::uuid,3600);`,
      ),
    );
    denied(call(), /CLOSED_STATE_REQUIRED/); // Valid approval alone prevents closure.
    query(
      'update private.pre_cutover_release_lock set enabled=false;update private.family_billing_config set enabled=true;',
    );
    query(`create function private.close_failure_fixture() returns trigger language plpgsql as $$begin raise exception 'CLOSE_FAILURE_FIXTURE';end;$$;
    create trigger close_failure_fixture before update on private.family_billing_config for each row execute function private.close_failure_fixture();`);
    const openState = state();
    denied(
      `select private.close_family_billing_app_review_window(${quote(owner)}::uuid,${quote(first.generation)}::uuid,true);`,
      /CLOSE_FAILURE_FIXTURE/,
    );
    assert.equal(
      state(),
      openState,
      'Failed close rolls back switches, approval and lock',
    );
    denied(call(), /CLOSED_STATE_REQUIRED/);
    query(
      'drop trigger close_failure_fixture on private.family_billing_config;drop function private.close_failure_fixture();',
    );
    assert.equal(
      maint(
        `select private.close_family_billing_app_review_window(${quote(owner)}::uuid,${quote(first.generation)}::uuid,true);`,
      ),
      't',
    );
    maint(`select cron.alter_job(${first.close_job_id},active:=false);`);
    assert.equal(JSON.parse(state()).quota, false);
    denied(
      call({
        ...evidence(),
        functions_billing: { ...evidence().functions_billing, enabled: true },
      }),
      /EVIDENCE_DENIED/,
    );
    const freshEvidence = evidence();
    maint(
      `begin;${call(freshEvidence)}select public.rv2_assert((select status='abandoned' from private.family_billing_intents where id=${quote(intent)}),'temporary closure');rollback;`,
    );
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '0',
    );
    query(`create function private.yearly_rollback_fixture() returns trigger language plpgsql as $$begin
    if new.status='abandoned' then raise exception 'YEARLY_WRITE_FAILURE';end if;return new;end;$$;
    create trigger yearly_write_failure before update on private.family_billing_intents for each row execute function private.yearly_rollback_fixture();`);
    denied(call(freshEvidence), /YEARLY_WRITE_FAILURE/);
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '0',
      'Audit rolls back if status update fails',
    );
    assert.equal(
      query(
        `select status from private.family_billing_intents where id=${quote(intent)};`,
      ),
      'store_pending',
    );
    query(
      'drop trigger yearly_write_failure on private.family_billing_intents;drop function private.yearly_rollback_fixture();',
    );

    // Two connections exercise the actual payer lock and same-argument replay.
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
    const exit = once(holder, 'exit');
    const held = new Promise((resolve, reject) => {
      holder.stdout.on('data', (b) => {
        if (b.toString().includes('YEARLY_LOCK_HELD')) resolve();
      });
      holder.once('error', reject);
    });
    holder.stdin.end(
      `${clear}begin;${call(freshEvidence)}select 'YEARLY_LOCK_HELD';select pg_sleep(2);commit;`,
    );
    await held;
    denied(call(freshEvidence), /lock timeout/);
    assert.equal((await exit)[0], 0);
    const closed = JSON.parse(maint(call(freshEvidence)));
    assert.equal(closed.transaction_outcome, 'unknown');
    assert.equal(closed.product_id, 'sandbox.yearly');
    assert.equal(closed.intent_before.status, 'store_pending');
    assert.deepEqual(JSON.parse(maint(call(freshEvidence))), closed);
    denied(
      call(freshEvidence, { op: id('different-op') }),
      /ABANDONMENT_CONFLICT/,
    );
    denied(
      `update private.family_billing_intent_abandonments set reason='changed';`,
      /AUDIT_IMMUTABLE/,
    );
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '1',
    );
    // The original Monthly function remains callable with its original contract.
    const monthly = id('monthly-request');
    const monthlyEvidence = evidence('sandbox.monthly', monthly);
    maint(`begin;set local homeypaw.pre_cutover_migration_bypass='on';
    insert into private.family_billing_intents(id,customer_id,family_id,product_id,status,created_at,expires_at)
    values(${quote(monthly)},${quote(owner)},${quote(family)},'sandbox.monthly','store_pending',clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '15 minutes');
    ${clear}select private.abandon_family_billing_intent(${quote(monthly)}::uuid,${quote(owner)}::uuid,${quote(family)}::uuid,public.rv2_id('monthly-op'),'monthly-unknown',${quote(JSON.stringify(monthlyEvidence))}::jsonb);
    select public.rv2_assert((select status='abandoned' from private.family_billing_intents where id=${quote(monthly)}),'original Monthly still works');rollback;`);
    console.log(
      'PASS: valid Yearly abandonment, exact replay, concurrent lock timeout/no duplicate, audit/status rollback and original Monthly closure.',
    );

    const restore = (
      ceiling,
    ) => `do $$declare deadline timestamptz:=${quote(ceiling)}::timestamptz; remaining integer; result jsonb;begin
    if (select enabled from private.family_billing_config) or not (select enabled from private.pre_cutover_release_lock)
      or (select storage_enforcement_enabled from private.family_media_quota_policy)
      or exists(select 1 from private.family_billing_test_accounts where enabled and expires_at>clock_timestamp())
      or exists(select 1 from private.family_billing_intents i where i.family_id=${quote(family)} and private.family_billing_intent_blocks_checkout(i,clock_timestamp())) then
      raise exception 'RESUME_BASELINE_INVALID';end if;
    remaining:=floor(extract(epoch from deadline-clock_timestamp()))::integer-1;
    if remaining<=0 or remaining>1209600 then raise exception 'RESUME_DEADLINE_INVALID';end if;
    result:=private.approve_family_billing_app_review(${quote(owner)}::uuid,${quote(family)}::uuid,remaining);
    if (result->>'expires_at')::timestamptz>deadline then raise exception 'RESUME_DEADLINE_EXTENDED';end if;
  end;$$;`;
    const closedState = state();
    denied(restore('2020-01-01T00:00:00Z'), /RESUME_DEADLINE_INVALID/);
    query(
      "create or replace function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin raise exception 'SCHEDULE_FAILURE';end;$$;",
    );
    denied(restore(first.expires_at), /SCHEDULE_FAILURE/);
    assert.equal(
      state(),
      closedState,
      'Failed restore installs no approval or task and leaves the baseline closed',
    );
    query(
      'create or replace function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid;$$;',
    );
    maint(restore(first.expires_at));
    const resumed = JSON.parse(
      query(
        `select jsonb_build_object('generation',approval_generation,'expires_at',expires_at) from private.family_billing_test_accounts where user_id=${quote(owner)};`,
      ),
    );
    assert.notEqual(resumed.generation, first.generation);
    assert.ok(Date.parse(resumed.expires_at) <= Date.parse(first.expires_at));
    assert.equal(
      JSON.parse(state()).billing,
      false,
      'Approval does not open Billing',
    );
    query(`select public.rv2_assert(exists(select 1 from cron.job where jobname='homeypaw-billing-app-review-'||${quote(resumed.generation)} and active and schedule='* * * * *'),'new exact-generation task installed');
    update private.pre_cutover_release_lock set enabled=false;update private.family_billing_config set enabled=true;`);
    const resumedState = state();
    maint(
      `select private.close_family_billing_app_review_window(${quote(owner)}::uuid,${quote(first.generation)}::uuid,true);`,
    );
    assert.equal(
      state(),
      resumedState,
      'Old generation cannot close or modify the new approval',
    );
    assert.equal(
      query(
        "select active from cron.job where jobname='homeypaw-billing-recovery';",
      ),
      'f',
    );
    assert.equal(
      query(
        `select enabled from private.family_billing_test_accounts where user_id=${quote(stranger)};`,
      ),
      'f',
    );
    const billing = () =>
      JSON.parse(
        auth(
          'owner',
          `select public.get_family_billing_state(${quote(family)}::uuid);`,
        )
          .split('\n')
          .at(-1),
      );
    assert.equal(billing().pending_intent, false);
    assert.equal(billing().tier, 'free');
    assert.equal(
      JSON.parse(
        query(
          `select public.get_family_billing_server_context(${quote(owner)}::uuid);`,
        ),
      ).pending_intent,
      true,
      'Abandoned remains eligible for late reconciliation',
    );
    // Original 90-minute duration guard still accepts 90 and rejects 91 minutes.
    maint(`begin;select private.close_family_billing_app_review_window(${quote(owner)}::uuid,${quote(resumed.generation)}::uuid,true);
    update private.pre_cutover_release_lock set enabled=false;
    update private.family_billing_test_accounts set admission_kind='development',approval_generation=null,enabled=true,approved_at=clock_timestamp(),expires_at=clock_timestamp()+interval '90 minutes' where user_id=${quote(owner)};
    set local request.jwt.claim.sub=${quote(owner)};set local request.jwt.claim.role='authenticated';
    select private.require_family_billing_test_writer(${quote(owner)}::uuid,${quote(family)}::uuid);
    ${clear}update private.family_billing_test_accounts set expires_at=approved_at+interval '91 minutes' where user_id=${quote(owner)};
    set local request.jwt.claim.sub=${quote(owner)};set local request.jwt.claim.role='authenticated';
    select public.rv2_error(${quote(`select private.require_family_billing_test_writer('${owner}'::uuid,'${family}'::uuid)`)},'42501','BILLING_TEST_ACCESS_DENIED');rollback;`);
    console.log(
      'PASS: failed close blocks abandonment; failed restore rolls back; remaining-time new generation never extends deadline; stale closer cannot affect it; 90-minute guard and other data preserved. Cron catalog is a local double; Functions proof is synthetic, not a cloud/runtime check.',
    );

    // Build 14-compatible purchase RPC may now start a new request, with no SDK.
    query(
      `insert into private.family_billing_purchase_checks values(${quote(family)},${quote(owner)},clock_timestamp());`,
    );
    const next = JSON.parse(
      auth(
        'owner',
        `select public.begin_family_billing_purchase(${quote(family)}::uuid,public.rv2_id('new-yearly-request'),'yearly');`,
      )
        .split('\n')
        .at(-1),
    );
    auth(
      'owner',
      `select public.update_family_billing_intent(${quote(next.intent_id)}::uuid,'store_pending');`,
    );
    const started = query(
      `select created_at+interval '1 minute' from private.family_billing_intents where id=${quote(intent)};`,
    );
    const snapshot = (chain, start) => ({
      environment: 'SANDBOX',
      store: 'APP_STORE',
      customer_id: owner,
      original_customer_id: owner,
      app_id: 'app_fixture',
      entitlement_id: 'ent_fixture',
      ownership: 'purchased',
      original_transaction_id: chain,
      rc_subscription_id: 'rc-' + chain,
      product_id: 'sandbox.yearly',
      started_at: start,
      access_until: new Date(Date.now() + 3600000).toISOString(),
      status: 'active',
      auto_renewal_status: 'will_renew',
      gives_access: true,
    });
    const event = (
      chain,
    ) => `insert into private.family_billing_webhook_inbox(event_id,payload_hash,customer_id,original_transaction_id,event_type,product_id,event_at)
    values(${quote(chain)},repeat('b',64),${quote(owner)},${quote(chain)},'INITIAL_PURCHASE','sandbox.yearly',clock_timestamp());`;
    const apply = (s) =>
      `select public.apply_family_billing_snapshot(${quote(owner)}::uuid,0,${quote(JSON.stringify(s))}::jsonb,${quote(s.original_transaction_id)});`;
    const ambiguous = snapshot('ambiguous-yearly', new Date().toISOString());
    query(`begin;${event('ambiguous-yearly')}${apply(ambiguous)}${apply(ambiguous)}
    select public.rv2_assert((select intent_id is null and family_id=${quote(family)}::uuid from private.family_store_subscriptions),'Family proof does not guess an Intent');
    select public.rv2_assert((select cardinality(candidate_intent_ids)=2 and resolution='family_verified_intent_unknown' from private.family_billing_intent_ambiguities),'immutable candidate ambiguity');
    select public.rv2_assert((select count(*)=1 from private.family_media_entitlements),'one real-snapshot entitlement');rollback;`);
    query(`begin;${event('ambiguous-yearly')}
    insert into private.family_billing_intents(id,customer_id,family_id,product_id,status) values(public.rv2_id('cross-family-yearly'),${quote(owner)},${quote(other)},'sandbox.yearly','store_pending');
    select public.rv2_error(${quote(apply(ambiguous))},'P0001','BILLING_BINDING_REVIEW_REQUIRED');
    select public.rv2_assert((select count(*)=0 from private.family_media_entitlements),'no cross-Family grant');rollback;`);
    const late = snapshot('unique-yearly', started);
    query(`${event('unique-yearly')}${apply(late)}${apply(late)}`);
    assert.equal(
      query('select intent_id from private.family_store_subscriptions;'),
      intent,
    );
    assert.equal(
      query(
        `select status from private.family_billing_intents where id=${quote(intent)};`,
      ),
      'abandoned',
    );
    assert.equal(
      query(
        `select count(*) from private.family_media_entitlements where family_id=${quote(other)};`,
      ),
      '0',
    );
    assert.deepEqual(
      JSON.parse(maint(call(freshEvidence))),
      closed,
      'Replay after late attachment remains read-only and idempotent',
    );
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '1',
    );
    console.log(
      'PASS: abandoned Yearly stays discoverable; fresh request unblocked; unique late chain binds exactly; same-Family ambiguity grants verified Family with audit; cross-Family ambiguity grants nothing.',
    );
  },
);

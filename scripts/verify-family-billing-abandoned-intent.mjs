import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  withIsolatedMedia,
  read,
  quote,
} from './lib/isolated-family-media.mjs';
import {
  reconcileCustomer,
  isBillingManualReview,
} from '../supabase/functions/_shared/family-billing-sandbox.mjs';

const migration = '20261026074212_family_billing_abandoned_intent.sql';
assert.ok(!readdirSync('supabase/migrations').includes(migration));
assert.equal(isBillingManualReview('BILLING_BINDING_REVIEW_REQUIRED'), true);
// Exercise the actual existing Edge error path, without HTTP or deployment.
const finishes = [];
await assert.rejects(
  reconcileCustomer(
    {
      rpc: async (name, args) => {
        if (name === 'get_family_billing_server_context')
          return {
            config: { enabled: true },
            chains: [],
            pending_intent: true,
          };
        if (name === 'start_family_billing_refresh') return 1;
        if (name === 'get_family_billing_recovery_anchors') return [];
        if (name === 'receive_family_billing_webhook') return 'pending';
        if (name === 'apply_family_billing_snapshot')
          throw new Error('BILLING_BINDING_REVIEW_REQUIRED');
        if (name === 'finish_family_billing_recovery') {
          finishes.push(args);
          return;
        }
        assert.fail(name);
      },
      reader: {
        anchors: async () => [
          { id: 'synthetic-event', original_transaction_id: 'synthetic-chain' },
        ],
        snapshot: async () => ({}),
      },
    },
    'synthetic-customer',
  ),
  /BILLING_BINDING_REVIEW_REQUIRED/u,
);
assert.equal(finishes[0].result, 'manual_review');

await withIsolatedMedia(
  async ({ query: rawQuery, auth, id, database, dbContainer }) => {
    rawQuery(
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
      rawQuery(read('supabase/migrations/' + file));
    rawQuery(
      read(
        'supabase/sandbox-migrations/20261025143824_family_billing_test_window_guards.sql',
      ),
    );
    const clear = `set request.jwt.claim.role='';set request.jwt.claim.sub='';set request.jwt.claims='';
    set request.headers='';set request.method='';set request.path='';set request.cookies='';
    set homeypaw.pre_cutover_migration_bypass='off';`;
    const query = (sql) =>
      rawQuery(clear + "set homeypaw.pre_cutover_migration_bypass='on';" + sql);
    const maint = (sql) => query(clear + sql);
    maint(
      read(
        'supabase/sandbox-migrations/20261026051034_family_billing_app_review_access.sql',
      ),
    );
    query(`update public.app_release_policy set enforce_mutation_gate=false;
    update private.family_billing_config set rc_project_id='proj_fixture',rc_app_id='app_fixture',rc_entitlement_id='ent_fixture',monthly_product_id='sandbox.monthly',yearly_product_id='sandbox.yearly';
    insert into private.family_billing_customers(id,user_id) values(public.rv2_id('owner'),public.rv2_id('owner'));
    update private.pre_cutover_release_lock set enabled=true;`);
    const unchanged = () =>
      query(`select jsonb_build_object(
    'contracts',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('begin_family_billing_purchase','get_family_billing_state','update_family_billing_intent','get_family_billing_test_access','get_family_plus_summary')),
    'guards',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl) order by p.oid)
      from pg_proc p where p.proname in('require_family_billing_test_writer','approve_family_billing_app_review','close_family_billing_app_review_window','schedule_family_billing_app_review_close','close_expired_family_billing_test_window','schedule_family_billing_test_window_close')),
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
    'config',(select to_jsonb(c) from private.family_billing_config c),
    'lock',(select enabled from private.pre_cutover_release_lock),
    'quota',(select storage_enforcement_enabled from private.family_media_quota_policy),
    'admissions',(select count(*) from private.family_billing_test_accounts));`);
    const before = unchanged();
    query("update private.family_billing_config set environment='PRODUCTION';");
    assert.throws(
      () => maint(read('supabase/sandbox-migrations/' + migration)),
      /BILLING_REVIEW_MAINTENANCE_REQUIRED/u,
    );
    query("update private.family_billing_config set environment='SANDBOX';");
    maint(read('supabase/sandbox-migrations/' + migration));
    assert.equal(
      unchanged(),
      before,
      'Build 12 contracts, 90-minute/14-day guards, policies and switches preserved',
    );
    // Catalog security checks for the new surface, in the disposable DB only.
    assert.equal(
      query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in('abandon_family_billing_intent','guard_family_billing_abandonment_audit','guard_family_billing_abandoned_intent',
        'guard_family_billing_intent_ambiguity','check_family_billing_ambiguous_subscription','family_billing_intent_blocks_checkout')
      and (p.proconfig is null or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'));`),
      '0',
    );
    assert.equal(
      query(`select relrowsecurity and not has_table_privilege('service_role',oid,'insert,update,delete')
    from pg_class where oid='private.family_billing_intent_abandonments'::regclass;`),
      't',
    );
    const owner = id('owner'),
      family = id('family'),
      other = id('other'),
      stranger = id('stranger');
    const intent = id('abandoned-request'),
      operation = id('abandon-operation');
    query(`insert into private.family_billing_intents(id,family_id,customer_id,product_id,status,created_at,expires_at)
    values(${quote(intent)},${quote(family)},${quote(owner)},'sandbox.monthly','store_pending',clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '15 minutes');`);
    const evidence = JSON.parse(
      query(`select jsonb_build_object('observed_at',clock_timestamp(),
    'project_ref','yhxxsawcaffxonpconaq','rc_project_id','proj_fixture','app_id','app_fixture','entitlement_id','ent_fixture',
    'customer_id',${quote(owner)},'original_customer_id',${quote(owner)},'intent_id',${quote(intent)},'product_id','sandbox.monthly',
    'environment','SANDBOX','store','APP_STORE','transaction_outcome','unknown','pagination_complete',true,
    'transactions_since_intent',0,'events_since_intent',0,'active_entitlements',0,'pending_payments',0,'evidence_sha256',repeat('a',64));`),
    );
    const call = (e = evidence, u = owner, f = family, op = operation) =>
      `select private.abandon_family_billing_intent(${quote(intent)}::uuid,${quote(u)}::uuid,${quote(f)}::uuid,${quote(op)}::uuid,'local_request_ended_apple_outcome_unknown',${quote(JSON.stringify(e))}::jsonb);`;
    const denied = (fn, pattern) => assert.throws(fn, pattern);
    denied(
      () => maint(call(evidence, owner, other)),
      /BILLING_ABANDONMENT_BINDING_DENIED/u,
    );
    denied(
      () => maint(call(evidence, stranger)),
      /BILLING_ABANDONMENT_BINDING_DENIED/u,
    );
    for (const role of ['anon', 'authenticated', 'service_role'])
      denied(() => query(`set role ${role};${call()}`), /permission denied/u);
    denied(
      () => maint(call({ ...evidence, transactions_since_intent: 1 })),
      /BILLING_ABANDONMENT_EVIDENCE_DENIED/u,
    );
    denied(
      () => maint(call({ ...evidence, pagination_complete: false })),
      /BILLING_ABANDONMENT_EVIDENCE_DENIED/u,
    );
    denied(
      () => maint(call({ ...evidence, transaction_outcome: 'failed' })),
      /BILLING_ABANDONMENT_EVIDENCE_DENIED/u,
    );
    denied(
      () => maint(call({ ...evidence, observed_at: '2020-01-01T00:00:00Z' })),
      /BILLING_ABANDONMENT_EVIDENCE_DENIED/u,
    );
    denied(
      () => maint(call({ ...evidence, customer_id: stranger })),
      /BILLING_ABANDONMENT_EVIDENCE_DENIED/u,
    );
    query(
      `update private.family_billing_intents set status='prepared' where id=${quote(intent)};`,
    );
    denied(
      () => maint(call()),
      /BILLING_ABANDONMENT_EXPECTED_PENDING_MONTHLY/u,
    );
    query(`update private.family_billing_intents set status='store_pending' where id=${quote(intent)};
    update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=${quote(owner)};`);
    denied(() => maint(call()), /BILLING_ABANDONMENT_BINDING_DENIED/u);
    query(`update auth.users set banned_until=null where id=${quote(owner)};`);
    query("update private.family_billing_config set environment='PRODUCTION';");
    denied(() => maint(call()), /BILLING_REVIEW_MAINTENANCE_REQUIRED/u);
    query("update private.family_billing_config set environment='SANDBOX';");
    // Confirmed/deferred evidence must prevent abandonment, including a real
    // transaction that arrives after the external GET but before the DB check.
    query(`insert into private.family_billing_webhook_inbox(event_id,payload_hash,customer_id,event_type,product_id,event_at)
    values('synthetic-confirmed-event',repeat('a',64),${quote(owner)},'INITIAL_PURCHASE','sandbox.monthly',clock_timestamp());`);
    denied(
      () => maint(call()),
      /BILLING_ABANDONMENT_TRANSACTION_REVIEW_REQUIRED/u,
    );
    query(
      "delete from private.family_billing_webhook_inbox where event_id='synthetic-confirmed-event';",
    );
    query(`insert into private.family_store_subscriptions(environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,
    product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
    values('SANDBOX','APP_STORE','confirmed-chain','rc-confirmed',${quote(owner)},${quote(family)},${quote(intent)},'sandbox.monthly',
      'expired',false,'will_not_renew',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',0,clock_timestamp());`);
    denied(
      () => maint(call()),
      /BILLING_ABANDONMENT_TRANSACTION_REVIEW_REQUIRED/u,
    );
    query(
      "delete from private.family_store_subscriptions where original_transaction_id='confirmed-chain';",
    );
    query(`insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
    values(${quote(family)},'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',false,'synthetic-confirmed-entitlement');`);
    denied(
      () => maint(call()),
      /BILLING_ABANDONMENT_TRANSACTION_REVIEW_REQUIRED/u,
    );
    query(
      "delete from private.family_media_entitlements where source_reference='synthetic-confirmed-entitlement';",
    );
    // A concurrent trusted snapshot owns this same payer lock.
    const lock = spawn(
      'docker',
      [
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
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const locked = new Promise((resolve) =>
      lock.stdout.on('data', (b) => {
        if (b.toString().includes('PAYER_LOCK_HELD')) resolve();
      }),
    );
    const exit = once(lock, 'exit');
    lock.stdin.end(
      `begin;select 1 from private.family_billing_customers where id=${quote(owner)} for update;select 'PAYER_LOCK_HELD';select pg_sleep(2);rollback;`,
    );
    await locked;
    denied(() => maint(call()), /lock timeout/u);
    assert.equal((await exit)[0], 0);
    query(`begin;
      insert into private.family_billing_intents(id,family_id,customer_id,product_id,status,created_at,expires_at)
        values(public.rv2_id('historical-attempt'),${quote(family)},${quote(owner)},'sandbox.monthly','fulfilled',clock_timestamp()-interval '3 days',clock_timestamp()-interval '3 days'+interval '15 minutes');
      insert into private.family_store_subscriptions(environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,
        product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
        values('SANDBOX','APP_STORE','historical-expired-chain','rc-historical',${quote(owner)},${quote(family)},public.rv2_id('historical-attempt'),
          'sandbox.monthly','expired',false,'will_not_renew',clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days',0,clock_timestamp());
      ${clear}${call()}
      select public.rv2_assert((select status='expired' and not gives_access and intent_id=public.rv2_id('historical-attempt')
        from private.family_store_subscriptions where original_transaction_id='historical-expired-chain'),'expired history and exact association preserved');
      select public.rv2_assert((select status='abandoned' from private.family_billing_intents where id=${quote(intent)}),'old pending closed with expired history retained');
      rollback;`);
    const closed = JSON.parse(maint(call()));
    assert.equal(closed.transaction_outcome, 'unknown');
    assert.equal(closed.intent_before.status, 'store_pending');
    assert.deepEqual(
      JSON.parse(maint(call())),
      closed,
      'repeat closure is immutable/idempotent',
    );
    denied(
      () => maint(call(evidence, owner, family, id('different-operation'))),
      /BILLING_ABANDONMENT_CONFLICT/u,
    );
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '1',
    );
    assert.equal(
      query(
        `select status from private.family_billing_intents where id=${quote(intent)};`,
      ),
      'abandoned',
    );
    // Even if a future API configuration grants private-schema usage, the
    // table's existing service-role grants cannot bypass the new trigger.
    query('grant usage on schema private to service_role;');
    denied(
      () =>
        query(
          `set role service_role;update private.family_billing_intents set status='prepared' where id=${quote(intent)};`,
        ),
      /BILLING_ABANDONED_INTENT_IMMUTABLE/u,
    );
    denied(
      () =>
        query(`set role service_role;insert into private.family_billing_intents(id,family_id,customer_id,product_id,status)
    values(public.rv2_id('forged-abandoned'),${quote(family)},${quote(owner)},'sandbox.monthly','abandoned');`),
      /BILLING_ABANDONMENT_AUDIT_REQUIRED/u,
    );
    assert.equal(
      maint("select current_setting('homeypaw.pre_cutover_migration_bypass');"),
      'off',
    );
    assert.equal(
      query('select enabled from private.pre_cutover_release_lock;'),
      't',
    );
    denied(
      () =>
        query(
          `update private.family_billing_intents set status='cancelled' where id=${quote(intent)};`,
        ),
      /BILLING_ABANDONED_INTENT_IMMUTABLE/u,
    );
    denied(
      () => maint('delete from private.family_billing_intent_abandonments;'),
      /BILLING_ABANDONMENT_AUDIT_IMMUTABLE/u,
    );
    query(`insert into private.family_billing_test_accounts(user_id,family_id,enabled,approved_at,expires_at)
    values(${quote(owner)},${quote(family)},true,clock_timestamp(),clock_timestamp()+interval '90 minutes');
    update private.pre_cutover_release_lock set enabled=false;
    update private.family_billing_config set enabled=true;`);
    const state = () =>
      JSON.parse(
        auth(
          'owner',
          `select public.get_family_billing_state(${quote(family)}::uuid);`,
        )
          .split('\n')
          .at(-1),
      );
    assert.equal(
      state().pending_intent,
      false,
      'abandoned no longer blocks Build 12',
    );
    const ctx = () =>
      JSON.parse(
        query(
          `select public.get_family_billing_server_context(${quote(owner)}::uuid);`,
        ),
      );
    assert.equal(
      ctx().pending_intent,
      true,
      'reconciliation still searches for unknown late chains',
    );
    assert.ok(
      JSON.parse(
        query(
          'select to_jsonb(public.get_family_billing_reconciliation_work());',
        ),
      ).includes(owner),
    );
    const begin = (label) => {
      query(
        `insert into private.family_billing_purchase_checks values(${quote(family)},${quote(owner)},clock_timestamp()) on conflict(family_id) do update set verified_at=excluded.verified_at;`,
      );
      return JSON.parse(
        auth(
          'owner',
          `set local request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.4.0","x-homeypaw-build":"12"}';
      select public.begin_family_billing_purchase(${quote(family)}::uuid,public.rv2_id(${quote(label)}),'monthly');`,
        )
          .split('\n')
          .at(-1),
      );
    };
    const next = begin('new-build12-request');
    assert.equal(next.status, 'prepared');
    assert.deepEqual(
      Object.keys(next).sort(),
      ['intent_id', 'customer_id', 'product_id', 'status', 'expires_at'].sort(),
    );
    auth(
      'owner',
      `select public.update_family_billing_intent(${quote(next.intent_id)}::uuid,'store_pending');`,
    );
    denied(
      () =>
        auth(
          'owner',
          `select public.update_family_billing_intent(${quote(intent)}::uuid,'cancelled');`,
        ),
      /BILLING_ABANDONED_INTENT_IMMUTABLE/u,
    );
    denied(
      () =>
        auth(
          'owner',
          `select public.update_family_billing_intent(${quote(next.intent_id)}::uuid,'abandoned');`,
        ),
      /invalid intent status/u,
    );
    const originalStarted = query(
      `select created_at+interval '1 minute' from private.family_billing_intents where id=${quote(intent)};`,
    );
    const snapshot = (chain, started) => ({
      environment: 'SANDBOX',
      store: 'APP_STORE',
      customer_id: owner,
      original_customer_id: owner,
      app_id: 'app_fixture',
      entitlement_id: 'ent_fixture',
      ownership: 'purchased',
      original_transaction_id: chain,
      rc_subscription_id: 'rc-' + chain,
      product_id: 'sandbox.monthly',
      started_at: started,
      access_until: new Date(Date.now() + 3600000).toISOString(),
      status: 'active',
      auto_renewal_status: 'will_renew',
      gives_access: true,
    });
    const event = (chain, customer = owner) =>
      query(`insert into private.family_billing_webhook_inbox(event_id,payload_hash,customer_id,original_transaction_id,event_type,product_id,event_at)
    values(${quote(chain)},repeat('b',64),${quote(customer)},${quote(chain)},'INITIAL_PURCHASE','sandbox.monthly',clock_timestamp());`);
    const apply = (s, source = s.original_transaction_id) =>
      query(`select public.apply_family_billing_snapshot(${quote(owner)}::uuid,
    (select refresh_generation from private.family_billing_customers where id=${quote(owner)}),${quote(JSON.stringify(s))}::jsonb,${quote(source)});`);
    event('ambiguous-chain');
    const ambiguous = snapshot('ambiguous-chain', new Date().toISOString());
    // Same-family ambiguity grants the verified Family, never guesses an Intent.
    // Roll back this scenario so the unique-late-chain case stays independent.
    query(`begin;
      select public.apply_family_billing_snapshot(${quote(owner)}::uuid,0,${quote(JSON.stringify(ambiguous))}::jsonb,'ambiguous-chain');
      select public.rv2_assert((select intent_id is null and family_id=${quote(family)}::uuid from private.family_store_subscriptions),'no arbitrary Intent association');
      select public.rv2_assert((select cardinality(candidate_intent_ids)=2 and candidate_intent_ids @> array[${quote(intent)}::uuid,${quote(next.intent_id)}::uuid]
        and resolution='family_verified_intent_unknown' from private.family_billing_intent_ambiguities),'both candidates retained');
      select public.rv2_assert((select status='store_pending' from private.family_billing_intents where id=${quote(next.intent_id)}),'no fabricated fulfilled attempt');
      select public.apply_family_billing_snapshot(${quote(owner)}::uuid,0,${quote(JSON.stringify(ambiguous))}::jsonb,'ambiguous-chain');
      select public.rv2_assert((select count(*)=1 from private.family_billing_intent_ambiguities),'replay has one immutable audit');
      select public.rv2_assert((select count(*)=1 from private.family_media_entitlements where family_id=${quote(family)}::uuid),'single Family entitlement');
      set local role authenticated;set local request.jwt.claim.role='authenticated';
      select set_config('request.jwt.claim.sub',${quote(owner)},true);
      select public.rv2_assert((public.get_family_billing_state(${quote(family)}::uuid)->>'tier')='plus','Build 12 sees Plus');
      select public.rv2_assert((public.get_family_billing_state(${quote(family)}::uuid)->>'pending_intent')='false','audited requests no longer block checkout');
      reset role;
      select public.rv2_error('delete from private.family_billing_intent_ambiguities','42501','BILLING_INTENT_AMBIGUITY_IMMUTABLE');
      rollback;`);
    assert.equal(
      query('select count(*) from private.family_store_subscriptions;'),
      '0',
    );
    // A candidate pointing to another Family MUST still take the manual path.
    query(`insert into private.family_billing_intents(id,customer_id,family_id,product_id,status)
      values(public.rv2_id('cross-family-attempt'),${quote(owner)},${quote(other)},'sandbox.monthly','store_pending');`);
    denied(() => apply(ambiguous), /BILLING_BINDING_REVIEW_REQUIRED/u);
    query(
      "delete from private.family_billing_intents where id=public.rv2_id('cross-family-attempt');",
    );
    assert.equal(
      query('select count(*) from private.family_media_entitlements;'),
      '0',
    );
    // Without the audit, relaxing the nullable column grants no new capability.
    denied(
      () =>
        query(`insert into private.family_store_subscriptions(environment,store,original_transaction_id,rc_subscription_id,customer_id,family_id,intent_id,
      product_id,status,gives_access,auto_renewal_status,started_at,access_until,last_generation,checked_at)
      values('SANDBOX','APP_STORE','forged-chain','forged-rc',${quote(owner)},${quote(family)},null,'sandbox.monthly','active',true,'will_renew',
        clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',0,clock_timestamp());`),
      /BILLING_INTENT_AMBIGUITY_AUDIT_REQUIRED/u,
    );
    // Existing Recovery manual review still handles cross-family failures.
    query(
      `select public.finish_family_billing_recovery(${quote(owner)}::uuid,0,'manual_review','BILLING_BINDING_REVIEW_REQUIRED');`,
    );
    assert.equal(
      query(
        `select review_required from private.family_billing_customers where id=${quote(owner)};`,
      ),
      't',
    );
    assert.equal(
      query(
        'select to_jsonb(public.get_family_billing_reconciliation_work());',
      ),
      '[]',
    );
    // A genuinely older transaction has only the abandoned request as candidate.
    event('unique-late-chain');
    const late = snapshot('unique-late-chain', originalStarted);
    denied(
      () => apply({ ...late, original_customer_id: stranger }),
      /BILLING_SNAPSHOT_DENIED/u,
    );
    denied(
      () => apply({ ...late, environment: 'PRODUCTION' }),
      /BILLING_SNAPSHOT_DENIED/u,
    );
    denied(
      () => apply(late, 'unknown-source'),
      /BILLING_CHAIN_ANCHOR_REQUIRED/u,
    );
    const result = JSON.parse(apply(late));
    assert.equal(result.family_id, family);
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
        `select status from private.family_billing_intents where id=${quote(next.intent_id)};`,
      ),
      'store_pending',
    );
    apply(late);
    assert.equal(
      query('select count(*) from private.family_store_subscriptions;'),
      '1',
    );
    assert.equal(
      query('select count(*) from private.family_media_entitlements;'),
      '1',
    );
    assert.equal(
      query(
        `select count(*) from private.family_media_entitlements where family_id=${quote(other)};`,
      ),
      '0',
    );
    // A consumed abandoned request cannot claim an additional older chain.
    event('second-old-chain');
    denied(
      () => apply(snapshot('second-old-chain', originalStarted)),
      /BILLING_BINDING_REVIEW_REQUIRED/u,
    );
    assert.equal(
      query('select count(*) from private.family_billing_intent_abandonments;'),
      '1',
    );
    assert.deepEqual(
      JSON.parse(maint(call())),
      closed,
      'closure replay remains safe after real late attachment',
    );
    console.log(
      'PASS: local SQL + Edge mocks; abandonment/audit/idempotency, Build 12 fresh purchase, evidence/conflict/role/environment/locking rejection, unique late binding, same-Family ambiguous Plus grant with audit, cross-Family manual review, replay/no cross-Family grant; 90-minute/14-day guards unchanged. No Cron rehearsal or provider call.',
    );
  },
);

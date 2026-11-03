import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import ts from 'typescript';
import {
  withIsolatedMedia,
  read,
  quote,
} from './lib/isolated-family-media.mjs';

await withIsolatedMedia(async ({ query, auth, id }) => {
  const forwards = [
    '20261023044929_family_billing_auth_identity.sql',
    '20261023045414_family_billing_release_contract.sql',
    '20261023055340_family_media_capacity_enforcement.sql',
    '20261023074855_family_media_transition_fifteen_days.sql',
    '20261024114459_family_media_capacity_release_readiness.sql',
  ];
  const untouched = () =>
    query(`select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like '%billing%' or p.proname in('create_post','update_post','create_post_v2','update_post_v2'));`);
  query(`insert into private.family_media_quota_policy(singleton) values(true);
    insert into private.family_billing_config(singleton) values(true);`);
  for (const file of forwards) {
    const applied = query(
      `begin read only; select exists(select 1 from supabase_migrations.schema_migrations where version=${quote(file.split('_')[0])}); commit;`,
      'postgres',
    );
    const before = untouched();
    if (applied !== 't') query(read('supabase/migrations/' + file));
    if (file === '20261023074855_family_media_transition_fifteen_days.sql')
      assert.equal(
        untouched(),
        before,
        'The Transition forward preserves Billing and Journal definitions.',
      );
  }
  assert.equal(
    query(`select (select enabled from private.family_billing_config)
      or (select storage_enforcement_enabled from private.family_media_quota_policy)
      or (select legacy_tus_residual_risk_accepted from private.family_media_quota_policy)
      or (select legacy_transition_started_at is not null from private.family_media_quota_policy)
      or exists(select 1 from private.family_media_entitlements);`),
    'f',
    'Installation never activates Billing, quotas or the transition.',
  );
  const billingBefore = untouched();
  assert.match(
    query(read('scripts/sql/family-media-transition.sql')),
    /FAMILY_MEDIA_TRANSITION_PASS/,
  );
  assert.equal(
    untouched(),
    billingBefore,
    'Billing and Journal functions are unchanged.',
  );
  for (const role of ['owner', 'member', 'viewer']) {
    const summary = JSON.parse(
      auth(
        role,
        `select public.get_family_plus_summary(${quote(id('family'))});`,
      )
        .split('\n')
        .find((s) => s.startsWith('{')),
    );
    assert.equal(summary.status, 'free');
    assert.equal(summary.transition, null);
    assert.equal(summary.gives_plus_access, false);
  }
  console.log(
    'PASS: one-time server activation, 15-day/DST boundary, strict >300 MiB qualification, unknown usage rejection, no new-Family/relogin/Pet reset, Plus precedence, expiry upload denial and retained media; rollback leaves switches OFF.',
  );
});

let elapsed = 100;
const module = { exports: {} };
new Script(
  ts.transpileModule(read('src/features/billing/family-plus-presentation.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
).runInNewContext({
  module,
  exports: module.exports,
  performance: { now: () => elapsed },
});
const model = module.exports;
const start = '2026-10-23T00:00:00Z';
const end = '2026-11-07T00:00:00Z';
const snapshot = {
  source: 'server',
  status: 'transition',
  serverClock: { serverTime: start, receivedAt: elapsed },
  transition: { startsAt: start, endsAt: end },
  plusAccess: {
    source: 'server-verified',
    givesAccess: false,
    validUntil: null,
  },
};
assert.equal(model.familyPlusTransition(snapshot).remainingDays, 15);
assert.equal(model.familyPlusIdentity(snapshot, false).showBadge, false);
elapsed += 14 * 86_400_000;
assert.equal(model.familyPlusTransition(snapshot).remainingDays, 1);
elapsed += 86_400_000;
assert.equal(model.familyPlusTransition(snapshot).expired, true);
for (const status of ['active', 'grace', 'cancelled', 'free', 'expired'])
  assert.equal(model.familyPlusTransition({ ...snapshot, status }), null);
assert.equal(
  model.familyPlusTransition({ ...snapshot, source: 'development-preview' }),
  null,
);
assert.equal(
  model.familyPlusTransition({ ...snapshot, serverClock: undefined }),
  null,
);
console.log(
  'PASS: server-clock countdown and exact day-15 expiry; Preview invents no deadline; Plus/grace/cancelled presentation remains independent.',
);

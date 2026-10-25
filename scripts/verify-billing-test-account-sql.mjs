import assert from 'node:assert/strict';
import { withIsolatedMedia, read } from './lib/isolated-family-media.mjs';
await withIsolatedMedia(async ({ query, auth }) => {
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
  ])
    query(read('supabase/migrations/' + file));
  assert.equal(
    query('select count(*) from private.family_billing_test_accounts;'),
    '0',
  );
  assert.throws(
    () => auth('owner', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  query(
    "insert into private.family_billing_test_accounts(user_id,family_id,enabled,expires_at) values(public.rv2_id('owner'),public.rv2_id('family'),true,now()+interval '1 hour');",
  );
  assert.ok(
    auth('owner', 'select public.get_family_billing_test_access();').includes(
      'SANDBOX',
    ),
  );
  assert.throws(
    () => auth('member', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  assert.throws(
    () => auth('owner', 'select * from private.family_billing_test_accounts;'),
    /permission denied/,
  );
  assert.throws(
    () =>
      auth(
        'owner',
        'update private.family_billing_test_accounts set enabled=true;',
      ),
    /permission denied/,
  );
  for (const actor of ['member', 'viewer']) {
    query(
      `insert into private.family_billing_test_accounts(user_id,family_id,enabled,expires_at) values(public.rv2_id('${actor}'),public.rv2_id('family'),true,now()+interval '1 hour');`,
    );
    assert.ok(
      auth(actor, 'select public.get_family_billing_test_access();').includes(
        'SANDBOX',
      ),
    );
  }
  query(
    "delete from public.family_members where user_id=public.rv2_id('member');",
  );
  assert.throws(
    () => auth('member', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  query(
    "update private.family_billing_test_accounts set family_id=public.rv2_id('other') where user_id=public.rv2_id('owner');",
  );
  assert.throws(
    () => auth('owner', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  query(
    "update private.family_billing_test_accounts set family_id=public.rv2_id('family'),approved_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where user_id=public.rv2_id('owner');",
  );
  assert.throws(
    () => auth('owner', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  query(
    "update private.family_billing_test_accounts set expires_at=now()+interval '1 hour',enabled=false where user_id=public.rv2_id('owner');",
  );
  assert.throws(
    () => auth('owner', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  query(
    "update private.family_billing_test_accounts set enabled=true;update private.family_billing_config set environment='PRODUCTION';",
  );
  assert.throws(
    () => auth('owner', 'select public.get_family_billing_test_access();'),
    /ACCESS_DENIED/,
  );
  assert.equal(
    query(
      "select has_function_privilege('anon','public.get_family_billing_test_access()','execute');",
    ),
    'f',
  );
  assert.equal(
    query(
      'select (select enabled from private.family_billing_config) or (select storage_enforcement_enabled from private.family_media_quota_policy) or exists(select 1 from private.family_media_entitlements);',
    ),
    'f',
  );
  console.log(
    'PASS: empty default admission, authenticated canonical Family/roles, Removed/cross-Family/expiry/revocation/Production denial, private ACL/RLS and no Plus/billing/quota activation. Synthetic disposable SQL only.',
  );
});

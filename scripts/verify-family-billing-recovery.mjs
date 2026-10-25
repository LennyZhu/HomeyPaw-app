import assert from 'node:assert/strict';
import {
  createRevenueCatReader,
  runBillingRecovery,
  isBillingManualReview,
  authorizationMatches,
} from '../supabase/functions/_shared/family-billing-sandbox.mjs';

for (const code of ['BILLING_PROVIDER_HTTP_401', 'BILLING_PROVIDER_HTTP_403'])
  assert.equal(isBillingManualReview(code), true);
for (const code of [
  'BILLING_PROVIDER_HTTP_429',
  'BILLING_PROVIDER_HTTP_503',
  'BILLING_RECOVERY_TIME_BUDGET',
])
  assert.equal(isBillingManualReview(code), false);
assert.equal(await authorizationMatches('Bearer short', 'short'), false);
assert.equal(
  await authorizationMatches(
    'Bearer independent-internal-secret-12345678',
    'independent-internal-secret-12345678',
  ),
  true,
);

let now = 100;
const finishes = [];
const seen = [];
const reader = {
  withDeadline: (deadline) => {
    assert.ok(deadline <= now + 20_000);
    return {
      hasSubscriptions: async () => {
        seen.push(now);
        now += 23_000;
        return false;
      },
    };
  },
};
const rpc = async (name, args) => {
  if (name === 'get_family_billing_server_context')
    return { config: { enabled: true }, chains: [], pending_intent: false };
  if (name === 'get_family_billing_reconciliation_work') {
    assert.equal(args.job_limit, 5);
    return ['a', 'b', 'c', 'd', 'e'];
  }
  if (name === 'get_family_billing_recovery_anchors') return [];
  if (name === 'start_family_billing_refresh') return 1;
  if (name === 'finish_family_billing_recovery') {
    finishes.push(args);
    return;
  }
  if (name === 'get_family_billing_recovery_health')
    return { attention_required: false };
  assert.fail(name);
};
const bounded = await runBillingRecovery({ rpc, reader }, { now: () => now });
assert.equal(bounded.completed, 2);
assert.equal(bounded.remaining, 3);
assert.equal(seen.length, 2, 'Time budget leaves unstarted work for next tick');
assert.equal(finishes.length, 2);

for (const status of [401, 403, 429, 503]) {
  finishes.length = 0;
  let calls = 0;
  const result = await runBillingRecovery({
    rpc,
    reader: {
      hasSubscriptions: async () => {
        calls++;
        throw new Error(`BILLING_PROVIDER_HTTP_${status}`);
      },
    },
  });
  const authFailure = status === 401 || status === 403;
  assert.equal(calls, authFailure ? 1 : 5);
  assert.equal(result.review, authFailure ? 1 : 0);
  assert.equal(result.failed, authFailure ? 0 : 5);
  assert.equal(finishes[0].result, authFailure ? 'manual_review' : 'retry');
}
await assert.rejects(
  runBillingRecovery({ rpc: async () => ({ config: { enabled: false } }) }),
  /BILLING_SANDBOX_NOT_CONFIGURED/,
);
let requests = 0;
const provider = createRevenueCatReader({
  secret: 'synthetic-provider-secret',
  projectId: 'proj_fixture',
  now: () => 100,
  fetchImpl: async (_url, options) => {
    requests++;
    assert.equal(options.signal.aborted, false);
    return Response.json({ items: [], next_page: null });
  },
});
assert.equal(
  await provider.withDeadline(101).hasSubscriptions('synthetic-customer'),
  false,
);
await assert.rejects(
  provider.withDeadline(100).hasSubscriptions('synthetic-customer'),
  /TIME_BUDGET/,
);
assert.equal(
  requests,
  1,
  'Expired budget never starts another provider request',
);
console.log(
  'PASS (local mocks): recovery deadline, bounded batch, safe OFF, independent bearer, 401/403 stop + review, transient retry; no provider or database mutation.',
);

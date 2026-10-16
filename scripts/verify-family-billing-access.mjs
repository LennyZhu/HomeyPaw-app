import assert from 'node:assert/strict';
import { subscriptionAccess } from '../supabase/functions/_shared/family-billing-sandbox.mjs';

const now = 2_000_000_000_000;
const sub = {
  starts_at: now - 10000,
  current_period_starts_at: now - 10000,
  current_period_ends_at: now + 1000,
  store_subscription_identifier: 'current-tx',
  status: 'active',
  gives_access: true,
  auto_renewal_status: 'will_renew',
};
const tx = {
  id: 'current-tx',
  purchased_at: sub.current_period_starts_at,
  product_store_identifier: 'monthly',
  expiration_date: sub.current_period_ends_at,
  effective_expiration_date: sub.current_period_ends_at,
};
const access = (s = sub, t = [tx], at = now, mapped = true) =>
  subscriptionAccess(s, t, 'monthly', mapped, at);
assert.equal(access().until, sub.current_period_ends_at);
assert.equal(
  access({ ...sub, auto_renewal_status: 'will_not_renew' }).givesAccess,
  true,
);
assert.equal(
  access({ ...sub, status: 'cancelled', auto_renewal_status: 'will_not_renew' })
    .givesAccess,
  true,
);
for (const status of [
  'in_billing_retry',
  'expired',
  'refunded',
  'revoked',
  'paused',
]) {
  assert.equal(
    access({ ...sub, status, gives_access: false }).givesAccess,
    false,
  );
  assert.throws(() => access({ ...sub, status }), /ACCESS_PENDING/);
}
const grace = {
  ...sub,
  status: 'in_grace_period',
  current_period_ends_at: now - 1000,
};
const graceTx = {
  ...tx,
  expiration_date: grace.current_period_ends_at,
  effective_expiration_date: now + 1000,
};
assert.equal(access(grace, [graceTx]).until, graceTx.effective_expiration_date);
assert.equal(access(grace, [graceTx], now + 999).givesAccess, true);
for (const at of [now + 1000, now + 1001])
  assert.throws(() => access(grace, [graceTx], at), /ACCESS_PENDING/);
assert.throws(
  () => access(sub, [tx], sub.current_period_ends_at),
  /ACCESS_PENDING/,
);
for (const change of [
  { id: 'other-chain-tx' },
  { product_store_identifier: 'yearly' },
  { purchased_at: now - 1 },
  { expiration_date: now + 999999 },
  { effective_expiration_date: null },
  { effective_expiration_date: now - 1 },
])
  assert.throws(
    () => access(grace, [{ ...graceTx, ...change }]),
    /ACCESS_PENDING/,
  );
assert.throws(() => access(grace, []), /ACCESS_PENDING/);
assert.throws(() => access(grace, [graceTx, graceTx]), /ACCESS_PENDING/);
assert.throws(() => access(sub, [tx], now, false), /ACCESS_PENDING/);
assert.throws(() => access({ ...sub, status: 'unknown' }), /ACCESS_PENDING/);
// A different transaction's much later expiry cannot extend the current chain.
assert.equal(
  access(sub, [
    tx,
    { ...tx, id: 'other-tx', effective_expiration_date: now + 99999999 },
  ]).until,
  sub.current_period_ends_at,
);
assert.equal(
  access(sub, [{ ...tx, effective_expiration_date: now + 99999999 }]).until,
  sub.current_period_ends_at,
);
console.log(
  'PASS: chain/current-transaction grace expiry, exact time boundaries, cancel auto-renew, retry/expiry/refund/revoke, unknown/inconsistent provider facts pending, no aggregate or other transaction expiry.',
);

import assert from 'node:assert/strict';
import { read, withBlankFamilyPlus } from './lib/blank-family-plus.mjs';

await withBlankFamilyPlus(async ({ query }) => {
  const output = query(read('scripts/sql/family-billing-sandbox.sql'));
  assert.ok(output.endsWith('FAMILY_BILLING_SQL_COMPLETE'));
  query(read('scripts/sql/family-billing-recovery.sql'));
  query(read('scripts/sql/family-storage-quota-prototype.sql'));
  console.log(
    'PASS: existing Phase 2 quota SQL assertions also execute under the combined Phase 2 + Phase 3 schema.',
  );
  console.log(
    'PASS (synthetic SQL): monthly/yearly intent and binding, Owner/Member/Viewer/Removed/cross-Family authorization, cancel/fail/pending, restore/renew/grace/retry/expiry/refund/revoke, replay conflict, stale refresh fence, Owner transfer, payer exit/deletion, shared Phase 2 entitlement and enforcement OFF.',
  );
});

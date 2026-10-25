import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { withBlankFamilyPlus } from './lib/blank-family-plus.mjs';
import { createClient } from '@supabase/supabase-js';
import { Script } from 'node:vm';
import { z } from 'zod';
import ts from 'typescript';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
await withBlankFamilyPlus(async ({ query, api, anonKey, jwtSecret }) => {
  assert.match(
    query(read('scripts/sql/family-plus-read-summary.sql')),
    /FAMILY_PLUS_READ_SQL_PASS/,
  );
  console.log(
    'PASS: read-only RPC, canonical Owner/Member/Viewer, cross/removed/former/anonymous denial, bounded Plus/expiry/revoke/transition, uninitialized/late upload/cleanup/reservation, candidate monthly ledger and partial coverage.',
  );
  query(read('scripts/sql/family-billing-sandbox.sql'));
  query(read('scripts/sql/family-billing-recovery.sql'));
  query(read('scripts/sql/family-storage-quota-prototype.sql'));
  console.log(
    'PASS: existing Quota + Billing + Recovery SQL regressions against the full blank chain.',
  );
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const id = (who) => query(`select public.rv2_id('${who}');`);
  const token = (who) => {
    const content =
      encode({ alg: 'HS256', typ: 'JWT' }) +
      '.' +
      encode({
        role: 'authenticated',
        sub: id(who),
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 600,
      });
    return (
      content +
      '.' +
      createHmac('sha256', jwtSecret).update(content).digest('base64url')
    );
  };
  for (const who of [
    'owner',
    'member',
    'viewer',
    'removed',
    'former',
    'stranger',
  ]) {
    const response = await fetch(api + '/rest/v1/rpc/get_family_plus_summary', {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + token(who),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_family_id: id('family') }),
    });
    if (['owner', 'member', 'viewer'].includes(who)) {
      assert.equal(response.status, 200);
      const doc = await response.json();
      assert.equal(doc.role, who);
      assert.equal(doc.family_id, id('family'));
      assert.equal(doc.usage.used_bytes, null);
    } else assert.ok([401, 403].includes(response.status));
  }
  query(`begin;
    insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference)
    values(public.rv2_id('family'),'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',false,'HTTP-bounded-synthetic');
    insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
    values(public.rv2_id('http-object'),'post-media',public.rv2_id('owner')||'/'||public.rv2_id('pet')||'/'||public.rv2_id('http-post')||'/'||public.rv2_id('http-object')||'.jpg',public.rv2_id('owner')::text,'synthetic','{"size":1024}');
    select private.sync_family_media_objects(public.rv2_id('family')); commit;`);
  const load = (path, deps) => {
    const module = { exports: {} };
    new Script(
      ts.transpileModule(read(path), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).runInNewContext({
      module,
      exports: module.exports,
      performance,
      URL,
      __DEV__: true,
      process: { env: { EXPO_PUBLIC_SUPABASE_URL: api } },
      require: (name) => {
        assert.ok(name in deps);
        return deps[name];
      },
    });
    return module.exports;
  };
  const model = load('src/features/billing/family-plus-presentation.ts', {});
  const dataAdapter = load('src/features/billing/family-plus-data.ts', {
    zod: { z },
    './family-plus-presentation': model,
  });
  const preview = load('src/features/billing/family-plus-preview.ts', {});
  const environment = load('src/features/billing/family-plus-environment.ts', {
    '@/lib/supabase/environment': {
      supabaseEnvironment: { url: api, sandbox: false },
    },
    './family-plus-preview': preview,
  });
  for (const who of ['owner', 'member', 'viewer']) {
    const client = createClient(api, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + token(who) } },
    });
    const reader = load('src/features/billing/family-plus-api.ts', {
      '@/lib/supabase/client': { requireSupabase: () => client },
      './family-plus-data': dataAdapter,
      './family-plus-environment': environment,
      './family-plus-presentation': model,
    });
    const result = await reader.readFamilyPlusSummary(
      id(who),
      id('family'),
      new AbortController().signal,
    );
    const snapshot = dataAdapter.familyPlusServerSnapshot(
      result.summary,
      result.receivedAt,
    );
    assert.equal(snapshot.storage.usedBytes, 1024);
    assert.equal(snapshot.storage.limitBytes, 5368709120);
    assert.equal(model.familyPlusIdentity(snapshot, false).showBadge, true);
    assert.equal(snapshot.source, 'server');
  }
  console.log(
    'PASS: actual loopback PostgREST/JWT authorization, real supabase-js + client adapter reads bounded synthetic Plus and trusted registry bytes for all roles; no provider calls.',
  );
});

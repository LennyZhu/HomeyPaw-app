import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import ts from 'typescript';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const load = (path, deps = {}, globals = {}) => {
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
    URL,
    performance: { now: () => elapsed },
    ...globals,
    require: (name) => {
      assert.ok(name in deps, `Unexpected dependency ${name}`);
      return deps[name];
    },
  });
  return module.exports;
};
let elapsed = 1000;
const model = load('src/features/billing/family-plus-presentation.ts');
const data = load('src/features/billing/family-plus-data.ts', {
  zod: { z },
  './family-plus-presentation': model,
});
const preview = load('src/features/billing/family-plus-preview.ts');
const keys = load('src/features/family/family-query-keys.ts');
const user = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  family = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const otherUser = 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  otherFamily = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const raw = {
  schema_version: 1,
  family_id: family,
  viewer_user_id: user,
  role: 'owner',
  server_time: '2020-01-01T00:00:00Z',
  status: 'active',
  gives_plus_access: true,
  access_until: '2020-01-01T00:01:00Z',
  entitlement_checked_at: '2020-01-01T00:00:00Z',
  billing_environment: 'SANDBOX',
  limit_bytes: 5368709120,
  storage_enforcement_enabled: false,
  usage: {
    status: 'ready',
    used_bytes: 400 * 1024 ** 2,
    reserved_bytes: 8,
    unpublished_bytes: 2,
    cleanup_pending_bytes: 1,
    unsettled_object_count: 0,
    reconciled_at: '2020-01-01T00:00:00Z',
  },
  videos: {
    status: 'ready',
    published: 4,
    limit: null,
    calendar_time_zone: 'Asia/Hong_Kong',
    counting_scope: 'all_successful',
    period_start: '2020-01-01T00:00:00Z',
    policy_is_candidate: true,
  },
};
const parsed = data.parseFamilyPlusSummary(raw, user, family);
const snap = data.familyPlusServerSnapshot(parsed);
assert.equal(snap.confirmedAt, raw.server_time);
assert.equal(
  model.familyPlusIdentity(snap, false).showBadge,
  true,
  'server time wins over wall clock',
);
elapsed += 60_000;
assert.equal(
  model.familyPlusIdentity(snap, false).showBadge,
  false,
  'exclusive expiry',
);
elapsed = 1000;
for (const role of ['owner', 'member', 'viewer']) {
  const doc = data.parseFamilyPlusSummary({ ...raw, role }, user, family);
  assert.equal(
    data.familyPlusServerSnapshot(doc).storage.usedBytes,
    400 * 1024 ** 2,
  );
}
for (const change of [
  { family_id: otherFamily },
  { viewer_user_id: otherUser },
  { billing_environment: 'PRODUCTION' },
  { gives_plus_access: false },
  { access_until: null },
])
  assert.throws(() =>
    data.parseFamilyPlusSummary({ ...raw, ...change }, user, family),
  );
const unknown = data.familyPlusServerSnapshot(
  data.parseFamilyPlusSummary(
    {
      ...raw,
      status: 'unavailable',
      gives_plus_access: false,
      access_until: null,
      limit_bytes: null,
      usage: { ...raw.usage, status: 'uninitialized', used_bytes: null },
      videos: { ...raw.videos, status: 'not_configured', published: null },
    },
    user,
    family,
  ),
);
assert.equal(unknown.storage, null);
assert.equal(unknown.videos, null);
assert.equal(model.familyPlusIdentity(unknown, false).showBadge, false);
assert.equal(snap.prices.length, 0);

const pending = [];
const fakeSupabase = {
  rpc: (name, args) => {
    assert.equal(name, 'get_family_plus_summary');
    return {
      abortSignal: (signal) =>
        new Promise((resolve) => pending.push({ resolve, signal, args })),
    };
  },
};
const deps = {
  '@/lib/supabase/client': { requireSupabase: () => fakeSupabase },
  './family-plus-data': data,
  './family-plus-preview': preview,
  './family-plus-presentation': model,
};
const env = {
  __DEV__: true,
  process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' } },
};
const api = load('src/features/billing/family-plus-api.ts', deps, env);
const controller = new AbortController();
const success = api.readFamilyPlusSummary(user, family, controller.signal);
pending.shift().resolve({ data: raw, error: null });
assert.equal((await success).summary.role, 'owner');
const cancelledController = new AbortController();
const cancelled = api.readFamilyPlusSummary(
  user,
  family,
  cancelledController.signal,
);
const waiting = pending.shift();
cancelledController.abort();
waiting.resolve({ data: raw, error: null });
await assert.rejects(cancelled, /SCOPE_CHANGED/);
for (const globals of [
  { ...env, __DEV__: false },
  {
    __DEV__: true,
    process: {
      env: {
        EXPO_PUBLIC_SUPABASE_URL: 'https://tknaobmlwmodsqtpqwkr.supabase.co',
      },
    },
  },
])
  await assert.rejects(
    load(
      'src/features/billing/family-plus-api.ts',
      deps,
      globals,
    ).readFamilyPlusSummary(user, family, new AbortController().signal),
    /LOCAL_ONLY/,
  );

let online = true,
  queryResult = {
    data: { summary: parsed, receivedAt: 1000 },
    isPending: false,
    isError: false,
  },
  options;
let previewState = {
  enabled: true,
  mode: 'server',
  snapshot: null,
  setScene: () => undefined,
};
const hook = load('src/features/billing/use-family-plus.ts', {
  react: { useSyncExternalStore: (_s, get) => get() },
  'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
  '@tanstack/react-query': {
    onlineManager: { subscribe: () => () => undefined, isOnline: () => online },
    useQuery: (o) => {
      options = o;
      return { ...queryResult, refetch: () => undefined };
    },
  },
  '@/features/family/family-query-keys': keys,
  './family-plus-api': api,
  './family-plus-data': data,
  './family-plus-presentation': model,
  './use-family-plus-preview': { useFamilyPlusPreview: () => previewState },
});
const input = {
  userId: user,
  familyId: family,
  role: 'owner',
  loading: false,
  error: false,
};
assert.equal(hook.useFamilyPlus(input).snapshot.source, 'server');
const keyA = options.queryKey;
for (const flags of [
  { role: null },
  { loading: true },
  { error: true },
  { userId: otherUser },
  { familyId: otherFamily },
])
  assert.equal(
    model.familyPlusIdentity(
      hook.useFamilyPlus({ ...input, ...flags }).snapshot,
      false,
    ).showBadge,
    false,
  );
queryResult = { ...queryResult, isError: true };
assert.equal(hook.useFamilyPlus(input).snapshot.storage, null);
queryResult = { ...queryResult, isError: false };
online = false;
assert.equal(hook.useFamilyPlus(input).scene, 'offline');
assert.equal(options.enabled, false);
online = true;
previewState = {
  enabled: true,
  mode: 'preview',
  snapshot: preview.familyPlusPreviewSnapshot(true, 'free'),
};
assert.equal(hook.useFamilyPlus(input).snapshot.source, 'development-preview');
assert.equal(options.enabled, false);
// Actual QueryClient: switch keys and clear while old responses are outstanding.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
let resolveOld;
const old = client
  .fetchQuery({
    queryKey: keyA,
    queryFn: ({ signal }) =>
      new Promise((resolve) => {
        resolveOld = () => resolve({ signal, scope: family });
      }),
  })
  .catch(() => undefined);
const keyB = hook.familyPlusKeys(otherUser, otherFamily);
await client.fetchQuery({
  queryKey: keyB,
  queryFn: async () => ({ scope: otherFamily }),
});
resolveOld();
await old;
assert.equal(client.getQueryData(keyB).scope, otherFamily);
let finishLate;
const late = client
  .fetchQuery({
    queryKey: keyA,
    staleTime: 0,
    queryFn: ({ signal }) =>
      new Promise((resolve) => {
        finishLate = () => resolve(signal.aborted ? 'aborted' : 'late');
      }),
  })
  .catch(() => undefined);
client.clear();
finishLate();
await late;
assert.equal(client.getQueryCache().getAll().length, 0);
for (const path of [
  'src/features/billing/family-plus-api.ts',
  'src/features/billing/use-family-plus.ts',
  'src/features/billing/family-plus-data.ts',
])
  assert.doesNotMatch(
    read(path),
    /react-native-purchases|billing-client|\.from\(|\.invoke\(|\.insert\(|\.update\(|AsyncStorage|isPlus|currentPet/,
  );
assert.match(
  read('src/features/billing/family-plus-api.ts'),
  /\.rpc\('get_family_plus_summary'/,
);
console.log(
  'PASS: strict server contract, server-relative expiry, initialized/unknown counts, canonical roles, wrong environment/scope rejection, local-only read API, aborts, cache/account/Family isolation, offline/error hiding, Preview does not query, no SDK/mutation/persistence.',
);

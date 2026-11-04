// Offline JSX, cache/identity and localization checks. No native or service calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const noop = () => {};
function load(path, mocks, globals = {}) {
  const module = { exports: {} };
  new vm.Script(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    { filename: path },
  ).runInNewContext({
    module,
    exports: module.exports,
    Date,
    Intl,
    Math,
    Error,
    ...globals,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
      return mocks[name];
    },
  });
  return module.exports;
}
const model = load('src/features/family/family-member-limit.ts', {
  zod: { z },
});
const keys = load('src/features/family/family-query-keys.ts', {});
const userId = '10000000-0000-4000-a000-000000000001';
const otherUser = '10000000-0000-4000-a000-000000000002';
const familyId = '20000000-0000-4000-a000-000000000001';
const otherFamily = '20000000-0000-4000-a000-000000000002';
const serverTime = Date.parse('2026-11-04T10:00:00Z');
const sample = (count = 1, plus = false) => ({
  schema_version: 1,
  family_id: familyId,
  viewer_user_id: userId,
  server_time: new Date(serverTime).toISOString(),
  member_count: count,
  member_limit: plus ? 10 : 2,
  plus_until: plus ? new Date(serverTime + 1000).toISOString() : null,
  can_create_invite: count < (plus ? 10 : 2),
  reserved_seats: 0,
  invite_expires_at: null,
  legacy_invite_remaining: 0,
});
assert.equal(
  model.parseFamilyMemberCapacity(sample(), userId, familyId).member_limit,
  2,
);
assert.throws(
  () => model.parseFamilyMemberCapacity(sample(), otherUser, familyId),
  /IDENTITY_MISMATCH/,
);
assert.throws(
  () => model.parseFamilyMemberCapacity(sample(), userId, otherFamily),
  /IDENTITY_MISMATCH/,
);
assert.throws(
  () =>
    model.parseFamilyMemberCapacity(
      { ...sample(), member_limit: 10 },
      userId,
      familyId,
    ),
  /IDENTITY_MISMATCH/,
);
for (const count of [1, 2, 5, 11]) {
  const state = model.familyMemberCapacityView(sample(count), serverTime);
  assert.equal(state.count, count);
  assert.equal(state.limit, 2);
  assert.equal(state.canCreate, count < 2);
}
assert.equal(
  model.familyMemberCapacityView(sample(9, true), serverTime).canCreate,
  true,
);
assert.equal(
  model.familyMemberCapacityView(sample(10, true), serverTime).canCreate,
  false,
);
const expired = model.familyMemberCapacityView(
  sample(10, true),
  serverTime + 1001,
);
assert.equal(expired.limit, 2);
assert.equal(expired.count, 10);
assert.equal(expired.canCreate, false);
const reserved = {
  ...sample(),
  reserved_seats: 1,
  legacy_invite_remaining: 1,
  invite_expires_at: new Date(serverTime + 1000).toISOString(),
};
assert.equal(model.familyMemberCapacityView(reserved, serverTime).reserved, 1);
assert.equal(
  model.familyMemberCapacityView(reserved, serverTime + 1001).reserved,
  0,
);
assert.equal(
  model.familyMemberCapacityView(reserved, serverTime + 1001).legacyRemaining,
  0,
);
assert.equal(
  model.isFreeFamilyMemberLimitError({
    message: 'family_member_limit_reached',
    details: 'member_limit=2;plan=free',
  }),
  true,
);
assert.equal(
  model.isFreeFamilyMemberLimitError({
    message: 'family_member_limit_reached',
    details: 'member_limit=10;plan=plus',
  }),
  false,
);
assert.equal(model.isFamilyInvitePermissionError({ code: '42501' }), true);
const runtime = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
};
const hooks = {
  useState: (v) => [typeof v === 'function' ? v() : v, noop],
  useEffect: noop,
  useCallback: (f) => f,
};
const flatten = (node) =>
  !node || typeof node !== 'object'
    ? []
    : Array.isArray(node)
      ? node.flatMap(flatten)
      : [node, ...flatten(node.props?.children)];
function page(
  count,
  plus = false,
  owner = true,
  unavailable = false,
  legacy = false,
) {
  const capacity = model.familyMemberCapacityView(
    {
      ...sample(count, plus),
      can_create_invite: owner && count < (plus ? 10 : 2),
      ...(legacy
        ? {
            legacy_invite_remaining: 2,
            reserved_seats: 2,
            invite_expires_at: new Date(serverTime + 1000).toISOString(),
          }
        : {}),
    },
    serverTime,
  );
  const members = Array.from({ length: count }, (_, i) => ({
    role: i === 0 ? 'owner' : i === 2 ? 'viewer' : 'member',
    userId: i === 0 ? userId : `synthetic-${i}`,
    displayName: `Member ${i}`,
  }));
  const mutation = {
    mutateAsync: async () => {
      throw new Error('No mutation permitted in display checks');
    },
    isPending: false,
  };
  const components = Object.fromEntries(
    [
      'app-button',
      'app-text',
      'avatar',
      'icon-button',
      'loading-view',
      'screen',
    ].map((p) => [
      `@/components/${p}`,
      {
        [p
          .split('-')
          .map((s) => s[0].toUpperCase() + s.slice(1))
          .join('')]: p,
      },
    ]),
  );
  const { default: Screen } = load(
    'src/features/family/pet-members-screen.tsx',
    {
      react: hooks,
      'react/jsx-runtime': runtime,
      'react-native': {
        Alert: { alert: noop },
        Platform: { OS: 'ios' },
        Share: { share: noop },
        StyleSheet: { create: (s) => s },
        View: 'View',
      },
      'expo-router': {
        useLocalSearchParams: () => ({ id: familyId }),
        useRouter: () => ({ push: noop, replace: noop }),
        useFocusEffect: noop,
      },
      'expo-clipboard': {},
      '@expo/vector-icons/Ionicons': 'Icon',
      'react-i18next': {
        useTranslation: () => ({
          i18n: { language: 'en' },
          t: (key, values) => JSON.stringify({ key, ...values }),
        }),
      },
      ...components,
      '@/components/feedback-provider': {
        useFeedback: () => ({ showFeedback: noop }),
      },
      '@/features/auth/auth-context': {
        useAuth: () => ({ user: { id: owner ? userId : otherUser } }),
      },
      '@/features/family/backend-capability': {
        useBackendCapability: () => ({
          data: 'FAMILY_MULTI_PET',
          isPending: false,
          isError: false,
        }),
      },
      '@/features/media/storage-signed-url': { createStorageImageSource: noop },
      '@/features/profile/profile-avatar': { profileAvatarBucket: 'synthetic' },
      '@/features/pets/pet-queries': {
        usePet: () => ({
          data: { id: familyId, family_id: familyId, name: 'Synthetic pet' },
          isPending: false,
          isError: false,
        }),
      },
      '@/theme': { lightColors: {}, radius: {}, spacing: {} },
      './family-member-limit': model,
      './use-family-member-capacity': {
        useFamilyMemberCapacity: () => ({
          capacity: unavailable ? null : capacity,
          canCreate: !unavailable && capacity.canCreate,
          serverNow: serverTime,
          dataUpdatedAt: 1,
          refetch: noop,
        }),
      },
      './family-queries': {
        usePetMembers: () => ({ data: members, refetch: noop }),
        useActivePetInvite: () => ({
          data: legacy
            ? {
                expires_at: new Date(serverTime + 1000).toISOString(),
                max_uses: 5,
                used_count: 3,
              }
            : null,
          refetch: noop,
        }),
        useCreatePetInvite: () => mutation,
        useRevokePetInvite: () => mutation,
        useRemovePetMember: () => mutation,
      },
    },
  );
  return flatten(Screen());
}
const button = (nodes, key) =>
  nodes.find((n) => n.props?.label && JSON.parse(n.props.label).key === key);
const copies = (nodes) =>
  nodes.flatMap((n) =>
    typeof n.props?.children === 'string' && n.props.children.startsWith('{')
      ? [JSON.parse(n.props.children)]
      : [],
  );
for (const [count, plus, disabled] of [
  [1, false, false],
  [2, false, true],
  [5, false, true],
  [9, true, false],
  [10, true, true],
]) {
  const tree = page(count, plus);
  assert.equal(button(tree, 'family.invite.create').props.disabled, disabled);
  assert.equal(
    tree.filter((n) => n.type === 'avatar').length,
    count,
    'Never truncate existing members',
  );
  const line = copies(tree).find((c) => c.key === 'family.members.subtitle');
  assert.equal(line.count, count);
  assert.equal(line.maximum, plus ? 10 : 2);
}
assert.ok(button(page(5), 'family.invite.upgrade'));
assert.equal(button(page(10, true), 'family.invite.upgrade'), undefined);
assert.equal(button(page(1, false, false), 'family.invite.create'), undefined);
assert.equal(
  button(page(1, false, true, true), 'family.invite.create').props.disabled,
  true,
);
const old = page(3, false, true, false, true);
assert.equal(button(old, 'family.invite.regenerate').props.disabled, true);
assert.ok(
  button(old, 'family.invite.revoke'),
  'Legacy invitations remain manageable',
);
assert.ok(copies(old).some((c) => c.key === 'family.invite.legacy'));

// Exercise the actual read hook with controlled query results; only one RPC exists.
let identity = userId,
  online = true,
  cached,
  options,
  onFocus,
  refetches = 0;
const rpcCalls = [];
const hook = load('src/features/family/use-family-member-capacity.ts', {
  react: { ...hooks, useSyncExternalStore: (_s, get) => get() },
  'expo-router': {
    useFocusEffect: (callback) => {
      onFocus = callback;
    },
  },
  '@tanstack/react-query': {
    onlineManager: { subscribe: noop, isOnline: () => online },
    useQuery: (o) => {
      options = o;
      return {
        data: cached,
        isError: false,
        refetch: () => {
          refetches++;
        },
      };
    },
  },
  '@/features/auth/auth-context': {
    useAuth: () => ({ user: identity ? { id: identity } : null }),
  },
  '@/lib/supabase/client': {
    requireSupabase: () => ({
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        return { data: sample(), error: null };
      },
    }),
  },
  '@/features/billing/family-plus-presentation': { monotonicNow: () => 1000 },
  './family-member-limit': model,
  './family-query-keys': keys,
});
hook.useFamilyMemberCapacity(familyId);
assert.equal(options.enabled, true);
onFocus();
assert.equal(refetches, 1, 'Re-entering the screen refreshes capacity');
assert.equal(options.queryKey[1], userId);
assert.ok(options.queryKey.includes(familyId));
cached = await options.queryFn();
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].name, 'get_family_member_capacity');
assert.deepEqual(Object.keys(rpcCalls[0].args), ['target_family_id']);
assert.equal(hook.useFamilyMemberCapacity(familyId).canCreate, true);
identity = otherUser;
assert.equal(hook.useFamilyMemberCapacity(familyId).capacity, null);
identity = userId;
assert.equal(hook.useFamilyMemberCapacity(otherFamily).capacity, null);
online = false;
assert.equal(hook.useFamilyMemberCapacity(familyId).canCreate, false);
onFocus();
identity = null;
hook.useFamilyMemberCapacity(familyId);
assert.equal(options.enabled, false);
onFocus();
assert.equal(
  refetches,
  1,
  'Offline or signed-out focus cannot request capacity',
);
for (const locale of ['en', 'zh-HK']) {
  const copy = JSON.parse(read(`src/i18n/locales/${locale}.json`));
  assert.match(copy.familyPlus.free.members, /2/);
  assert.match(copy.familyPlus.plus.members, /10/);
  assert.match(
    copy.familyPlus.membersIncludeOwner,
    locale === 'en' ? /includes the Owner/ : /包含擁有者/,
  );
  assert.equal(
    copy.familyPlus.benefits.members,
    locale === 'en'
      ? 'Care for your pets with up to 10 family members'
      : '最多 10 位家庭成員共同照顧毛孩',
  );
}
assert.match(
  read('src/features/billing/family-plus-screen.tsx'),
  /\['space', 'members', 'video', 'care'\]/,
);
assert.match(
  read('src/features/billing/family-plus-screen.tsx'),
  /\['space', 'members', 'video', 'sharing'\]/,
);
console.log(
  'PASS: capacity parsing/expiry/identity isolation, Free and Plus counts, historical lists, Owner-only invite controls, legacy display, offline/read-only query, bilingual paywall and Owner-inclusive totals. Mocks only.',
);

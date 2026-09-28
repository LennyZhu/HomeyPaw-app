import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import {
  buildFamilyPushMessage,
  classifyExpoTicket,
  classifyExpoReceipt,
} from '../supabase/functions/family-push/push-core.ts';
import {
  getFamilyPushNavigationTarget,
  canOpenChatPushTarget,
} from '../src/features/reminders/family-push-navigation.ts';
import {
  setFocusedChatForPush,
  shouldSuppressChatPush,
} from '../src/services/chat-push-presentation.ts';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const familyId = '11111111-1111-4111-8111-111111111111';
const otherFamily = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const event = {
  event_id: messageId,
  event_type: 'chat_message',
  activity_kind: 'chat',
  family_id: familyId,
  pet_id: null,
  actor_user_id: 'sender',
  source_id: messageId,
  sender_name: 'Jason',
  body: 'sensitive content must never be sent',
  pet_name: 'private Pet name',
};
const target = {
  delivery_id: 'delivery',
  push_device_id: 'device',
  expo_push_token: 'ExpoPushToken[fixturetoken00]',
  recipient_locale: 'zh-HK',
};
for (const [locale, named, generic] of [
  ['en', 'Jason sent a new message', 'You received a new family chat message'],
  ['zh-HK', 'Jason 發來一則新訊息', '你收到一則新的家庭聊天訊息'],
]) {
  const payload = buildFamilyPushMessage(event, {
    ...target,
    recipient_locale: locale,
  });
  assert.equal(payload.title, 'HomeyPaw');
  assert.equal(payload.body, named);
  assert.deepEqual(payload.data, { type: 'chat_message', familyId, messageId });
  assert.doesNotMatch(
    JSON.stringify(payload),
    /sensitive content|private Pet name|petId|sender_id|"badge"/u,
  );
  for (const sender_name of [null, '', ' \n\u202e ']) {
    assert.equal(
      buildFamilyPushMessage(
        { ...event, sender_name },
        { ...target, recipient_locale: locale },
      ).body,
      generic,
    );
  }
  const long = buildFamilyPushMessage(
    { ...event, sender_name: '😀'.repeat(100) },
    { ...target, recipient_locale: locale },
  );
  assert.equal([...long.body].filter((char) => char === '😀').length, 40);
}
assert.equal(
  buildFamilyPushMessage({ ...event, sender_name: 'Ja\nson\u202e' }, target)
    .body,
  'Ja son 發來一則新訊息',
);
assert.equal(
  buildFamilyPushMessage(event, { ...target, recipient_locale: 'unknown' })
    .body,
  'Jason 發來一則新訊息',
);
for (const [type, kind] of [
  ['journal_created', 'journal'],
  ['care_log_created', 'care'],
  ['care_log_created', 'health'],
  ['reminder_created', 'reminder'],
]) {
  const payload = buildFamilyPushMessage(
    { ...event, event_type: type, activity_kind: kind, pet_id: otherFamily },
    target,
  );
  assert.deepEqual(payload.data, {
    type,
    petId: otherFamily,
    sourceId: messageId,
  });
  assert.ok(payload.body);
}
const chatTarget = getFamilyPushNavigationTarget({
  type: 'chat_message',
  familyId,
  messageId,
});
assert.deepEqual(chatTarget, {
  type: 'chat_message',
  familyId,
  messageId,
  href: '/chat',
});
for (const role of ['owner', 'member'])
  assert.equal(canOpenChatPushTarget(chatTarget, familyId, role), true);
for (const role of ['viewer', null, 'removed', 'former'])
  assert.equal(canOpenChatPushTarget(chatTarget, familyId, role), false);
assert.equal(canOpenChatPushTarget(chatTarget, otherFamily, 'owner'), false);
assert.equal(canOpenChatPushTarget(chatTarget, null, 'owner'), false);
for (const invalid of [
  {},
  { type: 'chat_message', familyId, petId: otherFamily },
  { type: 'chat_message', familyId: 'bad', messageId },
  { type: 'chat_message', familyId, messageId: '../chat' },
]) {
  assert.equal(getFamilyPushNavigationTarget(invalid), null);
}
const data = { type: 'chat_message', familyId, messageId };
setFocusedChatForPush({ familyId, userId: 'recipient' });
assert.equal(shouldSuppressChatPush(data, 'active'), true);
for (const state of ['background', 'inactive', 'unknown'])
  assert.equal(shouldSuppressChatPush(data, state), false);
assert.equal(
  shouldSuppressChatPush({ ...data, familyId: otherFamily }, 'active'),
  false,
);
assert.equal(
  shouldSuppressChatPush({ ...data, type: 'journal_created' }, 'active'),
  false,
);
setFocusedChatForPush(null);
assert.equal(
  shouldSuppressChatPush(data, 'active'),
  false,
  'other screen/unmount/logout keeps existing presentation',
);
assert.equal(
  classifyExpoTicket({
    status: 'error',
    details: { error: 'DeviceNotRegistered' },
  }).outcome,
  'device_not_registered',
);
assert.equal(
  classifyExpoReceipt({
    status: 'error',
    details: { error: 'DeviceNotRegistered' },
  }).outcome,
  'device_not_registered',
);
assert.equal(
  classifyExpoTicket({
    status: 'error',
    details: { error: 'MessageRateExceeded' },
  }).outcome,
  'retry',
);

// Exercise the real Edge request handler with a stub service client and its
// existing local mock transport. No network, tokens, deployment or fixtures.
let handler;
let scenario;
const calls = [];
const previousDeno = globalThis.Deno;
const previousClient = globalThis.__chatPushCreateClient;
globalThis.Deno = {
  env: {
    get: (name) =>
      ({
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
      })[name],
  },
  serve: (value) => {
    handler = value;
  },
};
globalThis.__chatPushCreateClient = () => ({
  rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'claim_family_push_receipts') return { data: [], error: null };
    if (name === 'claim_family_notification_event')
      return { data: scenario.events.splice(0, 1), error: null };
    if (name === 'claim_family_notification_targets')
      return { data: scenario.targets, error: null };
    if (name === 'validate_family_notification_delivery')
      return {
        data: scenario.valid.includes(args.target_delivery_id),
        error: scenario.validationError ?? null,
      };
    return { data: true, error: null };
  },
});
try {
  const source = read('supabase/functions/family-push/index.ts')
    .replace(
      "import { createClient } from 'npm:@supabase/supabase-js@2';",
      'const createClient = globalThis.__chatPushCreateClient;',
    )
    .replace(
      "'./push-core.ts'",
      JSON.stringify(
        new URL(
          '../supabase/functions/family-push/push-core.ts',
          import.meta.url,
        ).href,
      ),
    );
  await import(
    `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`
  );
  const request = (authorization = 'Bearer fixture-service-key') =>
    new Request('http://localhost/family-push', {
      method: 'POST',
      headers: { Authorization: authorization },
      body: JSON.stringify({ maxEvents: 1 }),
    });
  assert.equal((await handler(request('Bearer ordinary-user'))).status, 403);
  scenario = {
    events: [event],
    targets: [
      { ...target, delivery_id: 'deleted' },
      { ...target, delivery_id: 'allowed' },
    ],
    valid: ['allowed'],
  };
  calls.length = 0;
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).transport, 'mock');
  assert.deepEqual(
    calls
      .filter(([name]) => name === 'record_family_push_delivery')
      .map(([, args]) => args.target_delivery_id),
    ['allowed'],
  );
  assert.ok(
    calls.findIndex(
      ([name]) => name === 'validate_family_notification_delivery',
    ) < calls.findIndex(([name]) => name === 'record_family_push_delivery'),
  );
  scenario = {
    events: [event],
    targets: [target],
    valid: [],
    validationError: { code: 'fixture validation unavailable' },
  };
  calls.length = 0;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    assert.equal((await handler(request())).status, 200);
  } finally {
    console.error = originalError;
  }
  assert.equal(
    calls.find(([name]) => name === 'record_family_push_delivery')[1]
      .delivery_outcome,
    'failed',
    'fail closed when final validation unavailable',
  );
} finally {
  if (previousDeno === undefined) delete globalThis.Deno;
  else globalThis.Deno = previousDeno;
  if (previousClient === undefined) delete globalThis.__chatPushCreateClient;
  else globalThis.__chatPushCreateClient = previousClient;
}
const coordinator = read(
  'src/features/reminders/care-task-notification-coordinator.tsx',
);
assert.match(coordinator, /getLastNotificationResponse/u);
assert.match(coordinator, /addNotificationResponseReceivedListener/u);
assert.match(coordinator, /pendingResponse/u);
assert.match(coordinator, /!navigationReady/u);
assert.match(coordinator, /familyContextPending/u);
assert.match(coordinator, /\.from\('family_members'\)/u);
assert.match(
  coordinator,
  /if \(familyTarget.type !== 'chat_message'\)\s*\{\s*useCurrentPetStore/u,
);
assert.match(
  read('src/services/family-push-device.ts'),
  /device_chat_push_v1: true/u,
);
assert.match(
  read('src/features/chat/chat-session-provider.tsx'),
  /return \(\) => setFocusedChatForPush\(null\)/u,
);
assert.doesNotMatch(
  read('supabase/migrations/20260928072854_family_chat_remote_push_v1.sql'),
  /from public\.pet_members|join public\.pet_members/iu,
);
assert.doesNotMatch(
  read('supabase/functions/family-push/index.ts'),
  /mark_family_chat_read|family_chat_read_states|get_family_chat_unread_count/u,
);
console.log(
  'PASS: Chat localized/name/fallback/private payload, existing activity payloads, canonical navigation roles and Pet independence, foreground/background behavior, token invalidation, real Edge handler service authorization/final validation/skip/fail-closed and unread independence.',
);

// Execute the real coordinator with bounded hook/platform stubs. This verifies
// response retention across cold-start readiness, background taps and revoke
// decisions, without mounting native UI or introducing a test framework.
const navigationCalls = [];
const petSelections = [];
const refs = [];
let refIndex = 0;
let effectCallbacks = [];
let cleanups = [];
let responseListener;
let lastResponse;
let authReady = false;
let rootReady = false;
let contextPending = true;
let currentFamily = familyId;
let role = 'member';
let membershipLookup = async () => ({
  data: role ? { role } : null,
  error: null,
});
const runtime = {
  router: {
    push: (href) => navigationCalls.push(['push', href]),
    replace: (href) => navigationCalls.push(['replace', href]),
  },
  useRootNavigationState: () => (rootReady ? { key: 'root' } : undefined),
  useAuth: () => ({
    session: authReady ? { user: { id: 'recipient' } } : null,
    isPasswordRecovery: false,
    isProcessingAuthCallback: false,
    isProfileSetupPending: false,
  }),
  useCurrentFamily: () => ({
    currentFamilyId: currentFamily,
    capabilityQuery: { isPending: contextPending, isError: false },
    familiesQuery: { isPending: contextPending, isError: false },
    petsQuery: { isPending: contextPending, isError: false },
  }),
  useRef: (initial) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };
    return refs[index];
  },
  useEffect: (callback) => effectCallbacks.push(callback),
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'ios' },
  syncCareTaskNotifications: async () => undefined,
  requireSupabase: () => ({
    from: (table) => {
      assert.equal(table, 'family_members');
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => membershipLookup(),
      };
      return builder;
    },
  }),
  useCurrentPetStore: {
    getState: () => ({
      setCurrentPetId: (...args) => petSelections.push(args),
    }),
  },
  Notifications: {
    getLastNotificationResponse: () => lastResponse,
    clearLastNotificationResponseAsync: async () => {
      lastResponse = null;
    },
    addNotificationResponseReceivedListener: (listener) => {
      responseListener = listener;
      return {
        remove: () => {
          responseListener = undefined;
        },
      };
    },
  },
};
const previousRuntime = globalThis.__chatPushNavigationRuntime;
globalThis.__chatPushNavigationRuntime = runtime;
try {
  const bindings = {
    'expo-notifications': 'const Notifications=runtime.Notifications;',
    'expo-router': 'const {router,useRootNavigationState}=runtime;',
    react: 'const {useRef,useEffect}=runtime;',
    'react-native': 'const {AppState,Platform}=runtime;',
    '@/features/auth/auth-context': 'const {useAuth}=runtime;',
    '@/features/family/use-current-family': 'const {useCurrentFamily}=runtime;',
    '@/services/care-task-notifications':
      'const {syncCareTaskNotifications}=runtime;',
    '@/lib/supabase/client': 'const {requireSupabase}=runtime;',
    '@/stores/current-pet-store': 'const {useCurrentPetStore}=runtime;',
    './family-push-navigation': `import {getFamilyPushNavigationTarget,canOpenChatPushTarget} from '${new URL('../src/features/reminders/family-push-navigation.ts', import.meta.url).href}';`,
  };
  let source = coordinator;
  const parsed = ts.createSourceFile(
    'coordinator.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of [...parsed.statements].reverse()) {
    if (!ts.isImportDeclaration(statement)) continue;
    const binding = bindings[statement.moduleSpecifier.text];
    assert.ok(
      binding,
      `Unexpected coordinator dependency: ${statement.moduleSpecifier.text}`,
    );
    source =
      source.slice(0, statement.getFullStart()) +
      '\n' +
      binding +
      source.slice(statement.end);
  }
  source = 'const runtime=globalThis.__chatPushNavigationRuntime;\n' + source;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const { CareTaskNotificationCoordinator } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  );
  const render = () => {
    for (const cleanup of cleanups) cleanup?.();
    refIndex = 0;
    effectCallbacks = [];
    CareTaskNotificationCoordinator();
    cleanups = effectCallbacks.map((callback) => callback());
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const response = (id, extra = {}) => ({
    notification: {
      request: {
        identifier: id,
        content: {
          data: { type: 'chat_message', familyId, messageId, ...extra },
        },
      },
    },
  });
  lastResponse = response('cold-start');
  render();
  await flush();
  assert.deepEqual(navigationCalls, []);
  authReady = true;
  render();
  await flush();
  assert.deepEqual(navigationCalls, [], 'wait for root');
  rootReady = true;
  render();
  await flush();
  assert.deepEqual(navigationCalls, [], 'wait for Family');
  contextPending = false;
  render();
  await flush();
  assert.deepEqual(navigationCalls, [['push', '/chat']]);
  assert.deepEqual(petSelections, []);
  responseListener(response('cold-start'));
  await flush();
  assert.equal(navigationCalls.length, 1, 'same response opens once');
  responseListener(
    response('background', {
      url: `/reminders/${messageId}`,
      petId: otherFamily,
    }),
  );
  await flush();
  assert.deepEqual(
    navigationCalls.at(-1),
    ['push', '/chat'],
    'typed Chat overrides legacy URL',
  );
  assert.deepEqual(petSelections, [], 'another selected Pet is never changed');
  for (const deniedRole of ['viewer', null]) {
    role = deniedRole;
    responseListener(response(`denied-${deniedRole}`));
    await flush();
    assert.deepEqual(navigationCalls.at(-1), ['replace', '/']);
  }
  role = 'owner';
  currentFamily = otherFamily;
  render();
  responseListener(response('wrong-family'));
  await flush();
  assert.deepEqual(navigationCalls.at(-1), ['replace', '/']);
  currentFamily = familyId;
  render();
  let resolveMembership;
  membershipLookup = () =>
    new Promise((resolve) => {
      resolveMembership = resolve;
    });
  const beforeLogout = navigationCalls.length;
  responseListener(response('logout-during-lookup'));
  await flush();
  authReady = false;
  render();
  resolveMembership({ data: { role: 'member' }, error: null });
  await flush();
  assert.equal(
    navigationCalls.length,
    beforeLogout,
    'logout cancels stale navigation',
  );
  assert.deepEqual(petSelections, []);
  console.log(
    'PASS: actual notification coordinator retains cold-start responses until session/root/Family ready, handles background taps, ignores Pet selection/legacy URL for Chat, rejects Viewer/Removed/cross-Family and cancels navigation after logout.',
  );
} finally {
  for (const cleanup of cleanups) cleanup?.();
  if (previousRuntime === undefined)
    delete globalThis.__chatPushNavigationRuntime;
  else globalThis.__chatPushNavigationRuntime = previousRuntime;
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';

import {
  chatKeys,
  getFamilyChatTopic,
} from '../src/features/chat/chat-scope.ts';

const load = (path, dependencies, globals = {}) => {
  const module = { exports: {} };
  new Script(
    ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { filename: path },
  ).runInNewContext({
    module,
    exports: module.exports,
    Error,
    AbortController,
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const familyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const familyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const messageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Run the real hook with deterministic React/native/transport adapters. No app,
// auth login, socket, database, device or new test framework is involved.
function harness() {
  const slots = [];
  let cursor = 0,
    dirty = false,
    effects = [],
    options,
    value;
  const calls = [],
    logs = [],
    channels = [],
    authListeners = new Set();
  const appListeners = new Set(),
    networkListeners = new Set(),
    timers = new Map();
  let timerId = 0;
  const responses = {
    auth: [],
    version: [],
    message: [],
    cancel: [],
    remove: [],
  };
  const take = (kind, fallback) =>
    responses[kind].shift() ?? Promise.resolve(fallback);
  const react = {
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (update) => {
          const next =
            typeof update === 'function' ? update(slots[index].value) : update;
          if (!Object.is(next, slots[index].value)) {
            slots[index].value = next;
            dirty = true;
          }
        },
      ];
    },
    useEffect(callback, deps) {
      const index = cursor++,
        previous = slots[index];
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps[n])))
        effects.push({ index, callback, deps, cleanup: previous?.cleanup });
    },
  };
  const client = {
    realtime: { setAuth: () => take('auth') },
    removeChannel: async (channel) => {
      await take('remove', 'ok');
      channel.removed = true;
      calls.push(['remove', channel.topic]);
    },
    channel(topic) {
      const existing = channels.find((c) => c.topic === topic && !c.removed);
      if (existing) return existing;
      const channel = {
        topic,
        state: 'joining',
        removed: false,
        handlers: {},
        on(_kind, { event }, callback) {
          this.handlers[event] = callback;
          return this;
        },
        subscribe(callback) {
          assert.equal(
            this.joinedOnce,
            undefined,
            'SDK channel must not be subscribed twice',
          );
          this.joinedOnce = true;
          this.status = callback;
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    auth: {
      onAuthStateChange(callback) {
        authListeners.add(callback);
        return {
          data: {
            subscription: { unsubscribe: () => authListeners.delete(callback) },
          },
        };
      },
    },
  };
  const queryClient = {
    invalidateQueries: async ({ queryKey }) => {
      calls.push(['invalidate', queryKey]);
    },
    cancelQueries: ({ queryKey }) => {
      calls.push(['cancel', queryKey]);
      return take('cancel');
    },
    removeQueries: ({ queryKey }) => calls.push(['clear', queryKey]),
    setQueryData: (...args) => calls.push(['set', ...args]),
  };
  const app = {
    currentState: 'active',
    addEventListener(_kind, callback) {
      appListeners.add(callback);
      return { remove: () => appListeners.delete(callback) };
    },
  };
  const queries = {
    chatKeys,
    clearChatFamilyCache: (...args) =>
      calls.push(['clear-family', ...args.slice(1)]),
    fetchChatChannelVersion: (...args) => {
      calls.push(['version', ...args]);
      return take('version', 1);
    },
    fetchChatMessageById: (...args) => {
      calls.push(['message', ...args]);
      return take('message', null);
    },
    isChatAccessError: (error) => error?.code === '42501',
    mergeChatMessage: (...args) => calls.push(['merge', ...args.slice(1)]),
    removeChatMessageFromCache: (...args) =>
      calls.push(['delete', ...args.slice(1)]),
  };
  const { useChatRealtime: runHook } = load(
    'src/features/chat/use-chat-realtime.ts',
    {
      react,
      '@tanstack/react-query': { useQueryClient: () => queryClient },
      'react-native': { AppState: app },
      '@react-native-community/netinfo': {
        addEventListener(callback) {
          networkListeners.add(callback);
          return () => networkListeners.delete(callback);
        },
      },
      '@/lib/logger': { logError: (...args) => logs.push(args) },
      '@/lib/supabase/client': { requireSupabase: () => client },
      '@/features/family/family-query-keys': {
        familyKeys: {
          members: (...args) => ['members', ...args],
          detail: (...args) => ['family', ...args],
        },
      },
      '@/features/pets/pet-queries': { petKeys: { all: (id) => ['pets', id] } },
      './chat-queries': queries,
      './chat-scope': { getFamilyChatTopic },
      './chat-presentation': {
        consumeCreatedMessageId: (seen, id) =>
          seen.has(id) ? false : (seen.add(id), true),
        shouldInvalidateChatUnread: (sender, current) => sender !== current,
      },
    },
    {
      setTimeout: (callback) => {
        timers.set(++timerId, callback);
        return timerId;
      },
      setInterval: (callback) => {
        timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      clearInterval: (id) => timers.delete(id),
    },
  );
  const render = (changes = {}) => {
    options = { ...options, ...changes };
    cursor = 0;
    effects = [];
    dirty = false;
    value = runHook(options);
    for (const effect of effects) effect.cleanup?.();
    for (const effect of effects)
      slots[effect.index] = { deps: effect.deps, cleanup: effect.callback() };
    return value;
  };
  const flush = async () => {
    for (let n = 0; n < 30; n++) {
      await Promise.resolve();
      if (dirty) render();
    }
  };
  const unmount = () => {
    for (const slot of slots) slot?.cleanup?.();
  };
  const start = async () => {
    render({
      userId: 'owner-a',
      familyId: familyA,
      channelVersion: 1,
      enabled: true,
      onAccessLost: () => calls.push(['lost']),
    });
    await flush();
    channels.at(-1).status('SUBSCRIBED');
    await flush();
    channels.at(-1).status('SUBSCRIBED');
    await flush();
    assert.equal(value.status, 'subscribed');
    calls.length = 0;
  };
  return {
    start,
    render,
    flush,
    unmount,
    responses,
    calls,
    logs,
    channels,
    timers,
    get value() {
      return value;
    },
    auth(event, id) {
      for (const callback of authListeners)
        callback(event, id ? { user: { id } } : null);
    },
    foreground(state) {
      app.currentState = state;
      for (const callback of appListeners) callback(state);
    },
    network(connected) {
      for (const callback of networkListeners)
        callback({ isConnected: connected, isInternetReachable: connected });
    },
  };
}

const h = harness();
await h.start();
const waiting = deferred();
h.responses.version.push(waiting.promise);
const first = h.value.validateAndReconcile();
await h.flush();
const duplicate = h.value.validateAndReconcile();
await h.flush();
assert.equal(
  h.calls.filter(([kind]) => kind === 'version').length,
  1,
  'overlapping reconcile must share one request',
);
waiting.resolve(1);
await Promise.all([first, duplicate]);
assert.equal(h.calls.filter(([kind]) => kind === 'invalidate').length, 3);
h.unmount();

const stale = harness();
await stale.start();
const pending = deferred();
stale.responses.version.push(pending.promise);
const request = stale.value.validateAndReconcile();
await stale.flush();
const signal = stale.calls.find(([kind]) => kind === 'version')[2];
stale.unmount();
pending.reject({ code: '42501', message: 'old account is no longer a member' });
await request;
assert.equal(
  signal?.aborted,
  true,
  'cleanup must abort outstanding room requests',
);
assert.equal(
  stale.logs.length,
  0,
  'retired requests must not log current-session failures',
);
assert.equal(
  stale.calls.some(([kind]) => kind === 'lost'),
  false,
);
assert.equal(
  stale.calls.some(
    ([kind]) => kind === 'invalidate' || kind === 'clear-family',
  ),
  false,
);

const auth = harness();
await auth.start();
const authWait = deferred();
auth.responses.auth.push(authWait.promise);
const authRequest = auth.value.validateAndReconcile();
auth.auth('SIGNED_OUT', null);
authWait.resolve();
await authRequest;
assert.equal(
  auth.calls.some(([kind]) => kind === 'version'),
  false,
  'logout before React cleanup must fence the old Family RPC',
);
auth.render({ userId: 'member-a' });
await auth.flush();
assert.notEqual(
  auth.value.status,
  'subscribed',
  'new account must wait for its own control channel',
);
assert.equal(
  auth.channels.filter((c) => c.topic.includes('owner-a') && !c.removed).length,
  0,
);
auth.unmount();

const retiring = harness();
await retiring.start();
const oldRoom = retiring.channels.find(
  (c) => c.topic === getFamilyChatTopic(familyA, 1),
);
const removal = deferred();
retiring.responses.remove.push(removal.promise);
retiring.auth('SIGNED_IN', 'member-a');
retiring.render({ userId: 'member-a' });
await retiring.flush();
retiring.channels.at(-1).status('SUBSCRIBED');
await retiring.flush();
assert.equal(
  retiring.channels.filter((c) => c.topic === oldRoom.topic).length,
  1,
  'new subscription must await old SDK channel removal',
);
removal.resolve('ok');
await retiring.flush();
assert.equal(oldRoom.removed, true);
assert.notEqual(retiring.channels.at(-1), oldRoom);
assert.equal(retiring.logs.length, 0);
retiring.unmount();

const callbacks = harness();
await callbacks.start();
callbacks.render({ onAccessLost: () => callbacks.calls.push(['latest-lost']) });
await callbacks.flush();
assert.equal(
  callbacks.channels.length,
  2,
  'callback/token refresh alone must not recreate subscriptions',
);
callbacks.responses.version.push(
  Promise.reject({ code: '42501', message: 'family not found' }),
);
await callbacks.value.validateAndReconcile();
assert.equal(
  callbacks.calls.some(([kind]) => kind === 'latest-lost'),
  true,
  'current permission denial still clears access using latest callback',
);
callbacks.unmount();

const switching = harness();
await switching.start();
const familyRequest = deferred();
switching.responses.version.push(familyRequest.promise);
const oldRequest = switching.value.validateAndReconcile();
await switching.flush();
switching.render({ familyId: familyB });
await switching.flush();
switching.channels.at(-1).status('SUBSCRIBED');
await switching.flush();
familyRequest.reject({ code: '42501', message: 'retired family' });
await oldRequest;
assert.equal(switching.logs.length, 0);
assert.equal(
  switching.calls.some(([kind]) => kind === 'lost'),
  false,
);
assert.equal(switching.value.status, 'subscribed');
switching.unmount();

const offline = harness();
await offline.start();
offline.network(false);
await offline.value.validateAndReconcile();
assert.equal(offline.calls.length, 0, 'offline polling must not launch RPCs');
offline.network(true);
await offline.flush();
assert.equal(offline.calls.filter(([kind]) => kind === 'version').length, 1);
offline.calls.length = 0;
offline.foreground('background');
await offline.value.validateAndReconcile();
assert.equal(offline.calls.length, 0);
offline.foreground('active');
await offline.flush();
assert.equal(offline.calls.filter(([kind]) => kind === 'version').length, 1);
offline.unmount();
assert.equal(offline.timers.size, 0);

const failure = harness();
await failure.start();
failure.responses.version.push(
  Promise.reject({
    code: 'PGRST002',
    status: 503,
    message: 'service unavailable',
  }),
);
await failure.value.validateAndReconcile();
assert.equal(
  failure.logs.length,
  1,
  'genuine current-session errors remain observable',
);
assert.equal(failure.logs[0][0], 'chat_realtime_reconcile_failed');
assert.equal(failure.logs[0][2].phase, 'channel_version');
assert.equal(JSON.stringify(failure.logs[0][2]).includes(familyA), false);
failure.unmount();

const events = harness();
await events.start();
const room = events.channels.find(
  (c) => c.topic === getFamilyChatTopic(familyA, 1),
);
const row = { id: messageId, family_id: familyA, sender_id: 'member-a' };
events.responses.message.push(Promise.resolve(row));
await room.handlers.message_created({ payload: { message_id: messageId } });
await room.handlers.message_created({ payload: { message_id: messageId } });
assert.equal(events.calls.filter(([kind]) => kind === 'merge').length, 1);
assert.ok(
  events.calls.some(
    ([kind, key]) =>
      kind === 'invalidate' &&
      JSON.stringify(key) ===
        JSON.stringify(chatKeys.unread('owner-a', familyA)),
  ),
);
events.responses.message.push(Promise.resolve({ ...row, family_id: familyB }));
await room.handlers.message_updated({ payload: { message_id: messageId } });
assert.equal(
  events.calls.filter(([kind]) => kind === 'merge').length,
  1,
  'cross-Family rows cannot enter cache',
);
events.responses.message.push(Promise.resolve(row));
await room.handlers.message_updated({ payload: { message_id: messageId } });
assert.equal(events.calls.filter(([kind]) => kind === 'merge').length, 2);
await room.handlers.message_deleted({ payload: { message_id: messageId } });
assert.equal(events.calls.filter(([kind]) => kind === 'delete').length, 1);
events.unmount();

// Exercise the installed Supabase SDK and the real query functions with an
// in-memory fetch transport. This also verifies HTTP status and AbortSignal
// propagation, rather than assuming an Error instance from PostgREST.
let transportMode = 'error';
const requests = [];
const sdk = createClient('https://chat-fixture.invalid', 'public-fixture', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: async (url, init) => {
      requests.push({ url, signal: init.signal });
      if (init.signal?.aborted)
        throw new DOMException('fixture aborted', 'AbortError');
      if (transportMode === 'network')
        throw new TypeError('Network request failed');
      return new Response(
        JSON.stringify(
          transportMode === 'error'
            ? {
                code: 'PGRST002',
                message: 'fixture database unavailable',
                details: 'private row',
                hint: 'private hint',
              }
            : 1,
        ),
        {
          status: transportMode === 'error' ? 400 : 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  },
});
const queryApi = load('src/features/chat/chat-queries.ts', {
  '@tanstack/react-query': {},
  '@/features/auth/auth-context': {},
  '@/features/profile/profile-avatar': {},
  '@/lib/supabase/client': { requireSupabase: () => sdk },
  './chat-cache': {},
  './chat-scope': { chatKeys },
});
await assert.rejects(
  queryApi.fetchChatChannelVersion(familyA),
  (error) => error.code === 'PGRST002' && error.status === 400,
);
transportMode = 'network';
await assert.rejects(
  queryApi.fetchChatChannelVersion(familyA),
  (error) =>
    error.status === 0 && error.message.includes('Network request failed'),
);
transportMode = 'success';
const controller = new AbortController();
assert.equal(
  await queryApi.fetchChatChannelVersion(familyA, controller.signal),
  1,
);
assert.equal(requests.at(-1).signal, controller.signal);
controller.abort();
await assert.rejects(
  queryApi.fetchChatMessageById(messageId, controller.signal),
  (error) => error.status === 0 && error.message.includes('AbortError'),
);
assert.equal(requests.at(-1).signal, controller.signal);

for (const dev of [true, false]) {
  const logs = [];
  const { logError } = load(
    'src/lib/logger.ts',
    {},
    {
      __DEV__: dev,
      console: { error: (...args) => logs.push(JSON.parse(args[1])) },
    },
  );
  logError(
    'chat_realtime_reconcile_failed',
    {
      code: 'PGRST002',
      status: 503,
      message:
        'service failed for fixture@example.test https://example.test/private?token=fixture',
      details: 'private payload must not be logged',
      hint: 'private hint',
    },
    {
      phase: 'channel_version',
      userId: 'private-account',
      token: 'private-token',
    },
  );
  const output = logs[0];
  assert.notEqual(
    output.error.name,
    'UnknownError',
    'plain Supabase errors must retain useful diagnostics',
  );
  assert.equal(output.error.code, 'PGRST002');
  assert.equal(output.error.status, 503);
  assert.equal('message' in output.error, dev);
  assert.doesNotMatch(
    JSON.stringify(output),
    /fixture@example|https:\/\/|private payload|private hint|private-account|private-token/,
  );
}
console.log(
  'PASS: real hook lifecycle, account fencing, abort/single-flight, offline/foreground recovery, scoped control channel, message/edit/delete/unread isolation; sanitized plain-object error diagnostics in DEV and Release.',
);

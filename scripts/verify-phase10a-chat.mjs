import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function count(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

const migration = read(
  'supabase/migrations/20260907090000_phase10a_secure_family_chat.sql',
);
const queries = read('src/features/chat/chat-queries.ts');
const cache = read('src/features/chat/chat-cache.ts');
const realtime = read('src/features/chat/use-chat-realtime.ts');
const screen = read('src/features/chat/chat-screen.tsx');
const sessionProvider = read('src/features/chat/chat-session-provider.tsx');
const composer = read(
  'src/features/chat/components/production-chat-composer.tsx',
);
const messageList = read(
  'src/features/chat/components/production-chat-message-list.tsx',
);
const editModal = read(
  'src/features/chat/components/chat-edit-message-modal.tsx',
);
const route = read('src/app/(tabs)/chat.tsx');
const previewRoute = read('src/app/chat-preview.tsx');
const previewScreen = read('src/features/chat/chat-preview-screen.tsx');
const rootLayout = read('src/app/_layout.tsx');
const tabs = read('src/app/(tabs)/_layout.tsx');
const homeRoute = read('src/app/(tabs)/index.tsx');
const featureFlags = read('src/config/features.ts');
const backendTarget = read('src/config/backend-target.ts');
const databaseTypes = read('src/types/database.ts');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const zhHK = JSON.parse(read('src/i18n/locales/zh-HK.json'));
const rotationStart = migration.indexOf(
  'create or replace function private.rotate_pet_chat_channel(',
);
const rotationEnd = migration.indexOf('$$;', rotationStart);
const rotationDefinition = migration.slice(rotationStart, rotationEnd);

assert(
  migration.includes('create table public.chat_messages') &&
    migration.includes('create table public.chat_read_states') &&
    migration.includes('create table private.pet_chat_states'),
  'Chat messages, read state, or private channel state table is missing.',
);
assert(
  count(migration, /on delete cascade/gu) >= 5,
  'Expected additive cascade FKs for pet, sender, and read-state cleanup.',
);
assert(
  migration.includes('unique (sender_id, client_message_id)') &&
    migration.includes(
      'on public.chat_messages (pet_id, created_at desc, id desc)',
    ),
  'Idempotency constraint or stable cursor index is missing.',
);
assert(
  migration.includes('char_length(body) between 1 and 2000') &&
    migration.includes("safe_body := btrim(coalesce(message_body, ''))"),
  'Server and table message validation are incomplete.',
);
assert(
  migration.includes(
    'alter table public.chat_messages enable row level security',
  ) &&
    migration.includes(
      'alter table public.chat_read_states enable row level security',
    ) &&
    migration.includes(
      'grant select on table public.chat_messages to authenticated',
    ) &&
    !migration.includes('grant insert on table public.chat_messages') &&
    !migration.includes('grant delete on table public.chat_messages'),
  'Chat RLS or direct-table privilege boundary is incorrect.',
);
assert(
  migration.includes('private.can_contribute_to_pet(pet_id)') &&
    migration.includes("membership.role in ('owner', 'member')"),
  'Chat access is not bound to the existing Owner/Member semantics.',
);
assert(
  migration.includes('create or replace function public.send_chat_message') &&
    migration.includes('caller_id := auth.uid()') &&
    migration.includes('caller_id,') &&
    !/send_chat_message\([\s\S]{0,240}sender_id/gu.test(migration),
  'Send RPC does not clearly server-bind sender identity.',
);

for (const [name, revokeSignature] of [
  ['private.initialize_pet_chat_state', 'private.initialize_pet_chat_state()'],
  [
    'private.can_receive_pet_chat_broadcast',
    'private.can_receive_pet_chat_broadcast(text)',
  ],
  [
    'private.can_receive_chat_control_broadcast',
    'private.can_receive_chat_control_broadcast(text)',
  ],
  [
    'private.broadcast_pet_chat_change',
    'private.broadcast_pet_chat_change(uuid, text, uuid)',
  ],
  [
    'private.broadcast_pet_chat_rotation',
    'private.broadcast_pet_chat_rotation(uuid)',
  ],
  ['private.rotate_pet_chat_channel', 'private.rotate_pet_chat_channel(uuid)'],
  [
    'private.rotate_pet_chat_channel_on_membership',
    'private.rotate_pet_chat_channel_on_membership()',
  ],
  [
    'private.broadcast_chat_message_mutation',
    'private.broadcast_chat_message_mutation()',
  ],
  [
    'private.lock_pet_chat_membership',
    'private.lock_pet_chat_membership(uuid)',
  ],
  [
    'public.get_pet_chat_channel_version',
    'public.get_pet_chat_channel_version(uuid)',
  ],
  [
    'public.get_chat_messages_page',
    'public.get_chat_messages_page(uuid, timestamptz, uuid, integer)',
  ],
  ['public.send_chat_message', 'public.send_chat_message(uuid, uuid, text)'],
  ['public.update_chat_message', 'public.update_chat_message(uuid, text)'],
  ['public.delete_chat_message', 'public.delete_chat_message(uuid)'],
  ['public.mark_chat_read', 'public.mark_chat_read(uuid, uuid)'],
  ['public.get_chat_unread_count', 'public.get_chat_unread_count(uuid)'],
  ['public.get_pet_chat_members', 'public.get_pet_chat_members(uuid)'],
]) {
  const start = migration.indexOf(`create or replace function ${name}`);
  const end = migration.indexOf('$$;', start);
  const definition = migration.slice(start, end);
  assert(start >= 0, `Missing SECURITY DEFINER function: ${name}`);
  assert(
    definition.includes("security definer\nset search_path = ''"),
    `${name} is missing SECURITY DEFINER with a fixed search_path.`,
  );
  assert(
    migration.includes(`revoke execute on function ${revokeSignature}`),
    `${name} is missing an explicit PUBLIC/anon revoke.`,
  );
}

assert(
  migration.includes('on realtime.messages') &&
    migration.includes("extension = 'broadcast'") &&
    migration.includes('private.can_receive_pet_chat_broadcast') &&
    migration.includes('private.can_receive_chat_control_broadcast') &&
    migration.includes('state.channel_version = requested_version') &&
    migration.includes('requested_topic = private.user_chat_control_topic') &&
    count(migration, /on realtime\.messages\n  for select/gu) === 2 &&
    !migration.includes('for insert\n  to authenticated'),
  'Private Broadcast authorization is incomplete or grants client send access.',
);
assert(
  realtime.includes('config: { private: true }') &&
    realtime.includes('await client.realtime.setAuth()') &&
    realtime.includes('const messageId = event.payload?.message_id') &&
    realtime.includes('payload?.pet_id') &&
    !realtime.includes('payload?.id') &&
    !realtime.includes('postgres_changes'),
  'Client must authenticate private Broadcast and ignore framework metadata.',
);
assert(
  migration.includes("'message_id', target_message_id") &&
    migration.includes("'type', change_type") &&
    migration.includes("'type', 'chat_channel_rotated'") &&
    migration.includes("'pet_id', target_pet_id") &&
    !migration.includes('membership_changed') &&
    !migration.includes("'new_channel_version'") &&
    !migration.includes("'message_body'") &&
    count(migration, /private\.user_chat_control_topic\(recipient_id\)/gu) ===
      1,
  'Broadcast payload is not minimal.',
);
assert(
  count(migration, /perform realtime\.send\(/gu) === 2 &&
    !migration.includes('insert into realtime.messages') &&
    count(
      migration,
      /private\.(pet_chat_topic|user_chat_control_topic)[\s\S]{0,100}\n\s+true\n\s+\);/gu,
    ) === 2,
  'Server Broadcast must use the official private realtime.send API.',
);
assert(
  migration.includes('rotate_pet_chat_channel_after_membership_change') &&
    migration.includes(
      'after insert or delete or update of pet_id, user_id, role',
    ) &&
    migration.includes('initialize_pet_chat_state_after_pet_insert') &&
    migration.includes('is never recreated') &&
    migration.includes('from public.pets as pet') &&
    migration.includes('where pet.id = target_pet_id') &&
    migration.includes('private.broadcast_pet_chat_rotation(target_pet_id)') &&
    migration.includes("membership.role in ('owner', 'member')") &&
    !rotationDefinition.includes('realtime.send') &&
    !rotationDefinition.includes('private.pet_chat_topic'),
  'Membership rotation does not cover all DB mutations or pet cascade safety.',
);
assert(
  migration.includes('private.lock_pet_chat_membership') &&
    migration.includes('for share;') &&
    migration.includes('for update;') &&
    migration.includes(
      'caller_role := private.lock_pet_chat_membership(target_pet_id)',
    ),
  'Chat writes are not serialized against concurrent membership rotation.',
);
assert(
  realtime.includes(".on('broadcast', { event: 'chat_channel_rotated' }") &&
    realtime.includes('`user:${userId}:chat-control`') &&
    !realtime.includes("event: 'membership_changed'") &&
    count(realtime, /config: \{ private: true \}/gu) === 2 &&
    realtime.includes('fetchChatChannelVersion(petId)') &&
    realtime.includes('clearChatPetCache') &&
    realtime.includes('membershipRecheckIntervalMs') &&
    realtime.includes('staleVersionRetryDelayMs') &&
    realtime.includes('retryAttempted = true'),
  'Rotation recovery, cache clearing, or bounded stale-version retry is missing.',
);
assert(
  migration.includes('message.sender_id <> caller_id') &&
    migration.includes('public.chat_read_states.last_read_at') &&
    migration.includes('last_read_message_id') &&
    migration.includes('(message.created_at, message.id) >') &&
    migration.includes('target_message_id uuid') &&
    migration.includes('user_id = (select auth.uid())'),
  'Per-user unread calculation or read-state isolation is missing.',
);
assert(
  migration.includes('(message.created_at, message.id) <') &&
    migration.includes(
      'limit least(greatest(coalesce(requested_limit, 30), 1), 30)',
    ) &&
    queries.includes('CHAT_PAGE_SIZE = 30') &&
    queries.includes('getChronologicalMessages'),
  'Stable 30-message cursor pagination is missing.',
);
assert(
  queries.includes('client_message_id') &&
    cache.includes("deliveryState?: 'failed' | 'sending'") &&
    cache.includes(
      'candidate.client_message_id !== message.client_message_id',
    ) &&
    screen.includes('Crypto.randomUUID()'),
  'Optimistic reconciliation and deterministic retry are incomplete.',
);
assert(
  migration.includes('create or replace function public.update_chat_message') &&
    migration.includes('message_sender_id <> caller_id') &&
    migration.includes('body = safe_body') &&
    migration.includes('updated_at = now()') &&
    queries.includes("rpc('update_chat_message'") &&
    screen.includes('useUpdateChatMessage') &&
    messageList.includes('onEdit') &&
    editModal.includes('maxLength={messageLimit}'),
  'Edit-own permission, server validation, or accessible UI is incomplete.',
);
assert(
  realtime.includes("event === 'TOKEN_REFRESHED'") &&
    realtime.includes("nextState === 'active'") &&
    realtime.includes('NetInfo.addEventListener') &&
    screen.includes('onlineManager.isOnline() === false'),
  'Token refresh, foreground, reconnect, or offline handling is missing.',
);
assert(
  screen.includes('PetSwitcherModal') &&
    screen.includes('ChatMembersModal') &&
    screen.includes('ProductionChatMessageList') &&
    screen.includes('ProductionChatComposer') &&
    screen.includes('key={pet.id}') &&
    sessionProvider.includes('clearChatPetCache') &&
    !composer.includes('Attachment') &&
    !screen.includes('image-picker'),
  'Real UI is missing core states or includes Phase 10B attachments.',
);
assert(
  messageList.includes('accessibilityActions') &&
    messageList.includes('maxToRenderPerBatch') &&
    composer.includes('multiline') &&
    composer.includes('maxLength={messageLimit}') &&
    !messageList.includes('maxFontSizeMultiplier') &&
    !composer.includes('maxFontSizeMultiplier') &&
    !messageList.includes('allowFontScaling={false}') &&
    !composer.includes('allowFontScaling={false}'),
  'Accessibility, long-message, or virtualized-list behavior is incomplete.',
);
assert(
  featureFlags.includes('__DEV__') &&
    featureFlags.includes('PRODUCTION_CHAT_ENABLED = true') &&
    featureFlags.includes('__DEV__ && LOCAL_BACKEND') &&
    route.includes('if (!CHAT_ENABLED)') &&
    tabs.includes('...(CHAT_ENABLED ? {} : { href: null })'),
  'Current production route/tab guard is incomplete.',
);
assert(
  backendTarget.includes("['localhost', '127.0.0.1']") &&
    backendTarget.includes('EXPO_PUBLIC_SUPABASE_URL') &&
    !featureFlags.includes('EXPO_PUBLIC_CHAT_ENABLED'),
  'Local Chat preview is not tied to the actual local Supabase URL.',
);
assert(
  homeRoute.includes('@/features/home/home-screen') &&
    tabs.includes('<Tabs.Screen\n        name="index"') &&
    !rootLayout.includes('initialRouteName="chat-preview"') &&
    !tabs.includes('initialRouteName="chat-preview"'),
  'Canonical Home route is missing or Chat Preview became an initial route.',
);
assert(
  /<Stack\.Protected[\s\S]{0,200}__DEV__\s*&&\s*session[\s\S]{0,200}<Stack\.Screen name="chat-preview"/u.test(
    rootLayout,
  ) &&
    rootLayout.includes('<Stack.Screen name="chat-preview" />') &&
    previewRoute.includes('if (!__DEV__)') &&
    previewRoute.includes('<Redirect href="/" />'),
  'Chat Preview is not fully guarded as a development-only route.',
);
assert(
  previewScreen.includes('if (router.canGoBack())') &&
    previewScreen.includes('router.back();') &&
    previewScreen.includes("router.replace('/');"),
  'Chat Preview back navigation is missing the canonical Home fallback.',
);
assert(
  databaseTypes.includes('chat_messages:') &&
    databaseTypes.includes('get_pet_chat_channel_version:') &&
    en.chat?.live &&
    zhHK.chat?.live,
  'Database types or English/zh-HK UI resources are missing.',
);

const liveSources = [
  migration,
  queries,
  cache,
  realtime,
  screen,
  composer,
  messageList,
  editModal,
]
  .join('\n')
  .toLowerCase();
for (const forbidden of [
  'service_role',
  'sb_secret_',
  'database_password',
  'supabase_db_password',
]) {
  assert(
    !liveSources.includes(forbidden),
    `Forbidden secret marker: ${forbidden}`,
  );
}

if (failures.length > 0) {
  console.error('Phase 10A static verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    'PASS: additive chat schema, cursor index, and idempotency contract.',
  );
  console.log('PASS: Owner/Member RLS, secure RPCs, and sender binding.');
  console.log('PASS: private minimal Broadcast and version rotation guards.');
  console.log(
    'PASS: unread, offline/reconnect, accessible UI, and production guard.',
  );
}

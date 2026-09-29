import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const families = read('src/features/family/families-screen.tsx');
const create = read('src/features/pets/new-pet-screen.tsx');
const join = read('src/features/family/join-family-screen.tsx');
const profile = read('src/features/profile/profile-screen.tsx');
const account = read('src/features/profile/account-security-screen.tsx');
const pets = read('src/features/pets/pets-screen.tsx');
const modal = read(
  'src/features/pets/components/pets-create-actions-modal.tsx',
);
const members = read('src/features/family/pet-members-screen.tsx');
const queries = read('src/features/family/family-queries.ts');
const petQueries = read('src/features/pets/pet-queries.ts');
const home = read('src/features/home/home-screen.tsx');
const chat = read('src/features/chat/chat-screen.tsx');
const chatQueries = read('src/features/chat/chat-queries.ts');
const chatScope = read('src/features/chat/chat-scope.ts');
const chatSession = read('src/features/chat/chat-session-provider.tsx');
const chatRealtime = read('src/features/chat/use-chat-realtime.ts');
const en = JSON.parse(read('src/i18n/locales/en.json'));
const zh = JSON.parse(read('src/i18n/locales/zh-HK.json'));
function check(label, condition) {
  assert.ok(condition, label);
  console.log(`PASS: ${label}`);
}
check(
  'Family entry redirects sole membership, without list or Family selector',
  families.includes('router.replace({') &&
    families.includes("pathname: '/families/[id]'") &&
    !families.includes('families.map(') &&
    !families.includes('setCurrentFamilyId'),
);
check(
  'No-Family state alone offers Create and Join',
  families.includes('familiesQuery.data?.length === 1') &&
    families.includes("router.push('/families/new')") &&
    families.includes("router.push('/join-family')"),
);
check(
  'Create Family is guarded for an existing membership',
  create.includes('if (createNewFamily && currentFamilyId)') &&
    create.includes('isAlreadyInFamilyError(error)'),
);
check(
  'Join Family is guarded and maps canonical ALREADY_IN_FAMILY',
  join.includes('if (familyContext.currentFamilyId)') &&
    join.includes('isAlreadyInFamilyError(error)'),
);
check(
  'Profile hides Join for a member and its Manage route resolves sole Family',
  profile.includes("item.key !== 'joinFamily'") &&
    profile.includes("router.push('/families')"),
);
check(
  'Pet creation modal hides Create/Join after membership',
  modal.includes('canCreateOrJoinFamily ?') &&
    pets.includes('familiesQuery.isSuccess && !currentFamilyId'),
);
check(
  'Home with a zero-Pet Family does not offer Join',
  home.includes('!petsState.currentFamilyId ?'),
);
// A Family can chat with zero Pets. Create/Join belongs to the no-Family state.
const noFamilyChat = chat.match(/if \(!familyId\) \{([\s\S]*?)\n  \}/u)?.[1];
assert.ok(noFamilyChat, 'Chat must have an explicit no-Family state');
for (const route of ['/families/new', '/join-family']) {
  check(
    `Chat offers ${route} only inside the no-Family state`,
    noFamilyChat.includes(`router.push('${route}'`) &&
      chat.split(`router.push('${route}'`).length === 2,
  );
}
check(
  'Chat queries and room identity use Family; zero Pets do not block Chat',
  /const familyId = familyState\.currentFamilyId;/u.test(chat) &&
    /useChatMessages\(\s*familyId,/u.test(chat) &&
    /useChatMembers\(\s*familyId,/u.test(chat) &&
    /key=\{familyId\}/u.test(chat) &&
    !/if \(!pet\)|if \(!petId\)|key=\{pet\.id\}/u.test(chat),
);
check(
  'Chat API reads canonical Family members and uses Family RPCs/cache keys',
  chatQueries.includes("'get_family_chat_members'") &&
    chatQueries.includes("'get_family_chat_messages_page'") &&
    chatQueries.includes("'send_family_chat_message'") &&
    chatQueries.includes('target_family_id: familyId') &&
    chatScope.includes("'family', familyId") &&
    !/target_pet_id|petId|pet_members/u.test(chatQueries + chatScope),
);
check(
  'Chat session/realtime uses Family scope independently of the selected Pet',
  chatSession.includes('familyState.currentFamilyId') &&
    chatSession.includes('createChatScopeKey(user?.id, familyId)') &&
    chatRealtime.includes('getFamilyChatTopic(familyId, channelVersion)') &&
    !/currentPet|petId|pet_id|pet:/u.test(chatSession + chatRealtime),
);
check(
  'Pets actions wait for membership and hide Add Pet from non-Owners',
  pets.includes('familiesQuery.isSuccess &&') &&
    pets.includes("currentMembership?.role === 'owner'"),
);
check(
  'Account deletion blocker shows one Owner resolution, not a list',
  account.includes('familiesQuery.data?.find') &&
    !account.includes('.map(({ family })'),
);
check(
  'ordinary Add Pet uses currentFamilyId and create_family_pet',
  create.includes('useCreateFamilyPet(currentFamilyId)') &&
    petQueries.includes("rpc('create_family_pet'"),
);
check(
  'bootstrap create_pet remains only behind explicit Create Family',
  create.includes('createNewFamilyWithPet.mutateAsync(values)') &&
    petQueries.includes("rpc('create_pet'"),
);
check(
  'Family Members read canonical Family membership with direct Remove and invitation buttons',
  members.includes('usePetMembers') &&
    queries.includes("'get_family_members'") &&
    queries.includes("capability === 'LEGACY_PET'") &&
    queries.includes("'get_pet_members'") &&
    members.includes("label={t('family.members.remove')}") &&
    members.includes("label={t('family.invite.regenerate')}") &&
    members.includes("label={t('family.invite.revoke')}"),
);
for (const locale of [en, zh])
  check(
    'single-Family copy is localized',
    Boolean(
      locale.family.single.alreadyInFamily && locale.family.single.noFamilyBody,
    ),
  );

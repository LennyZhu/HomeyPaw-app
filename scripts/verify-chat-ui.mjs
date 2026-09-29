import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInstance } from 'i18next';
import React from 'react';
import ts from 'typescript';

import {
  CHAT_MESSAGE_GROUP_WINDOW_MS,
  isChatMessageConsecutive,
} from '../src/features/chat/chat-message-grouping.ts';

const [screen, list, english, chinese, memberModal] = await Promise.all([
  readFile(
    new URL('../src/features/chat/chat-screen.tsx', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL(
      '../src/features/chat/components/production-chat-message-list.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL('../src/i18n/locales/en.json', import.meta.url),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('../src/i18n/locales/zh-HK.json', import.meta.url),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL(
      '../src/features/chat/components/chat-members-modal.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
]);

assert.match(screen, /numberOfLines=\{1\}[\s\S]*\{chatTitle\}/u);
assert.match(screen, /ellipsizeMode="tail"/u);
assert.match(screen, /chat\.live\.header\.memberCount/u);
assert.doesNotMatch(
  screen,
  /currentPet|activePet|selectedPet|PetSwitcherModal|PetAvatar|isSwitcherOpen|petSelector|chevron-down|switchPet|switchHint|familyPets|\/pets\/new/u,
);
assert.match(screen, /const chatTitle = t\('chat\.live\.header\.title'\)/u);
assert.match(screen, /const familyId = familyState\.currentFamilyId/u);
assert.match(screen, /count: members\.length/u);
for (const source of [screen, memberModal]) {
  assert.doesNotMatch(
    source,
    /familyName|familyLabel|familyId\.slice|family\.lifecycle\.emptyFamily/u,
  );
}
assert.equal(chinese.chat.live.header.title, '家庭聊天室');
assert.equal(english.chat.live.header.title, 'Family Chat');
assert.equal(chinese.chat.live.header.memberCount_other, '{{count}} 位家人');
assert.equal(
  english.chat.live.header.memberCount_other,
  '{{count}} family members',
);
for (const resources of [english, chinese]) {
  assert.equal(resources.chat.live.header.subtitle_one, undefined);
  assert.equal(resources.chat.live.header.subtitle_other, undefined);
  assert.doesNotMatch(resources.chat.live.members.body_one, /\{\{name\}\}/u);
  assert.doesNotMatch(resources.chat.live.members.body_other, /\{\{name\}\}/u);
}

// Render the actual Header JSX and its title declaration. Native
// primitives are inert tags; no App render, query, navigation or device runs.
function extractHeader(source, filename) {
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let header;
  let titleDeclaration;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed) === 'chatTitle'
    )
      titleDeclaration = node.getText(parsed);
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(parsed) === 'style' &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression?.getText(parsed) === 'styles.header',
      )
    )
      header = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(header, `${filename} Header must exist`);
  return { header, titleDeclaration };
}
const { header, titleDeclaration } = extractHeader(screen, 'chat-screen.tsx');
const { header: modalHeader } = extractHeader(
  memberModal,
  'chat-members-modal.tsx',
);
assert.ok(titleDeclaration);
const compiled = ts.transpileModule(
  `function renderHeader(familyState, members, t, isSubscribed, setIsMembersOpen, styles) {
    const ${titleDeclaration};
    return (${header});
  }
  function renderMembersHeader(members, t, onClose, styles) {
    return (${modalHeader});
  }`,
  {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { renderHeader, renderMembersHeader } = new Function(
  'React',
  'View',
  'AppText',
  'Pressable',
  'Ionicons',
  'IconButton',
  'lightColors',
  `${compiled}\nreturn { renderHeader, renderMembersHeader };`,
)(React, 'View', 'AppText', 'Pressable', 'Ionicons', 'IconButton', {
  secondary: 'existing-green',
});
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants(node.props.children)];
}
const familyId = 'abcdef12-1111-4111-8111-111111111111';
for (const [language, resources, expectedTitle] of [
  ['zh-HK', chinese, '家庭聊天室'],
  ['en', english, 'Family Chat'],
]) {
  const translator = createInstance();
  await translator.init({
    lng: language,
    resources: { [language]: { translation: resources } },
  });
  let opened;
  const render = (petId, count = 2, subscribed = true, id = familyId) => {
    const state = { currentFamilyId: id, currentPetId: petId };
    Object.defineProperty(state, 'currentPet', {
      get: () => {
        throw new Error('Header must never read the current Pet');
      },
    });
    return descendants(
      renderHeader(
        state,
        Array.from({ length: count }, (_, index) => ({
          userId: `member-${index}`,
        })),
        translator.t,
        subscribed,
        (value) => {
          opened = value;
        },
        { titleCopy: 'title-copy' },
      ),
    );
  };
  const texts = (nodes) =>
    nodes
      .filter((node) => node.type === 'AppText')
      .map((node) => node.props.children);
  const mochi = render('Mochi');
  assert.deepEqual(texts(mochi), [
    expectedTitle,
    language === 'en' ? '2 family members' : '2 位家人',
  ]);
  assert.deepEqual(
    texts(render('Test')),
    texts(mochi),
    'Pet switch must not change Header identity',
  );
  assert.deepEqual(
    texts(render(null)),
    texts(mochi),
    'zero-Pet Family retains the same Header',
  );
  assert.equal(
    texts(render(null, 1))[1],
    language === 'en' ? '1 family member' : '1 位家人',
  );
  assert.equal(
    texts(render(null, 0))[1],
    language === 'en' ? '0 family members' : '0 位家人',
  );
  assert.equal(
    texts(render(null, 2, true, 'ffeeddcc-other-family'))[1],
    texts(mochi)[1],
    'Header exposes no Family identifier',
  );
  const title = mochi.find((node) => node.props.accessibilityRole === 'header');
  assert.equal(title.props.variant, 'title3');
  const subtitle = mochi.filter((node) => node.type === 'AppText')[1];
  assert.equal(subtitle.props.variant, 'caption');
  assert.equal(subtitle.props.tone, 'secondary');
  assert.doesNotMatch(
    texts(mochi).join(' '),
    /abcdef12|111111111111|Mochi|Test/u,
  );
  for (const count of [0, 1, 2]) {
    const modalTexts = texts(
      descendants(
        renderMembersHeader(
          Array.from({ length: count }, () => ({})),
          translator.t,
          () => {},
          {},
        ),
      ),
    );
    assert.deepEqual(modalTexts, [
      language === 'en' ? 'Family members' : '家庭成員',
      language === 'en'
        ? `${count} family member${count === 1 ? '' : 's'} can access this chat.`
        : `${count} 位家人可進入家庭聊天室。`,
    ]);
    assert.doesNotMatch(
      modalTexts.join(' '),
      /abcdef12|111111111111|Mochi|Test/u,
    );
  }
  const titleCopy = mochi.find((node) => node.props.style === 'title-copy');
  assert.equal(titleCopy.type, 'View');
  assert.equal(
    titleCopy.props.onPress,
    undefined,
    'Header title must not trigger a selector',
  );
  const buttons = mochi.filter((node) => node.type === 'Pressable');
  assert.equal(buttons.length, 1, 'only the members button remains');
  assert.equal(
    buttons[0].props.accessibilityLabel,
    translator.t('chat.live.header.members'),
  );
  assert.equal(buttons[0].props.disabled, false);
  buttons[0].props.onPress();
  assert.equal(opened, true, 'members button still opens members');
  assert.equal(
    render(null, 2, false).find((node) => node.type === 'Pressable').props
      .disabled,
    true,
  );
  const icon = mochi.find((node) => node.type === 'Ionicons');
  assert.equal(icon.props.name, 'people-outline');
  assert.equal(icon.props.color, 'existing-green');
  assert.equal(icon.props.size, 22);
}

assert.match(list, /member\?\.displayName/u);
assert.doesNotMatch(list, /member\?\.role|member\.role/u);
assert.match(list, /!isOwn && !consecutive/u);
assert.match(list, /consecutive && styles\.consecutiveRow/u);
assert.match(list, /consecutive \? \([\s\S]*styles\.avatarSpacer/u);

const message = (senderId, createdAt) => ({
  created_at: createdAt,
  sender_id: senderId,
});
const first = message('member-a', '2026-09-11T02:00:00.000Z');
assert.equal(
  isChatMessageConsecutive(
    message('member-a', '2026-09-11T02:04:59.000Z'),
    first,
  ),
  true,
);
assert.equal(
  isChatMessageConsecutive(
    message(
      'member-a',
      new Date(
        new Date(first.created_at).getTime() + CHAT_MESSAGE_GROUP_WINDOW_MS,
      ).toISOString(),
    ),
    first,
  ),
  true,
);
assert.equal(
  isChatMessageConsecutive(
    message('member-a', '2026-09-11T02:05:00.001Z'),
    first,
  ),
  false,
);
assert.equal(
  isChatMessageConsecutive(
    message('member-b', '2026-09-11T02:01:00.000Z'),
    first,
  ),
  false,
);
assert.equal(
  isChatMessageConsecutive(
    message('member-a', '2026-09-10T16:01:00.000Z'),
    message('member-a', '2026-09-10T15:59:00.000Z'),
  ),
  false,
);
assert.equal(
  isChatMessageConsecutive(
    message('current-user', '2026-09-11T02:02:00.000Z'),
    message('current-user', '2026-09-11T02:01:00.000Z'),
  ),
  true,
);

assert.match(list, /onLongPress=\{\(\) =>/u);
assert.match(list, /Haptics\.selectionAsync/u);
assert.match(list, /accessibilityActions=\{actions\}/u);
assert.doesNotMatch(list, /name="ellipsis-horizontal"/u);
assert.match(
  list,
  /onPress=\{canRetry \? \(\) => requestAction\(item\) : undefined\}/u,
);
assert.match(
  list,
  /const canDelete = !item\.optimistic && \(isOwn \|\| canModerate\)/u,
);
assert.match(list, /const canEdit = !item\.optimistic && isOwn/u);
assert.match(list, /canEdit=\{targetCanEdit\}/u);
assert.match(list, /canDelete=\{targetCanDelete\}/u);

assert.match(list, /useContentLayout\('modal'\)/u);
assert.match(list, /animationType=\{isWide \? 'fade' : 'slide'\}/u);
assert.match(list, /isWide && styles\.actionOverlayWide/u);
assert.match(list, /contentStyles\.modal/u);
assert.match(list, /accessibilityViewIsModal/u);
assert.match(list, /minHeight: 56/u);
assert.match(list, /cancel && styles\.cancelAction/u);
assert.match(list, /destructive \? lightColors\.error/u);

console.log(
  'PASS: actual bilingual Chat title/count-only subtitle and member modal; no Family identifiers or Pet selector; Pet switch and zero Pet retain Header; title3/caption hierarchy, members action/icon/disabled state, truncation and accessibility retained.',
);
console.log(
  'PASS: five-minute, sender, and local-date message grouping boundaries.',
);
console.log(
  'PASS: own/member/owner actions remain permission-scoped and accessible.',
);
console.log('PASS: long press replaces permanent message action affordances.');
console.log('PASS: iPhone sheet and iPad centered action modal variants.');

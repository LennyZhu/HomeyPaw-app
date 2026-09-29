import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import { StackRouter } from '../node_modules/expo-router/build/react-navigation/routers/StackRouter.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  journal,
  create,
  en,
  zh,
  tabs,
  postRoute,
  home,
  care,
  reminders,
  schedule,
] = await Promise.all([
  read('src/features/journal/journal-screen.tsx'),
  read('src/features/create/create-screen.tsx'),
  read('src/i18n/locales/en.json'),
  read('src/i18n/locales/zh-HK.json'),
  read('src/app/(tabs)/_layout.tsx'),
  read('src/app/posts/new.tsx'),
  read('src/features/home/home-screen.tsx'),
  read('src/features/care/care-history-screen.tsx'),
  read('src/features/reminders/reminders-screen.tsx'),
  read('src/features/schedule/schedule-screen.tsx'),
]);

assert.ok(journal.includes("t('journal.title')"));
assert.equal(journal.includes("t('journal.timelineSubtitle'"), false);
assert.equal(journal.includes("t('posts.list.noPetSubtitle')"), false);
assert.equal(journal.includes("t('posts.list.add')"), false);
assert.equal(journal.includes('styles.addButton'), false);
assert.equal(journal.includes('PetSwitcherModal'), false);
assert.equal(journal.includes('styles.petSelector'), false);
assert.equal(journal.includes('setCurrentPetId'), false);
assert.equal(journal.includes("router.push('/pets/new')"), false);
assert.ok(journal.includes('const petId = petsState.currentPetId'));
assert.ok(journal.includes('usePosts(petId, dateRange)'));
assert.ok(journal.includes('usePetPostAuthors(petId)'));
assert.ok(journal.includes('styles.titleRow'));
assert.ok(journal.includes('styles.filterAction'));
assert.equal(journal.includes('styles.filterButton'), false);
assert.equal(journal.includes('name="calendar-outline"'), false);
assert.ok(journal.includes("router.push('/posts/new')"));

for (const scrollBehavior of [
  'contentOffset={{ x: 0, y: initialScrollOffset }}',
  'ref={listRef}',
  'maintainVisibleContentPosition',
  'listRef.current?.scrollToOffset',
  'setJournalScrollOffset',
  'postsQuery.fetchNextPage()',
]) {
  assert.ok(journal.includes(scrollBehavior), scrollBehavior);
}

// Exercise the actual Tab listener with the installed Expo stack reducer.
// No App, native view, network request or navigation container is launched.
const parsed = ts.createSourceFile(
  '_layout.tsx',
  tabs,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let listener;
function visit(node) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(parsed) === 'Tabs.Screen' &&
    node.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(parsed) === 'name' &&
        attribute.initializer?.text === 'create',
    )
  ) {
    listener = node.attributes.properties
      .find((attribute) => attribute.name?.getText(parsed) === 'listeners')
      ?.initializer?.expression?.getText(parsed);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(listener, 'middle + must intercept Tab navigation');
const compiled = ts.transpileModule(
  `function createListeners(router) { return (${listener}); }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const getListeners = new Function(`${compiled}\nreturn createListeners;`)();
const options = {
  routeNames: ['(tabs)', 'posts'],
  routeParamList: {},
  routeGetIdList: {},
};
for (const activeTab of ['index', 'journal', 'chat', 'profile']) {
  const stack = StackRouter({ initialRouteName: '(tabs)' });
  const postStack = StackRouter({ initialRouteName: 'new' });
  const postOptions = { ...options, routeNames: ['new'] };
  let postState = postStack.getInitialState(postOptions);
  let state = stack.getInitialState(options);
  const tabState = { activeTab };
  state.routes[0].state = tabState;
  let prevented = false;
  const { tabPress } = getListeners({
    navigate: (href) => {
      assert.equal(prevented, true, 'Tab switch must be prevented first');
      assert.equal(
        href,
        '/posts/new',
        'use the existing Journal creation route',
      );
      state = stack.getStateForAction(
        state,
        {
          type: 'NAVIGATE',
          payload: { name: 'posts', params: { screen: 'new' } },
        },
        options,
      );
      postState = postStack.getStateForAction(
        postState,
        { type: 'NAVIGATE', payload: { name: 'new' } },
        postOptions,
      );
    },
  });
  for (let press = 0; press < 5; press++) {
    prevented = false;
    tabPress({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
  }
  assert.equal(state.routes.length, 2, 'rapid repeats cannot stack more pages');
  assert.equal(
    postState.routes.length,
    1,
    'nested Journal page stays singular',
  );
  assert.equal(state.routes[1].params.screen, 'new');
  assert.equal(state.routes[0].state, tabState, 'original Tab state survives');
  state = stack.getStateForAction(state, { type: 'GO_BACK' }, options);
  assert.equal(state.routes.length, 1);
  assert.equal(state.routes[0].state.activeTab, activeTab);
}
assert.match(
  postRoute,
  /export \{ default \} from '@\/features\/posts\/create-post-screen'/u,
);
assert.match(tabs, /tabBarIcon: CreateTabIcon/u);
assert.match(tabs, /tabBarLabel: \(\) => null/u);
assert.match(tabs, /name="add" size=\{29\}/u);
assert.match(
  tabs,
  /createIcon: \{\s*width: 50,\s*height: 50,[\s\S]*backgroundColor: lightColors\.primary,[\s\S]*borderRadius: radius\.full,[\s\S]*translateY: -5[\s\S]*\.\.\.shadows\.floating/u,
);
assert.doesNotMatch(
  tabs,
  /Modal|setVisible|setActiveMenu|primaryCreateActions/u,
);
assert.doesNotMatch(
  create,
  /activeMenu|setActiveMenu|CreateMenu|primaryCreateActions|create\.menu\.(title|journal|reminder|schedule)|\/posts\/new|\/reminders\/new|\/schedule\/new/u,
);

assert.ok(create.includes('careTypes.map'));
assert.ok(create.includes('healthObservationTypes.map'));
assert.equal(create.includes("t('care.quick.subtitle'"), false);
assert.ok(create.includes('accessibilityLabel={label}'));
assert.ok(create.includes('accessibilityViewIsModal'));
assert.ok(create.includes('minHeight: 56'));
assert.ok(create.includes('...contentStyles.modal'));
assert.ok(create.includes("router.replace('/')"));
assert.ok(create.includes('requestAnimationFrame(() => router.push(href))'));
assert.match(
  home,
  /router\.push\(\{ pathname: '\/create', params: \{ mode: 'care' \} \}\)/u,
);
assert.match(care, /onActionPress=\{\(\) => router\.push\('\/create'\)\}/u);
assert.match(create, /pathname: '\/care\/new'/u);
assert.match(
  reminders,
  /onPress=\{\(\) => router\.push\('\/reminders\/new'\)\}/u,
);
assert.match(
  schedule,
  /\/schedule\/new\?date=\$\{encodeURIComponent\(selectedDate\)\}/u,
);

const enLocale = JSON.parse(en);
const zhLocale = JSON.parse(zh);
assert.deepEqual(enLocale.create.menu, {
  care: 'Record Care',
});
assert.deepEqual(zhLocale.create.menu, {
  care: '記錄照顧',
});

console.log(
  'PASS: middle + opens the existing Journal route from every Tab; repeated navigate stays singular and back retains the original Tab; global Add menu removed; + visuals and feature-owned Care/Reminder/Schedule creation preserved.',
);

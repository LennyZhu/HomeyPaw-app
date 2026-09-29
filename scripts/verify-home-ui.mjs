import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import { buildCalendarMonth } from '../src/features/schedule/calendar-date.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [home, homeSchedule, schedule, sectionHeader, en, zh, scheduleRoute] =
  await Promise.all([
    read('src/features/home/home-screen.tsx'),
    read('src/features/schedule/components/home-schedule-card.tsx'),
    read('src/features/schedule/schedule-screen.tsx'),
    read('src/features/home/components/home-section-header.tsx'),
    read('src/i18n/locales/en.json').then(JSON.parse),
    read('src/i18n/locales/zh-HK.json').then(JSON.parse),
    read('src/app/schedule/new.tsx'),
  ]);

const hierarchy = [
  'style={styles.petHeader}',
  "title={t('care.home.title')}",
  '<HomeScheduleCard',
  "title={t('home.recentActivity')}",
  "<HomeSection title={t('home.family')}",
].map((needle) => home.indexOf(needle));

assert.ok(hierarchy.every((index) => index >= 0));
assert.deepEqual(
  hierarchy,
  [...hierarchy].sort((a, b) => a - b),
);
assert.ok(home.includes('getCompanionDays(pet.adoption_date)'));
assert.ok(home.includes('companionDays !== null && companionDays > 0'));
assert.ok(home.includes('name="heart-outline"'));

for (const removed of [
  'getGreetingKey',
  'home.greetingSubtitle',
  'home.greetings.',
  'home.memory.',
  'home.viewJournal',
  'usePetMemory',
  'PostMediaPreview',
]) {
  assert.equal(home.includes(removed), false, `${removed} remains on Home`);
}

assert.equal(buildCalendarMonth('2023-02-01').length, 35);
assert.equal(buildCalendarMonth('2026-05-01').length, 42);
assert.equal(homeSchedule.includes('fixedSixWeeks'), false);
assert.match(schedule, /<ScheduleMonthCalendar\s+fixedSixWeeks/u);

assert.ok(home.includes('<HomeSectionHeader'));
assert.ok(homeSchedule.includes('<HomeSectionHeader'));
assert.ok(sectionHeader.includes('accessibilityLabel={action}'));
assert.ok(sectionHeader.includes('accessibilityRole="button"'));
assert.ok(sectionHeader.includes('minHeight: 44'));
assert.ok(sectionHeader.includes('tone="brand"'));
assert.ok(sectionHeader.includes('variant="footnote"'));

console.log(
  'PASS: Home hierarchy, companion visibility, removed modules, compact calendar, full schedule grid, and shared section actions.',
);

assert.equal(zh.care.home.add, '照顧打卡');
assert.equal(en.care.home.add, 'Record care');
assert.equal(zh.care.create.title, '記錄照顧');
assert.equal(zh.care.empty.action, '記錄照顧');
assert.equal(zh.schedule.add, '新增排班');
assert.equal(en.schedule.add, 'Add schedule');
assert.equal(zh.schedule.view, '全部排班');
assert.equal(en.schedule.view, 'View schedule');
assert.match(scheduleRoute, /schedule\/new-schedule-screen/u);

const parse = (source) =>
  ts.createSourceFile(
    'screen.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const nodes = (source) => {
  const collected = [];
  const visit = (node) => {
    collected.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return collected;
};
const opening = (node) => (ts.isJsxElement(node) ? node.openingElement : node);
const findElement = (all, tag) =>
  all.filter(
    (node) =>
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      opening(node).tagName.getText() === tag,
  );
const prop = (node, name) =>
  opening(node).attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  )?.initializer;
const expression = (node, name) => {
  const value = prop(node, name);
  assert(value && ts.isJsxExpression(value) && value.expression);
  return value.expression.getText();
};
const homeNodes = nodes(parse(home));
const cardNodes = nodes(parse(homeSchedule));
const careButton = findElement(homeNodes, 'AppButton').find((node) =>
  prop(node, 'label')?.getText().includes("t('care.home.add')"),
);
assert(careButton);
assert.match(
  expression(careButton, 'onPress'),
  /pathname: '\/create', params: \{ mode: 'care' \}/u,
);
assert.equal(prop(careButton, 'variant').text, 'secondary');
assert.match(home, /const \{ currentMembership \} = useCurrentFamily\(\)/u);
const card = findElement(homeNodes, 'HomeScheduleCard')[0];
const canAdd = new Function(
  'currentMembership',
  `return ${expression(card, 'canAddSchedule')};`,
);
const header = findElement(cardNodes, 'HomeSectionHeader')[0];
const declarations = (name) => {
  const declaration = cardNodes.find(
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name,
  );
  assert(declaration);
  return `const ${declaration.getText()};`;
};
const navigation = ts.transpileModule(
  `${declarations('openSchedule')}\n${declarations('openNewSchedule')}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const routes = [];
const selectedDate = '2026-09-29';
const actions = new Function(
  'router',
  'selectedDate',
  `${navigation}\nreturn { openSchedule, openNewSchedule };`,
)({ push: (route) => routes.push(route) }, selectedDate);
const headerAction = new Function(
  'canAddSchedule',
  't',
  `return ${expression(header, 'action')};`,
);
const headerHandler = new Function(
  'canAddSchedule',
  'openNewSchedule',
  `return ${expression(header, 'onAction')};`,
);
const browse = findElement(cardNodes, 'Pressable').find((node) =>
  prop(node, 'onPress')?.getText().includes('openSchedule()'),
);
assert(browse);
let browseBranch = browse;
while (ts.isParenthesizedExpression(browseBranch.parent)) {
  browseBranch = browseBranch.parent;
}
const browseConditional = browseBranch.parent;
assert(ts.isConditionalExpression(browseConditional));
assert.equal(browseConditional.whenTrue, browseBranch);
const canBrowse = new Function(
  'canAddSchedule',
  'scheduleQuery',
  `return ${browseConditional.condition.getText()};`,
);
for (const role of ['owner', 'member', 'viewer', null]) {
  const allowed = canAdd(role ? { role } : null);
  assert.equal(allowed, role === 'owner' || role === 'member');
  assert.equal(
    headerAction(allowed, (key) => key),
    allowed ? 'schedule.add' : undefined,
  );
  assert.equal(
    headerHandler(allowed, actions.openNewSchedule),
    allowed ? actions.openNewSchedule : undefined,
  );
  for (const state of ['no-schedules', 'empty-date', 'empty-month']) {
    assert.equal(canBrowse(allowed, { isError: false }), allowed, state);
  }
  assert.equal(
    canBrowse(allowed, { isError: true }),
    false,
    'Retry stays outside a press target.',
  );
}
actions.openNewSchedule();
new Function('openSchedule', `return ${expression(browse, 'onPress')};`)(
  actions.openSchedule,
)();
assert.deepEqual(routes, [
  `/schedule/new?date=${selectedDate}`,
  `/schedule?date=${selectedDate}`,
]);
assert.equal(prop(browse, 'accessibilityRole').text, 'button');
assert.equal(expression(browse, 'accessibilityLabel'), "t('schedule.view')");
assert.match(declarations('summary'), /schedule.emptyDate/u);
assert.match(declarations('summary'), /styles.summaryHeading/u);
assert.match(declarations('summary'), /name="chevron-forward"/u);
assert.doesNotMatch(declarations('summary'), /<Pressable/u);
const summaryHeading = findElement(cardNodes, 'View').find(
  (node) => prop(node, 'style')?.getText() === '{styles.summaryHeading}',
);
assert(summaryHeading);
const headingNodes = nodes(summaryHeading);
const viewLabel = findElement(headingNodes, 'AppText').find((node) =>
  node.getText().includes("t('schedule.view')"),
);
assert(viewLabel);
assert.equal(prop(viewLabel, 'tone').text, 'tertiary');
assert.equal(prop(viewLabel, 'variant').text, 'footnote');
assert.match(
  summaryHeading.getText(),
  /formatCalendarDate\(selectedDate, i18n.language\)/u,
);
assert.match(summaryHeading.getText(), /styles.overflowLink/u);
assert.match(summaryHeading.getText(), /name="chevron-forward"/u);
assert.doesNotMatch(summaryHeading.getText(), /Pressable|onPress/u);
for (const target of [
  header,
  findElement(cardNodes, 'ScheduleMonthCalendar')[0],
  browse,
]) {
  for (let parent = target.parent; parent; parent = parent.parent) {
    assert(
      !(
        ts.isJsxElement(parent) &&
        opening(parent).tagName.getText() === 'Pressable'
      ),
      'Add action, calendar dates and browse summary must have independent press targets.',
    );
  }
}
assert.match(homeSchedule, /onSelectDate=\{setSelectedDate\}/u);
assert.match(
  homeSchedule,
  /selectCurrentCareScheduleItems\(scheduleQuery.data \?\? \[\]\)/u,
);
assert.match(homeSchedule, /item.shift_status === 'canceled' \|\|/u);
assert.match(homeSchedule, /item.shift_task_status === 'canceled'/u);
console.log(
  'PASS: Home-only care check-in copy keeps the original Care action; canonical Owner/Member permissions control Add schedule, empty summaries retain browsing, independent press targets preserve calendar and Retry, and both routes reuse existing Schedule screens.',
);

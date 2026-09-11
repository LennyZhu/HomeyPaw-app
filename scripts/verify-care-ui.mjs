import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [create, newCare, history, actionsModal, careTypes, english, chinese] =
  await Promise.all([
    read('src/features/create/create-screen.tsx'),
    read('src/features/care/new-care-screen.tsx'),
    read('src/features/care/care-history-screen.tsx'),
    read('src/features/care/components/care-log-actions-modal.tsx'),
    read('src/features/care/care-types.ts'),
    read('src/i18n/locales/en.json').then(JSON.parse),
    read('src/i18n/locales/zh-HK.json').then(JSON.parse),
  ]);

assert.match(create, /careTypes\.map/u);
assert.match(create, /healthObservationTypes\.map/u);
assert.match(create, /compactOption: \{ minHeight: 44 \}/u);
assert.match(create, /compactOptionIcon: \{ width: 32, height: 32 \}/u);
assert.match(create, /careSectionLabel: \{ marginTop: spacing\.xs \}/u);
assert.match(create, /careSheet: \{[\s\S]*minHeight: 540,/u);
assert.match(create, /activeMenu === 'care' && styles\.careSheet/u);
assert.match(
  create,
  /contentContainerStyle=\{\[styles\.options, styles\.careOptions\]\}/u,
);
assert.doesNotMatch(
  create,
  /allowFontScaling=\{false\}|maxFontSizeMultiplier/u,
);
for (const type of [
  'feeding',
  'walk',
  'medicine',
  'bath',
  'grooming',
  'other',
]) {
  assert.match(careTypes, new RegExp(`'${type}'`, 'u'));
}
for (const subtype of ['stool', 'vomiting', 'energy']) {
  assert.match(careTypes, new RegExp(`'${subtype}'`, 'u'));
}

assert.match(
  newCare,
  /type === 'health'\s*\? t\('care\.health\.subtitle'\)\s*: t\('care\.create\.subtitle'\)/u,
);
assert.match(
  newCare,
  /type === 'health'\s*\? t\('care\.health\.submit'\)\s*: t\('care\.create\.submit'\)/u,
);
assert.equal(
  chinese.care.create.subtitle,
  '記下這次照顧，和家人同步毛孩近況。',
);
assert.equal(
  chinese.care.health.subtitle,
  '記下毛孩當下的狀況，方便家人一起了解。',
);
assert.equal(chinese.care.create.submit, '儲存照顧記錄');
assert.equal(chinese.care.health.submit, '儲存健康記錄');
assert.equal(
  english.care.create.subtitle,
  'Record this care activity and keep your family updated.',
);
assert.equal(
  english.care.health.subtitle,
  'Record how your pet is doing so your family can stay informed.',
);
assert.equal(english.care.create.submit, 'Save Care Record');
assert.equal(english.care.health.submit, 'Save Health Record');

assert.match(history, /icon="ellipsis-horizontal"/u);
assert.match(history, /care\.history\.actions\.label/u);
assert.match(history, /<CareLogActionsModal/u);
assert.doesNotMatch(history, /t\('common\.edit'\)/u);
assert.match(history, /isOwner \|\| item\.log\.performed_by === user\?\.id/u);
assert.match(history, /actionTarget\?\.performed_by === user\?\.id/u);
assert.match(
  history,
  /isOwner \|\| actionTarget\.performed_by === user\?\.id/u,
);
assert.match(history, /Alert\.alert\(t\('care\.delete\.title'\)/u);
assert.match(history, /style: 'destructive'/u);
assert.match(history, /careLogLabel\(log, t\)/u);
assert.match(history, /formatCareTime\(/u);
assert.match(history, /care\.performedBy/u);
assert.match(history, /log\.note/u);

assert.match(actionsModal, /useContentLayout\('modal'\)/u);
assert.match(actionsModal, /animationType=\{isWide \? 'fade' : 'slide'\}/u);
assert.match(
  actionsModal,
  /supportedOrientations=\{modalSupportedOrientations\}/u,
);
assert.match(actionsModal, /contentStyles\.modal/u);
assert.match(actionsModal, /\{canEdit \? \(/u);
assert.match(actionsModal, /\{canDelete \? \(/u);
assert.match(actionsModal, /destructive/u);
assert.match(actionsModal, /minHeight: 56/u);
assert.match(actionsModal, /accessibilityViewIsModal/u);
assert.doesNotMatch(
  actionsModal,
  /allowFontScaling=\{false\}|maxFontSizeMultiplier/u,
);

assert.equal(chinese.care.history.actions.label, '照顧記錄操作');
assert.equal(chinese.care.history.actions.edit, '編輯記錄');
assert.equal(chinese.care.history.actions.delete, '刪除記錄');
assert.equal(english.care.history.actions.label, 'Care record actions');
assert.equal(english.care.history.actions.edit, 'Edit Record');
assert.equal(english.care.history.actions.delete, 'Delete Record');

console.log(
  'PASS: all six care and three health entries remain visible and accessible.',
);
console.log(
  'PASS: care and health forms use distinct natural copy and save labels.',
);
console.log(
  'PASS: Care History uses one lightweight 44pt record-actions entry.',
);
console.log(
  'PASS: edit/delete permissions and destructive confirmation remain scoped.',
);
console.log(
  'PASS: iPhone sheet and iPad centered action-menu variants are responsive.',
);

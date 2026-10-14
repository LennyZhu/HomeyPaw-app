import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Script } from 'node:vm';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  new Script(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
  ).runInNewContext({
    exports: module.exports,
    module,
    Date,
    Intl,
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  });
  return module.exports;
}
const recurrence = load('src/features/reminders/care-task-recurrence.ts');
const {
  needsCareTimeConfirmation,
  isValidActualCareTime,
  careTimeFields,
  actualCareTimeFromFields,
} = load('src/features/schedule/care-completion-time.ts', {
  '../reminders/care-task-recurrence': recurrence,
});
const planned = '2026-10-14T05:00:00Z'; // 13:00 Hong Kong.
for (const minutes of [-30, -5, 0, 5, 30])
  assert.equal(
    needsCareTimeConfirmation(
      planned,
      new Date(Date.parse(planned) + minutes * 60_000),
    ),
    false,
  );
for (const minutes of [-300, -31, 31, 300])
  assert.equal(
    needsCareTimeConfirmation(
      planned,
      new Date(Date.parse(planned) + minutes * 60_000),
    ),
    true,
  );
const now = new Date('2026-10-14T10:00:00Z');
for (const value of [planned, now.toISOString(), '2026-10-14T06:15:00Z'])
  assert.equal(isValidActualCareTime(value, now), true);
for (const value of ['', 'invalid', '2026-10-14T10:00:01Z'])
  assert.equal(isValidActualCareTime(value, now), false);
assert.equal(
  actualCareTimeFromFields('2026-10-14', '14:15', 'Asia/Hong_Kong'),
  '2026-10-14T06:15:00.000Z',
);
assert.equal(
  careTimeFields(new Date('2026-10-14T15:30Z'), 'Asia/Hong_Kong').date,
  '2026-10-14',
);
assert.equal(
  careTimeFields(new Date('2026-10-15T00:00Z'), 'Asia/Hong_Kong').date,
  '2026-10-15',
);
assert.equal(
  actualCareTimeFromFields('2026-03-08', '02:30', 'America/Los_Angeles'),
  null,
);
assert.equal(
  actualCareTimeFromFields('2026-11-01', '01:30', 'America/Los_Angeles'),
  '2026-11-01T09:30:00.000Z',
);
assert.equal(
  actualCareTimeFromFields('2026-02-30', '12:00', 'Asia/Hong_Kong'),
  null,
);

// Execute the actual API adapter with a mock transport; never contact Supabase.
let call;
const api = load('src/features/schedule/care-schedule-api.ts', {
  '@/config/features': { SCHEDULE_ENABLED: true },
  '@/lib/logger': {},
  '@/lib/supabase/client': {
    requireSupabase: () => ({
      rpc: async (name, args) => {
        call = { name, args };
        return { data: [{ completion_status: 'completed' }], error: null };
      },
    }),
  },
  '@/features/profile/profile-avatar': {},
});
await api.completeCareShiftTask({
  careLogId: 'log',
  completionId: 'completion',
  shiftTaskId: 'item',
  occurredAt: planned,
});
assert.equal(call.name, 'complete_care_shift_task_v2');
assert.equal(call.args.care_occurred_at, planned);
assert.equal(call.args.target_shift_task_id, 'item');
assert.ok(!('completed_at' in call.args));
await api.completeCareShiftTask({
  careLogId: 'now-log',
  completionId: 'now-completion',
  shiftTaskId: 'now-item',
  occurredAt: null,
});
assert.equal(
  call.args.care_occurred_at,
  null,
  'Server-now must reach the RPC.',
);
const screen = read('src/features/schedule/schedule-screen.tsx');
assert.match(
  screen,
  /needsCareTimeConfirmation\(item.source_scheduled_for, now\)/u,
);
assert.match(screen, /occurredAt: input.occurredAt \?\? null/u);
assert.doesNotMatch(screen, /occurredAt:.*(?:new Date|now\.toISOString)/u);
// Execute the real near-time decision handler, with only its dependencies mocked.
const requests = [];
const targets = [];
const requestCompletionSource = screen.slice(
  screen.indexOf('  const requestCompletion ='),
  screen.indexOf('  const header ='),
);
new Script(
  ts.transpileModule(`${requestCompletionSource}\nrequestCompletion(item);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText,
).runInNewContext({
  Date,
  item: { source_scheduled_for: new Date().toISOString() },
  completionInFlight: { current: false },
  needsCareTimeConfirmation,
  setCompletionTarget: (item) => targets.push(item),
  complete: (input) => requests.push(input),
});
assert.equal(targets.length, 0);
assert.equal(requests.length, 1);
assert.equal(requests[0].occurredAt, null, 'One-click uses server-now too.');
assert.match(screen, /completionInFlight.current = true/u);
assert.match(screen, /onComplete=\{requestCompletion\}/u);
const modal = read(
  'src/features/reminders/components/task-completion-modal.tsx',
);
assert.match(
  modal,
  /timeChoice, setTimeChoice\] = useState<[\s\S]*?>\(null\)/u,
);
assert.match(modal, /accessibilityRole="radio"/u);
assert.match(modal, /disabled=\{!validTime\}/u);
assert.match(
  modal,
  /choice === 'planned' && !isValidActualCareTime\(scheduledFor\)/u,
);
assert.match(modal, /onPress=\{onClose\}/u);
assert.match(modal, /occurredAt: actualTime/u);
assert.doesNotMatch(modal, /openedAt/u);
assert.match(modal, /reminders.complete.actualTime.nowHint/u);
assert.match(modal, /timeZone=\{timeZone\}/u);
const queries = read('src/features/care/care-queries.ts');
assert.match(queries, /rpc\('get_today_care_logs'/u);
assert.match(queries, /order\('occurred_at', \{ ascending: false \}\)/u);
assert.match(queries, /care_time_zone: timeZone \?\? getDeviceTimeZone\(\)/u);
assert.match(
  read('src/features/care/edit-care-screen.tsx'),
  /timeZone=\{log.time_zone\}/u,
);
assert.match(
  read('src/features/home/home-screen.tsx'),
  /formatCareTime\(log.occurred_at, log.time_zone/u,
);
assert.match(
  read('src/features/care/care-history-screen.tsx'),
  /formatCareTime\(log.occurred_at, log.time_zone, i18n.language\)/u,
);
console.log(
  'PASS: 30-minute inclusive boundary, early/late confirmation, nonfuture actual times, timezone/midnight/DST, actual v2 payload, single-click path, cancel/selection guards, history ordering and timezone-preserving edits.',
);

// Execute the real modal with lightweight React/host stubs to verify explicit
// selection and cancellation, without rendering native UI or running a device.
let states = [],
  cursor = 0,
  closed = 0;
const completed = [];
let clock = Date.parse('2026-10-14T06:47:00Z'); // Open at 14:47 Hong Kong.
class ModalDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
  static now() {
    return clock;
  }
}
const jsx = (type, props) => ({ type, props });
const tokens = { spacing: {}, lightColors: {}, radius: {}, typography: {} };
const react = {
  useState: (initial) => {
    const index = cursor++;
    if (!(index in states))
      states[index] = typeof initial === 'function' ? initial() : initial;
    return [
      states[index],
      (value) => {
        states[index] =
          typeof value === 'function' ? value(states[index]) : value;
      },
    ];
  },
};
const { TaskCompletionModal } = load(
  'src/features/reminders/components/task-completion-modal.tsx',
  {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      Modal: 'Modal',
      Pressable: 'Pressable',
      TextInput: 'TextInput',
      View: 'View',
      StyleSheet: { create: (x) => x },
    },
    'react-i18next': {
      useTranslation: () => ({ t: (key) => key, i18n: { language: 'en' } }),
    },
    '@/components/app-button': { AppButton: 'AppButton' },
    '@/components/app-text': { AppText: 'AppText' },
    '@/components/modal-screen': { ModalScreen: 'ModalScreen' },
    '@/theme': tokens,
    '@/features/care/components/care-date-time-field': {
      CareDateTimeField: 'CareDateTimeField',
    },
    '@/features/schedule/care-completion-time': {
      isValidActualCareTime: (value) =>
        isValidActualCareTime(value, new ModalDate()),
    },
  },
  { Date: ModalDate },
);
const props = {
  careType: 'feeding',
  scheduledFor: planned,
  timeZone: 'Asia/Hong_Kong',
  isCompleting: false,
  visible: true,
  title: 'Care',
  onClose: () => closed++,
  onComplete: async (input) => {
    completed.push(input);
  },
};
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const render = (input = props) => {
  cursor = 0;
  return nodes(TaskCompletionModal(input));
};
let tree = render();
assert.equal(
  tree.find(
    (n) =>
      n.type === 'AppButton' && n.props.label === 'reminders.complete.action',
  ).props.disabled,
  true,
);
tree
  .find((n) => n.type === 'AppButton' && n.props.label === 'common.cancel')
  .props.onPress();
assert.equal(closed, 1);
assert.equal(completed.length, 0);
tree
  .find(
    (n) =>
      n.type === 'Pressable' &&
      n.props.children[1].props.children[0].props.children ===
        'reminders.complete.actualTime.plannedChoice',
  )
  .props.onPress();
tree = render();
const confirm = tree.find(
  (n) =>
    n.type === 'AppButton' && n.props.label === 'reminders.complete.action',
);
assert.equal(confirm.props.disabled, false);
await confirm.props.onPress();
assert.equal(completed.length, 1);
assert.equal(completed[0].occurredAt, planned);
const select = (choice) => {
  tree
    .find(
      (n) =>
        n.type === 'Pressable' &&
        n.props.children[1].props.children[0].props.children ===
          `reminders.complete.actualTime.${choice}Choice`,
    )
    .props.onPress();
  tree = render();
};
const submit = async () => {
  const button = tree.find(
    (n) =>
      n.type === 'AppButton' && n.props.label === 'reminders.complete.action',
  );
  assert.equal(button.props.disabled, false);
  await button.props.onPress();
};
states = [];
tree = render();
select('now');
assert.ok(
  tree.some(
    (n) => n.props?.children === 'reminders.complete.actualTime.nowHint',
  ),
);
clock = Date.parse('2026-10-14T06:52:00Z'); // Confirm five minutes later.
// Use the handler captured before the wait, matching no intervening re-render.
await submit();
assert.equal(
  completed.at(-1).occurredAt,
  null,
  'Never submit the stale 14:47.',
);
tree = render();
select('other');
tree
  .find((n) => n.type === 'CareDateTimeField')
  .props.onChange('2026-10-14T06:00:00Z');
tree = render();
await submit();
assert.equal(completed.at(-1).occurredAt, '2026-10-14T06:00:00Z');
select('planned');
await submit();
assert.equal(completed.at(-1).occurredAt, planned);
states = [];
tree = render({
  ...props,
  scheduledFor: new ModalDate(clock + 3600000).toISOString(),
});
assert.equal(tree.find((n) => n.type === 'Pressable').props.disabled, true);
console.log(
  'PASS: actual modal execution requires a choice; cancel makes no completion call; 14:47 open / 14:52 confirm sends server-now, custom 14:00 and planned time stay exact; future planned choice is disabled.',
);

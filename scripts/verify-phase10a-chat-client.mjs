import {
  addOptimisticMessagePages,
  getChronologicalMessagesFromPages,
  markOptimisticMessageFailedPages,
  reconcileChatMessagePages,
  removeChatMessagePages,
} from '../src/features/chat/chat-cache.ts';

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function message(id, clientMessageId, createdAt, extra = {}) {
  return {
    body: `message ${id}`,
    client_message_id: clientMessageId,
    created_at: createdAt,
    id,
    pet_id: 'pet-a',
    sender_id: 'user-a',
    updated_at: createdAt,
    ...extra,
  };
}

const timestamp = '2026-09-07T12:00:00.000Z';
const pending = message('optimistic:client-a', 'client-a', timestamp, {
  deliveryState: 'sending',
  optimistic: true,
});
const pendingPages = addOptimisticMessagePages([], pending);
expect(pendingPages[0]?.messages.length === 1, 'Optimistic insert failed.');

const failedPages = markOptimisticMessageFailedPages(pendingPages, 'client-a');
expect(
  failedPages[0]?.messages[0]?.deliveryState === 'failed',
  'Failed-send state was not retained for retry.',
);

const retryPages = addOptimisticMessagePages(failedPages, {
  ...pending,
  deliveryState: 'sending',
});
expect(
  retryPages[0]?.messages.length === 1 &&
    retryPages[0].messages[0]?.deliveryState === 'sending',
  'Same client ID retry created a duplicate optimistic row.',
);

const committed = message(
  '00000000-0000-4000-8000-000000000010',
  'client-a',
  timestamp,
);
const reconciled = reconcileChatMessagePages(retryPages, committed);
expect(
  reconciled[0]?.messages.length === 1 &&
    reconciled[0].messages[0]?.id === committed.id &&
    !reconciled[0].messages[0]?.optimistic,
  'Committed row did not replace its optimistic client ID.',
);
const edited = {
  ...committed,
  body: 'edited message',
  updated_at: '2026-09-07T12:01:00.000Z',
};
const editedPages = reconcileChatMessagePages(reconciled, edited);
expect(
  editedPages[0]?.messages.length === 1 &&
    editedPages[0].messages[0]?.body === 'edited message' &&
    editedPages[0].messages[0]?.created_at === committed.created_at,
  'Edit reconciliation duplicated the row or changed its stable cursor.',
);

const older = message(
  '00000000-0000-4000-8000-000000000001',
  'client-older',
  timestamp,
);
const newerTie = message(
  '00000000-0000-4000-8000-000000000020',
  'client-newer',
  timestamp,
);
const duplicatePages = [
  { messages: [newerTie, committed], nextCursor: null },
  { messages: [committed, older], nextCursor: null },
];
const chronological = getChronologicalMessagesFromPages(duplicatePages);
expect(chronological.length === 3, 'Message ID dedupe failed across pages.');
expect(
  chronological.map((item) => item.id).join(',') ===
    [older.id, committed.id, newerTie.id].join(','),
  'Identical timestamps did not use ID as deterministic tie-breaker.',
);

const removed = removeChatMessagePages(duplicatePages, committed.id);
expect(
  removed.every((page) =>
    page.messages.every((item) => item.id !== committed.id),
  ),
  'Delete reconciliation left a duplicate in a retained page.',
);

console.log(
  'PASS: optimistic send, failure, and same-ID retry reconciliation.',
);
console.log('PASS: cross-page ID dedupe and identical-timestamp ordering.');
console.log('PASS: delete invalidation removes all cached copies.');
console.log('PASS: edit invalidation replaces one row without cursor drift.');

# Family Chat scope correction

Status: local implementation and verification only. No Production connection,
release-policy change or rollout has been performed.

## Data and compatibility

Migration: `20260927103354_family_chat_scope.sql` (forward only).

- `chat_messages.family_id` is non-null canonical ownership, backfilled through
  the existing Pet's Family. Unmappable rows abort the migration atomically.
- Message IDs, bodies, sender IDs and timestamps are retained. The C4D-BC
  nullable sender / deleted-user retention constraint is unchanged.
- Legacy `pet_id` is retained and becomes nullable with `ON DELETE SET NULL`.
  Family deletion cascades messages; Pet deletion preserves them.
- A private trigger derives Family for legacy inserts, checks Pet/Family
  consistency, rejects ownership reassignment and binds authenticated inserts
  to the sender's canonical Owner/Member membership.
- New messages have `pet_id = NULL`; sending never needs a Pet, including a
  zero-Pet Family.
- `family_chat_read_states` uses `(family_id, user_id)`. For each current
  Owner/Member, take the **minimum (timestamp, message ID) tuple** across every
  Pet room in that Family with historical messages. A missing read state
  contributes the epoch/zero UUID. Because this cursor is no later than any
  contributing room's cursor, it cannot mark a previously unread message read.
  Previously read messages can appear unread again. Old-client read operations
  after migration do not advance the new cursor; additional false-unread is an
  accepted temporary compatibility cost.
- New RPCs: `get_family_chat_messages_page`, `send_family_chat_message`,
  `update_family_chat_message`, `delete_family_chat_message`,
  `get_family_chat_members`, `get_family_chat_unread_count`,
  `mark_family_chat_read`, `get_family_chat_channel_version`.
- Family RPCs, message SELECT RLS and private Broadcast authorization use
  `family_members`. Owner/Member access and edit-own/Owner moderation remain;
  Viewer, unauthenticated, removed and foreign-Family callers remain excluded.
- Old RPC signatures, Pet pagination, Pet read states, Pet channel state and
  private Pet topics are retained. Their write-lock and Pet-topic join helpers now check canonical membership
  without changing signatures. Old member-list/rotation compatibility data still
  uses mirrors; it is not the new Family path authority.
- Legacy messages additionally notify their canonical Family topic. New Family
  messages do not fan out to every old Pet room. While minimum iOS remains
  1.2.0 (9), the legacy Pet path remains complete, including Realtime. New Family messages may have no Pet and
  need not appear in old Pet rooms. No message copying or bidirectional bridge.
- Family topics are `family:{familyId}:chat:v{version}`. Membership changes rotate
  the version and notify remaining contributors over their existing private
  user control channel. Expired **Family channel versions** receive no future
  events. Payloads remain message-ID hints, not message bodies. Existing Pet
  topics are preserved.
- Existing mutation/release guards are retained. The new read-state table uses
  the same pre-cutover trigger as the old Chat tables. The migration's historical
  backfill uses only the existing trusted transaction-local migration bypass,
  restores its previous value and does not change the persisted lock or policy.

## Client scope

Query keys are `['chat', userId, 'family', familyId, kind]`. The namespace also
prevents reuse of old Pet-room caches. Session identity, messages, unread state,
read cursor, optimistic sends, composer identity and Realtime depend on Family,
not selected Pet. A displayed Pet/avatar and the existing switcher remain UI
context only. A Family with no Pets displays the existing Family Chat title and
continues to send/read. No-Family UI offers creation/join.

Family/user changes or access loss cancel/clear the affected Chat cache. Pet
cleanup must not clear Family history because it contains legacy Pet metadata.
Shared Family access cleanup explicitly clears the Family Chat keys, including
zero-Pet Families, without depending on a Pet list.
The same user/Family checks and version authorization remain required on resume,
reconnect and regular membership revalidation.

## Changed client files

- `src/features/chat/chat-screen.tsx`: Family-bound hooks, read cursor/composer,
  zero-Pet screen and presentational Pet switcher.
- `src/features/chat/chat-session-provider.tsx`: Family session/unread/access cleanup.
- `src/features/chat/chat-queries.ts`: new RPCs and Family optimistic/cache routing.
- `src/features/chat/use-chat-realtime.ts`: Family topics and Family message validation.
- `src/features/chat/chat-scope.ts`: shared, testable Family keys/topics/cleanup predicate.
- `src/features/chat/chat-presentation.ts`: remove the old Pet scope constructor.
- `src/features/family/family-access-cleanup.ts`: explicit Family Chat revocation,
  including a Family with no Pet IDs.
- `src/features/pets/pet-access-state.ts`: Pet cleanup no longer matches Chat.
- `src/types/database.ts`: new Family columns/table/RPC types; legacy page shape retained.
- `src/i18n/locales/{en,zh-HK}.json`: no-Family state and corrected switch accessibility
  copy. Mock preview copy and Chat styles are unchanged.

## Local verification

- `npm run verify:family-chat-client`: real QueryClient cache and existing
  Family-context reconciliation, historical merge/send persistence, zero Pet,
  Family/user isolation, topic identity, unread identity and Pet cleanup.
- `npm run verify:family-chat-sql`: explicitly targets local Docker container
  `supabase_db_pawday` over its Unix socket. Fixtures and SQL assertions run
  in one rollback transaction; the migration body is included only when pending
  (failure closes the
  connection and PostgreSQL rolls back). No linked CLI, URL, keys or remote API.
  It uses the existing trusted local transaction bypass without changing policy.
- SQL covers backfill/content retention, merged pagination, conservative read
  cursors, current/foreign/Viewer/removed access, private topic authorization and
  emission, expired Family-version silence after rotation, legacy
  fetch/send/edit/delete/members/read/version/topic compatibility, zero Pet,
  Pet deletion, deleted
  sender retention, mirror drift and unchanged release policy/lock.
- Existing Chat/cache/UI/removed-member verifiers and TypeScript/lint/format
  checks are also run. SQL checks do not replace actual websocket subscription,
  PostgREST client compatibility or device smoke tests.
- The verifier never persistently applies the migration. When pending, it tests
  the migration body without its explicit outer BEGIN/COMMIT. When already
  applied, it uses the existing schema and seeds only synthetic fixture cursors
  and channel versions in its rollback transaction. Both modes verify that
  persisted schema, migration history, data and release policy remain unchanged.

## Production preflight checklist — DO NOT execute as part of this task

The companion `docs/sql/family-chat-production-preflight.sql` contains only
read-only, pre-migration aggregate queries. Run only in a separately authorized
Production review, against the confirmed project ref.

- [ ] Count messages/read states, Families with Chat and multi-Pet Families with
      Chat; record per-Family/per-Pet message counts (no body/sender export).
- [ ] Require zero unmappable message rows, missing Pet/Family or orphan read
      states. Never infer ownership from a sender's current Family.
- [ ] Review missing cursors, differing cursors, conservative epoch resets and
      estimated false-unread. Record expected backfill/read-state/channel rows.
- [ ] Previous Pet cascade deletions cannot be inferred or recovered from live
      rows alone. Compare authorized backups/deletion audit data if available;
      otherwise explicitly record this as unknown. Do not restore Production.
- [ ] Verify deployed schema/RPC/policy definitions match the reviewed migration
      baseline and record old RPC signatures and role grants.
- [ ] Prepare a reviewed backup and size/lock-duration estimate. Backfill, FK
      changes and index creation take locks; test the transaction at comparable
      data size and use bounded lock/statement timeouts for the real execution.
- [ ] Confirm old 1.2.0 fetch/send/read/private Realtime with an authorized test
      account after migration; no immediate old-path deletion.
- [ ] Apply DB support before shipping the Family client; the new client requires
      these RPCs and deliberately has no fallback to Pet-room identity.
- [ ] After next-release smoke (multi-Pet merge/switch/send, zero-Pet Family,
      roles/removal/Realtime), decide minimum-version changes in the release
      process. This change does not edit minimum iOS, mutation gate, lock,
      maintenance mode, cleanup worker or scheduler.

## Review correction: staged compatibility

A. Migration applied, minimum still 1.2.0 (9): legacy `send_chat_message`
retains the requested Pet and derives canonical Family ownership. Its existing
Pet trigger emits to the current Pet channel; the same row ID also notifies the
Family channel. Pet version lookup/rotation and legacy fetch/unread/read remain
functional. Broadcast access and writes require canonical Owner/Member membership,
so a leftover mirror cannot restore Viewer or removed/former access.

B. Next release available and minimum raised through the separate release process:
new clients use only Family Realtime; old release clients are blocked by the
existing minimum-version gate. Legacy Pet RPCs, cursor state and topics naturally
stop receiving old-client traffic; this migration does not remove them or add a
long-term sync bridge. Production release policy and security gates are unchanged.

The original implementation already emitted both hints for legacy writes. The
previous “older topics” wording meant expired Family versions, not active Pet
channels. The review adds per-message event counts, legacy retry/read checks and
current-version authorization tests (replacing a weak hard-coded Pet v1 check).
Family send is explicitly checked with `family_id NOT NULL`, `pet_id NULL`, one
DB row and no Pet event. Client regression checks repeated hints/RPC results in
both arrival orders, replacing optimistic state with exactly one canonical row.
SQL verification tests database Broadcast generation and authorization; it does
not establish actual websocket delivery or device compatibility.

## Local persistent application

The CLI runner requires this migration's explicit BEGIN/COMMIT for LOCK TABLE
and atomic backfill, matching existing project migrations. Apply using
`supabase migration up --local` after checking `migration list --local`. The
Family Chat SQL verifier supports the resulting applied schema without
re-applying or reverting the persisted migration. No reset or data wipe is needed.

Local application completed on 2026-09-27 via `migration up --local`. History
contains 39 entries, including `20260927103354` (`family_chat_scope`). The local
DB had zero Chat messages before/after; therefore no existing message rows
required backfill. Both existing Families have initialized channel states.
Persisted read-state/message fields and release policy/lock fingerprints are
unchanged. Pending-mode and applied-mode SQL compatibility tests both passed;
the applied schema/history remain intact after the verifier rolls back.

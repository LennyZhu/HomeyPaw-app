# Phase 10A — Secure Family Chat

Status: Security Review Round 2 local implementation and review only
Production migration: **NOT APPLIED**
Local migration: **NOT APPLIED**

## Architecture

HomeyPaw keeps its existing family boundary: one `pets` row plus its
`pet_members` rows is one private family chat. Phase 10A does not add a
household, room, channel, community, discovery, or direct-message model.

PostgreSQL is the only source of truth. Supabase Realtime carries small
invalidation hints; the app always reads a created or updated message again
through RLS before merging it into the query cache.

The real UI is isolated behind `CHAT_ENABLED`. It requires both a development
build and `EXPO_PUBLIC_CHAT_ENABLED=true`. A production bundle cannot enable
the tab, and the page redirects when reached directly. The already released
1.0.0 app, version, and build number are unchanged.

Expo Router can still include the static `chat` and `chat-preview` modules in a
production JavaScript bundle. The current release therefore relies on two
non-bypassable UI guards (`href: null` plus a page redirect, with `__DEV__`
compiled false), while database RLS/RPC/channel authorization remains the real
security boundary. Physically removing those route modules would require a
larger router/build split and is deferred rather than disguised.

## Additive schema

- `public.chat_messages`: text-only messages, pet and sender cascade FKs,
  server-bound sender, 2,000-character limit, and deterministic retry key.
- `public.chat_read_states`: one private `(last_read_at,
last_read_message_id)` cursor per user and pet. The ID is deliberately not a
  message FK so deletion cannot erase the ordering tie-breaker.
- `private.pet_chat_states`: server-only current Broadcast topic version. It is
  not a chat-room abstraction and is not exposed through PostgREST.
- Unique `(sender_id, client_message_id)` prevents uncertain retries from
  creating duplicate messages.
- `(pet_id, created_at DESC, id DESC)` supports stable history pagination.

No existing table, policy, membership helper, or production row is removed or
rewritten.

## RLS and RPC boundary

| Operation                         | Owner                   | Member                  | Viewer / Stranger / Removed |
| --------------------------------- | ----------------------- | ----------------------- | --------------------------- |
| Read messages                     | Yes                     | Yes                     | No                          |
| Send own text                     | Secure RPC              | Secure RPC              | No                          |
| Edit own message                  | Secure RPC              | Secure RPC              | No                          |
| Edit another member's             | No                      | No                      | No                          |
| Delete own                        | Secure RPC              | Secure RPC              | No                          |
| Delete another member's           | Secure RPC              | No                      | No                          |
| Read/update own read cursor       | Secure RPC / own SELECT | Secure RPC / own SELECT | No                          |
| Receive current private Broadcast | Yes                     | Yes                     | No                          |

The public message and read-state tables grant only `SELECT` to authenticated
clients. They grant no direct `INSERT`, `UPDATE`, or `DELETE`. Every mutating
RPC is `SECURITY DEFINER`, has `search_path = ''`, schema-qualifies referenced
objects, derives identity from `auth.uid()`, revokes default execution, and
grants execution only to `authenticated`.

`send_chat_message` validates the active Owner/Member relation before it trims
and validates the body. The client cannot supply `sender_id`.
`update_chat_message` looks up the message server-side, requires the caller to
be its sender and a current contributor, changes only trimmed `body` and
`updated_at`, and rejects empty or over-2,000-character content. Owner status
does not permit editing another member's message.
`delete_chat_message` returns `false` for a missing or unauthorized message to
avoid disclosing its existence. There is no direct update policy.

## Private Realtime Broadcast

Topics have the exact form `pet:<PET_UUID>:chat:v<VERSION>`. A private
`realtime.messages` SELECT policy checks all three inputs: `auth.uid()`, the
active Owner/Member row, and the current server-only channel version. There is
no authenticated `realtime.messages` INSERT policy because clients never send
Broadcast events.

Database logic emits only:

```json
{
  "type": "message_created | message_updated | message_deleted",
  "message_id": "uuid"
}
```

The topic already scopes the pet, so the payload contains no pet ID, message
body, profile, member list, invite, or credential. Insert and future server
update operations use a table trigger. Explicit message deletion uses the
secure delete RPC. There is deliberately no generic `AFTER DELETE` message
trigger: account and pet cascades must not leak deleted message IDs.

The local Realtime runtime confirms that the official `realtime.send` API adds
its generated infrastructure row UUID to the delivered JSON payload. The
reviewed server helpers continue to use that official API with `private = true`;
HomeyPaw supplies only the business fields above. Clients consume only `type`
and `message_id` and ignore unknown framework metadata. Authenticated clients
have no `realtime.messages` INSERT policy.

Rotation uses a separate per-user private control plane:

```text
user:<AUTH_USER_UUID>:chat-control
```

Its independent `realtime.messages` SELECT policy requires the topic to equal
the caller's exact `auth.uid()` topic. It has no client INSERT policy. After a
membership mutation, server logic queries the post-mutation Owner/Member rows
and sends only those users:

```json
{ "type": "chat_channel_rotated", "pet_id": "uuid" }
```

It never sends the control event to the removed, leaving, demoted, or
account-deleted user. This control plane is not a second room or DM and carries
no message data. HomeyPaw consumes only `type` and `pet_id` from control events
and ignores Supabase infrastructure metadata.

## Channel version rotation

An `AFTER INSERT OR DELETE OR UPDATE` trigger on `pet_members` centralizes
rotation for invite joins, Owner removal, future direct administrative
membership changes, and Auth account cascades. It takes an exclusive lock on
the private state row. Chat write RPCs first share-lock the caller's membership
and the same state row, so a concurrent send/delete is transactionally ordered
before or after removal; edit uses the same order. None can publish a future
event to the old topic.

The previous Pet topic receives **no rotation or control event at all**. Once
the membership transaction commits, all later message events are sent only to
the new exact-current-version topic. Current members learn of rotation through
their own control topics, refetch the version through RLS, unsubscribe the old
Pet channel, subscribe the new private channel, wait for `SUBSCRIBED`, and then
reconcile. A removed member receives no control event, cannot fetch the new
version, and cannot authorize the new topic. Keeping the old socket open does
not expose any later create/update/delete/control event.

The first owner membership establishes version 1 without an old-topic event.
The Pet insert trigger creates its state first. A membership trigger never
recreates missing state, so pet-deletion cascade order cannot produce an FK
failure. Rotation also verifies the parent Pet is still visible; a Pet cascade
therefore emits no Chat or control event even if sibling membership row
triggers have not all run yet. No event is ever sent to the old Pet topic, and
message IDs are never broadcast during cascades.

The Chat topic authorization parser accepts only the canonical UUID/version
shape and joins the requested Pet to `private.pet_chat_states`. Authorization
requires both a current Owner/Member row and equality with the exact current
version. A current v7 member therefore cannot pre-subscribe v8, and after
removal cannot subscribe v8 or any guessed later version. Membership mutation
and version rotation are one atomic trigger transaction, so other sessions
cannot observe a new committed version with the removed membership still
committed.

### Lock ordering

Client Chat mutations use one ordering:

1. caller's `pet_members` row: `FOR SHARE`;
2. `private.pet_chat_states` row: `FOR SHARE`;
3. target message row: INSERT or UPDATE/DELETE row lock.

Membership removal/update first locks the membership row, then its `AFTER`
trigger obtains `FOR UPDATE` on the state row. Consequently send/edit/delete
either finishes before removal, or observes the removed membership and fails.
The Broadcast helper also share-locks the current state row, preventing a
server-side message event from being committed against an already-rotated old
version.

## Pagination and unread

`get_chat_messages_page` uses the tuple cursor `(created_at, id)`, returns at
most 30 newest-first rows, and rejects half-specified cursors. The UI merges by
message ID/client message ID and displays oldest to newest.

`mark_chat_read` accepts a last actually visible `message_id`, never a client
timestamp. After locking membership/state it resolves that message's Pet and
`created_at` server-side, then advances the stored tuple only when
`(created_at,id)` is greater. A client cannot submit a future timestamp or move
the cursor backwards. `get_chat_unread_count` uses the same tuple comparison
and excludes the caller's messages.

## Client lifecycle

1. Authenticate Realtime and subscribe to the caller's private control topic.
2. Fetch the authorized current Pet topic version.
3. Join the exact private Pet channel only after the control topic is ready.
4. After `SUBSCRIBED`, fetch the latest page and member map.
5. On create/update hints, fetch the specific row through message RLS.
6. On delete hints, remove the ID and reconcile the current pages.
7. On `chat_channel_rotated`, hide the room, fetch the authorized current
   version, remove the old Pet channel, clear its caches, subscribe the new
   private channel, wait for `SUBSCRIBED`, and then reconcile.
8. On foreground, reconnect, token refresh, and a focused-screen 15-second
   membership check, revalidate the version and
   reconcile. A stale-version channel failure gets one delayed refetch, not an
   infinite custom retry loop.
9. Pet-specific query keys and channel cleanup prevent cross-pet mixing.

The periodic membership check is required because the removed user correctly
receives no control event. It clears already-obtained local Chat cache after a
focused client discovers the revoked membership; confidentiality of new data
does not depend on that poll because the old Pet topic is server-silent.

Offline sends are not presented as successful. A failed or uncertain send is
shown in memory and can retry with the same `client_message_id`; a committed
first attempt returns the same authoritative row.

## Account deletion

The existing Plan A server flow remains unchanged. Deleting a Member Auth user
cascades their messages and membership; the membership trigger rotates the
topic for the remaining family. An Owner account flow deletes owned pets first,
which cascades messages, read states, memberships, and the private topic state.
No cascade broadcasts message IDs.

The repository currently has no Member self-leave RPC or direct authenticated
`pet_members` delete grant. The existing mutation paths are invite join, Owner
remove, service-role account deletion cascade, and Pet deletion cascade; the
database trigger covers all of them. If self-leave is added later, deleting the
membership row automatically uses the same rotation boundary.

## Verification

Static verification:

```sh
npm run verify:phase10a-chat
npm run verify:phase10a-chat-client
```

The destructive three/four-user test harness refuses any host except
`localhost` or `127.0.0.1`. After a local Supabase stack is reset with the new
migration, provide only local ephemeral test values through the process
environment and run:

```sh
npm run verify:phase10a-chat-rls
```

It covers Owner/Member/Stranger access, current-member future-version and
malformed-topic denial, per-user control authorization, cross-pet
isolation, direct-write denial, sender spoof prevention, whitespace/length
validation, normalized retry and cross-Pet collision, edit-own restrictions,
Owner moderation, visible-message cursor unread calculations, 70+ rows,
identical timestamps, stable cursors, private create/update/delete delivery,
remove-vs-send/edit/delete concurrency, Owner-send-vs-remove deadlock timeout,
removed-member old-socket silence and reconnect denial, account-deletion
membership cascade rotation, and pet cascade cleanup. There is no product
self-leave RPC to exercise separately in this repository.

## Production Realtime setting audit

Repository audit found no existing HomeyPaw feature using public Broadcast,
Presence, or `postgres_changes`; Phase 10A's two channel types both specify
`private: true`. Therefore disabling Supabase Realtime **Allow public access**
is compatible with the repository implementation and is recommended before a
future Phase 10A production release. The actual production dashboard setting
was not read or changed in this local-only round.

Manual device review must additionally cover:

- zh-HK and English copy;
- largest accessibility text sizes and VoiceOver/TalkBack delete/retry actions;
- multiline 2,000-character composer and keyboard/Home Indicator layout;
- current-pet switching with no message flash from the previous pet;
- background removal followed by foreground access loss;
- network timeout after a committed send, then same-ID retry;
- 100+ messages on a lower-end device;
- sign-out clearing all query cache and closing the current subscription.

## Rollback strategy

Before any future rollout, keep the feature flag off and back up the database.
If the migration itself fails, its transaction rolls back atomically. If a
post-migration issue is found, first keep Chat disabled; the additive tables can
remain dormant without affecting existing pet, journal, care, or reminder
features.

Dropping chat data is not an automatic rollback. Only after an explicit data
retention decision and backup should a separately reviewed maintenance
migration remove the Realtime policy, membership/message triggers, Chat RPCs,
private state, read states, and messages in dependency order. No rollback may
alter the existing `pets`, `pet_members`, or membership helper semantics.

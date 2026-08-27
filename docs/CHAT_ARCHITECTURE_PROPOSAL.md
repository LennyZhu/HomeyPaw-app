# Chat Architecture Proposal

> Status: proposal only. Nothing in this document is implemented by the Chat UI Prototype.

## Product Boundary

HomeyPaw Chat is a private family conversation centered on one pet. It is not a public group, community, stranger-to-stranger messenger, or household-wide room.

The durable sharing boundary remains:

`Pet → Active Pet Family Members → Private Pet Family Chat`

- One pet has one private family conversation.
- A user with multiple pets sees a separate conversation for each pet.
- Only active members of that pet may read or send.
- A household abstraction must not silently widen access across pets.

The current prototype is development-only, uses deterministic Mock Data, and performs no backend reads or writes. The ideas below belong to a future, separately approved Chat Backend phase.

## Future Schema Options — Not Implemented

### Option A: `chat_messages.pet_id`

Conceptual fields:

- `id`
- `pet_id`
- `author_id`
- `message_type`
- `body`
- `created_at`
- `edited_at`
- `deleted_at`

Advantages:

- Models the product boundary directly.
- Avoids a room lookup for the fixed one-pet/one-chat relationship.
- Makes membership-based RLS easier to read and audit.
- Reduces schema, trigger, and lifecycle complexity for a first version.

Tradeoffs:

- A later need for several rooms per pet, room-specific settings, room archives, or cross-pet rooms would require a schema evolution.
- Room metadata has no natural home until a separate settings/read-state table is introduced.

### Option B: `chat_rooms` + `chat_messages.room_id`

Conceptual `chat_rooms` fields:

- `id`
- `pet_id`
- `created_at`

Conceptual `chat_messages` fields:

- `id`
- `room_id`
- `author_id`
- `message_type`
- `body`
- `created_at`
- `edited_at`
- `deleted_at`

Advantages:

- Provides a natural parent for room settings, retention state, and future room types.
- Supports multiple rooms per pet later without changing every message relationship.
- Can make room-level analytics or archival clearer.

Tradeoffs:

- Adds a table and join even though the current product guarantees exactly one room per pet.
- Requires enforcing one room per pet and keeping room membership aligned with pet membership.
- Adds another object whose authorization and deletion lifecycle must be audited.

## Future Database Recommendation

Start with **Option A: `chat_messages.pet_id`** if the product boundary remains one private conversation per pet. It is the smallest schema that expresses the actual authorization boundary and is easier to verify under RLS.

Before implementation, confirm that product does not need multiple channels, archived rooms, or room-specific membership. If any of those requirements become real, choose Option B before launch instead of prematurely adding a room table now.

This recommendation is not a migration plan. No table, index, trigger, function, enum, or policy is created by the prototype.

## Future Message Model — Not Implemented

Suggested conceptual message properties:

| Field                 | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `id`                  | Stable message identity and cursor tie-breaker           |
| `pet_id` or `room_id` | Private conversation boundary                            |
| `author_id`           | Authenticated sender                                     |
| `message_type`        | Text, image, or narrowly defined system event            |
| `body`                | Validated text content; optional for media-only messages |
| `created_at`          | Server-assigned ordering timestamp                       |
| `edited_at`           | Future edit marker, if editing is approved               |
| `deleted_at`          | Tombstone for author or owner deletion, if approved      |

Media should be modeled separately rather than storing mutable arrays in the message row. A future media record could contain message identity, storage path, position, MIME type, dimensions, and created time.

System Care and Reminder messages require an explicit future decision: either store immutable chat events with a safe display snapshot, or derive them from domain events. The prototype does neither and must not be treated as evidence that Care Logs or reminders are connected to Chat.

## Future RLS Recommendation — Not Implemented

Authorization should be derived from active pet membership at request time. Client guards are presentation only and must never substitute for RLS.

| Actor                            | Read                  | Create                   | Edit                               | Delete                                          |
| -------------------------------- | --------------------- | ------------------------ | ---------------------------------- | ----------------------------------------------- |
| Active pet member                | Messages for that pet | Own message for that pet | Own message only, if editing ships | Own message only, if deletion ships             |
| Pet owner                        | Messages for that pet | Own message for that pet | Own message only                   | Own message plus moderation delete, if approved |
| Removed member                   | No new access         | No                       | No                                 | No                                              |
| Stranger / member of another pet | No                    | No                       | No                                 | No                                              |

Additional requirements:

- `author_id` must be derived from the authenticated user, not trusted from arbitrary client input.
- Creating a message must verify active membership for the target pet.
- An owner may moderate-delete a member message but must never edit that member's words.
- Removing a member must revoke new reads and sends immediately.
- Storage access for future images must use the same active-pet boundary.
- Service-role access, admin tooling, and account-deletion jobs require a separate audit.

Historical-message behavior after member removal is a product decision. A likely direction is to preserve the history for the remaining family while the removed member loses all future access, but this proposal does not define final retention semantics.

## Future Realtime Recommendation — Not Implemented

### PostgreSQL Changes

Advantages:

- Directly reflects committed message rows.
- Small implementation surface for the first private-family version.
- Fits the expected low fan-out of a pet family conversation.

Considerations:

- Subscription authorization and RLS behavior must be verified against the exact future Supabase version.
- Every reconnect must reconcile from the database using the message cursor; Realtime is not the source of truth.
- Typing and ephemeral presence do not belong in persisted message changes.

### Broadcast

Advantages:

- Better suited to ephemeral events such as typing signals.
- Can offer more control over channel payloads and reduce database-change fan-out in a larger system.

Considerations:

- Requires a secure private-channel authorization design.
- Adds message delivery paths that must be reconciled with committed database state.
- Is unnecessary complexity for the first small family chat unless measurements justify it.

### Recommendation

For a first real version, prefer **PostgreSQL Changes for committed messages**, with cursor reconciliation after connect or reconnect. Do not ship typing indicators initially. Reconsider private Broadcast only for ephemeral behavior or demonstrated scaling needs.

No Realtime channel, WebSocket, Broadcast, Presence, or subscription exists in the prototype.

## Future Pagination

Use keyset pagination ordered by `(created_at, id)`. Both fields are required because timestamps can collide.

- Load the newest page on entry.
- Request older pages using the oldest loaded `(created_at, id)` cursor.
- Preserve visible scroll position when prepending.
- Reconcile newly committed messages after reconnect.
- Define deterministic handling for soft-deleted rows.

Offset pagination is not recommended for an actively changing conversation.

## Future Unread Recommendation — Not Implemented

Prefer one `last_read_at` value per user and pet for the first version. This is simpler than per-message receipts and matches a family product that does not promise read receipts.

A future read-state record might conceptually contain `user_id`, `pet_id`, and `last_read_at`. Updating it would be a backend mutation with its own RLS and throttling design, so it is explicitly outside this prototype.

Do not infer `last_read_at` from the visual Mock unread divider. The prototype has no unread state, counters, receipts, or persistence.

## Future Image Messages — Not Implemented

If image messages are approved later:

- Use private Storage only.
- Validate active pet membership before upload and read.
- Use a scoped path such as `userId/petId/messageId/...`.
- Validate MIME type, byte size, image dimensions, and file count on trusted infrastructure.
- Keep media metadata separate from the message body.
- Define cleanup for failed sends, deleted messages, pet deletion, and account deletion.
- Use short-lived signed access or an equivalent private delivery model.

The prototype uses bundled local illustrations. It has no image picker, camera permission, upload, bucket, signed URL, or cleanup behavior.

## Future Push Recommendation — Not Implemented

Remote chat notifications belong to a later phase after the real authorization and persistence model is proven.

Requirements before implementation:

- Explicit opt-in and a clear permission prompt context.
- Per-user and ideally per-pet notification preferences.
- Privacy-safe lock-screen content choices.
- No notification to the sending user.
- Membership re-check immediately before enqueueing.
- Token lifecycle, sign-out, removed-member, and account-deletion handling.
- Rate limiting, grouping, and quiet-hour decisions.
- A separate privacy and App Review assessment before release.

No Expo Push Service, APNs, remote notification entitlement, token registration, or push mutation is added by the prototype.

## Future Moderation, Block, and Report

- Owner moderation delete is a reasonable future capability; owner edit of member messages is not.
- Traditional user blocking may be unnecessary inside an invite-only pet family. Membership removal is the primary control.
- A public report flow is not required by the current private, invite-only model, but it must be reassessed with policy and App Review requirements before a real release.
- Message edit, reactions, reply threads, read receipts, search, voice, video, location, stickers, and public sharing are not part of the first proposal.

## Product Decisions Deferred

The real Chat phase must decide all of the following before schema or policy work begins:

1. Whether removed members may retain any previously downloaded history; server access must end immediately either way.
2. Whether a removed member's historical messages remain visible to the family.
3. What happens to authored messages after account deletion: retain with attribution changes, anonymize, tombstone, or delete.
4. Whether authors can edit or delete their own messages, and any time window.
5. Whether owners can moderation-delete member messages and how that action is represented.
6. Whether system Care/Reminder messages are stored snapshots or derived events.
7. Message and media retention periods.
8. Whether multiple rooms per pet will ever be allowed.
9. Whether remote notification previews include message text.
10. Whether policy or App Review needs a report mechanism in an invite-only family context.

Account deletion semantics must be decided specifically for private family chat and must not be copied automatically from Posts.

## Prototype-to-Backend Gate

The prototype is not authorization to start the real backend. A future implementation should begin only after product decisions are approved and should have its own plan covering schema review, RLS tests, abuse cases, storage lifecycle, Realtime reconciliation, deletion semantics, privacy disclosures, and release gating.

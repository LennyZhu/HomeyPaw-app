# Journal Read Receipts V1

Journal stays Pet-owned and Family-authorized: `posts.pet_id → pets.family_id → family_members`. Owner, Member and Viewer can read and mark. Chat authorization is not reused.

## What counts

- Successfully opening Post Detail while focused and foregrounded.
- Explicitly clicking a Post's photo/video to open its viewer, including directly from Feed. Immediate close still counts.
- Passive Feed exposure, thumbnail/preload/URL requests do not count. Photo pagination creates no additional receipt.
- Detail and media entry points share QueryClient session dedupe; the database is the final idempotency and authorization boundary.

## Database contract

`post_read_states(id, post_id, user_id, first_read_at)` has unique `(post_id,user_id)`. Post deletion cascades; Auth deletion sets reader ID NULL. Multiple anonymous historical rows are valid. No name/email/avatar snapshot, last-read time, view counter, or dwell time is stored.

Only authenticated RPCs expose the feature. Table access is revoked and RLS is enabled. Both RPCs resolve and lock canonical Post/Family membership. `mark_post_read` skips the author and uses `ON CONFLICT DO NOTHING`. `get_post_readers` includes only current authorized non-author members, with NULL-safe author exclusion. Names and avatar paths follow existing profile/signing conventions. Removed/former/deleted receipts remain in storage but disappear from count/list.

Receipt writes honor existing pre-cutover/release mutation guards. No release policy is changed. Existing account preparation, Post/Pet/Family deletion, Journal media, Push and Chat behavior are unchanged.

## Client / UI

Detail appends secondary “N 人已查看” / “Viewed by N family members” to the author date/time metadata only when the reader count is positive. Only the receipt text opens the existing compact modal; date/time remains noninteractive. Zero readers has no label or placeholder, and there is no bottom receipt footer. The modal shows avatar, display name, first-view date and time, with loading/error/retry states. Count and list use the same RPC result.

Detail focus and modal opening refetch readers. There is no Feed count query, Realtime or Push. Failed mark requests do not block viewing; another focus or explicit view may retry. No persistent offline queue. Session replacement/logout clears QueryClient; Family/Pet access cleanup clears both receipt acknowledgment and identity caches, including when cached Pet rows are absent. Reader queries consume cancellation signals so late responses cannot start avatar signing after cleanup.

## Mixed-version release checklist

- Apply the additive migration before publishing the capable client. Existing clients keep reading Journal unchanged and do not report receipts.
- Counts can underrepresent actual views during mixed-version use. Missing receipt is never evidence of unread; do not show a denominator or a named unread list.
- After the next release is available and its smoke passes, include the existing minimum-version cutover strategy in the release process. No gate changes are part of this implementation.
- No historical view backfill is possible. Coverage starts with capable clients; offline failures can still leave missing receipts after cutover.
- Journal currently requires a Pet; this feature does not introduce 0-Pet Journal content or alter Pet history deletion.

## Local verification

`verify:post-read-sql` clones only the local Docker schema into a disposable database, applies the migration there, runs rollback fixtures plus concurrent synthetic mark/account-preparation checks, drops the scratch database, and verifies development data/outbox/config/history fingerprints. It never consumes outbox jobs or applies pending development migrations. Account lifecycle is checked through the actual preparation RPC and Auth-row deletion; it does not invoke the persistent account-deletion Edge verifier or its cleanup jobs.

`verify:post-read-client` checks shared session dedupe/retry/cancellation, view eligibility, explicit media click wiring, passive Feed boundaries, locale UI and access cache cleanup. Device UI verification remains manual after an explicitly authorized local persistent migration.

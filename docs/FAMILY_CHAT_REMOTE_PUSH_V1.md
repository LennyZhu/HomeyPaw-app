# Family Chat Remote Push V1

Chat INSERT queues one `chat_message` event in the existing private Family
notification outbox, in the message transaction. No historical messages are
queued. Updates, deletes, read state and Realtime hints do not create Push jobs.
Legacy Pet sends and Family sends both reach the same INSERT trigger.

## Compatibility and authorization

- Existing devices default to `chat_push_v1 = false`.
- The original four-argument `register_push_device` API is preserved and clears
  capability. The new five-argument API explicitly registers it; refresh and
  account rebind replace the capability, while unregister clears it.
- Only enabled capable devices receive Chat Push. Existing Pet activity Push
  does not require this capability, so 1.2.0 retains its existing notifications.
- All recipients now resolve from canonical `family_members`, with Owner/Member
  roles and actor exclusion. Pet activities resolve Family through `pets.family_id`.
- Eligibility and Chat source existence/ownership are checked when deliveries
  are created, claimed and individually validated immediately before sending.
  A deleted source or revoked recipient produces terminal `skipped` deliveries.
- Shared-Family permission eligibility works without Pets.

## Payload and client behavior

Chat data contains only `type: chat_message`, `familyId` and `messageId`.
Notification text uses a trusted Profile nickname, capped at 40 Unicode code
points with control characters removed, or a generic localized fallback.
Message content and Pet metadata are never included.

The existing notification coordinator retains pending responses until auth,
root navigation and Family context are ready. It rechecks canonical membership
before opening `/chat`, without changing Pet selection. Access failures use the
existing home fallback. A focused same-Family Chat suppresses foreground banner,
list and sound; other notification types/screens retain existing behavior.

Unread continues to come from Chat messages/read states. Push never writes or
increments unread/read state. Existing message, event and per-device delivery
uniqueness enforce application-level deduplication; provider delivery is not
claimed to be exactly once. Existing TTL and retry policy are retained.

## Local verification and later deployment

- `npm run verify:family-chat-push-client`: pure payload/navigation/presentation
  tests and the actual Edge handler with a stub service client/local mock transport.
- `npm run verify:family-chat-push-sql`: a disposable local PostgreSQL database,
  restored from schema only, tests the pending migration or already-applied
  schema, fixtures and real two-session worker concurrency. In applied mode,
  historical fixture inserts temporarily disable the Chat enqueue trigger only
  in the scratch DB. It copies no business data, cleans itself up, and checks
  that the development database/data/functions/history/release gates are unchanged.
- Existing Family Chat and Push regressions remain applicable.

The migration was persistently applied to local development on 2026-09-28.
The seven existing pending jobs retained every old field and received only their
Pet-to-Family ownership backfill. No development jobs were consumed, and the
worker was not deployed. Production remains untouched.

Production rollout order is fixed: migration, then updated worker takeover and
readiness confirmation, then capable client release. With existing 1.2.0 devices
incapable, old workers claim Chat events with zero deliveries and finish normally;
these events still consume batch slots. Capable clients must wait until old worker
invocations finish. Deploying the new worker before its validation RPC exists
permanently fails existing activity deliveries, even though its HTTP response
can still be 200. No additional activation gate is required for this rollout.
No additional native notification capability, credential, silent-background
mode or permission is required. Navigation/presentation changes still require
delivery in the next client release. Real APNs delivery, worker cadence and
cold/background launch must be tested separately on an authorized device.

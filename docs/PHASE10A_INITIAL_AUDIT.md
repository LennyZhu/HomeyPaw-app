# Phase 10A initial audit

Status: HISTORICAL AUDIT — the architecture/security gate was resolved when the
versioned Private Realtime Broadcast design was approved. See
`docs/PHASE10A_SECURE_FAMILY_CHAT.md` for the current implementation. Production
deployment remains unapproved and unapplied.

## Scope and evidence

The requested next release is 1.1.0, text-only family chat. One pet is one
room; `pet_members` remains the authorization boundary. This audit examined
the local source and migration history, not a live production schema.
Existing uncommitted release documents and the screenshot script were preserved.

## Existing implementation

| Area             | Finding                                                                                                                                                                         | Reuse / required work                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prototype        | `src/features/chat/chat-preview-screen.tsx` and its components use mock messages, attachments, typing and scenario controls.                                                    | Preserve visual structure; production needs text-only data adapters, async send failure handling and moderation.                                                      |
| Membership       | `pet_members` has `(pet_id, user_id)` primary key, `owner/member/viewer` roles and no active-status column. Removal deletes the membership row.                                 | Membership existence is active membership; do not invent a status or household.                                                                                       |
| Helpers          | `private.is_pet_member` includes viewers; `private.can_contribute_to_pet` checks owner/member; `private.is_pet_owner` checks owner.                                             | Use `can_contribute_to_pet` for Chat read and write, and `is_pet_owner` for moderation. No existing helper changes needed.                                            |
| Account deletion | The Edge Function deletes owned pets, then deletes the Auth user.                                                                                                               | New pet/user cascading FKs can implement Plan A without changing existing membership semantics. Cascaded deletes must also be covered by Realtime security tests.     |
| Identity         | Profiles are self-readable; `get_pet_members` exposes safe member names without email.                                                                                          | Reuse the member map and safe fallback for missing/removed senders; do not broaden profile RLS or query per message. Existing member RPC does not expose avatar URLs. |
| Routing          | Production tabs are Home, Journal, Create, Profile. Chat preview is development-only.                                                                                           | Enable a production Chat tab only in the next release source after the security gate.                                                                                 |
| Cache            | TanStack Query retries queries and refetches on reconnect; Auth clears the query client on logout/account changes. Current pet selection derives from the accessible pet query. | Add user/pet-scoped chat keys, cancel in-flight requests and clean up subscriptions on access changes. Query clearing alone does not stop a Realtime channel.         |
| Migrations       | Local migration history ends at care tasks; no Chat tables or Chat publication setup exists.                                                                                    | All Chat schema changes must be additive. Existing production policies remain unchanged.                                                                              |

## Blocking Realtime conflict

The brief requires direct Postgres Changes INSERT and DELETE subscriptions on
`chat_messages`, filtered to the current pet, while strangers and removed members
must receive zero Chat events.

Supabase's current official documentation states that Realtime DELETE events do
not apply RLS because the original row no longer exists for authorization checks:

<https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records>

This concerns event delivery, not SQL DELETE authorization: a secure deletion RPC
can correctly enforce owner/sender permissions while its emitted DELETE event
still lacks the required recipient authorization.

Inference: the requested direct DELETE subscription cannot be certified against
the zero-access acceptance requirement based on row SELECT policies. Client
filters, unsubscribe callbacks and cache cleanup are not a server-side security
boundary against an untrusted client retaining or recreating a subscription.
Even a message-ID-only payload is an event disclosure under the brief.

Using REPLICA IDENTITY FULL or marking a channel private must not be assumed to
fix deleted-row authorization. The issue also applies to Auth/pet FK cascades,
not only the explicit message-deletion RPC.

## Recommended decision to unblock

Relax the requirement to directly consume `chat_messages` DELETE events. Permit
a server-authorized deletion invalidation mechanism followed by RLS-protected
database reconciliation, while retaining Postgres Changes and the existing
pet boundary. This is a proposal, not an implemented or verified workaround.

A local proof of concept must first establish that unauthorized subscribers
cannot receive deletion events, including deliberately crafted subscriptions
and FK cascade deletes. Merely omitting a DELETE listener from the official app
is insufficient if the underlying publication still exposes those events.
Publication settings and any additional signal storage must be reviewed before
choosing the exact implementation; existing production publication behavior must
not be changed implicitly. No Broadcast/Presence or weaker zero-access policy
has been approved by this audit.

## Pending implementation after the decision

- Add `chat_messages` and `chat_read_states`, indexed `(pet_id, created_at DESC,
id DESC)` pagination, page size 30, and server-bound send/delete/read RPCs.
- Enforce role checks, no direct message writes, no message edit, authenticated
  EXECUTE grants and fixed search paths for privileged RPCs.
- Resolve send retry ambiguity with server-enforced idempotency if retries are
  offered. A failed HTTP response does not prove that the transaction failed.
- Keep unread server-timestamp semantics explicit and test concurrent send/read
  races; never silently mark unfetched messages as visibly read.
- Reconcile all retained pages after reconnect/deletes, not merely merge the
  newest 30 into stale history. Keep cursor ordering deterministic for identical
  timestamps and prevent late responses from restoring inaccessible cache.
- Prepare full SQL diff, RLS and SECURITY DEFINER annotations, FK cascade review,
  rollback strategy and isolated three-user integration tests before production
  migration.
- Validate translations, keyboard behavior, maximum Dynamic Type and identity
  fallback against the existing prototype.

## Test status

No new Chat migration, RLS test fixture, Realtime service or UI integration was
executed during this architecture gate. Three-user security, removed-member
Realtime, account/pet cascade and Chat performance acceptance remain unverified.
Existing-project checks, if run, are baseline checks only, not Phase 10A evidence.

No production migration, EAS build, TestFlight upload, commit or push was performed.

## Baseline verification results

- PASS: `npm run typecheck`, `npm run lint`, `npm run format:check`.
- PASS: `verify:i18n`, `verify:phase5-dates`, `verify:phase6-dates`,
  `verify:phase7-recurrence`, `verify:phase8-production`, `verify:phase9-local`,
  and `node scripts/verify-chat-prototype.mjs`.
- `npx expo-doctor`: 17/18 checks passed. Dependency compatibility check failed
  for 10 patch versions: expo, expo-constants, expo-dev-client, expo-font,
  expo-image, expo-image-manipulator, expo-image-picker, expo-linking,
  expo-notifications and expo-router. Installed expo is 57.0.17; expected
  range is ~57.0.20. No dependency upgrade was made at this security gate.
- Hosted Phase 7 RLS/account-deletion checks were not run: temporary test-account
  environment variables are absent and the account-deletion fixture is absent.
  Existing test scripts can write to the configured Supabase environment, so
  these are not equivalent to local baseline verification.

These results do not establish Phase 10A readiness.

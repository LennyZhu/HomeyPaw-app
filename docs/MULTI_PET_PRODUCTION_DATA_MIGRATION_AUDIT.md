# R4 — Legacy Multi-Pet Production Data Preflight

**Status: NO-GO pending Production read-only results.** No Production query or
data migration was run in R4. Current App Store Production is HomeyPaw 1.1.1
(Build 5). Run the [read-only SQL pack](sql/multi-pet-production-preflight.sql)
against the **pre-Multi-Pet schema, before Phase A**, then review its UUID-only
results before approving any migration. The pack must not be run as a migration.

## Existing model and conflict

The legacy model is Pet-scoped. `pets` has no Family ID before Phase A.
`pet_members(pet_id, user_id, role)` stores `owner`, `member`, or `viewer`;
its primary key permits one role per user per Pet, but does **not** limit the
number of Pets per user. A partial unique index permits at most one Owner per
Pet, and a deferred trigger protects normal deletes from leaving an existing
Pet ownerless. The preflight still checks zero/multiple Owners, missing
relationships, and missing Auth/Profile rows rather than assuming all
Production data satisfies intended constraints. Membership is physical: there
is no inactive or soft-delete state in this table.

`pet_invites` is Pet-scoped. Its code is stored only as a hash; the legacy join
RPC grants `member` on that **one Pet**. It has `invited_by`, `max_uses`,
`used_count`, `expires_at`, and `revoked_at`, but no invite-role column.
An unrevoked invite has a unique-per-Pet constraint even when expired.
`profiles.id` references `auth.users.id`; missing Profile/Auth joins are
explicit anomalies in the preflight. Foreign keys make orphan rows unlikely
under normal operation, but they remain part of the audit.

The target is Account → **0 or 1 Family**, Family → exactly 1 Owner plus
Members/Viewers and 0..N Pets, and Pet → exactly 1 Family. Phase A currently
creates one transitional Family per legacy Pet (reusing the Pet UUID), mirrors
that Pet's memberships/invites, and points the Pet to it. C4I later rejects any
`family_members.user_id` with more than one Family before creating its
`UNIQUE(user_id)` index. A user in two legacy Pets therefore creates two
Family memberships after Phase A and C4I fails closed. Even if the index were
bypassed, blindly merging those Families would give the union of all Family
members access to every Pet, potentially expanding access.

## Classification contract

Treat legacy users and Pets as a bipartite graph. An edge is a `pet_members`
row; a connected component includes every Pet reachable through shared users.
Every Pet, including an empty one, seeds traversal. The smallest Pet UUID is
the deterministic component ID. Each Pet's signature is the sorted sequence
of `user_id:role` pairs. Compare **all** signatures in a component, not just
Owner IDs. The SQL returns component UUID, Pet UUID array, user count, Owner
UUID array, signature count, role mismatch, invite counts, and access deltas.

Classification precedence is conservative:

| Class                         | Required condition                                                                                         | Action                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `INVALID_LEGACY_DATA`         | Zero/multiple Owners, empty membership, or missing Auth/Profile row; global orphan checks apply separately | Investigate and repair through a separately reviewed plan       |
| `SAFE_SINGLE_PET`             | Valid one-Pet component                                                                                    | Existing Phase A shape can preserve its access                  |
| `UNSAFE_OWNER_MISMATCH`       | Valid multi-Pet component with different Owners                                                            | Product/data decision                                           |
| `UNSAFE_ROLE_MISMATCH`        | Same user has different roles across Pets                                                                  | Product/data decision, even if Pet access pairs happen to match |
| `UNSAFE_DIFFERENT_MEMBERSHIP` | Same Owner but different full user/role signatures                                                         | Product/data decision                                           |
| `UNSAFE_ACCESS_DELTA`         | Candidate merge changes any user↔Pet access pair                                                           | Stop; recheck classification/algorithm                          |
| `SAFE_IDENTICAL_MULTI_PET`    | Same exact user/role signature and Owner on every Pet, with zero gained/lost access pairs                  | Candidate for a separately designed, verified consolidation     |

For a proposed merged Family with members `M` and Pets `P`, the post-merge
access set is `M × P`. The preflight computes existing `(user_id, pet_id)`
pairs and returns `gained_user_pet_pairs` and `lost_user_pet_pairs` using
both directions of `EXCEPT`. **Both must be zero** for a safe candidate.
Identical signatures imply equality for every user, including Members and
Viewers; Owner equality alone does not. Invite rights and role equality are
additional conditions beyond Pet access-pair equality.

Example outcomes: a sole Owner of Pet A has a straightforward one-Pet
component. An Owner of A+B with identical signatures can be a consolidation
candidate. If A and B have different Members, merging grants each Member a
new Pet; this is unsafe. A Member of A+B with different Owners connects both
Pets into one component, but a single Family would either expand other users'
access or require a product decision about lost access.

## Production preflight command pack

Run **only** [`docs/sql/multi-pet-production-preflight.sql`](sql/multi-pet-production-preflight.sql)
with an operator-controlled, read-only database role or in Supabase SQL Editor
before Phase A. The file starts `BEGIN TRANSACTION READ ONLY` and ends
`ROLLBACK`. It contains SELECT statements only and returns no emails, names,
avatars, tokens, or invite hashes. The SQL Editor may show only the last
result set; if so, execute its numbered SELECT blocks individually inside
read-only transactions, or use a read-only `psql -f` session that displays
every result. Do not run the file against a post-Phase-A schema as a substitute
for the actual legacy snapshot, and do not paste user-identifying data into
issues or chat. UUIDs and counts are sufficient for this decision.

1. **Scale and integrity:** Auth users, Pets, memberships; users with 0/1/2/3/4+
   Pets; Pets with 0/1/2/3/4+ members and the 2+ shared-Pet total;
   zero/multiple Owners; orphan/missing relationships; pending and unrevoked
   invites; inviters who are no longer current Pet Owners.
2. **Anomaly IDs:** Pet and user UUIDs for required-zero integrity cases.
3. **Multi-Pet users:** `user_id`, `COUNT(DISTINCT pet_id)`, Pet UUID array,
   without personal identifiers.
4. **Pet signatures:** sorted full user/role membership set.
5. **Connected components:** classification, IDs, user/Pet/Owner counts,
   signature equality, invite counts, gained/lost access pairs, and the
   count of components in each class.
6. **Invite topology:** invite/Pet/inviter UUIDs, inviter's current Pet role,
   usage/expiry/revocation state; no code/hash.

Required-zero before a standard rollout: `pets_0_owners`,
`pets_multiple_owners`, `orphan_pet_members`, `missing_auth_member`,
`missing_profile_member`, `orphan_pet_invites`, and
`missing_auth_inviter`. Investigate any anomaly rows even if a count is
unexpectedly zero. Every component must have zero access deltas. The
`users_2plus_pets` count and non-single-Pet component classifications are
**decision signals**, not numbers to force to zero by deleting memberships.
`pending_pet_invites` and `unrevoked_pet_invites` are decision signals too.
Review `invite_inviter_not_current_owner` and its invite rows before deciding
whether old codes may remain valid; a former Owner's invite must not silently
become a broader Family invite.
Return the metric table, component rows, anomaly rows, and invite counts for
review; do not return emails or names. If the graph query is too slow, stop
and plan a bounded read-only audit with an operator rather than weakening the
classification.

## Invite and migration strategy

A Pet invite cannot silently gain Family-wide scope. Phase A currently copies
legacy invites to corresponding one-Pet Families. Consolidating several such
Families may also collide with the Family's one-unrevoked-invite index,
including expired but unrevoked codes. During an approved migration window,
the safest candidate policy is to **invalidate/revoke pending legacy
invitations through a separately reviewed migration**, then have the new
client create a canonical Family invite. This is a recommendation, not an R4
operation. Product/support owners must decide the user communication and
whether unused codes can be invalidated. The R4 SQL exposes usage, expiry and
revocation without revealing hashes.

Do not automatically pick one Family, union/intersect member lists, randomly
choose an Owner, delete memberships, select a recent/current Pet, or silently
normalize legacy data. None preserves both access and ownership semantics.
Do not relax C4I's one-Family-per-account invariant.

Decision tree:

1. **No multi-Pet users, required-zero checks clean:** Existing
   Phase A → subsequent migrations → C4I is a plausible path, subject to the
   full release gate, invite review, and local regression. Production data has
   not yet established that this case applies.
2. **Only valid identical-signature multi-Pet components:** Design and review a
   deterministic pre-C4I consolidation, including invite handling, family
   ID selection, Owner invariants, and access-set proof. Because Phase A has
   not been deployed to Production, revising its unshipped backfill to group
   verified identical components is an option; it would require revalidating
   every downstream migration and verifier. An additional forward migration
   after A is another option, but must safely move Pets/invites and remove
   redundant Families before C4I. Pre-Phase-A normalization mutates legacy
   data and has no default approval. **R4 chooses none of these yet.**
3. **Any different membership, role/Owner mismatch, invalid row, or access
   delta:** Production rollout remains **NO-GO**. Resolve through explicit
   product/data decisions and a separately reviewed plan; no automatic merge.

The final decision needs real Production counts and topology, plus an invite
policy. R4's local fixtures prove classification determinism and the access
pair check, but do not establish what Production contains. No R5
consolidation migration, Production repair, forced-upgrade activation, worker
activation, or deployment is part of R4.

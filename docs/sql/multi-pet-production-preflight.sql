-- R4 legacy-data audit. Run only against the PRE-MULTI-PET Production schema,
-- before Phase A. Use a privileged read-only connection or SQL Editor.
-- No names, emails, invite hashes, or device data are returned.
begin transaction read only;

-- 1. Scale, distributions, and integrity. Counts are informational except
-- anomaly rows, which must be zero before migration.
with member_counts as (
  select p.id, count(m.user_id) as members,
         count(m.user_id) filter (where m.role = 'owner') as owners
  from public.pets p left join public.pet_members m on m.pet_id = p.id
  group by p.id
), user_pet_counts as (
  select user_id, count(distinct pet_id) as pets
  from public.pet_members group by user_id
)
select metric, total from (
  select 'auth_users' metric, count(*)::bigint total from auth.users
  union all select 'pets', count(*) from public.pets
  union all select 'pet_members', count(*) from public.pet_members
  union all select 'users_0_pets', count(*) from auth.users u
    where not exists (select 1 from public.pet_members m where m.user_id = u.id)
  union all select 'users_1_pet', count(*) from user_pet_counts where pets = 1
  union all select 'users_2_pets', count(*) from user_pet_counts where pets = 2
  union all select 'users_3_pets', count(*) from user_pet_counts where pets = 3
  union all select 'users_4plus_pets', count(*) from user_pet_counts where pets >= 4
  union all select 'users_2plus_pets', count(*) from user_pet_counts where pets >= 2
  union all select 'pets_0_members', count(*) from member_counts where members = 0
  union all select 'pets_1_member', count(*) from member_counts where members = 1
  union all select 'pets_2_members', count(*) from member_counts where members = 2
  union all select 'pets_2plus_members', count(*) from member_counts where members >= 2
  union all select 'pets_3_members', count(*) from member_counts where members = 3
  union all select 'pets_4plus_members', count(*) from member_counts where members >= 4
  union all select 'pets_0_owners', count(*) from member_counts where owners = 0
  union all select 'pets_multiple_owners', count(*) from member_counts where owners > 1
  union all select 'orphan_pet_members', count(*) from public.pet_members m
    left join public.pets p on p.id = m.pet_id where p.id is null
  union all select 'missing_auth_member', count(*) from public.pet_members m
    left join auth.users u on u.id = m.user_id where u.id is null
  union all select 'missing_profile_member', count(*) from public.pet_members m
    left join public.profiles pr on pr.id = m.user_id where pr.id is null
  union all select 'orphan_pet_invites', count(*) from public.pet_invites i
    left join public.pets p on p.id = i.pet_id where p.id is null
  union all select 'missing_auth_inviter', count(*) from public.pet_invites i
    left join auth.users u on u.id = i.invited_by where u.id is null
  union all select 'invite_inviter_not_current_owner', count(*) from public.pet_invites i
    left join public.pet_members m on m.pet_id = i.pet_id
      and m.user_id = i.invited_by and m.role = 'owner'
    where m.user_id is null
  union all select 'pending_pet_invites', count(*) from public.pet_invites i
    where i.revoked_at is null and i.expires_at > now() and i.used_count < i.max_uses
  union all select 'unrevoked_pet_invites', count(*) from public.pet_invites i
    where i.revoked_at is null
) s order by metric;

-- 2. IDs behind required-zero integrity metrics. UUIDs only.
with owner_counts as (
  select p.id as pet_id, count(m.user_id) filter (where m.role = 'owner') as owners
  from public.pets p left join public.pet_members m on m.pet_id = p.id
  group by p.id
)
select anomaly, pet_id, user_id from (
  select 'ZERO_OWNER'::text anomaly, pet_id, null::uuid user_id
  from owner_counts where owners = 0
  union all select 'MULTIPLE_OWNERS', pet_id, null::uuid
  from owner_counts where owners > 1
  union all select 'ORPHAN_PET_MEMBER', m.pet_id, m.user_id
  from public.pet_members m left join public.pets p on p.id = m.pet_id
  where p.id is null
  union all select 'MISSING_AUTH_MEMBER', m.pet_id, m.user_id
  from public.pet_members m left join auth.users u on u.id = m.user_id
  where u.id is null
  union all select 'MISSING_PROFILE_MEMBER', m.pet_id, m.user_id
  from public.pet_members m left join public.profiles pr on pr.id = m.user_id
  where pr.id is null
) anomalies order by anomaly, pet_id, user_id;

-- 3. Multi-Pet accounts. UUIDs only.
select user_id, count(distinct pet_id) as pet_count,
       array_agg(distinct pet_id order by pet_id) as pet_ids
from public.pet_members
group by user_id having count(distinct pet_id) > 1
order by pet_count desc, user_id;

-- 4. Deterministic per-Pet membership signature (role is significant).
select p.id as pet_id,
       coalesce(string_agg(m.user_id::text || ':' || m.role::text, ','
                           order by m.user_id, m.role::text), '') as membership_signature,
       count(m.user_id) as member_count,
       count(m.user_id) filter (where m.role = 'owner') as owner_count
from public.pets p left join public.pet_members m on m.pet_id = p.id
group by p.id order by p.id;

-- 5. Bipartite connected components. Each existing Pet is a seed, including
-- zero-member Pets. UNION deduplicates traversal cycles. The smallest Pet UUID
-- is the stable component ID. A component is a merge CANDIDATE only when the
-- exact user/role signature (including the Owner) is identical for every Pet.
with recursive
edges as (
  select m.pet_id, m.user_id, m.role
  from public.pet_members m join public.pets p on p.id = m.pet_id
),
walk(seed_pet_id, pet_id) as (
  select id, id from public.pets
  union
  select w.seed_pet_id, next_edge.pet_id
  from walk w
  join edges current_edge on current_edge.pet_id = w.pet_id
  join edges next_edge on next_edge.user_id = current_edge.user_id
),
component_pets as (
  select pet_id, min(seed_pet_id::text)::uuid as component_id
  from walk group by pet_id
),
pet_facts as (
  select cp.component_id, cp.pet_id,
         coalesce(string_agg(e.user_id::text || ':' || e.role::text, ','
                             order by e.user_id, e.role::text), '') as signature,
         count(e.user_id) filter (where e.role = 'owner') as owner_count,
         min(e.user_id::text) filter (where e.role = 'owner')::uuid as owner_id,
         count(e.user_id) as member_count,
         count(e.user_id) filter (where u.id is null or pr.id is null) as missing_user_or_profile
  from component_pets cp
  left join edges e on e.pet_id = cp.pet_id
  left join auth.users u on u.id = e.user_id
  left join public.profiles pr on pr.id = e.user_id
  group by cp.component_id, cp.pet_id
),
role_conflicts as (
  select cp.component_id, e.user_id
  from component_pets cp join edges e on e.pet_id = cp.pet_id
  group by cp.component_id, e.user_id
  having count(distinct e.role) > 1
),
component_facts as (
  select component_id, count(*) as pet_count,
         count(distinct signature) as signature_count,
         count(distinct owner_id) as distinct_owner_count,
         bool_or(owner_count <> 1 or member_count = 0 or missing_user_or_profile > 0) as invalid_pet,
         array_agg(pet_id order by pet_id) as pet_ids,
         array_agg(distinct owner_id order by owner_id)
           filter (where owner_id is not null) as owner_ids
  from pet_facts group by component_id
),
component_users as (
  select distinct cp.component_id, e.user_id
  from component_pets cp join edges e on e.pet_id = cp.pet_id
),
before_access as (
  select cp.component_id, e.user_id, e.pet_id
  from component_pets cp join edges e on e.pet_id = cp.pet_id
),
after_access as (
  select cu.component_id, cu.user_id, cp.pet_id
  from component_users cu
  join component_pets cp on cp.component_id = cu.component_id
),
gained as (select * from after_access except select * from before_access),
lost as (select * from before_access except select * from after_access),
access_delta as (
  select component_id, count(*) as gained_pairs, 0::bigint as lost_pairs
  from gained group by component_id
  union all
  select component_id, 0::bigint, count(*) from lost group by component_id
),
access_totals as (
  select component_id, sum(gained_pairs) as gained_pairs, sum(lost_pairs) as lost_pairs
  from access_delta group by component_id
),
invite_counts as (
  select cp.component_id, count(*) filter (
    where i.revoked_at is null and i.expires_at > now() and i.used_count < i.max_uses
  ) as pending_invites,
  count(*) filter (where i.revoked_at is null) as unrevoked_invites
  from component_pets cp left join public.pet_invites i on i.pet_id = cp.pet_id
  group by cp.component_id
),
classified as (
select cf.component_id, cf.pet_ids, cf.pet_count,
       (select count(*) from component_users cu where cu.component_id = cf.component_id) as user_count,
       cf.owner_ids, cf.distinct_owner_count, cf.signature_count,
       exists(select 1 from role_conflicts rc where rc.component_id = cf.component_id) as role_mismatch,
       cf.invalid_pet, ic.pending_invites, ic.unrevoked_invites,
       coalesce(at.gained_pairs, 0) as gained_user_pet_pairs,
       coalesce(at.lost_pairs, 0) as lost_user_pet_pairs,
       case
         when cf.invalid_pet then 'INVALID_LEGACY_DATA'
         when cf.pet_count = 1 then 'SAFE_SINGLE_PET'
         when cf.distinct_owner_count <> 1 then 'UNSAFE_OWNER_MISMATCH'
         when exists(select 1 from role_conflicts rc where rc.component_id = cf.component_id)
           then 'UNSAFE_ROLE_MISMATCH'
         when cf.signature_count <> 1 then 'UNSAFE_DIFFERENT_MEMBERSHIP'
         when coalesce(at.gained_pairs, 0) <> 0 or coalesce(at.lost_pairs, 0) <> 0
           then 'UNSAFE_ACCESS_DELTA'
         else 'SAFE_IDENTICAL_MULTI_PET'
       end as classification
from component_facts cf
join invite_counts ic using (component_id)
left join access_totals at using (component_id)
)
select classified.*,
       count(*) over (partition by classification) as classification_component_count
from classified order by component_id;

-- 6. Invite topology, identifiers and counters only. Pending invites are not
-- automatically merged: a per-Pet token cannot silently become Family-wide.
select i.id as invite_id, i.pet_id, i.invited_by,
       m.role as inviter_current_role, i.max_uses, i.used_count,
       i.expires_at, i.revoked_at,
       (i.revoked_at is null and i.expires_at > now() and i.used_count < i.max_uses) as pending
from public.pet_invites i
left join public.pet_members m on m.pet_id = i.pet_id and m.user_id = i.invited_by
order by i.pet_id, i.id;

rollback;

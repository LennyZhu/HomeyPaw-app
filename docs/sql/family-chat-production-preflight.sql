-- READ ONLY. Pre-migration schema only. Do not run without separate authorization.
-- No message bodies, sender identifiers, credentials or configuration mutations.
select
  (select count(*) from public.chat_messages) as chat_messages,
  (select count(*) from public.chat_read_states) as pet_read_states,
  (select count(distinct p.family_id) from public.chat_messages m
     join public.pets p on p.id=m.pet_id) as families_with_chat,
  (select count(*) from public.families) as expected_family_channel_rows;

select count(*) as multi_pet_families_with_chat
from (
  select p.family_id from public.pets p
  group by p.family_id having count(*)>1
) f where exists (select 1 from public.chat_messages m
  join public.pets p on p.id=m.pet_id where p.family_id=f.family_id);

select count(*) filter(where p.id is null) as orphan_message_pet,
  count(*) filter(where p.family_id is null) as unmappable_message_family,
  count(*) filter(where p.family_id is not null and f.id is null) as orphan_family
from public.chat_messages m
left join public.pets p on p.id=m.pet_id
left join public.families f on f.id=p.family_id;

select count(*) filter(where p.id is null) as orphan_read_state_pet,
  count(*) filter(where u.id is null) as orphan_read_state_user
from public.chat_read_states rs
left join public.pets p on p.id=rs.pet_id
left join auth.users u on u.id=rs.user_id;

select p.family_id, p.id as pet_id, count(*) as historical_messages
from public.chat_messages m join public.pets p on p.id=m.pet_id
 group by p.family_id,p.id order by p.family_id,p.id;

-- Mirrors the conservative migration merge. Missing state contributes epoch.
with rooms as (
  select distinct p.family_id,p.id as pet_id
  from public.chat_messages m join public.pets p on p.id=m.pet_id
), cursors as (
  select fm.family_id,fm.user_id,r.pet_id,rs.pet_id is null as missing,
    coalesce(rs.last_read_at,to_timestamp(0)) as cursor_at,
    coalesce(rs.last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid) as cursor_id
  from public.family_members fm join rooms r on r.family_id=fm.family_id
  left join public.chat_read_states rs on rs.pet_id=r.pet_id and rs.user_id=fm.user_id
  where fm.role in ('owner','member')
), merged as (
  select distinct on (family_id,user_id) family_id,user_id,cursor_at,cursor_id
  from cursors order by family_id,user_id,cursor_at,cursor_id
), risks as (
  select family_id,user_id,count(*) as rooms,count(*) filter(where missing) as missing_rooms,
    count(distinct (cursor_at,cursor_id)) as different_cursors
  from cursors group by family_id,user_id
)
select (select count(*) from public.chat_messages) as expected_backfill_rows,
  (select count(*) from merged) as expected_family_read_state_rows,
  count(*) filter(where rooms>1) as multi_room_member_states,
  count(*) filter(where missing_rooms>0) as members_with_missing_cursors,
  count(*) filter(where different_cursors>1) as members_with_differing_cursors,
  (select count(*) from merged where cursor_at=to_timestamp(0)) as conservative_epoch_states,
  (select count(*) from public.chat_messages m
    join merged f on f.family_id=(select p.family_id from public.pets p where p.id=m.pet_id)
    join cursors c on c.family_id=f.family_id and c.user_id=f.user_id and c.pet_id=m.pet_id
    where m.sender_id is distinct from f.user_id
      and (m.created_at,m.id)>(f.cursor_at,f.cursor_id)
      and (m.created_at,m.id)<=(c.cursor_at,c.cursor_id)) as estimated_false_unread_messages
from risks;

-- Earlier CASCADE-deleted messages leave no rows here. Their number and recovery
-- feasibility require independently authorized backup/audit comparison: UNKNOWN.

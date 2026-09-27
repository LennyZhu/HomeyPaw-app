select pg_temp.chat_assert(not exists(select 1 from public.chat_messages m join public.pets p on p.id=m.pet_id
  where m.family_id is distinct from p.family_id), 'backfill has no cross-Family mappings');
select pg_temp.chat_assert(not exists(select * from chat_test_before except
  select id,sender_id,body,created_at,updated_at,pet_id from public.chat_messages), 'history identity/content/timestamps unchanged');
select pg_temp.chat_assert((select (last_read_at,last_read_message_id)=('2026-09-01 10:02Z'::timestamptz,pg_temp.chat_id('message_c'))
  from public.family_chat_read_states where family_id=pg_temp.chat_id('family_a') and user_id=pg_temp.chat_id('member')),
  'conservative merge uses minimum tuple');
select pg_temp.chat_assert((select last_read_at=to_timestamp(0) from public.family_chat_read_states
  where family_id=pg_temp.chat_id('family_a') and user_id=pg_temp.chat_id('owner')), 'missing Pet cursor stays unread');
-- Every message previously unread must remain unread after the conservative merge.
select pg_temp.chat_assert(not exists(select 1 from public.chat_messages m
  join public.family_members fm on fm.family_id=m.family_id
  left join public.chat_read_states pr on pr.pet_id=m.pet_id and pr.user_id=fm.user_id
  join public.family_chat_read_states fr on fr.family_id=m.family_id and fr.user_id=fm.user_id
  where m.family_id=pg_temp.chat_id('family_a') and m.sender_id is distinct from fm.user_id
    and (m.created_at,m.id)>(coalesce(pr.last_read_at,to_timestamp(0)),coalesce(pr.last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid))
    and (m.created_at,m.id)<=(fr.last_read_at,fr.last_read_message_id)), 'no false-read');

select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select pg_temp.chat_assert((select string_agg(body,'' order by created_at,id)='ACBD'
  from public.get_family_chat_messages_page(pg_temp.chat_id('family_a'))), 'merged stable Family history');
select pg_temp.chat_assert((select count(*)=4 from public.chat_messages where family_id=pg_temp.chat_id('family_a')), 'RLS own Family');
select pg_temp.chat_assert((select count(*)=0 from public.chat_messages where family_id=pg_temp.chat_id('family_b')), 'RLS foreign Family denied');
select pg_temp.chat_assert((select count(*)=2 from public.get_chat_messages_page(pg_temp.chat_id('pet_a'))), 'legacy Pet fetch unchanged');
select pg_temp.chat_assert(public.get_family_chat_unread_count(pg_temp.chat_id('family_a'))=2,'Family unread after conservative merge');
select pg_temp.chat_assert(public.get_pet_chat_channel_version(pg_temp.chat_id('pet_a'))>0,'legacy channel version');
select pg_temp.chat_assert(private.can_receive_pet_chat_broadcast('pet:'||pg_temp.chat_id('pet_a')||':chat:v'||
  public.get_pet_chat_channel_version(pg_temp.chat_id('pet_a'))), 'legacy topic authorization');
select pg_temp.chat_assert(private.can_receive_family_chat_broadcast('family:'||pg_temp.chat_id('family_a')||':chat:v'||
  public.get_family_chat_channel_version(pg_temp.chat_id('family_a'))),'new topic authorization');
select pg_temp.chat_assert(not private.can_receive_family_chat_broadcast('family:'||pg_temp.chat_id('family_b')||':chat:v1'),'foreign topic denied');
select pg_temp.chat_assert((public.send_chat_message(pg_temp.chat_id('pet_b'),gen_random_uuid(),'legacy write')).family_id=pg_temp.chat_id('family_a'),'legacy sends derive Family');
select pg_temp.chat_assert((public.mark_chat_read(pg_temp.chat_id('pet_a'),pg_temp.chat_id('message_b'))).last_read_message_id=pg_temp.chat_id('message_b'),'legacy read cursor');
select pg_temp.chat_assert(public.get_chat_unread_count(pg_temp.chat_id('pet_a'))=0,'legacy mark/unread');
select pg_temp.chat_assert((public.send_family_chat_message(pg_temp.chat_id('family_a'),gen_random_uuid(),'Family write')).pet_id is null,'new sends have no Pet dependency');
select pg_temp.chat_assert((public.mark_family_chat_read(pg_temp.chat_id('family_a'),pg_temp.chat_id('message_d'))).last_read_message_id=pg_temp.chat_id('message_d'),'Family read cursor');
select pg_temp.chat_assert((public.mark_family_chat_read(pg_temp.chat_id('family_a'),pg_temp.chat_id('message_a'))).last_read_message_id=pg_temp.chat_id('message_d'),'older read cursor ignored');
select pg_temp.chat_assert((select last_read_message_id=pg_temp.chat_id('message_d') from public.family_chat_read_states
  where family_id=pg_temp.chat_id('family_a') and user_id=pg_temp.chat_id('member')), 'read cursor never regresses');
do $$ begin
  begin perform public.update_family_chat_message(pg_temp.chat_id('message_a'),'bad edit'); raise exception 'member edited another sender'; exception when insufficient_privilege then null; end;
  perform pg_temp.chat_assert(not public.delete_family_chat_message(pg_temp.chat_id('message_a')),'Member cannot moderate another sender');
  begin perform public.mark_family_chat_read(pg_temp.chat_id('family_a'),pg_temp.chat_id('message_other')); raise exception 'foreign read cursor accepted'; exception when insufficient_privilege then null; end;
end $$;
-- Stable pagination with a page boundary and a timestamp tie.
select pg_temp.chat_assert((select count(*)=2 from public.get_family_chat_messages_page(pg_temp.chat_id('family_a'),
  '2026-09-01 10:05Z',pg_temp.chat_id('message_b'),30)), 'Family cursor excludes boundary without duplicates');
reset role;

insert into chat_test_ids(label,id) select 'legacy_owned', id from public.chat_messages where pet_id=pg_temp.chat_id('pet_b') and sender_id=pg_temp.chat_id('member') and body='legacy write';
-- Old RPCs and old Pet Broadcast still work after adding Family ownership.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
set local role authenticated;
do $$ declare m public.chat_messages; begin
  m:=public.send_chat_message(pg_temp.chat_id('pet_b'),gen_random_uuid(),'legacy compatibility');
  perform pg_temp.chat_assert((public.update_chat_message(m.id,'legacy edited')).body='legacy edited','legacy edit');
  perform pg_temp.chat_assert((select count(*)>0 from public.get_pet_chat_members(pg_temp.chat_id('pet_b'))),'legacy members');
  perform pg_temp.chat_assert(public.delete_chat_message(m.id),'legacy delete');
  perform pg_temp.chat_assert((select count(*)=3 from realtime.messages where payload->>'message_id'=m.id::text and topic='pet:'||m.pet_id||':chat:v'||public.get_pet_chat_channel_version(m.pet_id) and event in ('message_created','message_updated','message_deleted')),'legacy create/edit/delete Pet events');
  perform pg_temp.chat_assert((select count(*)=3 from realtime.messages where payload->>'message_id'=m.id::text and topic='family:'||m.family_id||':chat:v'||public.get_family_chat_channel_version(m.family_id) and event in ('message_created','message_updated','message_deleted')),'same legacy row create/edit/delete Family events');
end $$;
reset role;
select pg_temp.chat_assert(exists(select 1 from realtime.messages where
  topic='pet:'||pg_temp.chat_id('pet_b')||':chat:v'||(select channel_version from private.pet_chat_states where pet_id=pg_temp.chat_id('pet_b'))
  and event='message_created'), 'legacy private Broadcast emission');
select pg_temp.chat_assert(exists(select 1 from realtime.messages where
  topic='family:'||pg_temp.chat_id('family_a')||':chat:v1' and event='message_created'), 'Family private Broadcast emission');
select pg_temp.chat_assert(not exists(select 1 from realtime.messages where topic='family:'||pg_temp.chat_id('family_a')||':chat:v1'
  and (payload ? 'body' or payload ? 'sender_id')), 'Family Broadcast carries hints only');
-- Review A/D/E: legacy Pet A write retains both identities, emits one hint
-- on each CURRENT topic, and retries never create another row or event.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
set local role authenticated;
do $$ declare m public.chat_messages; retry public.chat_messages; key uuid:=gen_random_uuid(); v bigint; begin
  v:=public.get_pet_chat_channel_version(pg_temp.chat_id('pet_a'));
  m:=public.send_chat_message(pg_temp.chat_id('pet_a'),key,'review legacy realtime');
  retry:=public.send_chat_message(pg_temp.chat_id('pet_a'),key,'review legacy realtime');
  perform pg_temp.chat_assert(m.family_id=pg_temp.chat_id('family_a') and m.pet_id=pg_temp.chat_id('pet_a'),'A: legacy identities');
  perform pg_temp.chat_assert(m.id=retry.id and (select count(*)=1 from public.chat_messages where sender_id=m.sender_id and client_message_id=key),'D: one legacy row after retry, no fan-out');
  perform pg_temp.chat_assert(exists(select 1 from public.get_chat_messages_page(pg_temp.chat_id('pet_a')) where id=m.id),'A: legacy fetch includes send');
  perform pg_temp.chat_assert(public.get_pet_chat_channel_version(pg_temp.chat_id('pet_a'))=v,'A: send does not rotate Pet version');
  perform pg_temp.chat_assert((select count(*)=1 from realtime.messages where topic='pet:'||m.pet_id||':chat:v'||v and event='message_created' and payload->>'message_id'=m.id::text),'A: exactly one current Pet event');
  perform pg_temp.chat_assert((select count(*)=1 from realtime.messages where topic='family:'||m.family_id||':chat:v'||public.get_family_chat_channel_version(m.family_id) and event='message_created' and payload->>'message_id'=m.id::text),'E: exactly one Family event for the same row');
end $$;
reset role;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('owner')::text,true);
set local role authenticated;
do $$ declare m public.chat_messages; begin
  select * into strict m from public.get_chat_messages_page(pg_temp.chat_id('pet_a')) where body='review legacy realtime';
  perform pg_temp.chat_assert(public.get_chat_unread_count(m.pet_id)=1,'A: legacy receiving Owner unread');
  perform pg_temp.chat_assert((public.mark_chat_read(m.pet_id,m.id)).last_read_message_id=m.id,'A: legacy read advances');
  perform pg_temp.chat_assert(public.get_chat_unread_count(m.pet_id)=0,'A: legacy read clears unread');
end $$;
reset role;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
set local role authenticated;
select pg_temp.chat_assert(public.delete_chat_message((select id from public.get_chat_messages_page(pg_temp.chat_id('pet_a')) where body='review legacy realtime')),'A: remove review fixture through legacy RPC');
reset role;
-- Review C/D: Family send never chooses a Pet, even when the Family has Pets.
select pg_temp.chat_assert((select family_id=pg_temp.chat_id('family_a') and pet_id is null from public.chat_messages where body='Family write'),'C: Family message has NULL Pet');
select pg_temp.chat_assert((select count(*)=1 from public.chat_messages where body='Family write'),'D: one canonical Family row');
select pg_temp.chat_assert((select count(*)=1 from realtime.messages r join public.chat_messages m on r.payload->>'message_id'=m.id::text where m.body='Family write' and r.event='message_created' and r.topic='family:'||m.family_id||':chat:v1'),'C: Family send event');
select pg_temp.chat_assert(not exists(select 1 from realtime.messages r join public.chat_messages m on r.payload->>'message_id'=m.id::text where m.body='Family write' and r.topic like 'pet:%'),'C: Family send has no Pet fan-out');
-- Capture the actual active Pet B version; v1 could already be expired.
create temporary table chat_test_legacy_topic as select 'pet:'||pet_id||':chat:v'||channel_version topic from private.pet_chat_states where pet_id=pg_temp.chat_id('pet_b');
grant select on chat_test_legacy_topic to authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('owner')::text,true);
set local role authenticated;
select pg_temp.chat_assert(private.can_receive_pet_chat_broadcast((select topic from chat_test_legacy_topic)),'B: Owner allowed current Pet topic');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
set local role authenticated;
select pg_temp.chat_assert(private.can_receive_pet_chat_broadcast((select topic from chat_test_legacy_topic)),'B: Member allowed current Pet topic');
select pg_temp.chat_assert(exists(select 1 from public.get_family_chat_messages_page(pg_temp.chat_id('family_a')) where body='Family write' and pet_id is null),'C: Family fetch includes NULL-Pet send');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('deleted_sender')::text,true);
set local role authenticated;
select pg_temp.chat_assert(not private.can_receive_pet_chat_broadcast((select topic from chat_test_legacy_topic)),'B: historical sender without canonical membership denied current Pet topic');
reset role;
-- Delete a compatibility mirror while retaining canonical membership.
create temporary table chat_test_pet_version as select channel_version from private.pet_chat_states where pet_id=pg_temp.chat_id('pet_a');
grant select on chat_test_pet_version to authenticated;
delete from public.pet_members where user_id=pg_temp.chat_id('member') and pet_id=pg_temp.chat_id('pet_a');
select pg_temp.chat_assert((select channel_version=(select channel_version+1 from chat_test_pet_version) from private.pet_chat_states where pet_id=pg_temp.chat_id('pet_a')),'legacy mirror changes retain original Pet version rotation');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
set local role authenticated;
select pg_temp.chat_assert((select count(*)=6 from public.get_family_chat_messages_page(pg_temp.chat_id('family_a'))),'new query ignores legacy mirror drift');
select pg_temp.chat_assert(private.can_receive_pet_chat_broadcast('pet:'||pg_temp.chat_id('pet_a')||':chat:v'||public.get_pet_chat_channel_version(pg_temp.chat_id('pet_a'))),'canonical Member retains current Pet access despite mirror drift');
select pg_temp.chat_assert(not private.can_receive_pet_chat_broadcast('pet:'||pg_temp.chat_id('pet_a')||':chat:v'||(select channel_version from chat_test_pet_version)),'expired Pet version denied after legacy rotation');
select pg_temp.chat_assert((select count(*)=2 from public.get_family_chat_members(pg_temp.chat_id('family_a'))),'members use canonical membership and exclude Viewer');
do $$ begin
  begin insert into public.chat_messages(family_id,sender_id,client_message_id,body)
    values(pg_temp.chat_id('family_a'),pg_temp.chat_id('member'),gen_random_uuid(),'direct');
    raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Viewer must remain excluded from page/send/version and both room policies.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('viewer')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.get_family_chat_messages_page(pg_temp.chat_id('family_a')); raise exception 'viewer page permitted'; exception when insufficient_privilege then null; end;
  begin perform public.send_family_chat_message(pg_temp.chat_id('family_a'),gen_random_uuid(),'bad'); raise exception 'viewer send permitted'; exception when insufficient_privilege then null; end;
  begin perform public.get_family_chat_channel_version(pg_temp.chat_id('family_a')); raise exception 'viewer channel permitted'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.chat_assert((select count(*)=0 from public.chat_messages),'Viewer RLS denied');
select pg_temp.chat_assert(not private.can_receive_family_chat_broadcast('family:'||pg_temp.chat_id('family_a')||':chat:v1'),'Viewer realtime denied');
select pg_temp.chat_assert(not private.can_receive_pet_chat_broadcast((select topic from chat_test_legacy_topic)),'B: Viewer denied current Pet topic');
do $$ begin
  begin perform public.get_pet_chat_channel_version(pg_temp.chat_id('pet_b')); raise exception 'Viewer legacy version permitted'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',pg_temp.chat_id('stranger')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.get_family_chat_messages_page(pg_temp.chat_id('family_a')); raise exception 'foreign page permitted'; exception when insufficient_privilege then null; end;
  begin perform public.send_family_chat_message(pg_temp.chat_id('family_a'),gen_random_uuid(),'bad'); raise exception 'foreign send permitted'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Zero-Pet Family can send/read/edit/moderate and use Realtime.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('zero_owner')::text,true);
set local role authenticated;
do $$ declare m public.chat_messages; retry public.chat_messages; other public.chat_messages; first_page public.chat_messages; next_page public.chat_messages; key uuid:=gen_random_uuid(); begin
  m:=public.send_family_chat_message(pg_temp.chat_id('family_zero'),key,'zero pets');
  retry:=public.send_family_chat_message(pg_temp.chat_id('family_zero'),key,'zero pets');
  perform pg_temp.chat_assert(m.id=retry.id,'idempotent Family send');
  perform pg_temp.chat_assert(m.pet_id is null and m.family_id=pg_temp.chat_id('family_zero'),'zero-Pet send');
  perform pg_temp.chat_assert((select count(*)=1 from public.get_family_chat_messages_page(pg_temp.chat_id('family_zero'))),'zero-Pet read');
  perform pg_temp.chat_assert((select count(*)=1 from public.chat_messages where client_message_id=key and sender_id=m.sender_id),'D: zero-Pet retry one DB row');
  perform pg_temp.chat_assert((select count(*)=1 from realtime.messages where payload->>'message_id'=m.id::text and event='message_created' and topic='family:'||m.family_id||':chat:v'||public.get_family_chat_channel_version(m.family_id)),'C: zero-Pet Family event once');
  perform pg_temp.chat_assert(not exists(select 1 from realtime.messages where payload->>'message_id'=m.id::text and topic like 'pet:%'),'C: zero-Pet message has no Pet event');
  other:=public.send_family_chat_message(pg_temp.chat_id('family_zero'),gen_random_uuid(),'timestamp tie');
  select * into first_page from public.get_family_chat_messages_page(pg_temp.chat_id('family_zero'),null,null,1);
  select * into next_page from public.get_family_chat_messages_page(pg_temp.chat_id('family_zero'),first_page.created_at,first_page.id,1);
  perform pg_temp.chat_assert(first_page.created_at=next_page.created_at and first_page.id>next_page.id,'timestamp tie paginates by stable UUID');
  perform pg_temp.chat_assert(first_page.id in (m.id,other.id) and next_page.id in (m.id,other.id),'pagination retains both messages without duplicates');
  perform public.delete_family_chat_message(other.id);
  perform public.mark_family_chat_read(pg_temp.chat_id('family_zero'),m.id);
  perform public.update_family_chat_message(m.id,'edited zero');
  perform pg_temp.chat_assert(public.delete_family_chat_message(m.id),'zero-Pet delete');
  perform pg_temp.chat_assert(private.can_receive_family_chat_broadcast('family:'||pg_temp.chat_id('family_zero')||':chat:v'||
    public.get_family_chat_channel_version(pg_temp.chat_id('family_zero'))),'zero-Pet realtime');
end $$;
reset role;

-- Pet deletion retains Family history; deleted sender retention stays intact.
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
delete from public.pets where id=pg_temp.chat_id('pet_a');
select pg_temp.chat_assert((select count(*)=2 from public.chat_messages where id in (pg_temp.chat_id('message_a'),pg_temp.chat_id('message_b')) and pet_id is null),'Pet deletion keeps history');
delete from auth.users where id=pg_temp.chat_id('deleted_sender');
select pg_temp.chat_assert((select sender_id is null from public.chat_messages where id=pg_temp.chat_id('message_d')),'deleted sender retention');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('owner')::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select pg_temp.chat_assert((select count(*)=6 from public.get_family_chat_messages_page(pg_temp.chat_id('family_a'))),'Owner reads retained/merged history');
select pg_temp.chat_assert(public.delete_family_chat_message(pg_temp.chat_id('message_d')),'Owner can moderate former/deleted sender');
reset role;

-- Canonical removal rotates Family version even when compatibility rows exist.
create temporary table chat_test_old_events as select count(*) n from realtime.messages
  where topic='family:'||pg_temp.chat_id('family_a')||':chat:v1';
create temporary table chat_test_version as select channel_version from private.family_chat_states where family_id=pg_temp.chat_id('family_a');
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
delete from public.family_members where family_id=pg_temp.chat_id('family_a') and user_id=pg_temp.chat_id('member');
select pg_temp.chat_assert((select 'pet:'||pet_id||':chat:v'||channel_version=(select topic from chat_test_legacy_topic) from private.pet_chat_states where pet_id=pg_temp.chat_id('pet_b')),'B: denied topic remains current after canonical removal');
select pg_temp.chat_assert(exists(select 1 from public.pet_members where pet_id=pg_temp.chat_id('pet_b') and user_id=pg_temp.chat_id('member')),'B: leftover mirror present during removal denial test');
select pg_temp.chat_assert((select channel_version>(select channel_version from chat_test_version) from private.family_chat_states
  where family_id=pg_temp.chat_id('family_a')),'membership removal rotates Family channel');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ begin
  begin perform public.get_family_chat_messages_page(pg_temp.chat_id('family_a')); raise exception 'removed page permitted'; exception when insufficient_privilege then null; end;
  begin perform public.send_family_chat_message(pg_temp.chat_id('family_a'),gen_random_uuid(),'bad'); raise exception 'removed send permitted'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.chat_assert((select count(*)=0 from public.chat_messages where family_id=pg_temp.chat_id('family_a')),'removed direct query denied');
select pg_temp.chat_assert(not private.can_receive_family_chat_broadcast('family:'||pg_temp.chat_id('family_a')||':chat:v1'),'removed stale realtime denied');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('owner')::text,true);
set local role authenticated;
select pg_temp.chat_assert(not private.can_receive_family_chat_broadcast('family:'||pg_temp.chat_id('family_a')||':chat:v1'),'expired Family version unauthorized after rotation');
reset role;

-- A leftover legacy mirror cannot authorize a removed member's old writes/join.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('member')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.send_chat_message(pg_temp.chat_id('pet_b'),gen_random_uuid(),'stale mirror'); raise exception 'removed legacy send permitted'; exception when insufficient_privilege then null; end;
  begin perform public.update_chat_message(pg_temp.chat_id('legacy_owned'),'stale mirror edit'); raise exception 'removed legacy edit permitted'; exception when insufficient_privilege then null; end;
  begin perform public.get_pet_chat_channel_version(pg_temp.chat_id('pet_b')); raise exception 'removed legacy version permitted'; exception when insufficient_privilege then null; end;
  begin perform public.get_chat_messages_page(pg_temp.chat_id('pet_b')); raise exception 'removed legacy fetch permitted'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.chat_assert(not private.can_receive_pet_chat_broadcast((select topic from chat_test_legacy_topic)),'B: Removed/Former denied current Pet topic despite leftover mirror');
reset role;
-- Family-only message uses the rotated Family topic; expired Family version stays silent.
-- This assertion never requires active legacy Pet topics to be silent.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('owner')::text,true);
set local role authenticated;
select pg_temp.chat_assert((public.send_family_chat_message(pg_temp.chat_id('family_a'),gen_random_uuid(),'after rotation')).family_id=pg_temp.chat_id('family_a'),'Owner send after rotation');
reset role;
select pg_temp.chat_assert((select count(*)=(select n from chat_test_old_events) from realtime.messages
  where topic='family:'||pg_temp.chat_id('family_a')||':chat:v1'),'no emission on expired Family version (not active legacy Pet topic)');
select pg_temp.chat_assert(exists(select 1 from realtime.messages where
  topic='family:'||pg_temp.chat_id('family_a')||':chat:v'||(select channel_version from private.family_chat_states where family_id=pg_temp.chat_id('family_a'))
  and event='message_created'),'new active topic emitted');
select pg_temp.chat_assert(not exists(select * from public.app_release_policy except select * from chat_test_release_before)
  and not exists(select * from chat_test_release_before except select * from public.app_release_policy),'release policy unchanged');
select pg_temp.chat_assert(not exists(select * from private.pre_cutover_release_lock except select * from chat_test_lock_before)
  and not exists(select * from chat_test_lock_before except select * from private.pre_cutover_release_lock),'release lock unchanged');
select pg_temp.chat_assert(not has_function_privilege('anon','public.send_family_chat_message(uuid,uuid,text)','execute'),'anon cannot call new RPC');

-- Family deletion remains a Family lifecycle cascade; no chat survives it.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('zero_owner')::text,true);
set local role authenticated;
select pg_temp.chat_assert((public.send_family_chat_message(pg_temp.chat_id('family_zero'),gen_random_uuid(),'Family lifecycle')).family_id=pg_temp.chat_id('family_zero'),'zero-Pet history before Family deletion');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
delete from public.families where id=pg_temp.chat_id('family_zero');
select pg_temp.chat_assert(not exists(select 1 from public.chat_messages where family_id=pg_temp.chat_id('family_zero')),'Family deletion cascades Chat');
select pg_temp.chat_assert(not exists(select 1 from private.family_chat_states where family_id=pg_temp.chat_id('family_zero')),'Family deletion cascades channel state');

-- Initialize a new zero-Pet Family after migration, not just pre-existing roots.
insert into pg_temp.chat_test_ids(label) values ('later_owner'),('later_family');
insert into auth.users(id,email) values(pg_temp.chat_id('later_owner'),pg_temp.chat_id('later_owner')::text||'@family-chat-test.invalid');
insert into public.families(id) values(pg_temp.chat_id('later_family'));
insert into public.family_members(family_id,user_id,role) values(pg_temp.chat_id('later_family'),pg_temp.chat_id('later_owner'),'owner');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('later_owner')::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select pg_temp.chat_assert(public.get_family_chat_channel_version(pg_temp.chat_id('later_family'))>0,'new Family initializes channel state');
select pg_temp.chat_assert((public.send_family_chat_message(pg_temp.chat_id('later_family'),gen_random_uuid(),'new zero-Pet Family')).pet_id is null,'new Family has no Pet prerequisite');
reset role;

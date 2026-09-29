select public.push_test_assert(not exists(select 1 from private.family_notification_outbox where event_type='chat_message'),'no historical Chat enqueue');
select public.push_test_assert(not exists(select 1 from private.push_devices where chat_push_v1),'existing devices incapable');
select public.push_test_assert(not exists(select 1 from private.family_notification_outbox where family_id is null),'queue Family backfill');
select public.push_test_assert(not has_function_privilege('authenticated','public.validate_family_notification_delivery(uuid)','execute')
 and not has_function_privilege('anon','public.register_push_device(text,text,text,text,boolean)','execute'),'service-only/private grants');

-- Register through real APIs, including multi-device, legacy registration,
-- rebind/downgrade, refresh, logout and null-capability safety.
select set_config('request.jwt.claim.role','authenticated',false);
do $$ declare u record; d uuid; begin
 for u in select label,id from public.push_test_ids where label in
  ('owner','member','member_b','viewer','removed','former','stranger','zero_owner','zero_member') loop
  perform set_config('request.jwt.claim.sub',u.id::text,false);
  perform public.register_push_device('capable-installation-'||u.label,'ExpoPushToken[capable_'||u.label||'00]','ios','next',true);
 end loop;
 perform set_config('request.jwt.claim.sub',public.push_test_id('member')::text,false);
 perform public.register_push_device('capable-installation-member-ipad','ExpoPushToken[capable_member_ipad00]','ios','next',true);
 d:=public.register_push_device('capable-installation-disabled','ExpoPushToken[disabled_member00]','ios','next',true);
 update private.push_devices set enabled=false where id=d;
 d:=public.register_push_device('registration-cycle-install','ExpoPushToken[registrationcycle00]','ios','next',true);
 perform public.push_test_assert((select chat_push_v1 from private.push_devices where id=d),'explicit capability registration');
 perform public.register_push_device('registration-cycle-install','ExpoPushToken[registrationcycle01]','ios','next',true);
 perform public.push_test_assert((select chat_push_v1 and expo_push_token='ExpoPushToken[registrationcycle01]' from private.push_devices where id=d),'token refresh capability');
 perform public.register_push_device('registration-cycle-install','ExpoPushToken[registrationcycle01]','ios','1.2.0');
 perform public.push_test_assert((select not chat_push_v1 from private.push_devices where id=d),'old API clears capability');
 perform set_config('request.jwt.claim.sub',public.push_test_id('stranger')::text,false);
 perform public.register_push_device('registration-cycle-install','ExpoPushToken[registrationcycle02]','ios','1.2.0');
 perform public.push_test_assert((select user_id=public.push_test_id('stranger') and not chat_push_v1 from private.push_devices where id=d),'rebind does not inherit capability');
 perform public.register_push_device('registration-cycle-install','ExpoPushToken[registrationcycle02]','ios','next',true);
 perform public.unregister_push_device('registration-cycle-install');
 perform public.push_test_assert((select not enabled and not chat_push_v1 from private.push_devices where id=d),'logout clears capability');
 perform public.register_push_device('registration-null-install','ExpoPushToken[registrationnull00]','ios','next',null);
 perform public.push_test_assert((select not chat_push_v1 from private.push_devices where installation_id='registration-null-install'),'null capability fail closed');
 perform public.unregister_push_device('registration-null-install');
 -- Sender has two capable devices, neither may receive its own events.
 perform set_config('request.jwt.claim.sub',public.push_test_id('owner')::text,false);
 perform public.register_push_device('capable-installation-owner-ipad','ExpoPushToken[capable_owner_ipad00]','ios','next',true);
end $$;

select set_config('request.jwt.claim.sub',public.push_test_id('zero_member')::text,false);
select public.push_test_assert(public.has_shared_family_for_push(),'zero-Pet shared Family preprompt');
select set_config('request.jwt.claim.sub',public.push_test_id('viewer')::text,false);
select public.push_test_assert(not public.has_shared_family_for_push(),'Viewer no preprompt');
select set_config('request.jwt.claim.sub',public.push_test_id('removed')::text,false);
select public.push_test_assert(not public.has_shared_family_for_push(),'stale mirror does not grant preprompt');

select set_config('request.jwt.claim.sub',public.push_test_id('owner')::text,false);
insert into public.push_test_ids(label,id)
select 'message',id from public.send_family_chat_message(public.push_test_id('family'),public.push_test_id('client_key'),'private body never pushed');
select public.push_test_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.push_test_id('message')),'INSERT one event');
select public.push_test_assert((select pet_id is null and family_id=public.push_test_id('family') from private.family_notification_outbox where source_id=public.push_test_id('message')),'Family-only queue scope');
select public.push_test_assert((public.send_family_chat_message(public.push_test_id('family'),public.push_test_id('client_key'),'private body never pushed')).id=public.push_test_id('message'),'same client key same row');
select public.update_family_chat_message(public.push_test_id('message'),'edited private body');
select public.mark_family_chat_read(public.push_test_id('family'),public.push_test_id('message'));
select public.push_test_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.push_test_id('message')),'retry/edit/read zero extra event');

-- Work only on the synthetic pending Chat event. The previous Journal row is
-- parked in this disposable DB to avoid affecting the claim assertions.
update private.family_notification_outbox set status='processed' where event_type<>'chat_message';
select set_config('request.jwt.claim.role','service_role',false);
create temporary table push_claim as select * from public.claim_family_notification_event();
select public.push_test_assert((select source_id=public.push_test_id('message') and sender_name='Jason' from push_claim),'worker trusted sender name');
select public.push_test_assert((select count(*)=3 from private.family_notification_deliveries),'Member two devices plus Member B missing mirror');
select public.push_test_assert(not exists(select 1 from private.family_notification_deliveries d where d.recipient_user_id not in
 (public.push_test_id('member'),public.push_test_id('member_b'))),'sender all devices/Viewer/Removed/Former/cross-Family excluded');
select public.push_test_assert(not exists(select 1 from private.family_notification_deliveries d join private.push_devices v on v.id=d.push_device_id
 where not v.enabled or not v.chat_push_v1),'old and disabled devices excluded');
select public.push_test_assert((select count(*)=0 from public.claim_family_notification_event()),'active event lease cannot be reclaimed');
create temporary table push_targets as select * from public.claim_family_notification_targets((select event_id from push_claim));
select public.push_test_assert((select count(*)=3 from push_targets),'eligible target claim');
select public.push_test_assert((select count(*)=0 from public.claim_family_notification_targets((select event_id from push_claim))),'sending target cannot be reclaimed');
select public.push_test_assert((select bool_and(public.validate_family_notification_delivery(delivery_id)) from push_targets),'per-send eligibility');

-- Source disappears after target claim: final per-send validation terminalizes
-- each pending delivery, not a permanent failure/retry loop.
select set_config('request.jwt.claim.role','authenticated',false);
select public.delete_family_chat_message(public.push_test_id('message'));
select public.push_test_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.push_test_id('message')),'delete zero extra event');
select set_config('request.jwt.claim.role','service_role',false);
select public.push_test_assert((select bool_and(not public.validate_family_notification_delivery(delivery_id)) from push_targets),'deleted-before-send skips');
select public.push_test_assert((select bool_and(status='skipped') from private.family_notification_deliveries),'deleted delivery terminal skipped');
select public.push_test_assert(public.finish_family_notification_event((select event_id from push_claim))='processed','deleted event safely finishes');

-- A message deleted before delivery creation creates no recipients at all.
select set_config('request.jwt.claim.role','authenticated',false);
insert into public.push_test_ids(label,id) select 'deleted_early',id from public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'delete early');
select public.delete_family_chat_message(public.push_test_id('deleted_early'));
select set_config('request.jwt.claim.role','service_role',false);
select * from public.claim_family_notification_event();
select public.push_test_assert(not exists(select 1 from private.family_notification_deliveries d join private.family_notification_outbox e on e.id=d.event_id where e.source_id=public.push_test_id('deleted_early')),'deleted-before-claim no deliveries');

-- Worker retries reuse event/device keys, and receipt invalidation still disables.
select set_config('request.jwt.claim.role','authenticated',false);
insert into public.push_test_ids(label,id) select 'retry_message',id from public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'retry fixture');
select set_config('request.jwt.claim.sub',public.push_test_id('member')::text,false);
create temporary table push_unread_before as select public.get_family_chat_unread_count(public.push_test_id('family')) as unread;
select set_config('request.jwt.claim.role','service_role',false);
create temporary table retry_event as select * from public.claim_family_notification_event();
create temporary table retry_targets as select * from public.claim_family_notification_targets((select event_id from retry_event));
select public.record_family_push_delivery(delivery_id,'retry',null,'rate limited',15) from retry_targets;
select public.finish_family_notification_event((select event_id from retry_event));
update private.family_notification_outbox set available_at=now() where id=(select event_id from retry_event);
update private.family_notification_deliveries set available_at=now() where event_id=(select event_id from retry_event);
select * from public.claim_family_notification_event();
select public.push_test_assert((select count(*)=3 from private.family_notification_deliveries where event_id=(select event_id from retry_event)),'worker retry no duplicated delivery');
create temporary table retry_again as select * from public.claim_family_notification_targets((select event_id from retry_event));
select public.record_family_push_delivery(delivery_id,'ticket','fixture-ticket-'||delivery_id,null) from retry_again;
select public.record_family_push_receipt(delivery_id,'device_not_registered','fixture invalid token') from retry_again where delivery_id=(select min(delivery_id::text)::uuid from retry_again);
select public.push_test_assert((select count(*)=1 from private.push_devices where not enabled and id in(select push_device_id from retry_again)),'token invalidation unchanged');
select public.finish_family_notification_event((select event_id from retry_event));
select public.push_test_assert(public.get_family_chat_unread_count(public.push_test_id('family'))=(select unread from push_unread_before),'Push retry/receipt failure does not change unread');
update private.push_devices set enabled=true where installation_id like 'capable-installation-member%';

-- Legacy Pet send generates one Family Push event, never one per Realtime topic.
insert into public.pet_members(pet_id,user_id,role) values(public.push_test_id('pet'),public.push_test_id('owner'),'owner') on conflict do nothing;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub',public.push_test_id('owner')::text,false);
insert into public.push_test_ids(label,id) select 'legacy_message',id from public.send_chat_message(public.push_test_id('pet'),gen_random_uuid(),'legacy fixture');
select public.push_test_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.push_test_id('legacy_message') and pet_id is null),'legacy row one Family queue event');
update private.family_notification_outbox set status='processed';

-- Existing activity triggers + recipients work for incapable devices and
-- canonical members even when Pet mirrors are absent.
insert into public.posts(id,pet_id,author_id,content) values(gen_random_uuid(),public.push_test_id('pet'),public.push_test_id('owner'),'new Journal');
insert into public.care_logs(id,pet_id,performed_by,care_type,occurred_at,time_zone,local_date,health_subtype)
values(gen_random_uuid(),public.push_test_id('pet'),public.push_test_id('owner'),'feeding',now(),'Asia/Hong_Kong',current_date,null),
 (gen_random_uuid(),public.push_test_id('pet'),public.push_test_id('owner'),'health',now(),'Asia/Hong_Kong',current_date,'stool');
insert into public.care_tasks(id,pet_id,created_by,title,schedule_type,scheduled_at,time_zone)
values(gen_random_uuid(),public.push_test_id('pet'),public.push_test_id('owner'),'new reminder','once',now()+interval '1 day','Asia/Hong_Kong');
select set_config('request.jwt.claim.role','service_role',false);
do $$ declare e record; t record; kinds text[]:=array[]::text[]; begin
 for i in 1..4 loop
  select * into e from public.claim_family_notification_event();
  kinds:=array_append(kinds,e.activity_kind);
  perform public.push_test_assert(e.family_id=public.push_test_id('family'),'Pet event canonical Family');
  perform public.push_test_assert((select count(*)=4 from private.family_notification_deliveries where event_id=e.event_id),'old device retained for Pet activity');
  perform public.push_test_assert(exists(select 1 from private.family_notification_deliveries d join private.push_devices v on v.id=d.push_device_id
   where d.event_id=e.event_id and v.installation_id='legacy-existing-installation'),'no capability gating for Pet event');
  for t in select * from public.claim_family_notification_targets(e.event_id) loop
   perform public.push_test_assert(public.validate_family_notification_delivery(t.delivery_id),'Pet pre-send eligibility');
   perform public.record_family_push_delivery(t.delivery_id,'ticket','old-push-ticket-'||t.delivery_id,null);
  end loop;
  perform public.finish_family_notification_event(e.event_id);
 end loop;
 perform public.push_test_assert(kinds @> array['journal','care','health','reminder'],'four activity kinds preserved');
end $$;

-- Zero-Pet Chat, plus Owner as recipient (Member sends).
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub',public.push_test_id('zero_member')::text,false);
select public.send_family_chat_message(public.push_test_id('zero_family'),gen_random_uuid(),'zero Pet Chat');
select set_config('request.jwt.claim.role','service_role',false);
create temporary table zero_event as select * from public.claim_family_notification_event();
select public.push_test_assert((select count(*)=1 from private.family_notification_deliveries where event_id=(select event_id from zero_event)
 and recipient_user_id=public.push_test_id('zero_owner')),'Owner recipient without Pet');
select * from public.claim_family_notification_targets((select event_id from zero_event));
-- Revocation after target claim must also fail final pre-send check.
update private.push_devices set chat_push_v1=false where user_id=public.push_test_id('zero_owner');
select public.push_test_assert(not public.validate_family_notification_delivery((select id from private.family_notification_deliveries where event_id=(select event_id from zero_event))),'capability withdrawn after claim denied');
select public.finish_family_notification_event((select event_id from zero_event));

-- Canonical membership can change after individual targets are already claimed.
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub',public.push_test_id('owner')::text,false);
select public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'late membership revocation');
select set_config('request.jwt.claim.role','service_role',false);
create temporary table revoked_event as select * from public.claim_family_notification_event();
create temporary table revoked_targets as select * from public.claim_family_notification_targets((select event_id from revoked_event));
delete from public.family_members where user_id=public.push_test_id('member_b');
select public.push_test_assert(not public.validate_family_notification_delivery((select d.id from private.family_notification_deliveries d
 where d.event_id=(select event_id from revoked_event) and d.recipient_user_id=public.push_test_id('member_b'))),'membership revoked after claim');
update public.family_members set role='viewer' where user_id=public.push_test_id('member');
select public.push_test_assert((select bool_and(not public.validate_family_notification_delivery(d.id)) from private.family_notification_deliveries d
 where d.event_id=(select event_id from revoked_event) and d.recipient_user_id=public.push_test_id('member')),'role downgraded after claim');
select public.push_test_assert(public.finish_family_notification_event((select event_id from revoked_event))='processed','revocation does not retry forever');
update public.family_members set role='member' where user_id=public.push_test_id('member');
insert into public.family_members(family_id,user_id,role) values(public.push_test_id('family'),public.push_test_id('member_b'),'member');
-- A corrupted source/Family association must not deliver to the other Family.
select set_config('request.jwt.claim.role','authenticated',false);
select public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'mismatch fixture');
select set_config('request.jwt.claim.role','service_role',false);
update private.family_notification_outbox set family_id=public.push_test_id('other_family') where status='pending';
create temporary table mismatch_event as select * from public.claim_family_notification_event();
select public.push_test_assert(not exists(select 1 from private.family_notification_deliveries where event_id=(select event_id from mismatch_event)),'source Family mismatch denied');

-- Existing ten-minute TTL applies equally to Chat and preserves the message.
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub',public.push_test_id('owner')::text,false);
insert into public.push_test_ids(label,id) select 'expired_message',id from public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'TTL fixture');
select set_config('request.jwt.claim.role','service_role',false);
update private.family_notification_outbox set created_at=now()-interval '11 minutes' where source_id=public.push_test_id('expired_message');
select * from public.claim_family_notification_event();
select public.push_test_assert((select status='expired' from private.family_notification_outbox where source_id=public.push_test_id('expired_message')),'Chat TTL terminal expiry');
select public.push_test_assert(exists(select 1 from public.chat_messages where id=public.push_test_id('expired_message')),'expired Push does not remove Chat');

-- Deletion after deliveries are created but before target claim also skips.
select set_config('request.jwt.claim.role','authenticated',false);
insert into public.push_test_ids(label,id) select 'deleted_middle',id from public.send_family_chat_message(public.push_test_id('family'),gen_random_uuid(),'delete before target claim');
select set_config('request.jwt.claim.role','service_role',false);
create temporary table deleted_middle_event as select * from public.claim_family_notification_event();
select set_config('request.jwt.claim.role','authenticated',false);
select public.delete_family_chat_message(public.push_test_id('deleted_middle'));
select set_config('request.jwt.claim.role','service_role',false);
select public.push_test_assert((select count(*)=0 from public.claim_family_notification_targets((select event_id from deleted_middle_event))),'deleted-before-target-claim no sends');
select public.push_test_assert((select bool_and(status='skipped') from private.family_notification_deliveries where event_id=(select event_id from deleted_middle_event)),'target-claim deletion safely skipped');
select public.finish_family_notification_event((select event_id from deleted_middle_event));

-- Enqueue and message insert are atomic: an outbox error cannot commit a
-- message without its job. The intentional exception is caught in a subtransaction.
create function public.push_test_fail_enqueue() returns trigger language plpgsql as $$
begin if new.event_type='chat_message' then raise exception 'fixture enqueue failure'; end if; return new; end; $$;
create trigger push_test_fail_enqueue before insert on private.family_notification_outbox
for each row execute function public.push_test_fail_enqueue();
select set_config('request.jwt.claim.role','authenticated',false);
do $$ declare key uuid:=gen_random_uuid(); begin
 begin
  perform public.send_family_chat_message(public.push_test_id('family'),key,'atomic enqueue fixture');
  raise exception 'expected enqueue failure';
 exception when raise_exception then
  if sqlerrm <> 'fixture enqueue failure' then raise; end if;
 end;
 perform public.push_test_assert(not exists(select 1 from public.chat_messages where client_message_id=key),'enqueue failure rolls back message');
end $$;
drop trigger push_test_fail_enqueue on private.family_notification_outbox;
drop function public.push_test_fail_enqueue();

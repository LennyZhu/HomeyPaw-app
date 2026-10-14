-- Synthetic data only, in the isolated local schema clone.
create function public.ct_id(text) returns uuid language sql immutable as $$ select md5('actual-care:'||$1)::uuid; $$;
create function public.ct_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function public.ct_error(command text, code text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then if sqlstate=code then return; end if; raise; end;
  raise exception 'Expected %: %',code,command;
end; $$;
insert into public.care_logs(id,pet_id,performed_by,care_type,occurred_at,time_zone,local_date,note)
values(public.ct_id('history'),public.rv2_id('pet'),public.rv2_id('owner'),'feeding','2020-01-01T01:00Z','Asia/Hong_Kong','2020-01-01','Historical timestamp retained, not inferred');
create table public.ct_history as select to_jsonb(l) as value from public.care_logs l where id=public.ct_id('history');
insert into public.care_tasks(id,pet_id,created_by,title,care_type,schedule_type,scheduled_at,time_zone)
select public.ct_id(label),public.rv2_id('pet'),public.rv2_id('owner'),label,'feeding','once',
  case when label='early' then clock_timestamp()+interval '5 hours' else
    ((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong' end,'Asia/Hong_Kong'
from unnest(array['planned','now','custom','early','midnight','member','denied','legacy','canceled','concurrent']) label;
insert into public.care_shifts(id,pet_id,local_date,assignee_user_id,created_by)
select public.ct_id('shift-'||label),public.rv2_id('pet'),(task.scheduled_at at time zone task.time_zone)::date,public.rv2_id('owner'),public.rv2_id('owner')
from unnest(array['planned','now','custom','early','midnight','member','denied','legacy','canceled','concurrent']) label
join public.care_tasks task on task.id=public.ct_id(label);
insert into public.care_shift_tasks(id,shift_id,pet_id,care_task_id,source_scheduled_for)
select public.ct_id('item-'||title),public.ct_id('shift-'||title),pet_id,id,scheduled_at
from public.care_tasks where id in(select public.ct_id(label) from unnest(array['planned','now','custom','early','midnight','member','denied','legacy','canceled','concurrent']) label);
update public.care_shift_tasks set status='canceled',canceled_at=clock_timestamp() where id=public.ct_id('item-canceled');

-- Everything below rolls back; committed fixtures are only for concurrency in
-- this disposable database, which the verifier always drops.
begin;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select * from public.complete_care_shift_task_v2(public.ct_id('completion-planned'),public.ct_id('log-planned'),public.ct_id('item-planned'),((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong');
select public.ct_assert((select occurred_at=(((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong') and local_date=current_date-1 and created_at>occurred_at from public.care_logs where id=public.ct_id('log-planned')),'planned actual distinct from recorded audit time');
select * from public.complete_care_shift_task_v2(public.ct_id('duplicate'),public.ct_id('duplicate-log'),public.ct_id('item-planned'),clock_timestamp());
select public.ct_assert((select count(*)=1 from public.care_task_completions where task_id=public.ct_id('planned')),'duplicate different IDs no second completion');
select public.ct_assert((select occurred_at=(((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong') from public.care_logs where id=public.ct_id('log-planned')),'retry cannot overwrite actual time');
-- The transaction starts before confirmation; clock_timestamp must be fresh.
select pg_sleep(0.03);
select * from public.complete_care_shift_task_v2(public.ct_id('completion-now'),public.ct_id('log-now'),public.ct_id('item-now'),null);
select public.ct_assert((select clock_timestamp()-occurred_at<interval '5 seconds' from public.care_logs where id=public.ct_id('log-now')),'just now actual');
select public.ct_assert((select l.occurred_at=c.completed_at and l.occurred_at>transaction_timestamp()+interval '0.02 seconds' and l.local_date=(l.occurred_at at time zone l.time_zone)::date from public.care_logs l join public.care_task_completions c on c.care_log_id=l.id where l.id=public.ct_id('log-now')),'server confirmation clock and timezone local date');
select * from public.complete_care_shift_task_v2(public.ct_id('now-retry'),public.ct_id('now-retry-log'),public.ct_id('item-now'),null);
select public.ct_assert((select count(*)=1 from public.care_task_completions where task_id=public.ct_id('now')),'server-now retry no duplicate');
select * from public.complete_care_shift_task_v2(public.ct_id('completion-custom'),public.ct_id('log-custom'),public.ct_id('item-custom'),((current_date-1)+time '14:15') at time zone 'Asia/Hong_Kong');
select public.ct_assert((select occurred_at=(((current_date-1)+time '14:15') at time zone 'Asia/Hong_Kong') from public.care_logs where id=public.ct_id('log-custom')),'custom actual');
select public.ct_assert((select source_scheduled_for=(((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong') from public.care_shift_tasks where id=public.ct_id('item-custom')),'original planned time unchanged');
select * from public.complete_care_shift_task_v2(public.ct_id('completion-early'),public.ct_id('log-early'),public.ct_id('item-early'),null);
select public.ct_assert((select scheduled_for>completed_at from public.care_task_completions where id=public.ct_id('completion-early')),'early completion retains future plan');
select * from public.complete_care_shift_task_v2(public.ct_id('completion-midnight'),public.ct_id('log-midnight'),public.ct_id('item-midnight'),((current_date-1)+time '23:30') at time zone 'Asia/Hong_Kong');
select public.ct_assert((select local_date=current_date-1 from public.care_logs where id=public.ct_id('log-midnight')),'midnight catch-up uses actual date');
select public.ct_assert((select count(*)=2 from public.get_today_care_logs(public.rv2_id('pet'))),'today excludes yesterday care even when recorded today');
set local time zone 'America/Los_Angeles';
select public.ct_assert((select count(*)=2 from public.get_today_care_logs(public.rv2_id('pet'))),'today reads independent of session/device timezone');
set local time zone 'UTC';
select public.ct_assert((select array_agg(id order by occurred_at desc)=array[public.ct_id('log-midnight'),public.ct_id('log-custom'),public.ct_id('log-planned')] from public.care_logs where id in(public.ct_id('log-midnight'),public.ct_id('log-custom'),public.ct_id('log-planned'))),'actual occurrence ordering');
select public.ct_error($q$select public.complete_care_shift_task_v2(gen_random_uuid(),gen_random_uuid(),public.ct_id('item-denied'),clock_timestamp()+interval '1 minute')$q$,'22023');
select public.ct_error($q$select public.complete_care_shift_task_v2(gen_random_uuid(),gen_random_uuid(),public.ct_id('item-denied'),'infinity')$q$,'22023');
select public.ct_error($q$select public.complete_care_shift_task_v2(gen_random_uuid(),gen_random_uuid(),public.ct_id('item-denied'),'-infinity')$q$,'22023');
select public.ct_error($q$select public.complete_care_shift_task_v2(null,gen_random_uuid(),public.ct_id('item-denied'),null)$q$,'22023');
select public.ct_error($q$select public.complete_care_shift_task_v2(gen_random_uuid(),gen_random_uuid(),public.ct_id('item-canceled'),clock_timestamp())$q$,'22023');
select public.ct_assert((select count(*)=0 from public.care_task_completions where task_id=public.ct_id('denied')),'invalid/cancel leaves state unchanged');

-- Existing author-only edit updates the fact, not completion or plan.
select * from public.update_care_log(public.ct_id('log-custom'),((current_date-2)+time '14:15') at time zone 'Asia/Hong_Kong','Asia/Hong_Kong',null,null);
select public.ct_assert((select local_date=current_date-2 from public.care_logs where id=public.ct_id('log-custom')),'author corrects actual date');
select public.ct_assert((select count(*)=1 from public.care_task_completions where task_id=public.ct_id('custom')),'edit keeps completed occurrence');
select public.ct_assert((select completed_at>(((current_date-1)+time '14:15') at time zone 'Asia/Hong_Kong') from public.care_task_completions where task_id=public.ct_id('custom')),'audit timestamp not replaced by edit');
select public.ct_error($q$select public.update_care_log(public.ct_id('log-custom'),clock_timestamp()+interval '1 minute','Asia/Hong_Kong',null,null)$q$,'22023');
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
-- Force a zone on the opposite side of midnight from UTC to exercise server-now local_date.
reset role;
update public.care_tasks set time_zone=case when extract(hour from clock_timestamp() at time zone 'UTC')<12 then 'Etc/GMT+12' else 'Etc/GMT-14' end where id=public.ct_id('member');
set local role authenticated;
select * from public.complete_care_task_v2(public.ct_id('completion-member'),public.ct_id('log-member'),public.ct_id('member'),((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong',null);
select public.ct_assert((select l.local_date=(l.occurred_at at time zone l.time_zone)::date and l.local_date<>(l.occurred_at at time zone 'UTC')::date and l.occurred_at=c.completed_at from public.care_logs l join public.care_task_completions c on c.care_log_id=l.id where l.id=public.ct_id('log-member')),'direct v2 server-now across UTC midnight');
select public.ct_error($q$select public.update_care_log(public.ct_id('log-custom'),clock_timestamp(),'Asia/Hong_Kong',null,null)$q$,'42501');
do $$ declare actor text; begin
 foreach actor in array array['viewer','removed','former','stranger'] loop
  perform set_config('request.jwt.claim.sub',public.rv2_id(actor)::text,true);
  perform public.ct_error($q$select public.complete_care_shift_task_v2(gen_random_uuid(),gen_random_uuid(),public.ct_id('item-denied'),null)$q$,'42501');
  perform public.ct_error($q$select public.complete_care_task_v2(gen_random_uuid(),gen_random_uuid(),public.ct_id('denied'),((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong',null)$q$,'42501');
  perform public.ct_assert((select count(*)=0 from public.get_today_care_logs(public.rv2_id('pet'))),'existing Viewer/nonmember Care read denial preserved');
 end loop;
end; $$;
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
-- Legacy once completion remains usable with its unchanged signature.
select * from public.complete_care_shift_task(public.ct_id('completion-legacy'),public.ct_id('log-legacy'),public.ct_id('item-legacy'));
select public.ct_assert((select abs(extract(epoch from (l.occurred_at-c.completed_at)))<1 from public.care_logs l join public.care_task_completions c on c.care_log_id=l.id where l.id=public.ct_id('log-legacy')),'legacy now-time behavior unchanged');
reset role;
select public.ct_assert((select to_jsonb(l)=(select value from public.ct_history) from public.care_logs l where id=public.ct_id('history')),'historical care row not rewritten');
select public.ct_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.ct_id('log-planned') and event_type='care_log_created'),'one Care Push event despite duplicate completion');
select public.ct_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.ct_id('log-now') and event_type='care_log_created'),'one Care Push for server-now retries');
select public.ct_assert((select completed_by=public.rv2_id('owner') from public.care_task_completions where id=public.ct_id('completion-now')),'server-now first actor retained');
select public.ct_assert((select c.id=public.ct_id('completion-now') and st.source_scheduled_for=(((current_date-1)+time '13:00') at time zone 'Asia/Hong_Kong') from public.care_shift_tasks st join public.care_task_completions c on c.care_shift_task_id=st.id where st.id=public.ct_id('item-now')),'Schedule remains completed with immutable plan');
select public.ct_assert((select count(*)=1 from private.family_notification_outbox where source_id=public.ct_id('log-custom') and event_type='care_log_created'),'edit does not enqueue another Care Push');
select public.ct_assert(not has_function_privilege('anon','public.complete_care_task_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,integer)','EXECUTE'),'anon completion denied');
rollback;

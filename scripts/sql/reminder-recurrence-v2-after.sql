begin;
select public.rv2_assert((select week_days=array[2]::smallint[] and ends_on is null from public.care_tasks where id=public.rv2_id('legacy')),'legacy singleton backfill');
select public.rv2_assert((select week_days is null and ends_on is null from public.care_tasks where id=public.rv2_id('daily')),'nonweekly backfill');
select public.rv2_assert(not has_function_privilege('anon','public.create_care_task_v2(uuid,uuid,text,public.care_type,text,public.care_task_schedule_type,timestamptz,date,time,text,smallint[],smallint,date,public.care_task_category)','EXECUTE'),'anon denied');
select public.rv2_assert(not has_table_privilege('authenticated','public.care_tasks','INSERT') and not has_table_privilege('service_role','public.care_tasks','INSERT'),'existing RPC-only write privileges preserved');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
select public.create_care_task(public.rv2_id('v1'),public.rv2_id('pet'),'V1',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',2::smallint,null);
select public.update_care_task(public.rv2_id('v1'),'V1 edit',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',3::smallint,null);
select public.rv2_assert((select week_days=array[3]::smallint[] and week_day=3 and ends_on is null from public.care_tasks where id=public.rv2_id('v1')),'v1 create and simple update');
select public.create_care_task_v2(public.rv2_id('v2'),public.rv2_id('pet'),'V2',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',array[5,1,3,1]::smallint[],null,current_date+10);
select public.rv2_assert((select week_days=array[1,3,5]::smallint[] and week_day=1 and ends_on=current_date+10 from public.care_tasks where id=public.rv2_id('v2')),'v2 sorted deduped rule');
select public.rv2_error($q$select public.update_care_task(public.rv2_id('v2'),'Bad legacy edit',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',2::smallint,null)$q$,'22023','REMINDER_REQUIRES_NEWER_CLIENT');
select public.rv2_assert((select week_days=array[1,3,5]::smallint[] and ends_on=current_date+10 from public.care_tasks where id=public.rv2_id('v2')),'advanced rule unchanged after v1 rejection');
select public.update_care_task_v2(public.rv2_id('v2'),'V2 update',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',array[2,4]::smallint[],null,current_date+5);
select public.rv2_assert((select week_days=array[2,4]::smallint[] and ends_on=current_date+5 from public.care_tasks where id=public.rv2_id('v2')),'v2 update');
select public.update_care_task_v2(public.rv2_id('v2'),'Multi only',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',array[2,4]::smallint[],null,null);
select public.rv2_error($q$select public.update_care_task(public.rv2_id('v2'),'Collapse multi',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',2::smallint,null)$q$,'22023','REMINDER_REQUIRES_NEWER_CLIENT');
select public.update_care_task_v2(public.rv2_id('v2'),'End only',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,current_date+5);
select public.rv2_error($q$select public.update_care_task(public.rv2_id('v2'),'Clear end',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null)$q$,'22023','REMINDER_REQUIRES_NEWER_CLIENT');
select public.rv2_error($q$select public.update_care_task_v2(public.rv2_id('v2'),'Empty',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong','{}'::smallint[],null,null)$q$,'22023');
select public.rv2_error($q$select public.update_care_task_v2(public.rv2_id('v2'),'Bad end',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,current_date)$q$,'22023');
select public.rv2_error($q$select public.update_care_task_v2(public.rv2_id('v2'),'Bad days',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',array[0,8]::smallint[],null,null)$q$,'22023');
select public.rv2_error($q$select public.update_care_task_v2(public.rv2_id('v2'),'Null day',null,null,'weekly',null,current_date+1,'18:00','Asia/Hong_Kong',array[null,1]::smallint[],null,null)$q$,'22023');
-- Member has no Pet mirror; canonical membership must suffice.
select set_config('request.jwt.claim.sub',public.rv2_id('member')::text,true);
select public.create_care_task_v2(public.rv2_id('member-task'),public.rv2_id('pet'),'Member task',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,null);
select public.update_care_task_v2(public.rv2_id('member-task'),'Member edit',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,current_date+2);
select public.rv2_error($q$select public.update_care_task_v2(public.rv2_id('v2'),'Other author',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,null)$q$,'42501');
-- Viewer reads, but cannot create. Removed/Former stale mirrors cannot restore access.
do $$ declare actor text; begin
  foreach actor in array array['viewer','removed','former','stranger'] loop
    perform set_config('request.jwt.claim.sub',public.rv2_id(actor)::text,true);
    perform public.rv2_error($q$select public.create_care_task_v2(gen_random_uuid(),public.rv2_id('pet'),'Denied',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,null)$q$,'42501');
    perform public.rv2_error($q$select public.update_care_task_v2(public.rv2_id('v2'),'Denied',null,null,'daily',null,current_date+1,'18:00','Asia/Hong_Kong',null,null,null)$q$,'42501');
    if actor <> 'viewer' then
      perform public.rv2_assert((select count(*)=0 from public.get_care_task_occurrences_v2('2026-10-01','2026-10-20',public.rv2_id('pet'))),'nonmember occurrence denied');
      perform public.rv2_assert((select count(*)=0 from public.care_tasks where pet_id=public.rv2_id('pet')),'care_tasks RLS denied');
    else
      perform public.rv2_assert((select count(*)>0 from public.care_tasks where pet_id=public.rv2_id('pet')),'Viewer read allowed');
    end if;
  end loop;
end; $$;
reset role;
set local request.jwt.claim.role='service_role';
select set_config('request.jwt.claim.sub',public.rv2_id('owner')::text,true);
-- Actual table constraints also reject invalid writes outside the RPC.
select public.rv2_error($q$update public.care_tasks set ends_on='2025-12-31' where id=public.rv2_id('legacy')$q$,'23514');
select public.rv2_error($q$update public.care_tasks set week_days='{}'::smallint[] where id=public.rv2_id('legacy')$q$,'23514');
select public.rv2_error($q$update public.care_tasks set week_days=array[2]::smallint[] where id=public.rv2_id('daily')$q$,'23514');
insert into public.care_tasks(id,pet_id,created_by,title,schedule_type,starts_on,local_time,time_zone,week_day,week_days,ends_on,month_day)
values
(public.rv2_id('daily-never'),public.rv2_id('pet'),public.rv2_id('owner'),'Daily never','daily','2026-10-01','18:00','Asia/Hong_Kong',null,null,null,null),
(public.rv2_id('daily-ended'),public.rv2_id('pet'),public.rv2_id('owner'),'Daily ended','daily','2026-10-01','18:00','Asia/Hong_Kong',null,null,'2026-10-03',null),
(public.rv2_id('mwf'),public.rv2_id('pet'),public.rv2_id('owner'),'Mon Wed Fri','weekly','2026-10-01','18:00','Asia/Hong_Kong',1,array[1,3,5]::smallint[],null,null),
(public.rv2_id('weekdays'),public.rv2_id('pet'),public.rv2_id('owner'),'Weekdays','weekly','2026-10-01','18:00','Asia/Hong_Kong',1,array[1,2,3,4,5]::smallint[],'2026-10-11',null),
(public.rv2_id('utc-boundary'),public.rv2_id('pet'),public.rv2_id('owner'),'Local end','daily','2026-10-01','00:30','Asia/Hong_Kong',null,null,'2026-10-01',null),
(public.rv2_id('equal'),public.rv2_id('pet'),public.rv2_id('owner'),'Equal','daily','2026-10-01','18:00','Asia/Hong_Kong',null,null,'2026-10-01',null),
(public.rv2_id('month'),public.rv2_id('pet'),public.rv2_id('owner'),'Monthly','monthly','2026-01-01','18:00','Asia/Hong_Kong',null,null,null,31),
(public.rv2_id('year'),public.rv2_id('pet'),public.rv2_id('owner'),'Yearly','yearly','2024-02-29','18:00','Asia/Hong_Kong',null,null,null,null),
(public.rv2_id('dst-gap'),public.rv2_id('pet'),public.rv2_id('owner'),'Gap','daily','2026-03-07','02:30','America/Los_Angeles',null,null,'2026-03-09',null),
(public.rv2_id('real-history'),public.rv2_id('pet'),public.rv2_id('owner'),'Real completion','daily',(clock_timestamp() at time zone 'Asia/Hong_Kong')::date,(clock_timestamp() at time zone 'Asia/Hong_Kong')::time(0),'Asia/Hong_Kong',null,null,null,null),
(public.rv2_id('dst-overlap'),public.rv2_id('pet'),public.rv2_id('owner'),'Overlap','daily','2026-11-01','01:30','America/Los_Angeles',null,null,'2026-11-01',null);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select * from public.complete_care_task(public.rv2_id('actual-completion'),public.rv2_id('actual-log'),public.rv2_id('real-history'),(select (starts_on+local_time) at time zone time_zone from public.care_tasks where id=public.rv2_id('real-history')),'Real completion fixture',null);
select public.update_care_task_v2(public.rv2_id('real-history'),'Edited real completion',null,null,'weekly',null,(clock_timestamp() at time zone 'Asia/Hong_Kong')::date,'23:59','Asia/Hong_Kong',array[7]::smallint[],null,null);
select public.rv2_assert((select count(*)=1 from public.get_care_task_occurrences_v2(clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',public.rv2_id('pet')) where completion_id=public.rv2_id('actual-completion')),'real completed history survives edit');
select public.rv2_assert((select count(*)=10 from public.get_care_task_occurrences_v2('2026-10-01 00:00+08','2026-10-11 00:00+08',public.rv2_id('pet')) where task_id=public.rv2_id('daily-never')),'daily never ends');
select public.rv2_assert((select count(*)=3 and max(scheduled_for)='2026-10-03 10:00Z'::timestamptz from public.get_care_task_occurrences_v2('2026-10-01 00:00+08','2026-10-11 00:00+08',public.rv2_id('pet')) where task_id=public.rv2_id('daily-ended')),'daily end inclusive with no later occurrence');
select public.rv2_assert((select array_agg((scheduled_for at time zone 'Asia/Hong_Kong')::date order by scheduled_for)=array['2026-10-02'::date,'2026-10-05'::date,'2026-10-07'::date,'2026-10-09'::date] from public.get_care_task_occurrences_v2('2026-10-01 00:00+08','2026-10-11 00:00+08',public.rv2_id('pet')) where task_id=public.rv2_id('mwf')),'all Mon Wed Fri weekdays expand');
select public.rv2_assert((select count(*)=7 and max(scheduled_for)='2026-10-09 10:00Z'::timestamptz from public.get_care_task_occurrences_v2('2026-10-01','2026-10-20',public.rv2_id('pet')) where task_id=public.rv2_id('weekdays')),'multi weekday + end Sunday');
select public.rv2_assert((select count(*)=1 and max(scheduled_for)='2026-09-30 16:30Z'::timestamptz from public.get_care_task_occurrences_v2('2026-09-30','2026-10-03',public.rv2_id('pet')) where task_id=public.rv2_id('utc-boundary')),'end uses local date rather than UTC midnight');
select public.rv2_assert((select count(*)=1 and max(scheduled_for)='2026-10-01 10:00Z'::timestamptz from public.get_care_task_occurrences_v2('2026-10-01','2026-10-03',public.rv2_id('pet')) where task_id=public.rv2_id('equal')),'equal start/end inclusive');
select public.rv2_assert((select count(*)=0 from public.get_care_task_occurrences_v2('2026-04-01 00:00+08','2026-05-01 00:00+08',public.rv2_id('pet')) where task_id=public.rv2_id('month')),'missing monthly date skipped');
select public.rv2_assert((select count(*)=1 and max(scheduled_for)='2027-02-28 10:00Z'::timestamptz from public.get_care_task_occurrences_v2('2027-02-20','2027-03-05',public.rv2_id('pet')) where task_id=public.rv2_id('year')),'Feb29 fallback');
select public.rv2_assert((select count(*)=2 from public.get_care_task_occurrences_v2('2026-03-07','2026-03-11',public.rv2_id('pet')) where task_id=public.rv2_id('dst-gap')),'DST gap skipped');
select public.rv2_assert((select count(*)=1 and max(scheduled_for)='2026-11-01 09:30Z'::timestamptz from public.get_care_task_occurrences_v2('2026-11-01','2026-11-03',public.rv2_id('pet')) where task_id=public.rv2_id('dst-overlap')),'DST overlap later instant');
select public.rv2_assert((select count(*)=7 from public.get_care_task_occurrences('2026-10-01','2026-10-20',public.rv2_id('pet')) where task_id=public.rv2_id('weekdays')),'v1 result shape wrapper still expands canonical rule');
reset role;
set local request.jwt.claim.role='service_role';
-- Concrete associated items: future valid, future invalid, completed, past, canceled.
insert into public.care_shifts(id,pet_id,local_date,created_by)
select public.rv2_id('shift-'||label),public.rv2_id('pet'),(instant::timestamptz at time zone 'Asia/Hong_Kong')::date,public.rv2_id('owner')
from (values('keep',clock_timestamp()+interval '2 days'),('drop',clock_timestamp()+interval '3 days'),('done',clock_timestamp()+interval '4 days'),('past',clock_timestamp()-interval '2 days'),('canceled',clock_timestamp()+interval '5 days')) as fixture(label,instant);
-- Use the daily rule's exact saved wall time for each item.
insert into public.care_shift_tasks(id,shift_id,pet_id,care_task_id,source_scheduled_for,status,canceled_at)
select public.rv2_id('item-'||label),public.rv2_id('shift-'||label),public.rv2_id('pet'),public.rv2_id('daily'),(shift.local_date+time '18:00') at time zone 'Asia/Hong_Kong',case when label='canceled' then 'canceled'::public.care_schedule_status else 'scheduled' end,case when label='canceled' then clock_timestamp() end
from unnest(array['keep','drop','done','past','canceled']) label join public.care_shifts shift on shift.id=public.rv2_id('shift-'||label);
insert into public.care_logs(id,pet_id,performed_by,care_type,occurred_at,time_zone,local_date,note)
select public.rv2_id('log-'||label),public.rv2_id('pet'),public.rv2_id('owner'),'other',clock_timestamp()-interval '1 day','Asia/Hong_Kong',(clock_timestamp() at time zone 'Asia/Hong_Kong')::date-1,'Synthetic completion'
from unnest(array['done','past']) label;
insert into public.care_task_completions(id,task_id,pet_id,completed_by,scheduled_for,care_log_id,care_shift_task_id)
select public.rv2_id('completion-'||label),public.rv2_id('daily'),public.rv2_id('pet'),public.rv2_id('owner'),item.source_scheduled_for,public.rv2_id('log-'||label),item.id
from unnest(array['done','past']) label join public.care_shift_tasks item on item.id=public.rv2_id('item-'||label);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select public.update_care_task_v2(public.rv2_id('daily'),'Shortened',null,null,'daily',null,'2026-01-01','18:00','Asia/Hong_Kong',null,null,(select local_date from public.care_shifts where id=public.rv2_id('shift-keep')));
select public.rv2_assert((select status='canceled' from public.care_shift_tasks where id=public.rv2_id('item-drop')),'future invalid item canceled');
select public.rv2_assert((select status='scheduled' from public.care_shift_tasks where id=public.rv2_id('item-keep')),'inclusive future item retained');
select public.rv2_assert((select status='scheduled' from public.care_shift_tasks where id=public.rv2_id('item-done')),'completed item retained');
select public.rv2_assert((select status='scheduled' from public.care_shift_tasks where id=public.rv2_id('item-past')),'past item retained');
select public.rv2_assert((select status='canceled' from public.care_shift_tasks where id=public.rv2_id('item-canceled')),'canceled history retained');
select public.rv2_assert((select count(*)=2 from public.care_logs where id in(public.rv2_id('log-done'),public.rv2_id('log-past'))),'Care facts retained');
select public.rv2_assert((select count(*)=1 from public.get_care_task_occurrences_v2(clock_timestamp()-interval '5 days',clock_timestamp()+interval '8 days',public.rv2_id('pet')) where completion_id=public.rv2_id('completion-done')),'completed instant beyond shortened end retained');
select public.rv2_assert((select count(*)=1 from public.get_care_task_occurrences_v2(clock_timestamp()-interval '5 days',clock_timestamp()+interval '8 days',public.rv2_id('pet')) where completion_id=public.rv2_id('completion-past')),'current occurrence and history union deduped');
select public.update_care_task_v2(public.rv2_id('daily'),'Changed weekdays/time',null,null,'weekly',null,'2026-01-01','19:00','Asia/Hong_Kong',array[7]::smallint[],null,null);
select public.rv2_assert((select status='canceled' from public.care_shift_tasks where id=public.rv2_id('item-keep')),'changed time/weekday invalidates future item');
select public.rv2_assert((select count(*)=2 from public.get_care_task_occurrences_v2(clock_timestamp()-interval '5 days',clock_timestamp()+interval '8 days',public.rv2_id('pet')) where task_id=public.rv2_id('daily') and completion_id is not null),'history survives changed weekdays/time');
select public.deactivate_care_task(public.rv2_id('daily'));
select public.rv2_assert((select count(*)=2 from public.get_care_task_occurrences_v2(clock_timestamp()-interval '5 days',clock_timestamp()+interval '8 days',public.rv2_id('pet')) where task_id=public.rv2_id('daily')),'history survives deactivation');
rollback;

-- Synthetic fixtures only, in the disposable local schema clone.
create function public.rv2_id(text) returns uuid language sql immutable as $$ select md5('recurrence-v2:' || $1)::uuid; $$;
create function public.rv2_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function public.rv2_error(command text, code text, message text default null) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = code and (message is null or position(message in sqlerrm)>0) then return; end if;
    raise;
  end;
  raise exception 'Expected %: %',code,command;
end; $$;
insert into public.app_release_policy(platform,minimum_app_version,minimum_build,enforce_mutation_gate) values('ios','1.2.0',9,true);
insert into auth.users(id,email,raw_user_meta_data)
select public.rv2_id(label),label||'@recurrence-v2.invalid',jsonb_build_object('display_name',label,'locale','en')
from unnest(array['owner','member','viewer','removed','former','stranger']) label;
insert into public.families(id) values(public.rv2_id('family')),(public.rv2_id('other'));
insert into public.family_members(family_id,user_id,role) values
(public.rv2_id('family'),public.rv2_id('owner'),'owner'),
(public.rv2_id('family'),public.rv2_id('member'),'member'),
(public.rv2_id('family'),public.rv2_id('viewer'),'viewer'),
(public.rv2_id('family'),public.rv2_id('removed'),'member'),
(public.rv2_id('family'),public.rv2_id('former'),'member'),
(public.rv2_id('other'),public.rv2_id('stranger'),'owner');
insert into public.pets(id,name,species,family_id) values(public.rv2_id('pet'),'Reminder fixture','dog',public.rv2_id('family'));
insert into public.pet_members(pet_id,user_id,role) values(public.rv2_id('pet'),public.rv2_id('owner'),'owner');
insert into public.pet_members(pet_id,user_id,role)
select public.rv2_id('pet'),public.rv2_id(label),'member'::public.pet_member_role from unnest(array['removed','former']) label;
delete from public.family_members where user_id in(public.rv2_id('removed'),public.rv2_id('former'));
-- Explicitly recreate stale compatibility mirrors after removal lifecycle cleanup.
insert into public.pet_members(pet_id,user_id,role)
select public.rv2_id('pet'),public.rv2_id(label),'member'::public.pet_member_role from unnest(array['removed','former']) label
on conflict (pet_id,user_id) do nothing;
delete from public.pet_members where user_id=public.rv2_id('member');
select public.rv2_assert((select count(*)=2 from public.pet_members where user_id in(public.rv2_id('removed'),public.rv2_id('former'))),'stale Pet mirrors actually present');
select public.rv2_assert((select count(*)=0 from public.pet_members where user_id=public.rv2_id('member')),'Member actually has no Pet mirror');
insert into public.care_tasks(id,pet_id,created_by,title,schedule_type,starts_on,local_time,time_zone,week_day)
values(public.rv2_id('legacy'),public.rv2_id('pet'),public.rv2_id('owner'),'Legacy Tuesday','weekly','2026-01-01','18:00','Asia/Hong_Kong',2),
(public.rv2_id('daily'),public.rv2_id('pet'),public.rv2_id('owner'),'Daily','daily','2026-01-01','18:00','Asia/Hong_Kong',null);

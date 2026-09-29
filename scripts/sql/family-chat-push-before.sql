-- This file runs only in the disposable local schema-only verification DB.
-- Synthetic policy fixture with mutation enforcement ON. No real gate is
-- copied or changed; clients in this verifier supply supported version headers.
insert into public.app_release_policy(platform,minimum_app_version,minimum_build,enforce_mutation_gate)
values('ios','1.2.0',9,true);
create table public.push_test_ids(label text primary key, id uuid not null default gen_random_uuid());
insert into public.push_test_ids(label) values
 ('owner'),('member'),('member_b'),('viewer'),('removed'),('former'),('stranger'),
 ('zero_owner'),('zero_member'),('family'),('other_family'),('zero_family'),('pet'),
 ('history'),('client_key');
create function public.push_test_id(text) returns uuid language sql as
 'select id from public.push_test_ids where label=$1';
create function public.push_test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end; $$;
grant select on public.push_test_ids to authenticated, service_role;
insert into auth.users(id,email,raw_user_meta_data)
select id,id::text||'@chat-push-test.invalid',jsonb_build_object('display_name',case when label='owner' then 'Jason' else label end,'locale','en')
from public.push_test_ids where label in ('owner','member','member_b','viewer','removed','former','stranger','zero_owner','zero_member');
insert into public.families(id) values
 (public.push_test_id('family')),(public.push_test_id('other_family')),(public.push_test_id('zero_family'));
insert into public.family_members(family_id,user_id,role) values
 (public.push_test_id('family'),public.push_test_id('owner'),'owner'),
 (public.push_test_id('family'),public.push_test_id('member'),'member'),
 (public.push_test_id('family'),public.push_test_id('member_b'),'member'),
 (public.push_test_id('family'),public.push_test_id('viewer'),'viewer'),
 (public.push_test_id('family'),public.push_test_id('removed'),'member'),
 (public.push_test_id('family'),public.push_test_id('former'),'member'),
 (public.push_test_id('other_family'),public.push_test_id('stranger'),'owner'),
 (public.push_test_id('zero_family'),public.push_test_id('zero_owner'),'owner'),
 (public.push_test_id('zero_family'),public.push_test_id('zero_member'),'member');
insert into public.pets(id,name,species,family_id) values
 (public.push_test_id('pet'),'Push fixture','dog',public.push_test_id('family'));
-- Deliberately keep stale Pet mirrors for Removed/Former and omit Member B's
-- mirror: canonical authority must both reject stale rows and include missing ones.
insert into public.pet_members(pet_id,user_id,role)
select public.push_test_id('pet'),public.push_test_id(label),'member'::public.pet_member_role
from public.push_test_ids where label in ('removed','former');
delete from public.family_members where user_id in (public.push_test_id('removed'),public.push_test_id('former'));
insert into public.chat_messages(id,family_id,sender_id,client_message_id,body)
values(public.push_test_id('history'),public.push_test_id('family'),public.push_test_id('owner'),gen_random_uuid(),'pre-migration history');
insert into private.push_devices(user_id,installation_id,expo_push_token,platform,app_version)
values(public.push_test_id('member'),'legacy-existing-installation','ExpoPushToken[legacyexisting00]','ios','1.2.0');
-- A pre-existing Pet event exercises ownership backfill, without generating
-- historical Chat notifications.
insert into public.posts(id,pet_id,author_id,content)
values(gen_random_uuid(),public.push_test_id('pet'),public.push_test_id('owner'),'history fixture');

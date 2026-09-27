-- Synthetic fixtures only; executed with migration and assertions in ONE rollback transaction.
create temporary table chat_test_ids(label text primary key, id uuid not null default gen_random_uuid());
insert into chat_test_ids(label) values ('owner'),('member'),('viewer'),('stranger'),('zero_owner'),
  ('deleted_sender'),('family_a'),('family_b'),('family_zero'),('pet_a'),('pet_b'),('pet_c'),
  ('message_a'),('message_b'),('message_c'),('message_d'),('message_other');
create function pg_temp.chat_id(label text) returns uuid language sql as
  'select id from pg_temp.chat_test_ids where label = $1';
create function pg_temp.chat_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end; $$;
grant select on chat_test_ids to authenticated;
insert into auth.users(id, email) select id, id::text || '@family-chat-test.invalid' from chat_test_ids
  where label in ('owner','member','viewer','stranger','zero_owner','deleted_sender');
insert into public.families(id) values (pg_temp.chat_id('family_a')), (pg_temp.chat_id('family_b')), (pg_temp.chat_id('family_zero'));
insert into public.family_members(family_id, user_id, role) values
  (pg_temp.chat_id('family_a'), pg_temp.chat_id('owner'), 'owner'),
  (pg_temp.chat_id('family_a'), pg_temp.chat_id('member'), 'member'),
  (pg_temp.chat_id('family_a'), pg_temp.chat_id('viewer'), 'viewer'),
  (pg_temp.chat_id('family_b'), pg_temp.chat_id('stranger'), 'owner'),
  (pg_temp.chat_id('family_zero'), pg_temp.chat_id('zero_owner'), 'owner');
insert into public.pets(id, name, species, family_id) values
  (pg_temp.chat_id('pet_a'), 'Mochi', 'dog', pg_temp.chat_id('family_a')),
  (pg_temp.chat_id('pet_b'), 'Test', 'dog', pg_temp.chat_id('family_a')),
  (pg_temp.chat_id('pet_c'), 'Other', 'dog', pg_temp.chat_id('family_b'));
-- Mirror rows are compatibility fixtures; the new Family path must not need them.
insert into public.pet_members(pet_id,user_id,role)
select p.id, fm.user_id, fm.role from public.pets p join public.family_members fm on fm.family_id=p.family_id
  where p.id in (pg_temp.chat_id('pet_a'),pg_temp.chat_id('pet_b'),pg_temp.chat_id('pet_c'))
  on conflict(pet_id,user_id) do nothing;
insert into public.chat_messages(id,pet_id,sender_id,client_message_id,body,created_at) values
  (pg_temp.chat_id('message_a'), pg_temp.chat_id('pet_a'), pg_temp.chat_id('owner'), gen_random_uuid(), 'A', '2026-09-01 10:00Z'),
  (pg_temp.chat_id('message_b'), pg_temp.chat_id('pet_a'), pg_temp.chat_id('owner'), gen_random_uuid(), 'B', '2026-09-01 10:05Z'),
  (pg_temp.chat_id('message_c'), pg_temp.chat_id('pet_b'), pg_temp.chat_id('owner'), gen_random_uuid(), 'C', '2026-09-01 10:02Z'),
  (pg_temp.chat_id('message_d'), pg_temp.chat_id('pet_b'), pg_temp.chat_id('deleted_sender'), gen_random_uuid(), 'D', '2026-09-01 10:07Z'),
  (pg_temp.chat_id('message_other'), pg_temp.chat_id('pet_c'), pg_temp.chat_id('stranger'), gen_random_uuid(), 'other', '2026-09-01 10:03Z');
insert into public.chat_read_states(pet_id,user_id,last_read_at,last_read_message_id) values
  (pg_temp.chat_id('pet_a'),pg_temp.chat_id('member'),'2026-09-01 10:05Z',pg_temp.chat_id('message_b')),
  (pg_temp.chat_id('pet_b'),pg_temp.chat_id('member'),'2026-09-01 10:02Z',pg_temp.chat_id('message_c')),
  (pg_temp.chat_id('pet_a'),pg_temp.chat_id('owner'),'2026-09-01 10:05Z',pg_temp.chat_id('message_b'));
create temporary table chat_test_before as select id, sender_id, body, created_at, updated_at, pet_id
  from public.chat_messages where id in (select id from chat_test_ids where label like 'message_%');

create temporary table chat_test_release_before as select * from public.app_release_policy;
create temporary table chat_test_lock_before as select * from private.pre_cutover_release_lock;

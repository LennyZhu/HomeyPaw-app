-- All fixtures and mutations live only in the disposable schema clone.
begin;
create function public.prv_id(text) returns uuid language sql immutable
as $$ select md5('post-read-v1:' || $1)::uuid; $$;
create function public.prv_assert(ok boolean, label text) returns void language plpgsql
as $$ begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end; $$;
create function public.prv_error(command text, expected_code text, expected_message text default null)
returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = expected_code and (expected_message is null or position(expected_message in sqlerrm)>0) then return; end if;
    raise;
  end;
  raise exception 'Expected error %: %', expected_code, command;
end; $$;

insert into public.app_release_policy(platform,minimum_app_version,minimum_build,enforce_mutation_gate)
values('ios','1.2.0',9,true);
insert into auth.users(id,email,raw_user_meta_data)
select public.prv_id(label), label || '@post-read.invalid', jsonb_build_object('display_name',label,'locale','en')
from unnest(array['owner','author','member','viewer','removed','former','stranger','other-reader','delete-reader']) label;
insert into public.families(id) values(public.prv_id('family')),(public.prv_id('other'));
insert into public.family_members(family_id,user_id,role) values
(public.prv_id('family'),public.prv_id('owner'),'owner'),
(public.prv_id('family'),public.prv_id('author'),'member'),
(public.prv_id('family'),public.prv_id('member'),'member'),
(public.prv_id('family'),public.prv_id('viewer'),'viewer'),
(public.prv_id('family'),public.prv_id('removed'),'member'),
(public.prv_id('family'),public.prv_id('former'),'member'),
(public.prv_id('family'),public.prv_id('delete-reader'),'viewer'),
(public.prv_id('other'),public.prv_id('stranger'),'owner'),
(public.prv_id('other'),public.prv_id('other-reader'),'member');
insert into public.pets(id,name,species,family_id) values
(public.prv_id('pet'),'Read fixture','dog',public.prv_id('family')),
(public.prv_id('pet-delete'),'Delete fixture','dog',public.prv_id('family')),
(public.prv_id('other-pet'),'Other fixture','dog',public.prv_id('other'));
-- Canonical Member deliberately has no Pet mirror. Removed users keep stale
-- mirrors to prove compatibility rows cannot restore authorization.
delete from public.family_members where user_id in(public.prv_id('removed'),public.prv_id('former'));
insert into public.pet_members(pet_id,user_id,role)
select public.prv_id('pet'),public.prv_id(label),'member'::public.pet_member_role
from unnest(array['removed','former']) label;
insert into public.posts(id,pet_id,author_id,content) values
(public.prv_id('post'),public.prv_id('pet'),public.prv_id('author'),'Read receipt fixture'),
(public.prv_id('post-delete'),public.prv_id('pet'),public.prv_id('author'),'Post deletion fixture'),
(public.prv_id('post-pet-delete'),public.prv_id('pet-delete'),public.prv_id('author'),'Pet deletion fixture'),
(public.prv_id('other-post'),public.prv_id('other-pet'),public.prv_id('stranger'),'Other Family fixture'),
(public.prv_id('gated-post'),public.prv_id('pet'),public.prv_id('author'),'Gate fixture');

select public.prv_assert((select relrowsecurity from pg_class where oid='public.post_read_states'::regclass),'RLS enabled');
select public.prv_assert(not has_table_privilege('authenticated','public.post_read_states','SELECT,INSERT,UPDATE,DELETE'),'no direct client table privileges');
select public.prv_assert(not has_table_privilege('anon','public.post_read_states','SELECT,INSERT,UPDATE,DELETE'),'no anon table privileges');
select public.prv_assert(not has_table_privilege('service_role','public.post_read_states','SELECT,INSERT,UPDATE,DELETE'),'no unnecessary service table privileges');
select public.prv_assert(not has_function_privilege('anon','public.mark_post_read(uuid)','EXECUTE'),'anon mark denied');
select public.prv_assert(not has_function_privilege('service_role','public.get_post_readers(uuid)','EXECUTE'),'service RPC denied');
select public.prv_assert(not has_function_privilege('authenticated','private.lock_post_read_access(uuid)','EXECUTE'),'private helper not callable by client');

set request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.prv_id('author')::text,true);
set local role authenticated;
select public.prv_assert(public.mark_post_read(public.prv_id('post'))='author_skipped','author skipped');
select public.prv_assert((select count(*)=0 from public.get_post_readers(public.prv_id('post'))),'zero readers');
select public.prv_error('select * from public.post_read_states','42501');
select public.prv_error('insert into public.post_read_states(post_id,user_id) values(public.prv_id(''post''),public.prv_id(''author''))','42501');
select public.prv_error('update public.post_read_states set first_read_at=now()','42501');
select public.prv_error('delete from public.post_read_states','42501');
reset role;
select public.prv_assert((select count(*)=0 from public.post_read_states),'author wrote no row');

select set_config('request.jwt.claim.sub',public.prv_id('member')::text,true);
set local role authenticated;
select public.mark_post_read(public.prv_id('post'));
reset role;
select public.prv_assert((select count(*)=1 from public.post_read_states),'B first view one row');
update public.post_read_states set first_read_at='2026-09-01 10:00:00+00' where post_id=public.prv_id('post');
set local role authenticated;
select public.mark_post_read(public.prv_id('post'));
select public.mark_post_read(public.prv_id('post'));
select public.prv_assert((select count(*)=1 from public.get_post_readers(public.prv_id('post'))),'duplicate mark one visible reader');
select public.mark_post_read(public.prv_id('post-pet-delete'));
reset role;
select public.prv_assert((select count(*)=1 and min(first_read_at)='2026-09-01 10:00:00+00' from public.post_read_states where post_id=public.prv_id('post')),'first time unchanged');
select public.prv_assert((select count(*)=1 from public.post_read_states where user_id=public.prv_id('member') and post_id=public.prv_id('post-pet-delete')),'same Family second Pet authorized without Pet mirror');
select public.prv_error('insert into public.post_read_states(post_id,user_id) values(public.prv_id(''post''),public.prv_id(''member''))','23505');

select set_config('request.jwt.claim.sub',public.prv_id('owner')::text,true);
set local role authenticated;
select public.mark_post_read(public.prv_id('post'));
select set_config('request.jwt.claim.sub',public.prv_id('viewer')::text,true);
select public.mark_post_read(public.prv_id('post'));
select public.prv_assert((select count(*)=3 from public.get_post_readers(public.prv_id('post'))),'Owner Member Viewer all allowed');
select public.prv_assert((select reader_user_id=public.prv_id('member') and reader_display_name='member' and first_read_at='2026-09-01 10:00:00+00' from public.get_post_readers(public.prv_id('post')) limit 1),'minimal identity and first-time ascending');
select public.prv_error('select public.mark_post_read(public.prv_id(''missing''))','42501');
select public.prv_error('select * from public.get_post_readers(public.prv_id(''missing''))','42501');
select public.prv_error('select public.mark_post_read(public.prv_id(''other-post''))','42501');
select public.prv_error('select * from public.get_post_readers(public.prv_id(''other-post''))','42501');
select set_config('request.jwt.claim.sub',public.prv_id('stranger')::text,true);
select public.prv_error('select public.mark_post_read(public.prv_id(''post''))','42501');
select public.prv_error('select * from public.get_post_readers(public.prv_id(''post''))','42501');
select set_config('request.jwt.claim.sub',public.prv_id('removed')::text,true);
select public.prv_error('select public.mark_post_read(public.prv_id(''post''))','42501');
select public.prv_error('select * from public.get_post_readers(public.prv_id(''post''))','42501');
select set_config('request.jwt.claim.sub',public.prv_id('former')::text,true);
select public.prv_error('select public.mark_post_read(public.prv_id(''post''))','42501');
select public.prv_error('select * from public.get_post_readers(public.prv_id(''post''))','42501');
select set_config('request.jwt.claim.sub','',true);
select public.prv_error('select public.mark_post_read(public.prv_id(''post''))','42501');
reset role;

-- Removing a reader preserves the row but removes count/list and access.
delete from public.family_members where user_id=public.prv_id('member');
select public.prv_assert((select count(*)=2 from public.post_read_states where user_id=public.prv_id('member')),'removed history retained');
select set_config('request.jwt.claim.sub',public.prv_id('member')::text,true);
set local role authenticated;
select public.prv_error('select public.mark_post_read(public.prv_id(''post''))','42501');
select public.prv_error('select * from public.get_post_readers(public.prv_id(''post''))','42501');
select set_config('request.jwt.claim.sub',public.prv_id('owner')::text,true);
select public.prv_assert((select count(*)=2 from public.get_post_readers(public.prv_id('post'))),'removed reader not counted');

-- Real account preparation RPC, followed by the Auth deletion that the Edge
-- orchestrator performs. No Edge is invoked and no external objects exist.
select set_config('request.jwt.claim.sub',public.prv_id('delete-reader')::text,true);
select public.mark_post_read(public.prv_id('post'));
select public.prepare_account_deletion();
reset role;
set request.jwt.claim.role='service_role';
delete from auth.users where id=public.prv_id('delete-reader');
select public.prv_assert((select count(*)=1 from public.post_read_states where user_id is null),'anonymous history retained');
set request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.prv_id('viewer')::text,true);
set local role authenticated;
select public.prepare_account_deletion();
reset role;
set request.jwt.claim.role='service_role';
delete from auth.users where id=public.prv_id('viewer');
select public.prv_assert((select count(*)=2 from public.post_read_states where user_id is null),'multiple anonymous rows allowed');

-- Deleting the author preserves Post/media ownership and NULL-safe readers.
set request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.prv_id('author')::text,true);
set local role authenticated;
select public.prepare_account_deletion();
reset role;
set request.jwt.claim.role='service_role';
delete from auth.users where id=public.prv_id('author');
select public.prv_assert((select author_id is null from public.posts where id=public.prv_id('post')),'author retention unchanged');
set request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',public.prv_id('owner')::text,true);
set local role authenticated;
select public.prv_assert((select count(*)=1 from public.get_post_readers(public.prv_id('post'))),'NULL author does not hide remaining readers');
select public.mark_post_read(public.prv_id('post-delete'));
select public.mark_post_read(public.prv_id('post-pet-delete'));
reset role;
set request.jwt.claim.role='service_role';
delete from public.posts where id=public.prv_id('post-delete');
select public.prv_assert(not exists(select 1 from public.post_read_states where post_id=public.prv_id('post-delete')),'Post cascade');
set request.jwt.claim.role='authenticated';
set local role authenticated;
select public.delete_family_pet(public.prv_id('pet-delete'));
reset role;
select public.prv_assert(not exists(select 1 from public.posts where id=public.prv_id('post-pet-delete')) and not exists(select 1 from public.post_read_states where post_id=public.prv_id('post-pet-delete')),'Pet lifecycle cascade unchanged');

select set_config('request.jwt.claim.sub',public.prv_id('other-reader')::text,true);
set local role authenticated;
select public.mark_post_read(public.prv_id('other-post'));
select set_config('request.jwt.claim.sub',public.prv_id('stranger')::text,true);
select public.delete_family(public.prv_id('other'));
reset role;
select public.prv_assert(not exists(select 1 from public.post_read_states where post_id=public.prv_id('other-post')),'Family cascade');

-- Receipt INSERT must honor existing release guards without changing gates.
insert into private.pre_cutover_release_lock(singleton,enabled) values(true,true)
on conflict(singleton) do update set enabled=true;
set homeypaw.pre_cutover_migration_bypass='off';
select set_config('request.jwt.claim.sub',public.prv_id('owner')::text,true);
set local role authenticated;
select public.prv_error('select public.mark_post_read(public.prv_id(''gated-post''))','P0001','PRE_CUTOVER_RELEASE_LOCK');
reset role;
set homeypaw.pre_cutover_migration_bypass='on';
update public.app_release_policy set maintenance_mode=true where platform='ios';
select set_config('request.jwt.claim.sub',public.prv_id('owner')::text,true);
set local role authenticated;
select public.prv_error('select public.mark_post_read(public.prv_id(''gated-post''))','P0001','APP_MAINTENANCE');
reset role;
update public.app_release_policy set maintenance_mode=false where platform='ios';
set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.1.0","x-homeypaw-build":"1"}';
set local role authenticated;
select public.prv_error('select public.mark_post_read(public.prv_id(''gated-post''))','P0001','APP_UPDATE_REQUIRED');
reset role;
select public.prv_assert(not exists(select 1 from public.post_read_states where post_id=public.prv_id('gated-post')),'rejected writes left no row');
rollback;

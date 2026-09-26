-- Forward fix: CLI direct migrations log in as cli_login_postgres, not postgres.
-- Never trust current_user alone: SECURITY DEFINER API RPCs may run as postgres.
create or replace function private.assert_release_write_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select enabled from private.pre_cutover_release_lock where singleton) is distinct from false
     and not (
       session_user in ('postgres', 'cli_login_postgres')
       and pg_catalog.pg_has_role(session_user, 'postgres', 'MEMBER')
       and coalesce(pg_catalog.current_setting(
         'homeypaw.pre_cutover_migration_bypass', true
       ), '') = 'on'
     )
  then
    raise exception 'PRE_CUTOVER_RELEASE_LOCK' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function private.assert_release_write_allowed()
  from public, anon, authenticated, service_role;
-- No lock state, API grants, policies or triggers are changed.

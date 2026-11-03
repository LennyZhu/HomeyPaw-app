-- Explicit trusted database maintenance; no policy, Release Lock, RLS, grant,
-- owner or quota changes. CREATE OR REPLACE retains function identity and ACL.
create or replace function private.require_supported_client_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  policy public.app_release_policy%rowtype;
  request_headers jsonb;
  client_platform text;
  client_version text;
  client_build_text text;
  client_build integer;
  client_parts integer[];
  minimum_parts integer[];
  raw_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  raw_sub text := nullif(current_setting('request.jwt.claim.sub', true), '');
  raw_claims text := nullif(current_setting('request.jwt.claims', true), '');
  raw_headers text := nullif(current_setting('request.headers', true), '');
  raw_method text := nullif(current_setting('request.method', true), '');
  raw_path text := nullif(current_setting('request.path', true), '');
  raw_cookies text := nullif(current_setting('request.cookies', true), '');
  claims jsonb := '{}'::jsonb;
  jwt_role text;
  effective_sub text;
  execution_role text := nullif(current_setting('role', true), 'none');
begin
  -- session_user is the actual database login. current_user here is the
  -- SECURITY DEFINER owner, including when an ordinary App invokes this trigger.
  -- NULL and empty GUCs mean no context; whitespace, {} and malformed payloads
  -- are present context and never establish a maintenance identity.
  if session_user in ('postgres', 'cli_login_postgres')
    and pg_catalog.pg_has_role(session_user, 'postgres', 'MEMBER')
    and raw_role is null and raw_sub is null
    and raw_claims is null and raw_headers is null
    and raw_method is null and raw_path is null and raw_cookies is null
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  begin
    if raw_claims is not null then
      claims := raw_claims::jsonb;
      if jsonb_typeof(claims) is distinct from 'object' then
        raise exception 'APP_REQUEST_CONTEXT_INVALID' using errcode = 'P0001';
      end if;
    end if;
    request_headers := coalesce(raw_headers::jsonb, '{}'::jsonb);
    if jsonb_typeof(request_headers) is distinct from 'object'
      or (raw_role is not null and claims ->> 'role' is not null
          and raw_role is distinct from claims ->> 'role')
      or (raw_sub is not null and claims ->> 'sub' is not null
          and raw_sub is distinct from claims ->> 'sub')
    then
      raise exception 'APP_REQUEST_CONTEXT_INVALID' using errcode = 'P0001';
    end if;
    effective_sub := coalesce(raw_sub, claims ->> 'sub');
    if effective_sub is not null then perform effective_sub::uuid; end if;
  exception when invalid_text_representation then
    raise exception 'APP_REQUEST_CONTEXT_INVALID' using errcode = 'P0001';
  end;
  jwt_role := coalesce(raw_role, claims ->> 'role');

  -- Preserve genuine service-role API maintenance. SET ROLE is enforced by
  -- PostgreSQL privileges; a client-supplied JWT/GUC alone cannot select it.
  if execution_role = 'service_role' and jwt_role = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if execution_role is distinct from 'authenticated'
    or jwt_role is distinct from 'authenticated'
  then
    raise exception 'APP_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into policy from public.app_release_policy where platform = 'ios';
  if not found then
    raise exception 'APP_RELEASE_POLICY_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if policy.maintenance_mode then
    raise exception 'APP_MAINTENANCE' using errcode = 'P0001';
  end if;
  if not policy.enforce_mutation_gate then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  client_platform := lower(request_headers ->> 'x-homeypaw-platform');
  client_version := request_headers ->> 'x-homeypaw-app-version';
  client_build_text := request_headers ->> 'x-homeypaw-build';
  if client_platform is null or client_platform not in ('ios', 'android', 'web')
    or client_version is null
    or client_version !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
    or client_build_text is null
    or client_build_text !~ '^[0-9]{1,9}$'
  then
    raise exception 'APP_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;

  if client_platform = 'ios' then
    client_build := client_build_text::integer;
    client_parts := regexp_split_to_array(client_version, '\.')::integer[];
    minimum_parts := regexp_split_to_array(policy.minimum_app_version, '\.')::integer[];
    if client_parts < minimum_parts or
      (client_parts = minimum_parts and client_build < policy.minimum_build)
    then
      raise exception 'APP_UPDATE_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


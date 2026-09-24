-- R3: read-only client release policy. Seeded at current App Store 1.1.1 (5); gates stay disabled.
-- Raise the minimum and enable write enforcement only in an approved rollout.
create table public.app_release_policy (
  platform text primary key check (platform = 'ios'),
  minimum_app_version text not null check (
    minimum_app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
  ),
  minimum_build integer not null check (minimum_build > 0),
  recommended_app_version text check (
    recommended_app_version is null or
    recommended_app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
  ),
  maintenance_mode boolean not null default false,
  enforce_mutation_gate boolean not null default false,
  maintenance_message text check (
    maintenance_message is null or char_length(maintenance_message) <= 500
  ),
  updated_at timestamptz not null default now()
);

insert into public.app_release_policy (
  platform, minimum_app_version, minimum_build
) values ('ios', '1.1.1', 5);

alter table public.app_release_policy enable row level security;
revoke all on public.app_release_policy from public, anon, authenticated, service_role;
grant select on public.app_release_policy to anon, authenticated, service_role;
grant update on public.app_release_policy to service_role;
create policy app_release_policy_read on public.app_release_policy
  for select to anon, authenticated using (true);

create or replace function private.touch_app_release_policy()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_app_release_policy before update on public.app_release_policy
  for each row execute function private.touch_app_release_policy();

-- PostgREST places the caller's HTTP headers in request.headers. This is a
-- compatibility gate, not identity authorization: JWT/RLS remain authoritative.
-- An official old client sends no HomeyPaw headers and is rejected once enabled.
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
begin
  if auth.role() <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
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

  request_headers := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb
  );
  client_platform := lower(request_headers ->> 'x-homeypaw-platform');
  client_version := request_headers ->> 'x-homeypaw-app-version';
  client_build_text := request_headers ->> 'x-homeypaw-build';
  if client_platform not in ('ios', 'android', 'web')
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

-- These canonical tables cover create_pet/create_family_pet, family creation,
-- invite/join/leave/remove/transfer, and Family/Pet deletion even for direct RPCs.
create trigger require_supported_client_families
  before insert or update or delete on public.families
  for each row execute function private.require_supported_client_mutation();
create trigger require_supported_client_family_members
  before insert or update or delete on public.family_members
  for each row execute function private.require_supported_client_mutation();
create trigger require_supported_client_pets
  before insert or update or delete on public.pets
  for each row execute function private.require_supported_client_mutation();
create trigger require_supported_client_family_invites
  before insert or update or delete on public.family_invites
  for each row execute function private.require_supported_client_mutation();

revoke execute on function private.touch_app_release_policy()
  from public, anon, authenticated;
revoke execute on function private.require_supported_client_mutation()
  from public, anon, authenticated;

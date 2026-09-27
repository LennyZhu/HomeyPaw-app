begin;

-- Post-release Family Chat correction. Legacy Pet RPCs/topics stay available.
-- Explicit transaction required by the CLI runner for locks/atomic backfill.
-- No release policy/lock changes.
lock table public.chat_messages, public.chat_read_states, public.pets,
  public.family_members in share row exclusive mode;

alter table public.chat_messages add column family_id uuid
  references public.families(id) on delete cascade;

-- Fail closed rather than guess ownership or lose unmappable historical rows.
do $$
declare previous_bypass text;
begin
  if exists (
    select 1 from public.chat_messages m
    left join public.pets p on p.id = m.pet_id
    where p.family_id is null
  ) then
    raise exception 'CHAT_FAMILY_BACKFILL_UNMAPPABLE';
  end if;
  previous_bypass := current_setting('homeypaw.pre_cutover_migration_bypass', true);
  perform set_config('homeypaw.pre_cutover_migration_bypass', 'on', true);
  update public.chat_messages m set family_id = p.family_id
    from public.pets p where p.id = m.pet_id;
  perform set_config('homeypaw.pre_cutover_migration_bypass', coalesce(previous_bypass, ''), true);
end;
$$;

alter table public.chat_messages
  alter column family_id set not null,
  alter column pet_id drop not null,
  drop constraint chat_messages_pet_id_fkey,
  add constraint chat_messages_pet_id_fkey foreign key (pet_id)
    references public.pets(id) on delete set null;
create index chat_messages_family_cursor_idx
  on public.chat_messages(family_id, created_at desc, id desc);
comment on column public.chat_messages.family_id is 'Canonical Family Chat ownership.';
comment on column public.chat_messages.pet_id is 'Legacy Pet chat compatibility metadata; never the new room identity.';

create table public.family_chat_read_states (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default to_timestamp(0),
  last_read_message_id uuid not null default '00000000-0000-0000-0000-000000000000',
  updated_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- Minimum tuple across ALL rooms with history. Missing rooms contribute epoch.
-- This can repeat read notifications but cannot pass an existing unread boundary.
insert into public.family_chat_read_states(family_id, user_id, last_read_at, last_read_message_id)
select distinct on (fm.family_id, fm.user_id)
  fm.family_id, fm.user_id,
  coalesce(rs.last_read_at, to_timestamp(0)),
  coalesce(rs.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
from public.family_members fm
join public.pets p on p.family_id = fm.family_id
left join public.chat_read_states rs on rs.pet_id = p.id and rs.user_id = fm.user_id
where fm.role in ('owner', 'member')
  and exists (select 1 from public.chat_messages m where m.pet_id = p.id)
order by fm.family_id, fm.user_id,
  coalesce(rs.last_read_at, to_timestamp(0)),
  coalesce(rs.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid);

create table private.family_chat_states (
  family_id uuid primary key references public.families(id) on delete cascade,
  channel_version bigint not null default 1 check (channel_version > 0)
);
insert into private.family_chat_states(family_id) select id from public.families;
revoke all on private.family_chat_states from public, anon, authenticated, service_role;

create function private.can_use_family_chat(target_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members fm
    where fm.family_id = target_family_id and fm.user_id = (select auth.uid())
      and fm.role in ('owner', 'member'));
$$;

-- Old sends derive Family from the server-side Pet row, not a client claim.
create function private.set_chat_message_family()
returns trigger language plpgsql security definer set search_path = '' as $$
declare resolved_family uuid;
begin
  if tg_op = 'UPDATE' and new.family_id is distinct from old.family_id then
    raise exception 'chat family ownership is immutable' using errcode = '23514';
  end if;
  if new.pet_id is not null then
    select family_id into resolved_family from public.pets where id = new.pet_id;
    if resolved_family is null or
      (new.family_id is not null and new.family_id <> resolved_family) then
      raise exception 'chat family mismatch' using errcode = '23514';
    end if;
    new.family_id := resolved_family;
  end if;
  if new.family_id is null then
    raise exception 'chat family is required' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and auth.role() = 'authenticated'
    and (not private.can_use_family_chat(new.family_id)
      or new.sender_id is distinct from auth.uid()) then
    raise exception 'family not found' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger set_chat_message_family before insert or update of family_id, pet_id
  on public.chat_messages for each row execute function private.set_chat_message_family();

-- Shared table SELECT is canonical; legacy page RPC still filters by Pet.
drop policy "Active contributors can read pet chat messages" on public.chat_messages;
create policy "Active contributors can read family chat messages"
  on public.chat_messages for select to authenticated
  using ((select private.can_use_family_chat(family_id)));
alter table public.family_chat_read_states enable row level security;
revoke all on public.family_chat_read_states from public, anon, authenticated, service_role;
grant select on public.family_chat_read_states to authenticated;
create policy "Contributors can read their own family chat state"
  on public.family_chat_read_states for select to authenticated
  using (user_id = (select auth.uid()) and (select private.can_use_family_chat(family_id)));
create trigger pre_cutover_release_lock before insert or update or delete
  on public.family_chat_read_states for each row execute function private.assert_release_write_allowed();

create function private.family_chat_topic(target_family_id uuid, target_channel_version bigint)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.format('family:%s:chat:v%s', target_family_id, target_channel_version);
$$;
create function private.initialize_family_chat_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.family_chat_states(family_id) values (new.id);
  return new;
end;
$$;
create trigger initialize_family_chat_state after insert on public.families
  for each row execute function private.initialize_family_chat_state();

create function private.rotate_family_chat_channel(target_family_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare next_version bigint; recipient uuid;
begin
  -- Family deletion cascades are silent, matching legacy lifecycle behavior.
  if not exists (select 1 from public.families where id = target_family_id) then return; end if;
  update private.family_chat_states set channel_version = channel_version + 1
    where family_id = target_family_id returning channel_version into next_version;
  if next_version is null then return; end if;
  for recipient in select user_id from public.family_members
    where family_id = target_family_id and role in ('owner', 'member')
  loop
    perform realtime.send(jsonb_build_object('type', 'family_chat_channel_rotated',
      'family_id', target_family_id), 'family_chat_channel_rotated',
      private.user_chat_control_topic(recipient), true);
  end loop;
end;
$$;
create function private.rotate_family_chat_on_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.family_id = new.family_id and old.user_id = new.user_id
      and old.role is not distinct from new.role then return new; end if;
    perform private.rotate_family_chat_channel(old.family_id);
    if new.family_id <> old.family_id then perform private.rotate_family_chat_channel(new.family_id); end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform private.rotate_family_chat_channel(old.family_id);
    return old;
  end if;
  perform private.rotate_family_chat_channel(new.family_id);
  return new;
end;
$$;
create trigger rotate_family_chat_after_membership_change
  after insert or delete or update of family_id, user_id, role on public.family_members
  for each row execute function private.rotate_family_chat_on_membership();

create function private.can_receive_family_chat_broadcast(requested_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; requested_family uuid; requested_version bigint;
begin
  if auth.uid() is null then return false; end if;
  parts := regexp_match(requested_topic,
    '^family:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):chat:v([1-9][0-9]*)$');
  if parts is null then return false; end if;
  begin
    requested_family := parts[1]::uuid; requested_version := parts[2]::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then return false;
  end;
  return private.can_use_family_chat(requested_family) and exists (
    select 1 from private.family_chat_states
    where family_id = requested_family and channel_version = requested_version);
end;
$$;
create policy "Contributors can receive current family chat broadcasts"
  on realtime.messages for select to authenticated
  using (extension = 'broadcast' and
    (select private.can_receive_family_chat_broadcast((select realtime.topic()))));

-- Legacy signatures/topics remain, but their write lock and join authorization
-- must not treat a drifted mirror as authority after canonical membership loss.
create or replace function private.lock_pet_chat_membership(target_pet_id uuid)
returns public.pet_member_role language plpgsql security definer set search_path = '' as $$
declare caller_role public.pet_member_role;
begin
  select fm.role into caller_role from public.family_members fm
    join public.pets p on p.family_id = fm.family_id
    where p.id = target_pet_id and fm.user_id = auth.uid()
      and fm.role in ('owner', 'member') for share of fm;
  if caller_role is null then return null; end if;
  -- Family membership -> Pet -> legacy channel -> message, consistent with
  -- canonical membership removal. Prevent a send/Pet deletion FK lock race.
  perform 1 from public.pets where id = target_pet_id for key share;
  if not found then return null; end if;
  perform 1 from private.pet_chat_states where pet_id = target_pet_id for share;
  if not found then return null; end if;
  return caller_role;
end;
$$;
create or replace function private.can_receive_pet_chat_broadcast(requested_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; requested_pet uuid; requested_version bigint;
begin
  if auth.uid() is null then return false; end if;
  parts := regexp_match(requested_topic,
    '^pet:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):chat:v([1-9][0-9]*)$');
  if parts is null then return false; end if;
  begin
    requested_pet := parts[1]::uuid; requested_version := parts[2]::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then return false;
  end;
  return private.can_contribute_to_pet(requested_pet) and exists (
    select 1 from private.pet_chat_states where pet_id = requested_pet and channel_version = requested_version);
end;
$$;
-- CREATE OR REPLACE preserves the old grants; restate the private ACL explicitly.
revoke execute on function private.lock_pet_chat_membership(uuid) from public, anon, authenticated;
revoke execute on function private.can_receive_pet_chat_broadcast(text) from public, anon;
grant execute on function private.can_receive_pet_chat_broadcast(text) to authenticated;

create function private.lock_family_chat_membership(target_family_id uuid)
returns public.pet_member_role language plpgsql security definer set search_path = '' as $$
declare caller_role public.pet_member_role;
begin
  -- Match legacy lock ordering: membership -> channel state -> message.
  select role into caller_role from public.family_members
    where family_id = target_family_id and user_id = auth.uid()
      and role in ('owner', 'member') for share;
  if caller_role is null then return null; end if;
  perform 1 from private.family_chat_states where family_id = target_family_id for share;
  if not found then return null; end if;
  return caller_role;
end;
$$;

create function private.broadcast_family_chat_change(target_family_id uuid, change_type text, target_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare active_version bigint;
begin
  if not exists (select 1 from public.families where id = target_family_id) then return; end if;
  select channel_version into active_version from private.family_chat_states
    where family_id = target_family_id for share;
  if active_version is null then return; end if;
  perform realtime.send(jsonb_build_object('type', change_type, 'message_id', target_message_id),
    change_type, private.family_chat_topic(target_family_id, active_version), true);
end;
$$;
-- While minimum iOS remains 1.2.0 (9), legacy Pet writes must still broadcast
-- on their active Pet topic. The same row also notifies its Family topic.
-- Family writes have pet_id NULL: Family-only notification, no copies/fan-out.
-- Only expired channel versions go silent; active legacy Pet topics stay live.
create or replace function private.broadcast_chat_message_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pet_id is not null then
    perform private.broadcast_pet_chat_change(new.pet_id,
      case when tg_op = 'INSERT' then 'message_created' else 'message_updated' end, new.id);
  end if;
  perform private.broadcast_family_chat_change(new.family_id,
    case when tg_op = 'INSERT' then 'message_created' else 'message_updated' end, new.id);
  return new;
end;
$$;
create function private.broadcast_family_chat_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.broadcast_family_chat_change(old.family_id, 'message_deleted', old.id);
  return old;
end;
$$;
create trigger broadcast_family_chat_deletion after delete on public.chat_messages
  for each row execute function private.broadcast_family_chat_deletion();

create function public.get_family_chat_channel_version(target_family_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare active_version bigint;
begin
  if not private.can_use_family_chat(target_family_id) then
    raise exception 'family not found' using errcode = '42501'; end if;
  select channel_version into active_version from private.family_chat_states where family_id = target_family_id;
  if active_version is null then raise exception 'family not found' using errcode = '42501'; end if;
  return active_version;
end;
$$;
create function public.get_family_chat_messages_page(target_family_id uuid,
  before_created_at timestamptz default null, before_message_id uuid default null, requested_limit integer default 30)
returns setof public.chat_messages language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_use_family_chat(target_family_id) then raise exception 'family not found' using errcode = '42501'; end if;
  if (before_created_at is null) <> (before_message_id is null) then
    raise exception 'cursor requires timestamp and id' using errcode = '22023'; end if;
  return query select m.* from public.chat_messages m where m.family_id = target_family_id
    and (before_created_at is null or (m.created_at, m.id) < (before_created_at, before_message_id))
    order by m.created_at desc, m.id desc limit least(greatest(coalesce(requested_limit, 30), 1), 30);
end;
$$;
create function public.get_family_chat_members(target_family_id uuid)
returns table (member_user_id uuid, member_role public.pet_member_role, member_display_name text,
  member_avatar_url text, member_joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_use_family_chat(target_family_id) then raise exception 'family not found' using errcode = '42501'; end if;
  return query select fm.user_id, fm.role, p.display_name, p.avatar_url, fm.created_at
    from public.family_members fm join public.profiles p on p.id = fm.user_id
    where fm.family_id = target_family_id and fm.role in ('owner', 'member')
    order by case when fm.role = 'owner' then 0 else 1 end, fm.created_at, fm.user_id;
end;
$$;
create function public.send_family_chat_message(target_family_id uuid, target_client_message_id uuid, message_body text)
returns public.chat_messages language plpgsql security definer set search_path = '' as $$
declare safe_body text; result public.chat_messages;
begin
  if auth.uid() is null or private.lock_family_chat_membership(target_family_id) is null then
    raise exception 'family not found' using errcode = '42501'; end if;
  if target_client_message_id is null then raise exception 'client message id is required' using errcode = '22023'; end if;
  safe_body := btrim(coalesce(message_body, ''));
  if safe_body = '' or safe_body !~ '[^[:space:]]' or char_length(safe_body) > 2000 then
    raise exception 'invalid message body' using errcode = '23514'; end if;
  insert into public.chat_messages(family_id, sender_id, client_message_id, body)
    values (target_family_id, auth.uid(), target_client_message_id, safe_body)
    on conflict (sender_id, client_message_id) do nothing returning * into result;
  if result.id is null then
    select * into result from public.chat_messages where sender_id = auth.uid() and client_message_id = target_client_message_id;
    if result.id is null or result.family_id <> target_family_id or result.body <> safe_body then
      raise exception 'client message id conflict' using errcode = '23505'; end if;
  end if;
  return result;
end;
$$;
create function public.update_family_chat_message(target_message_id uuid, message_body text)
returns public.chat_messages language plpgsql security definer set search_path = '' as $$
declare message_family uuid; message_sender uuid; safe_body text; result public.chat_messages;
begin
  select family_id, sender_id into message_family, message_sender from public.chat_messages where id = target_message_id;
  if auth.uid() is null or message_sender is distinct from auth.uid()
    or private.lock_family_chat_membership(message_family) is null then
    raise exception 'message not found' using errcode = '42501'; end if;
  safe_body := btrim(coalesce(message_body, ''));
  if safe_body = '' or safe_body !~ '[^[:space:]]' or char_length(safe_body) > 2000 then
    raise exception 'invalid message body' using errcode = '23514'; end if;
  update public.chat_messages set body = safe_body, updated_at = now()
    where id = target_message_id and family_id = message_family and sender_id = auth.uid() returning * into result;
  if result.id is null then raise exception 'message not found' using errcode = '42501'; end if;
  return result;
end;
$$;
create function public.delete_family_chat_message(target_message_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare message_family uuid; message_sender uuid; caller_role public.pet_member_role; deleted_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select family_id, sender_id into message_family, message_sender from public.chat_messages where id = target_message_id;
  caller_role := private.lock_family_chat_membership(message_family);
  if caller_role is null or (message_sender is distinct from auth.uid() and caller_role <> 'owner') then return false; end if;
  delete from public.chat_messages where id = target_message_id returning id into deleted_id;
  return deleted_id is not null;
end;
$$;
create function public.mark_family_chat_read(target_family_id uuid, target_message_id uuid)
returns public.family_chat_read_states language plpgsql security definer set search_path = '' as $$
declare cursor_at timestamptz; result public.family_chat_read_states;
begin
  if auth.uid() is null or private.lock_family_chat_membership(target_family_id) is null then
    raise exception 'family not found' using errcode = '42501'; end if;
  select created_at into cursor_at from public.chat_messages
    where id = target_message_id and family_id = target_family_id for share;
  if cursor_at is null then raise exception 'message not found' using errcode = '42501'; end if;
  insert into public.family_chat_read_states(family_id, user_id, last_read_at, last_read_message_id)
    values (target_family_id, auth.uid(), cursor_at, target_message_id)
    on conflict (family_id, user_id) do update set last_read_at = excluded.last_read_at,
      last_read_message_id = excluded.last_read_message_id, updated_at = now()
    where (excluded.last_read_at, excluded.last_read_message_id) >
      (family_chat_read_states.last_read_at, family_chat_read_states.last_read_message_id)
    returning * into result;
  if result.family_id is null then
    select * into result from public.family_chat_read_states where family_id = target_family_id and user_id = auth.uid();
  end if;
  return result;
end;
$$;
create function public.get_family_chat_unread_count(target_family_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare result bigint;
begin
  if not private.can_use_family_chat(target_family_id) then raise exception 'family not found' using errcode = '42501'; end if;
  select count(*) into result from public.chat_messages m
    left join public.family_chat_read_states rs on rs.family_id = m.family_id and rs.user_id = auth.uid()
    where m.family_id = target_family_id and m.sender_id is distinct from auth.uid()
      and (m.created_at, m.id) > (coalesce(rs.last_read_at, to_timestamp(0)),
        coalesce(rs.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid));
  return result;
end;
$$;

revoke execute on function private.can_use_family_chat(uuid) from public, anon, authenticated, service_role;

revoke execute on function private.set_chat_message_family() from public, anon, authenticated, service_role;

revoke execute on function private.family_chat_topic(uuid, bigint) from public, anon, authenticated, service_role;

revoke execute on function private.initialize_family_chat_state() from public, anon, authenticated, service_role;

revoke execute on function private.rotate_family_chat_channel(uuid) from public, anon, authenticated, service_role;

revoke execute on function private.rotate_family_chat_on_membership() from public, anon, authenticated, service_role;

revoke execute on function private.can_receive_family_chat_broadcast(text) from public, anon, authenticated, service_role;

revoke execute on function private.lock_family_chat_membership(uuid) from public, anon, authenticated, service_role;

revoke execute on function private.broadcast_family_chat_change(uuid, text, uuid) from public, anon, authenticated, service_role;

revoke execute on function private.broadcast_family_chat_deletion() from public, anon, authenticated, service_role;
grant execute on function private.can_use_family_chat(uuid) to authenticated;
grant execute on function private.can_receive_family_chat_broadcast(text) to authenticated;

revoke execute on function public.get_family_chat_channel_version(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_family_chat_channel_version(uuid) to authenticated;

revoke execute on function public.get_family_chat_messages_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_family_chat_messages_page(uuid, timestamptz, uuid, integer) to authenticated;

revoke execute on function public.get_family_chat_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_family_chat_members(uuid) to authenticated;

revoke execute on function public.send_family_chat_message(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_family_chat_message(uuid, uuid, text) to authenticated;

revoke execute on function public.update_family_chat_message(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.update_family_chat_message(uuid, text) to authenticated;

revoke execute on function public.delete_family_chat_message(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_family_chat_message(uuid) to authenticated;

revoke execute on function public.mark_family_chat_read(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_family_chat_read(uuid, uuid) to authenticated;

revoke execute on function public.get_family_chat_unread_count(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_family_chat_unread_count(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

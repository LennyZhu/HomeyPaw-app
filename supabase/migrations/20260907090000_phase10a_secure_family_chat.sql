-- Phase 10A: one private family chat per pet.
-- PostgreSQL remains the source of truth; Realtime Broadcast carries only
-- invalidation hints and never contains message bodies or membership details.

create table private.pet_chat_states (
  pet_id uuid primary key references public.pets (id) on delete cascade,
  channel_version bigint not null default 1,
  membership_initialized boolean not null default false,
  constraint pet_chat_states_channel_version_positive
    check (channel_version > 0)
);

comment on table private.pet_chat_states is
  'Server-only version state for each pet private chat Broadcast topic.';

revoke all on table private.pet_chat_states from public, anon, authenticated;

insert into private.pet_chat_states (pet_id, membership_initialized)
select pet.id, true
from public.pets as pet
on conflict (pet_id) do nothing;

create or replace function private.initialize_pet_chat_state()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into private.pet_chat_states (pet_id)
  values (new.id);
  return new;
end;
$$;

create trigger initialize_pet_chat_state_after_pet_insert
after insert on public.pets
for each row execute function private.initialize_pet_chat_state();

revoke execute on function private.initialize_pet_chat_state()
  from public, anon, authenticated;

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  client_message_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_messages_body_length
    check (
      char_length(body) between 1 and 2000
      and body = btrim(body)
      and body ~ '[^[:space:]]'
    ),
  constraint chat_messages_sender_client_id_unique
    unique (sender_id, client_message_id)
);

comment on table public.chat_messages is
  'Text-only private family chat messages. Sender identity is bound by secure RPC.';
comment on column public.chat_messages.client_message_id is
  'Client-generated retry key. Unique per authenticated sender.';

create index chat_messages_pet_cursor_idx
  on public.chat_messages (pet_id, created_at desc, id desc);

create table public.chat_read_states (
  pet_id uuid not null references public.pets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default to_timestamp(0),
  last_read_message_id uuid not null default '00000000-0000-0000-0000-000000000000',
  updated_at timestamptz not null default now(),
  primary key (pet_id, user_id)
);

comment on table public.chat_read_states is
  'Per-user, per-pet chat read cursor. Users can access only their own row.';
comment on column public.chat_read_states.last_read_message_id is
  'Stable cursor tie-breaker retained even if the referenced message is later deleted.';

create index chat_read_states_user_pet_idx
  on public.chat_read_states (user_id, pet_id);

alter table public.chat_messages enable row level security;
alter table public.chat_read_states enable row level security;

revoke all on table public.chat_messages from anon, authenticated;
revoke all on table public.chat_read_states from anon, authenticated;

grant select on table public.chat_messages to authenticated;
grant select on table public.chat_read_states to authenticated;

create policy "Active contributors can read pet chat messages"
  on public.chat_messages
  for select
  to authenticated
  using ((select private.can_contribute_to_pet(pet_id)));

create policy "Active contributors can read their own chat state"
  on public.chat_read_states
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.can_contribute_to_pet(pet_id))
  );

create or replace function private.pet_chat_topic(
  target_pet_id uuid,
  target_channel_version bigint
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.format(
    'pet:%s:chat:v%s',
    target_pet_id::text,
    target_channel_version::text
  );
$$;

create or replace function private.user_chat_control_topic(
  target_user_id uuid
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.format(
    'user:%s:chat-control',
    target_user_id::text
  );
$$;

create or replace function private.can_receive_pet_chat_broadcast(
  requested_topic text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_parts text[];
  requested_pet_id uuid;
  requested_version bigint;
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  topic_parts := pg_catalog.regexp_match(
    requested_topic,
    '^pet:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):chat:v([1-9][0-9]*)$'
  );

  if topic_parts is null then
    return false;
  end if;

  begin
    requested_pet_id := topic_parts[1]::uuid;
    requested_version := topic_parts[2]::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return false;
  end;

  return exists (
    select 1
    from private.pet_chat_states as state
    join public.pet_members as membership
      on membership.pet_id = state.pet_id
    where state.pet_id = requested_pet_id
      and state.channel_version = requested_version
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'member')
  );
end;
$$;

create or replace function private.can_receive_chat_control_broadcast(
  requested_topic text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and requested_topic = private.user_chat_control_topic(
      (select auth.uid())
    );
$$;

revoke execute on function private.pet_chat_topic(uuid, bigint)
  from public, anon, authenticated;
revoke execute on function private.user_chat_control_topic(uuid)
  from public, anon, authenticated;
revoke execute on function private.can_receive_pet_chat_broadcast(text)
  from public, anon;
revoke execute on function private.can_receive_chat_control_broadcast(text)
  from public, anon;
grant execute on function private.can_receive_pet_chat_broadcast(text)
  to authenticated;
grant execute on function private.can_receive_chat_control_broadcast(text)
  to authenticated;

create policy "Active contributors can receive current pet chat broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and (
      select private.can_receive_pet_chat_broadcast(
        (select realtime.topic())
      )
    )
  );

create policy "Users can receive only their own chat control broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and (
      select private.can_receive_chat_control_broadcast(
        (select realtime.topic())
      )
    )
  );

create or replace function private.broadcast_pet_chat_change(
  target_pet_id uuid,
  change_type text,
  target_message_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  active_channel_version bigint;
begin
  if change_type not in (
    'message_created',
    'message_updated',
    'message_deleted'
  ) or target_message_id is null then
    raise exception 'invalid chat broadcast' using errcode = '22023';
  end if;

  select state.channel_version into active_channel_version
  from private.pet_chat_states as state
  where state.pet_id = target_pet_id
  for share;

  if active_channel_version is null then
    return;
  end if;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'type', change_type,
      'message_id', target_message_id
    ),
    change_type,
    private.pet_chat_topic(target_pet_id, active_channel_version),
    true
  );
end;
$$;

create or replace function private.broadcast_pet_chat_rotation(
  target_pet_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
begin
  for recipient_id in
    select membership.user_id
    from public.pet_members as membership
    where membership.pet_id = target_pet_id
      and membership.role in ('owner', 'member')
  loop
    perform realtime.send(
      pg_catalog.jsonb_build_object(
        'type', 'chat_channel_rotated',
        'pet_id', target_pet_id
      ),
      'chat_channel_rotated',
      private.user_chat_control_topic(recipient_id),
      true
    );
  end loop;
end;
$$;

create or replace function private.rotate_pet_chat_channel(
  target_pet_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  state_is_initialized boolean;
begin
  -- A cascading Pet deletion must be completely silent. The parent row is no
  -- longer visible in this transaction, even if sibling memberships have not
  -- all reached their row trigger yet.
  if not exists (
    select 1
    from public.pets as pet
    where pet.id = target_pet_id
  ) then
    return;
  end if;

  select
    state.membership_initialized
  into state_is_initialized
  from private.pet_chat_states as state
  where state.pet_id = target_pet_id
  for update;

  if not found then
    -- State is initialized by the Pet insert trigger and is never recreated
    -- from a membership cascade.
    return;
  end if;

  if not state_is_initialized then
    -- The first owner membership establishes v1; there is no old audience.
    update private.pet_chat_states
    set membership_initialized = true
    where pet_id = target_pet_id;
    return;
  end if;

  update private.pet_chat_states
  set channel_version = channel_version + 1
  where pet_id = target_pet_id;

  -- The old Pet topic is deliberately silent forever after rotation. Notify
  -- only users who still contribute after the membership row mutation.
  perform private.broadcast_pet_chat_rotation(target_pet_id);
end;
$$;

create or replace function private.rotate_pet_chat_channel_on_membership()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.pet_id = new.pet_id
      and old.user_id = new.user_id
      and old.role is not distinct from new.role
    then
      return new;
    end if;

    perform private.rotate_pet_chat_channel(old.pet_id);
    if new.pet_id <> old.pet_id then
      perform private.rotate_pet_chat_channel(new.pet_id);
    end if;
    return new;
  end if;

  perform private.rotate_pet_chat_channel(
    case when tg_op = 'DELETE' then old.pet_id else new.pet_id end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger rotate_pet_chat_channel_after_membership_change
after insert or delete or update of pet_id, user_id, role
on public.pet_members
for each row execute function private.rotate_pet_chat_channel_on_membership();

create or replace function private.broadcast_chat_message_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_pet_chat_change(
    new.pet_id,
    case
      when tg_op = 'INSERT' then 'message_created'
      else 'message_updated'
    end,
    new.id
  );
  return new;
end;
$$;

create trigger broadcast_chat_message_mutation
after insert or update on public.chat_messages
for each row execute function private.broadcast_chat_message_mutation();

revoke execute on function private.broadcast_pet_chat_change(uuid, text, uuid)
  from public, anon, authenticated;
revoke execute on function private.broadcast_pet_chat_rotation(uuid)
  from public, anon, authenticated;
revoke execute on function private.rotate_pet_chat_channel(uuid)
  from public, anon, authenticated;
revoke execute on function private.rotate_pet_chat_channel_on_membership()
  from public, anon, authenticated;
revoke execute on function private.broadcast_chat_message_mutation()
  from public, anon, authenticated;

create or replace function private.lock_pet_chat_membership(
  target_pet_id uuid
)
returns public.pet_member_role
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_role public.pet_member_role;
begin
  select membership.role into caller_role
  from public.pet_members as membership
  where membership.pet_id = target_pet_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'member')
  for share;

  if caller_role is null then
    return null;
  end if;

  -- Membership mutation triggers take an UPDATE lock on the same state row.
  -- Holding SHARE here orders message writes before or after version rotation.
  perform 1
  from private.pet_chat_states as state
  where state.pet_id = target_pet_id
  for share;

  if not found then
    return null;
  end if;

  return caller_role;
end;
$$;

revoke execute on function private.lock_pet_chat_membership(uuid)
  from public, anon, authenticated;

create or replace function public.get_pet_chat_channel_version(
  target_pet_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_channel_version bigint;
begin
  if (select auth.uid()) is null
    or not private.can_contribute_to_pet(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select state.channel_version into active_channel_version
  from private.pet_chat_states as state
  where state.pet_id = target_pet_id;

  if active_channel_version is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return active_channel_version;
end;
$$;

create or replace function public.get_chat_messages_page(
  target_pet_id uuid,
  before_created_at timestamptz default null,
  before_message_id uuid default null,
  requested_limit integer default 30
)
returns table (
  id uuid,
  pet_id uuid,
  sender_id uuid,
  client_message_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not private.can_contribute_to_pet(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if (before_created_at is null) <> (before_message_id is null) then
    raise exception 'cursor requires timestamp and id' using errcode = '22023';
  end if;

  return query
  select
    message.id,
    message.pet_id,
    message.sender_id,
    message.client_message_id,
    message.body,
    message.created_at,
    message.updated_at
  from public.chat_messages as message
  where message.pet_id = target_pet_id
    and (
      before_created_at is null
      or (message.created_at, message.id) < (
        before_created_at,
        before_message_id
      )
    )
  order by message.created_at desc, message.id desc
  limit least(greatest(coalesce(requested_limit, 30), 1), 30);
end;
$$;

create or replace function public.send_chat_message(
  target_pet_id uuid,
  target_client_message_id uuid,
  message_body text
)
returns public.chat_messages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  safe_body text;
  created_message public.chat_messages;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_pet_id is null or target_client_message_id is null then
    raise exception 'pet and client message ids are required'
      using errcode = '22023';
  end if;

  caller_role := private.lock_pet_chat_membership(target_pet_id);
  if caller_role is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  safe_body := btrim(coalesce(message_body, ''));

  if safe_body = '' or safe_body !~ '[^[:space:]]' then
    raise exception 'message cannot be empty' using errcode = '23514';
  end if;

  if char_length(safe_body) > 2000 then
    raise exception 'message is too long' using errcode = '23514';
  end if;

  insert into public.chat_messages (
    pet_id,
    sender_id,
    client_message_id,
    body
  )
  values (
    target_pet_id,
    caller_id,
    target_client_message_id,
    safe_body
  )
  on conflict (sender_id, client_message_id) do nothing
  returning * into created_message;

  if created_message.id is null then
    select message.* into created_message
    from public.chat_messages as message
    where message.sender_id = caller_id
      and message.client_message_id = target_client_message_id;

    if created_message.id is null
      or created_message.pet_id <> target_pet_id
      or created_message.body <> safe_body
    then
      raise exception 'client message id conflict' using errcode = '23505';
    end if;
  end if;

  return created_message;
end;
$$;

create or replace function public.update_chat_message(
  target_message_id uuid,
  message_body text
)
returns public.chat_messages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  message_pet_id uuid;
  message_sender_id uuid;
  safe_body text;
  updated_message public.chat_messages;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_message_id is null then
    raise exception 'message id is required' using errcode = '22023';
  end if;

  safe_body := btrim(coalesce(message_body, ''));

  if safe_body = '' or safe_body !~ '[^[:space:]]' then
    raise exception 'message cannot be empty' using errcode = '23514';
  end if;

  if char_length(safe_body) > 2000 then
    raise exception 'message is too long' using errcode = '23514';
  end if;

  -- Read only routing/ownership columns before taking locks. Every mutating
  -- Chat RPC then locks membership -> channel state -> message in that order.
  select message.pet_id, message.sender_id
  into message_pet_id, message_sender_id
  from public.chat_messages as message
  where message.id = target_message_id;

  if message_pet_id is null or message_sender_id <> caller_id then
    raise exception 'message not found' using errcode = '42501';
  end if;

  caller_role := private.lock_pet_chat_membership(message_pet_id);
  if caller_role is null then
    raise exception 'message not found' using errcode = '42501';
  end if;

  update public.chat_messages as message
  set
    body = safe_body,
    updated_at = now()
  where message.id = target_message_id
    and message.pet_id = message_pet_id
    and message.sender_id = caller_id
  returning message.* into updated_message;

  if updated_message.id is null then
    raise exception 'message not found' using errcode = '42501';
  end if;

  return updated_message;
end;
$$;

create or replace function public.delete_chat_message(
  target_message_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  deleted_pet_id uuid;
  message_pet_id uuid;
  message_sender_id uuid;
  caller_role public.pet_member_role;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select message.pet_id, message.sender_id
  into message_pet_id, message_sender_id
  from public.chat_messages as message
  where message.id = target_message_id;

  if message_pet_id is null then
    return false;
  end if;

  caller_role := private.lock_pet_chat_membership(message_pet_id);
  if caller_role is null
    or (message_sender_id <> caller_id and caller_role <> 'owner')
  then
    return false;
  end if;

  delete from public.chat_messages as message
  where message.id = target_message_id
  returning message.pet_id into deleted_pet_id;

  if deleted_pet_id is null then
    return false;
  end if;

  perform private.broadcast_pet_chat_change(
    deleted_pet_id,
    'message_deleted',
    target_message_id
  );

  return true;
end;
$$;

create or replace function public.mark_chat_read(
  target_pet_id uuid,
  target_message_id uuid
)
returns public.chat_read_states
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  visible_message_created_at timestamptz;
  read_state public.chat_read_states;
begin
  caller_id := auth.uid();

  if caller_id is null or target_message_id is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  caller_role := private.lock_pet_chat_membership(target_pet_id);
  if caller_role is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  -- Resolve the last actually visible message on the server. The client can
  -- never submit a timestamp, so it cannot move the cursor into the future.
  select message.created_at into visible_message_created_at
  from public.chat_messages as message
  where message.id = target_message_id
    and message.pet_id = target_pet_id
  for share;

  if visible_message_created_at is null then
    raise exception 'message not found' using errcode = '42501';
  end if;

  insert into public.chat_read_states (
    pet_id,
    user_id,
    last_read_at,
    last_read_message_id,
    updated_at
  )
  values (
    target_pet_id,
    caller_id,
    visible_message_created_at,
    target_message_id,
    now()
  )
  on conflict (pet_id, user_id) do update
  set
    last_read_at = case
      when (
        excluded.last_read_at,
        excluded.last_read_message_id
      ) > (
        public.chat_read_states.last_read_at,
        public.chat_read_states.last_read_message_id
      ) then excluded.last_read_at
      else public.chat_read_states.last_read_at
    end,
    last_read_message_id = case
      when (
        excluded.last_read_at,
        excluded.last_read_message_id
      ) > (
        public.chat_read_states.last_read_at,
        public.chat_read_states.last_read_message_id
      ) then excluded.last_read_message_id
      else public.chat_read_states.last_read_message_id
    end,
    updated_at = case
      when (
        excluded.last_read_at,
        excluded.last_read_message_id
      ) > (
        public.chat_read_states.last_read_at,
        public.chat_read_states.last_read_message_id
      ) then now()
      else public.chat_read_states.updated_at
    end
  returning public.chat_read_states.* into read_state;

  return read_state;
end;
$$;

create or replace function public.get_chat_unread_count(
  target_pet_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  unread_count bigint;
  read_cursor_at timestamptz;
  read_cursor_id uuid;
begin
  caller_id := auth.uid();

  if caller_id is null
    or not private.can_contribute_to_pet(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select
    read_state.last_read_at,
    read_state.last_read_message_id
  into read_cursor_at, read_cursor_id
  from public.chat_read_states as read_state
  where read_state.pet_id = target_pet_id
    and read_state.user_id = caller_id;

  select count(*) into unread_count
  from public.chat_messages as message
  where message.pet_id = target_pet_id
    and message.sender_id <> caller_id
    and (message.created_at, message.id) > (
      coalesce(read_cursor_at, to_timestamp(0)),
      coalesce(
        read_cursor_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    );

  return unread_count;
end;
$$;

create or replace function public.get_pet_chat_members(
  target_pet_id uuid
)
returns table (
  member_user_id uuid,
  member_role public.pet_member_role,
  member_display_name text,
  member_avatar_url text,
  member_joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not private.can_contribute_to_pet(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  return query
  select
    membership.user_id,
    membership.role,
    profile.display_name,
    profile.avatar_url,
    membership.created_at
  from public.pet_members as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.pet_id = target_pet_id
    and membership.role in ('owner', 'member')
  order by
    case when membership.role = 'owner' then 0 else 1 end,
    membership.created_at,
    membership.user_id;
end;
$$;

revoke execute on function public.get_pet_chat_channel_version(uuid)
  from public, anon;
revoke execute on function public.get_chat_messages_page(uuid, timestamptz, uuid, integer)
  from public, anon;
revoke execute on function public.send_chat_message(uuid, uuid, text)
  from public, anon;
revoke execute on function public.update_chat_message(uuid, text)
  from public, anon;
revoke execute on function public.delete_chat_message(uuid)
  from public, anon;
revoke execute on function public.mark_chat_read(uuid, uuid)
  from public, anon;
revoke execute on function public.get_chat_unread_count(uuid)
  from public, anon;
revoke execute on function public.get_pet_chat_members(uuid)
  from public, anon;

grant execute on function public.get_pet_chat_channel_version(uuid)
  to authenticated;
grant execute on function public.get_chat_messages_page(uuid, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.send_chat_message(uuid, uuid, text)
  to authenticated;
grant execute on function public.update_chat_message(uuid, text)
  to authenticated;
grant execute on function public.delete_chat_message(uuid)
  to authenticated;
grant execute on function public.mark_chat_read(uuid, uuid)
  to authenticated;
grant execute on function public.get_chat_unread_count(uuid)
  to authenticated;
grant execute on function public.get_pet_chat_members(uuid)
  to authenticated;

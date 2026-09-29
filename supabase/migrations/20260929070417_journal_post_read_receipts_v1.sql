begin;

create table public.post_read_states (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  first_read_at timestamptz not null default now(),
  unique (post_id, user_id)
);

comment on table public.post_read_states is
  'First active Post view per reader. Anonymous historical rows are retained, never returned to clients.';
alter table public.post_read_states enable row level security;
revoke all on public.post_read_states from public, anon, authenticated, service_role;

create trigger pre_cutover_release_lock
before insert or update or delete on public.post_read_states
for each row execute function private.assert_release_write_allowed();
create trigger require_supported_client_post_reads
before insert or update or delete on public.post_read_states
for each row execute function private.require_supported_client_mutation();

-- Resolve scope on the server. Match canonical Family lock order, then lock the
-- actor before membership to serialize safely with account preparation/deletion.
create function private.lock_post_read_access(target_post_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_family_id uuid;
  target_post public.posts;
begin
  if caller_id is null then
    raise exception 'post not found' using errcode = '42501';
  end if;

  select pet.family_id into target_family_id
  from public.posts as post
  join public.pets as pet on pet.id = post.pet_id
  where post.id = target_post_id;
  if target_family_id is null then
    raise exception 'post not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );
  perform users.id from auth.users as users where users.id = caller_id for key share;
  if not found then
    raise exception 'post not found' using errcode = '42501';
  end if;

  select post.* into target_post
  from public.posts as post
  join public.pets as pet on pet.id = post.pet_id
  join public.family_members as membership on membership.family_id = pet.family_id
  where post.id = target_post_id
    and pet.family_id = target_family_id
    and membership.user_id = caller_id
    and membership.role in ('owner', 'member', 'viewer')
  for share of post, pet, membership;
  if target_post.id is null then
    raise exception 'post not found' using errcode = '42501';
  end if;
  return target_post;
end;
$$;
revoke execute on function private.lock_post_read_access(uuid)
  from public, anon, authenticated, service_role;

create function public.mark_post_read(target_post_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post public.posts;
begin
  target_post := private.lock_post_read_access(target_post_id);
  if target_post.author_id is not distinct from auth.uid() then
    return 'author_skipped';
  end if;
  insert into public.post_read_states(post_id, user_id)
  values (target_post.id, auth.uid())
  on conflict (post_id, user_id) do nothing;
  return 'recorded';
end;
$$;

create function public.get_post_readers(target_post_id uuid)
returns table (
  reader_user_id uuid,
  reader_display_name text,
  reader_avatar_path text,
  first_read_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post public.posts;
begin
  target_post := private.lock_post_read_access(target_post_id);
  return query
  select receipt.user_id, profile.display_name, profile.avatar_url, receipt.first_read_at
  from public.post_read_states as receipt
  join public.pets as pet on pet.id = target_post.pet_id
  join public.family_members as membership
    on membership.family_id = pet.family_id and membership.user_id = receipt.user_id
  join public.profiles as profile on profile.id = receipt.user_id
  where receipt.post_id = target_post.id
    and receipt.user_id is not null
    and receipt.user_id is distinct from target_post.author_id
    and membership.role in ('owner', 'member', 'viewer')
  order by receipt.first_read_at, receipt.id;
end;
$$;

revoke execute on function public.mark_post_read(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.get_post_readers(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_post_read(uuid) to authenticated;
grant execute on function public.get_post_readers(uuid) to authenticated;

commit;

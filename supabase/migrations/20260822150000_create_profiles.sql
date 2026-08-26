create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  locale text not null default 'zh-HK',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (
      char_length(display_name) between 1 and 80
      and display_name ~ '[^[:space:]]'
    ),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint profiles_locale_supported
    check (locale in ('zh-HK', 'en'))
);

comment on table public.profiles is
  'Private application profile for one Supabase Auth user.';

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url, locale)
  on table public.profiles to authenticated;

create policy "Users can read only their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update only their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_name text;
  safe_display_name text;
  safe_locale text;
begin
  metadata_name := nullif(
    regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'display_name', ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  if metadata_name is not null and metadata_name !~ '[^[:space:]]' then
    metadata_name := null;
  end if;
  safe_display_name := left(
    coalesce(
      metadata_name,
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'HomeyPaw user'
    ),
    80
  );
  safe_locale := case
    when new.raw_user_meta_data ->> 'locale' in ('zh-HK', 'en')
      then new.raw_user_meta_data ->> 'locale'
    else 'zh-HK'
  end;

  insert into public.profiles (id, display_name, locale)
  values (new.id, safe_display_name, safe_locale)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_profile_updated_at() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name, locale)
select
  users.id,
  left(
    coalesce(
      nullif(
        regexp_replace(
          coalesce(users.raw_user_meta_data ->> 'display_name', ''),
          '^[[:space:]]+|[[:space:]]+$',
          '',
          'g'
        ),
        ''
      ),
      nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
      'HomeyPaw user'
    ),
    80
  ),
  case
    when users.raw_user_meta_data ->> 'locale' in ('zh-HK', 'en')
      then users.raw_user_meta_data ->> 'locale'
    else 'zh-HK'
  end
from auth.users as users
on conflict (id) do nothing;

comment on column public.profiles.avatar_url is
  'Object path in the private profile-avatars Storage bucket.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.profile_avatar_owner_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(pg_catalog.split_part(object_name, '/', 1), '')::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function private.can_read_profile_avatar(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and (
      private.profile_avatar_owner_id(object_name) = auth.uid()
      or exists (
        select 1
        from public.pet_members as viewer_membership
        join public.pet_members as avatar_membership
          on avatar_membership.pet_id = viewer_membership.pet_id
          and avatar_membership.user_id = private.profile_avatar_owner_id(object_name)
        where viewer_membership.user_id = auth.uid()
      )
    );
$$;

create or replace function private.validate_profile_avatar_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_url is distinct from old.avatar_url
    and new.avatar_url is not null
    and private.profile_avatar_owner_id(new.avatar_url) is distinct from new.id
  then
    raise exception 'invalid profile avatar path' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_profile_avatar_path
before update of avatar_url on public.profiles
for each row execute function private.validate_profile_avatar_path();

revoke execute on function private.profile_avatar_owner_id(text)
  from public, anon;
revoke execute on function private.can_read_profile_avatar(text)
  from public, anon;
revoke execute on function private.validate_profile_avatar_path()
  from public, anon, authenticated;
grant execute on function private.profile_avatar_owner_id(text)
  to authenticated;
grant execute on function private.can_read_profile_avatar(text)
  to authenticated;

create policy "Family members can read profile avatars"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (select private.can_read_profile_avatar(name))
  );

create policy "Users can upload their own profile avatars"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and private.profile_avatar_owner_id(name) = (select auth.uid())
  );

create policy "Users can replace their own profile avatars"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and private.profile_avatar_owner_id(name) = (select auth.uid())
  )
  with check (
    bucket_id = 'profile-avatars'
    and private.profile_avatar_owner_id(name) = (select auth.uid())
  );

create policy "Users can delete their own profile avatars"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and private.profile_avatar_owner_id(name) = (select auth.uid())
  );

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

drop function public.get_pet_members(uuid);

create function public.get_pet_members(target_pet_id uuid)
returns table (
  member_user_id uuid,
  member_role public.pet_member_role,
  member_display_name text,
  member_avatar_path text,
  member_joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_pet_member(target_pet_id) then
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
  order by
    case when membership.role = 'owner' then 0 else 1 end,
    membership.created_at,
    membership.user_id;
end;
$$;

drop function public.get_care_schedule_range(uuid, date, date);

create function public.get_care_schedule_range(
  target_pet_id uuid,
  range_start date,
  range_end date
)
returns table (
  shift_id uuid,
  pet_id uuid,
  local_date date,
  assignee_user_id uuid,
  assignee_display_name text,
  assignee_avatar_path text,
  shift_status public.care_schedule_status,
  shift_note text,
  claimed_at timestamptz,
  shift_canceled_at timestamptz,
  split_from_shift_id uuid,
  shift_task_id uuid,
  care_task_id uuid,
  source_scheduled_for timestamptz,
  shift_task_status public.care_schedule_status,
  shift_task_canceled_at timestamptz,
  task_title text,
  task_care_type public.care_type,
  task_note text,
  task_time_zone text,
  completion_id uuid,
  completed_by uuid,
  completer_display_name text,
  completed_at timestamptz,
  care_log_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not private.has_care_schedule_access(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if range_start is null or range_end is null
    or range_end <= range_start
    or range_end - range_start > 42
  then
    raise exception 'invalid schedule range' using errcode = '22023';
  end if;

  return query
  select
    shift.id,
    shift.pet_id,
    shift.local_date,
    shift.assignee_user_id,
    case
      when assignee_membership.user_id is not null
        then assignee_profile.display_name
      else null
    end,
    case
      when assignee_membership.user_id is not null
        then assignee_profile.avatar_url
      else null
    end,
    shift.status,
    shift.note,
    shift.claimed_at,
    shift.canceled_at,
    shift.split_from_shift_id,
    shift_task.id,
    shift_task.care_task_id,
    shift_task.source_scheduled_for,
    shift_task.status,
    shift_task.canceled_at,
    task.title,
    task.care_type,
    task.note,
    task.time_zone,
    completion.id,
    completion.completed_by,
    completer_profile.display_name,
    completion.completed_at,
    completion.care_log_id
  from public.care_shifts as shift
  join public.care_shift_tasks as shift_task
    on shift_task.shift_id = shift.id
    and shift_task.pet_id = shift.pet_id
  join public.care_tasks as task
    on task.id = shift_task.care_task_id
    and task.pet_id = shift_task.pet_id
  left join public.pet_members as assignee_membership
    on assignee_membership.pet_id = shift.pet_id
    and assignee_membership.user_id = shift.assignee_user_id
    and assignee_membership.role in ('owner', 'member')
  left join public.profiles as assignee_profile
    on assignee_profile.id = assignee_membership.user_id
  left join public.care_task_completions as completion
    on completion.care_shift_task_id = shift_task.id
    or (
      completion.care_shift_task_id is null
      and completion.task_id = shift_task.care_task_id
      and completion.scheduled_for = shift_task.source_scheduled_for
    )
  left join public.profiles as completer_profile
    on completer_profile.id = completion.completed_by
  where shift.pet_id = target_pet_id
    and shift.local_date >= range_start
    and shift.local_date < range_end
  order by
    shift.local_date,
    shift_task.source_scheduled_for,
    shift.id,
    shift_task.id;
end;
$$;

revoke execute on function public.get_pet_chat_members(uuid)
  from public, anon;
revoke execute on function public.get_pet_members(uuid)
  from public, anon;
revoke execute on function public.get_care_schedule_range(uuid, date, date)
  from public, anon;
grant execute on function public.get_pet_chat_members(uuid)
  to authenticated;
grant execute on function public.get_pet_members(uuid)
  to authenticated;
grant execute on function public.get_care_schedule_range(uuid, date, date)
  to authenticated;

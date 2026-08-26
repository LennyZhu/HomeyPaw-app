create type public.care_type as enum (
  'feeding',
  'walk',
  'medicine',
  'bath',
  'grooming',
  'other'
);

create table public.care_logs (
  id uuid primary key,
  pet_id uuid not null references public.pets (id) on delete cascade,
  performed_by uuid not null references auth.users (id) on delete cascade,
  care_type public.care_type not null,
  occurred_at timestamptz not null,
  time_zone text not null,
  local_date date not null,
  note text,
  duration_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_logs_time_zone_length
    check (char_length(time_zone) between 1 and 64),
  constraint care_logs_note_length
    check (
      note is null
      or (
        char_length(note) between 1 and 500
        and note = btrim(note)
        and note ~ '[^[:space:]]'
      )
    ),
  constraint care_logs_other_requires_note
    check (care_type <> 'other' or note is not null),
  constraint care_logs_walk_duration
    check (
      duration_minutes is null
      or (
        care_type = 'walk'
        and duration_minutes between 1 and 1440
      )
    )
);

comment on table public.care_logs is
  'Completed pet care facts. Separate from Journal posts and future reminder tasks.';
comment on column public.care_logs.performed_by is
  'Always assigned from auth.uid() by create_care_log.';
comment on column public.care_logs.local_date is
  'Derived by trusted RPC from occurred_at in the validated IANA time_zone.';

create index care_logs_pet_history_idx
  on public.care_logs (pet_id, occurred_at desc, id desc);
create index care_logs_pet_today_idx
  on public.care_logs (pet_id, local_date, occurred_at desc, id desc);
create index care_logs_performer_idx
  on public.care_logs (performed_by);

create or replace function public.set_care_log_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_care_logs_updated_at
before update on public.care_logs
for each row execute function public.set_care_log_updated_at();

revoke execute on function public.set_care_log_updated_at()
  from public, anon, authenticated;

alter table public.care_logs enable row level security;

revoke all on table public.care_logs from anon, authenticated;
grant select, delete on table public.care_logs to authenticated;

create policy "Active family can read care logs"
  on public.care_logs
  for select
  to authenticated
  using ((select private.is_pet_member(pet_id)));

create policy "Performer or owner can delete care logs"
  on public.care_logs
  for delete
  to authenticated
  using (
    (
      performed_by = (select auth.uid())
      and (select private.is_pet_member(pet_id))
    )
    or (select private.is_pet_owner(pet_id))
  );

create or replace function public.create_care_log(
  care_id uuid,
  target_pet_id uuid,
  care_kind public.care_type,
  care_occurred_at timestamptz,
  care_time_zone text,
  care_note text default null,
  care_duration_minutes integer default null
)
returns public.care_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  created_log public.care_logs;
  existing_log public.care_logs;
  safe_note text;
  safe_time_zone text;
  derived_local_date date;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if care_id is null or target_pet_id is null or care_kind is null
    or care_occurred_at is null
  then
    raise exception 'care log fields are required' using errcode = '22023';
  end if;

  if not private.is_pet_member(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select * into existing_log
  from public.care_logs as care_log
  where care_log.id = care_id;

  if existing_log.id is not null then
    if existing_log.performed_by = caller_id
      and existing_log.pet_id = target_pet_id
      and existing_log.care_type = care_kind
    then
      return existing_log;
    end if;

    raise exception 'care log id is unavailable' using errcode = '23505';
  end if;

  if care_occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'care time cannot be in the future' using errcode = '22023';
  end if;

  safe_time_zone := nullif(btrim(coalesce(care_time_zone, '')), '');
  if safe_time_zone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = safe_time_zone
    )
  then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  safe_note := nullif(btrim(coalesce(care_note, '')), '');

  if care_kind = 'other' and safe_note is null then
    raise exception 'other care requires a note' using errcode = '23514';
  end if;

  if char_length(coalesce(safe_note, '')) > 500 then
    raise exception 'care note is too long' using errcode = '22001';
  end if;

  if care_duration_minutes is not null and (
    care_kind <> 'walk'
    or care_duration_minutes < 1
    or care_duration_minutes > 1440
  ) then
    raise exception 'invalid care duration' using errcode = '23514';
  end if;

  derived_local_date := (care_occurred_at at time zone safe_time_zone)::date;

  insert into public.care_logs (
    id,
    pet_id,
    performed_by,
    care_type,
    occurred_at,
    time_zone,
    local_date,
    note,
    duration_minutes
  ) values (
    care_id,
    target_pet_id,
    caller_id,
    care_kind,
    care_occurred_at,
    safe_time_zone,
    derived_local_date,
    safe_note,
    care_duration_minutes
  )
  returning * into created_log;

  return created_log;
end;
$$;

create or replace function public.update_care_log(
  target_care_log_id uuid,
  care_occurred_at timestamptz,
  care_time_zone text,
  care_note text default null,
  care_duration_minutes integer default null
)
returns public.care_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_log public.care_logs;
  updated_log public.care_logs;
  safe_note text;
  safe_time_zone text;
  derived_local_date date;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into existing_log
  from public.care_logs as care_log
  where care_log.id = target_care_log_id;

  if existing_log.id is null
    or existing_log.performed_by <> caller_id
    or not private.is_pet_member(existing_log.pet_id)
  then
    raise exception 'care log not found' using errcode = '42501';
  end if;

  if care_occurred_at is null then
    raise exception 'care time is required' using errcode = '22023';
  end if;

  if care_occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'care time cannot be in the future' using errcode = '22023';
  end if;

  safe_time_zone := nullif(btrim(coalesce(care_time_zone, '')), '');
  if safe_time_zone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = safe_time_zone
    )
  then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  safe_note := nullif(btrim(coalesce(care_note, '')), '');

  if existing_log.care_type = 'other' and safe_note is null then
    raise exception 'other care requires a note' using errcode = '23514';
  end if;

  if char_length(coalesce(safe_note, '')) > 500 then
    raise exception 'care note is too long' using errcode = '22001';
  end if;

  if care_duration_minutes is not null and (
    existing_log.care_type <> 'walk'
    or care_duration_minutes < 1
    or care_duration_minutes > 1440
  ) then
    raise exception 'invalid care duration' using errcode = '23514';
  end if;

  derived_local_date := (care_occurred_at at time zone safe_time_zone)::date;

  update public.care_logs
  set
    occurred_at = care_occurred_at,
    time_zone = safe_time_zone,
    local_date = derived_local_date,
    note = safe_note,
    duration_minutes = care_duration_minutes
  where id = target_care_log_id
  returning * into updated_log;

  return updated_log;
end;
$$;

create or replace function public.get_pet_care_performers(target_pet_id uuid)
returns table (
  performer_user_id uuid,
  performer_display_name text
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
  select distinct care_log.performed_by, profile.display_name
  from public.care_logs as care_log
  join public.profiles as profile on profile.id = care_log.performed_by
  where care_log.pet_id = target_pet_id
  order by profile.display_name, care_log.performed_by;
end;
$$;

revoke execute on function public.create_care_log(
  uuid, uuid, public.care_type, timestamptz, text, text, integer
) from public, anon;
revoke execute on function public.update_care_log(
  uuid, timestamptz, text, text, integer
) from public, anon;
revoke execute on function public.get_pet_care_performers(uuid)
  from public, anon;

grant execute on function public.create_care_log(
  uuid, uuid, public.care_type, timestamptz, text, text, integer
) to authenticated;
grant execute on function public.update_care_log(
  uuid, timestamptz, text, text, integer
) to authenticated;
grant execute on function public.get_pet_care_performers(uuid)
  to authenticated;

create type public.care_task_schedule_type as enum (
  'once',
  'daily',
  'weekly',
  'monthly'
);

create table public.care_tasks (
  id uuid primary key,
  pet_id uuid not null references public.pets (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null,
  care_type public.care_type,
  note text,
  schedule_type public.care_task_schedule_type not null,
  scheduled_at timestamptz,
  starts_on date,
  local_time time without time zone,
  time_zone text not null,
  week_day smallint,
  month_day smallint,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_tasks_title_length check (
    char_length(title) between 1 and 100
    and title = btrim(title)
    and title ~ '[^[:space:]]'
  ),
  constraint care_tasks_note_length check (
    note is null
    or (
      char_length(note) between 1 and 300
      and note = btrim(note)
      and note ~ '[^[:space:]]'
    )
  ),
  constraint care_tasks_time_zone_length
    check (char_length(time_zone) between 1 and 64),
  constraint care_tasks_week_day_range
    check (week_day is null or week_day between 1 and 7),
  constraint care_tasks_month_day_range
    check (month_day is null or month_day between 1 and 31),
  constraint care_tasks_active_state check (
    (is_active and deactivated_at is null)
    or (not is_active and deactivated_at is not null)
  ),
  constraint care_tasks_schedule_shape check (
    (
      schedule_type = 'once'
      and scheduled_at is not null
      and starts_on is null
      and local_time is null
      and week_day is null
      and month_day is null
    )
    or (
      schedule_type = 'daily'
      and scheduled_at is null
      and starts_on is not null
      and local_time is not null
      and week_day is null
      and month_day is null
    )
    or (
      schedule_type = 'weekly'
      and scheduled_at is null
      and starts_on is not null
      and local_time is not null
      and week_day is not null
      and month_day is null
    )
    or (
      schedule_type = 'monthly'
      and scheduled_at is null
      and starts_on is not null
      and local_time is not null
      and week_day is null
      and month_day is not null
    )
  )
);

comment on table public.care_tasks is
  'Shared future family care actions. Completed care facts remain in care_logs.';
comment on column public.care_tasks.created_by is
  'Server-bound creator. Preserved as null when a non-owner creator deletes their account.';
comment on column public.care_tasks.week_day is
  'ISO weekday: Monday=1 through Sunday=7.';
comment on column public.care_tasks.time_zone is
  'Fixed IANA schedule timezone; device travel does not shift the family schedule.';

create index care_tasks_pet_active_idx
  on public.care_tasks (pet_id, is_active, created_at, id);
create index care_tasks_creator_idx
  on public.care_tasks (created_by)
  where created_by is not null;

create table public.care_task_completions (
  id uuid primary key,
  task_id uuid not null references public.care_tasks (id) on delete cascade,
  pet_id uuid not null references public.pets (id) on delete cascade,
  completed_by uuid not null references auth.users (id) on delete cascade,
  scheduled_for timestamptz not null,
  completed_at timestamptz not null default now(),
  care_log_id uuid not null unique
    references public.care_logs (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint care_task_completions_task_occurrence_unique
    unique (task_id, scheduled_for)
);

comment on table public.care_task_completions is
  'One server-verified completion per concrete task occurrence.';
comment on column public.care_task_completions.scheduled_for is
  'The planned occurrence instant. completed_at is the real completion instant.';

create index care_task_completions_pet_time_idx
  on public.care_task_completions (pet_id, scheduled_for desc, id desc);
create index care_task_completions_user_idx
  on public.care_task_completions (completed_by);

create or replace function public.set_care_task_updated_at()
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

create trigger set_care_tasks_updated_at
before update on public.care_tasks
for each row execute function public.set_care_task_updated_at();

revoke execute on function public.set_care_task_updated_at()
  from public, anon, authenticated;

alter table public.care_tasks enable row level security;
alter table public.care_task_completions enable row level security;

revoke all on table public.care_tasks from anon, authenticated;
revoke all on table public.care_task_completions from anon, authenticated;
grant select on table public.care_tasks to authenticated;
grant select on table public.care_task_completions to authenticated;

create policy "Active family can read care tasks"
  on public.care_tasks
  for select
  to authenticated
  using ((select private.is_pet_member(pet_id)));

create policy "Active family can read care task completions"
  on public.care_task_completions
  for select
  to authenticated
  using ((select private.is_pet_member(pet_id)));

create or replace function private.validate_care_task_input(
  task_title text,
  task_note text,
  task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz,
  task_starts_on date,
  task_local_time time without time zone,
  task_time_zone text,
  task_week_day smallint,
  task_month_day smallint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  safe_title text;
  safe_note text;
  safe_time_zone text;
begin
  safe_title := nullif(btrim(coalesce(task_title, '')), '');
  safe_note := nullif(btrim(coalesce(task_note, '')), '');
  safe_time_zone := nullif(btrim(coalesce(task_time_zone, '')), '');

  if safe_title is null or char_length(safe_title) > 100 then
    raise exception 'invalid task title' using errcode = '22023';
  end if;

  if safe_note is not null and char_length(safe_note) > 300 then
    raise exception 'task note is too long' using errcode = '22001';
  end if;

  if safe_time_zone is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names
      where name = safe_time_zone
    )
  then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  if task_schedule_type = 'once' then
    if task_scheduled_at is null
      or task_starts_on is not null
      or task_local_time is not null
      or task_week_day is not null
      or task_month_day is not null
    then
      raise exception 'invalid once schedule' using errcode = '22023';
    end if;
  elsif task_schedule_type = 'daily' then
    if task_scheduled_at is not null
      or task_starts_on is null
      or task_local_time is null
      or task_week_day is not null
      or task_month_day is not null
    then
      raise exception 'invalid daily schedule' using errcode = '22023';
    end if;
  elsif task_schedule_type = 'weekly' then
    if task_scheduled_at is not null
      or task_starts_on is null
      or task_local_time is null
      or task_week_day is null
      or task_week_day not between 1 and 7
      or task_month_day is not null
    then
      raise exception 'invalid weekly schedule' using errcode = '22023';
    end if;
  elsif task_schedule_type = 'monthly' then
    if task_scheduled_at is not null
      or task_starts_on is null
      or task_local_time is null
      or task_week_day is not null
      or task_month_day is null
      or task_month_day not between 1 and 31
    then
      raise exception 'invalid monthly schedule' using errcode = '22023';
    end if;
  else
    raise exception 'invalid schedule type' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.is_care_task_occurrence(
  target_task public.care_tasks,
  candidate timestamptz
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  candidate_local timestamp without time zone;
  candidate_date date;
  expected_instant timestamptz;
begin
  if candidate is null then
    return false;
  end if;

  if target_task.schedule_type = 'once' then
    return target_task.scheduled_at = candidate;
  end if;

  candidate_local := candidate at time zone target_task.time_zone;
  candidate_date := candidate_local::date;
  expected_instant :=
    (candidate_date + target_task.local_time) at time zone target_task.time_zone;

  if candidate_date < target_task.starts_on
    or candidate_local::time(0) <> target_task.local_time::time(0)
    or expected_instant <> candidate
  then
    return false;
  end if;

  return case target_task.schedule_type
    when 'daily' then true
    when 'weekly' then extract(isodow from candidate_date)::smallint = target_task.week_day
    when 'monthly' then extract(day from candidate_date)::smallint = target_task.month_day
    else false
  end;
end;
$$;

revoke execute on function private.validate_care_task_input(
  text, text, public.care_task_schedule_type, timestamptz, date,
  time without time zone, text, smallint, smallint
) from public, anon, authenticated;
revoke execute on function private.is_care_task_occurrence(
  public.care_tasks, timestamptz
) from public, anon, authenticated;

create or replace function public.create_care_task(
  task_id uuid,
  target_pet_id uuid,
  task_title text,
  task_care_type public.care_type,
  task_note text,
  task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz,
  task_starts_on date,
  task_local_time time without time zone,
  task_time_zone text,
  task_week_day smallint,
  task_month_day smallint
)
returns public.care_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  created_task public.care_tasks;
  existing_task public.care_tasks;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if task_id is null or target_pet_id is null
    or not private.can_contribute_to_pet(target_pet_id)
  then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select * into existing_task
  from public.care_tasks as care_task
  where care_task.id = task_id;

  if existing_task.id is not null then
    if existing_task.created_by = caller_id
      and existing_task.pet_id = target_pet_id
    then
      return existing_task;
    end if;

    raise exception 'care task id is unavailable' using errcode = '23505';
  end if;

  perform private.validate_care_task_input(
    task_title, task_note, task_schedule_type, task_scheduled_at,
    task_starts_on, task_local_time, task_time_zone,
    task_week_day, task_month_day
  );

  if task_schedule_type = 'once'
    and (
      task_scheduled_at <= pg_catalog.clock_timestamp()
      or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years'
    )
  then
    raise exception 'task time is outside the supported range'
      using errcode = '22023';
  end if;

  if task_schedule_type <> 'once' and (
    task_starts_on < (pg_catalog.clock_timestamp() at time zone task_time_zone)::date
    or task_starts_on >
      (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826
  ) then
    raise exception 'task start date is outside the supported range'
      using errcode = '22023';
  end if;

  insert into public.care_tasks (
    id, pet_id, created_by, title, care_type, note, schedule_type,
    scheduled_at, starts_on, local_time, time_zone, week_day, month_day
  ) values (
    task_id,
    target_pet_id,
    caller_id,
    btrim(task_title),
    task_care_type,
    nullif(btrim(coalesce(task_note, '')), ''),
    task_schedule_type,
    task_scheduled_at,
    task_starts_on,
    task_local_time::time(0),
    btrim(task_time_zone),
    task_week_day,
    task_month_day
  )
  returning * into created_task;

  return created_task;
end;
$$;

create or replace function public.update_care_task(
  target_task_id uuid,
  task_title text,
  task_care_type public.care_type,
  task_note text,
  task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz,
  task_starts_on date,
  task_local_time time without time zone,
  task_time_zone text,
  task_week_day smallint,
  task_month_day smallint
)
returns public.care_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_task public.care_tasks;
  updated_task public.care_tasks;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into existing_task
  from public.care_tasks as care_task
  where care_task.id = target_task_id
  for update;

  if existing_task.id is null
    or not private.is_pet_member(existing_task.pet_id)
    or (
      existing_task.created_by is distinct from caller_id
      and not private.is_pet_owner(existing_task.pet_id)
    )
  then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  if not existing_task.is_active then
    raise exception 'care task is inactive' using errcode = '22023';
  end if;

  if existing_task.schedule_type = 'once'
    and exists (
      select 1 from public.care_task_completions as completion
      where completion.task_id = existing_task.id
    )
  then
    raise exception 'completed once task cannot be edited' using errcode = '22023';
  end if;

  perform private.validate_care_task_input(
    task_title, task_note, task_schedule_type, task_scheduled_at,
    task_starts_on, task_local_time, task_time_zone,
    task_week_day, task_month_day
  );

  if task_schedule_type = 'once'
    and (
      task_scheduled_at <= pg_catalog.clock_timestamp()
      or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years'
    )
  then
    raise exception 'task time is outside the supported range'
      using errcode = '22023';
  end if;

  if task_schedule_type <> 'once'
    and task_starts_on >
      (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826
  then
    raise exception 'task start date is outside the supported range'
      using errcode = '22023';
  end if;

  update public.care_tasks
  set
    title = btrim(task_title),
    care_type = task_care_type,
    note = nullif(btrim(coalesce(task_note, '')), ''),
    schedule_type = task_schedule_type,
    scheduled_at = task_scheduled_at,
    starts_on = task_starts_on,
    local_time = task_local_time::time(0),
    time_zone = btrim(task_time_zone),
    week_day = task_week_day,
    month_day = task_month_day
  where id = existing_task.id
  returning * into updated_task;

  return updated_task;
end;
$$;

create or replace function public.deactivate_care_task(target_task_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_task public.care_tasks;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into existing_task
  from public.care_tasks as care_task
  where care_task.id = target_task_id
  for update;

  if existing_task.id is null
    or not private.is_pet_member(existing_task.pet_id)
    or (
      existing_task.created_by is distinct from caller_id
      and not private.is_pet_owner(existing_task.pet_id)
    )
  then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  if not existing_task.is_active then
    return 'already_inactive';
  end if;

  update public.care_tasks
  set is_active = false, deactivated_at = pg_catalog.clock_timestamp()
  where id = existing_task.id;

  return 'deactivated';
end;
$$;

create or replace function public.get_care_task_occurrences(
  window_start timestamptz,
  window_end timestamptz,
  target_pet_id uuid default null
)
returns table (
  task_id uuid,
  pet_id uuid,
  pet_name text,
  created_by uuid,
  creator_display_name text,
  title text,
  care_type public.care_type,
  note text,
  schedule_type public.care_task_schedule_type,
  scheduled_at timestamptz,
  starts_on date,
  local_time time without time zone,
  time_zone text,
  week_day smallint,
  month_day smallint,
  is_active boolean,
  can_edit boolean,
  can_undo boolean,
  scheduled_for timestamptz,
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
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if window_start is null or window_end is null
    or window_end <= window_start
    or window_end - window_start > interval '35 days'
  then
    raise exception 'invalid occurrence window' using errcode = '22023';
  end if;

  return query
  with accessible_tasks as (
    select care_task.*
    from public.care_tasks as care_task
    where care_task.is_active
      and (target_pet_id is null or care_task.pet_id = target_pet_id)
      and private.is_pet_member(care_task.pet_id)
  ),
  concrete_occurrences as (
    select care_task.id, care_task.scheduled_at as occurrence_at
    from accessible_tasks as care_task
    where care_task.schedule_type = 'once'
      and care_task.scheduled_at >= window_start
      and care_task.scheduled_at < window_end

    union all

    select
      care_task.id,
      (local_day.day_value::date + care_task.local_time)
        at time zone care_task.time_zone as occurrence_at
    from accessible_tasks as care_task
    cross join lateral pg_catalog.generate_series(
      greatest(
        care_task.starts_on,
        (window_start at time zone care_task.time_zone)::date - 1
      )::timestamp without time zone,
      (
        (window_end at time zone care_task.time_zone)::date + 1
      )::timestamp without time zone,
      interval '1 day'
    ) as local_day(day_value)
    where care_task.schedule_type <> 'once'
      and (
        care_task.schedule_type = 'daily'
        or (
          care_task.schedule_type = 'weekly'
          and extract(isodow from local_day.day_value)::smallint = care_task.week_day
        )
        or (
          care_task.schedule_type = 'monthly'
          and extract(day from local_day.day_value)::smallint = care_task.month_day
        )
      )
  ),
  bounded_occurrences as (
    select occurrence.id, occurrence.occurrence_at
    from concrete_occurrences as occurrence
    join accessible_tasks as care_task on care_task.id = occurrence.id
    where occurrence.occurrence_at >= window_start
      and occurrence.occurrence_at < window_end
      and private.is_care_task_occurrence(
        care_task,
        occurrence.occurrence_at
      )
  )
  select
    care_task.id,
    care_task.pet_id,
    pet.name,
    care_task.created_by,
    creator.display_name,
    care_task.title,
    care_task.care_type,
    care_task.note,
    care_task.schedule_type,
    care_task.scheduled_at,
    care_task.starts_on,
    care_task.local_time,
    care_task.time_zone,
    care_task.week_day,
    care_task.month_day,
    care_task.is_active,
    (
      coalesce(care_task.created_by = auth.uid(), false)
      or private.is_pet_owner(care_task.pet_id)
    ),
    coalesce((
      completion.completed_by = auth.uid()
      or (
        completion.id is not null
        and private.is_pet_owner(care_task.pet_id)
      )
    ), false),
    occurrence.occurrence_at,
    completion.id,
    completion.completed_by,
    completer.display_name,
    completion.completed_at,
    completion.care_log_id
  from bounded_occurrences as occurrence
  join accessible_tasks as care_task on care_task.id = occurrence.id
  join public.pets as pet on pet.id = care_task.pet_id
  left join public.profiles as creator on creator.id = care_task.created_by
  left join public.care_task_completions as completion
    on completion.task_id = care_task.id
    and completion.scheduled_for = occurrence.occurrence_at
  left join public.profiles as completer on completer.id = completion.completed_by
  order by occurrence.occurrence_at, care_task.id;
end;
$$;

create or replace function public.complete_care_task(
  completion_id uuid,
  care_log_id uuid,
  target_task_id uuid,
  occurrence_scheduled_for timestamptz,
  completion_note text default null,
  completion_duration_minutes integer default null
)
returns table (
  completion_status text,
  result_completion_id uuid,
  result_care_log_id uuid,
  result_completed_by uuid,
  result_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_task public.care_tasks;
  existing_completion public.care_task_completions;
  completed_log public.care_logs;
  created_completion public.care_task_completions;
  safe_completion_note text;
  derived_note text;
  completion_time timestamptz;
  completion_local_date date;
  resulting_care_type public.care_type;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if completion_id is null or care_log_id is null
    or target_task_id is null or occurrence_scheduled_for is null
  then
    raise exception 'completion fields are required' using errcode = '22023';
  end if;

  select * into existing_task
  from public.care_tasks as care_task
  where care_task.id = target_task_id
  for update;

  if existing_task.id is null
    or not existing_task.is_active
    or not private.can_contribute_to_pet(existing_task.pet_id)
  then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  if not private.is_care_task_occurrence(
    existing_task,
    occurrence_scheduled_for
  ) then
    raise exception 'invalid task occurrence' using errcode = '22023';
  end if;

  completion_time := pg_catalog.clock_timestamp();

  if occurrence_scheduled_for > completion_time + interval '5 minutes' then
    raise exception 'task occurrence is not due' using errcode = '22023';
  end if;

  if existing_task.schedule_type <> 'once'
    and (occurrence_scheduled_for at time zone existing_task.time_zone)::date
      <> (completion_time at time zone existing_task.time_zone)::date
  then
    raise exception 'recurring occurrence is no longer actionable'
      using errcode = '22023';
  end if;

  select * into existing_completion
  from public.care_task_completions as completion
  where completion.task_id = existing_task.id
    and completion.scheduled_for = occurrence_scheduled_for;

  if existing_completion.id is not null then
    return query select
      'already_completed'::text,
      existing_completion.id,
      existing_completion.care_log_id,
      existing_completion.completed_by,
      existing_completion.completed_at;
    return;
  end if;

  safe_completion_note := nullif(btrim(coalesce(completion_note, '')), '');
  if safe_completion_note is not null
    and char_length(safe_completion_note) > 200
  then
    raise exception 'completion note is too long' using errcode = '22001';
  end if;

  resulting_care_type := coalesce(existing_task.care_type, 'other');
  if resulting_care_type = 'other' then
    derived_note := left(
      pg_catalog.concat_ws(
        ' · ',
        existing_task.title,
        existing_task.note,
        safe_completion_note
      ),
      500
    );
  else
    derived_note := nullif(
      left(
        pg_catalog.concat_ws(' · ', existing_task.note, safe_completion_note),
        500
      ),
      ''
    );
  end if;

  if completion_duration_minutes is not null and (
    resulting_care_type <> 'walk'
    or completion_duration_minutes < 1
    or completion_duration_minutes > 1440
  ) then
    raise exception 'invalid care duration' using errcode = '23514';
  end if;

  completion_local_date :=
    (completion_time at time zone existing_task.time_zone)::date;

  insert into public.care_logs (
    id, pet_id, performed_by, care_type, occurred_at, time_zone,
    local_date, note, duration_minutes
  ) values (
    care_log_id,
    existing_task.pet_id,
    caller_id,
    resulting_care_type,
    completion_time,
    existing_task.time_zone,
    completion_local_date,
    derived_note,
    completion_duration_minutes
  )
  returning * into completed_log;

  insert into public.care_task_completions (
    id, task_id, pet_id, completed_by, scheduled_for,
    completed_at, care_log_id
  ) values (
    completion_id,
    existing_task.id,
    existing_task.pet_id,
    caller_id,
    occurrence_scheduled_for,
    completion_time,
    completed_log.id
  )
  returning * into created_completion;

  return query select
    'completed'::text,
    created_completion.id,
    created_completion.care_log_id,
    created_completion.completed_by,
    created_completion.completed_at;
end;
$$;

create or replace function public.undo_care_task_completion(
  target_completion_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  existing_completion public.care_task_completions;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select completion.* into existing_completion
  from public.care_task_completions as completion
  where completion.id = target_completion_id
  for update;

  if existing_completion.id is null then
    return 'not_found';
  end if;

  if not private.is_pet_member(existing_completion.pet_id)
    or (
      existing_completion.completed_by <> caller_id
      and not private.is_pet_owner(existing_completion.pet_id)
    )
  then
    raise exception 'completion not found' using errcode = '42501';
  end if;

  delete from public.care_logs
  where id = existing_completion.care_log_id;

  return 'undone';
end;
$$;

revoke execute on function public.create_care_task(
  uuid, uuid, text, public.care_type, text,
  public.care_task_schedule_type, timestamptz, date,
  time without time zone, text, smallint, smallint
) from public, anon;
revoke execute on function public.update_care_task(
  uuid, text, public.care_type, text,
  public.care_task_schedule_type, timestamptz, date,
  time without time zone, text, smallint, smallint
) from public, anon;
revoke execute on function public.deactivate_care_task(uuid)
  from public, anon;
revoke execute on function public.get_care_task_occurrences(
  timestamptz, timestamptz, uuid
) from public, anon;
revoke execute on function public.complete_care_task(
  uuid, uuid, uuid, timestamptz, text, integer
) from public, anon;
revoke execute on function public.undo_care_task_completion(uuid)
  from public, anon;

grant execute on function public.create_care_task(
  uuid, uuid, text, public.care_type, text,
  public.care_task_schedule_type, timestamptz, date,
  time without time zone, text, smallint, smallint
) to authenticated;
grant execute on function public.update_care_task(
  uuid, text, public.care_type, text,
  public.care_task_schedule_type, timestamptz, date,
  time without time zone, text, smallint, smallint
) to authenticated;
grant execute on function public.deactivate_care_task(uuid)
  to authenticated;
grant execute on function public.get_care_task_occurrences(
  timestamptz, timestamptz, uuid
) to authenticated;
grant execute on function public.complete_care_task(
  uuid, uuid, uuid, timestamptz, text, integer
) to authenticated;
grant execute on function public.undo_care_task_completion(uuid)
  to authenticated;

alter table public.care_logs
  add column health_subtype public.health_observation_type;

alter table public.care_logs
  add constraint care_logs_health_shape check (
    (care_type = 'health' and health_subtype is not null and duration_minutes is null)
    or (care_type <> 'health' and health_subtype is null)
  );

comment on column public.care_logs.health_subtype is
  'Observed health fact subtype. Present only when care_type is health.';

alter table public.care_tasks
  add column task_category public.care_task_category not null default 'standard';

alter table public.care_tasks drop constraint care_tasks_schedule_shape;
alter table public.care_tasks add constraint care_tasks_schedule_shape check (
  (schedule_type = 'once' and scheduled_at is not null and starts_on is null and local_time is null and week_day is null and month_day is null)
  or (schedule_type in ('daily', 'yearly') and scheduled_at is null and starts_on is not null and local_time is not null and week_day is null and month_day is null)
  or (schedule_type = 'weekly' and scheduled_at is null and starts_on is not null and local_time is not null and week_day is not null and month_day is null)
  or (schedule_type = 'monthly' and scheduled_at is null and starts_on is not null and local_time is not null and week_day is null and month_day is not null)
);

alter table public.care_tasks add constraint care_tasks_health_not_schedulable
  check (care_type is distinct from 'health');

comment on column public.care_tasks.task_category is
  'Business label independent of recurrence; birthday defaults to yearly in clients.';

drop function public.create_care_log(uuid, uuid, public.care_type, timestamptz, text, text, integer);

create function public.create_care_log(
  care_id uuid,
  target_pet_id uuid,
  care_kind public.care_type,
  care_occurred_at timestamptz,
  care_time_zone text,
  care_note text default null,
  care_duration_minutes integer default null,
  care_health_subtype public.health_observation_type default null
)
returns public.care_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  created_log public.care_logs;
  existing_log public.care_logs;
  safe_note text;
  safe_time_zone text;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if care_id is null or target_pet_id is null or care_kind is null or care_occurred_at is null then
    raise exception 'care log fields are required' using errcode = '22023';
  end if;
  if not private.can_contribute_to_pet(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  select * into existing_log from public.care_logs where id = care_id;
  if existing_log.id is not null then
    if existing_log.performed_by = caller_id and existing_log.pet_id = target_pet_id
      and existing_log.care_type = care_kind
      and existing_log.health_subtype is not distinct from care_health_subtype then
      return existing_log;
    end if;
    raise exception 'care log id is unavailable' using errcode = '23505';
  end if;

  if care_occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'care time cannot be in the future' using errcode = '22023';
  end if;
  safe_time_zone := nullif(btrim(coalesce(care_time_zone, '')), '');
  if safe_time_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = safe_time_zone) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;
  safe_note := nullif(btrim(coalesce(care_note, '')), '');
  if care_kind = 'other' and safe_note is null then
    raise exception 'other care requires a note' using errcode = '23514';
  end if;
  if char_length(coalesce(safe_note, '')) > 500 then
    raise exception 'care note is too long' using errcode = '22001';
  end if;
  if (care_kind = 'health') <> (care_health_subtype is not null) then
    raise exception 'invalid health observation' using errcode = '23514';
  end if;
  if care_duration_minutes is not null and (care_kind <> 'walk' or care_duration_minutes < 1 or care_duration_minutes > 1440) then
    raise exception 'invalid care duration' using errcode = '23514';
  end if;

  insert into public.care_logs (
    id, pet_id, performed_by, care_type, health_subtype, occurred_at,
    time_zone, local_date, note, duration_minutes
  ) values (
    care_id, target_pet_id, caller_id, care_kind, care_health_subtype,
    care_occurred_at, safe_time_zone,
    (care_occurred_at at time zone safe_time_zone)::date,
    safe_note, care_duration_minutes
  ) returning * into created_log;
  return created_log;
end;
$$;

revoke execute on function public.create_care_log(uuid, uuid, public.care_type, timestamptz, text, text, integer, public.health_observation_type)
  from public, anon;
grant execute on function public.create_care_log(uuid, uuid, public.care_type, timestamptz, text, text, integer, public.health_observation_type)
  to authenticated;

create or replace function private.is_care_task_occurrence(target_task public.care_tasks, candidate timestamptz)
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
  anchor_month integer;
  anchor_day integer;
  expected_month integer;
  expected_day integer;
begin
  if candidate is null then return false; end if;
  if target_task.schedule_type = 'once' then return target_task.scheduled_at = candidate; end if;
  candidate_local := candidate at time zone target_task.time_zone;
  candidate_date := candidate_local::date;
  expected_instant := (candidate_date + target_task.local_time) at time zone target_task.time_zone;
  if candidate_date < target_task.starts_on or candidate_local::time(0) <> target_task.local_time::time(0) or expected_instant <> candidate then
    return false;
  end if;
  if target_task.schedule_type = 'yearly' then
    anchor_month := extract(month from target_task.starts_on)::integer;
    anchor_day := extract(day from target_task.starts_on)::integer;
    expected_month := anchor_month;
    expected_day := anchor_day;
    if anchor_month = 2 and anchor_day = 29
      and not (extract(year from candidate_date)::integer % 4 = 0
        and (extract(year from candidate_date)::integer % 100 <> 0 or extract(year from candidate_date)::integer % 400 = 0)) then
      expected_day := 28;
    end if;
    return extract(month from candidate_date)::integer = expected_month
      and extract(day from candidate_date)::integer = expected_day;
  end if;
  return case target_task.schedule_type
    when 'daily' then true
    when 'weekly' then extract(isodow from candidate_date)::smallint = target_task.week_day
    when 'monthly' then extract(day from candidate_date)::smallint = target_task.month_day
    else false
  end;
end;
$$;

revoke execute on function private.is_care_task_occurrence(public.care_tasks, timestamptz)
  from public, anon, authenticated;

create or replace function private.validate_care_task_input(
  task_title text, task_note text, task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz, task_starts_on date,
  task_local_time time without time zone, task_time_zone text,
  task_week_day smallint, task_month_day smallint
)
returns void language plpgsql security invoker set search_path = '' as $$
declare safe_title text := nullif(btrim(coalesce(task_title, '')), '');
declare safe_note text := nullif(btrim(coalesce(task_note, '')), '');
declare safe_time_zone text := nullif(btrim(coalesce(task_time_zone, '')), '');
begin
  if safe_title is null or char_length(safe_title) > 100 then raise exception 'invalid task title' using errcode = '22023'; end if;
  if safe_note is not null and char_length(safe_note) > 300 then raise exception 'task note is too long' using errcode = '22001'; end if;
  if safe_time_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = safe_time_zone) then raise exception 'invalid time zone' using errcode = '22023'; end if;
  if task_schedule_type = 'once' then
    if task_scheduled_at is null or task_starts_on is not null or task_local_time is not null or task_week_day is not null or task_month_day is not null then raise exception 'invalid once schedule' using errcode = '22023'; end if;
  elsif task_schedule_type in ('daily', 'yearly') then
    if task_scheduled_at is not null or task_starts_on is null or task_local_time is null or task_week_day is not null or task_month_day is not null then raise exception 'invalid recurring schedule' using errcode = '22023'; end if;
  elsif task_schedule_type = 'weekly' then
    if task_scheduled_at is not null or task_starts_on is null or task_local_time is null or task_week_day is null or task_week_day not between 1 and 7 or task_month_day is not null then raise exception 'invalid weekly schedule' using errcode = '22023'; end if;
  elsif task_schedule_type = 'monthly' then
    if task_scheduled_at is not null or task_starts_on is null or task_local_time is null or task_week_day is not null or task_month_day is null or task_month_day not between 1 and 31 then raise exception 'invalid monthly schedule' using errcode = '22023'; end if;
  else raise exception 'invalid schedule type' using errcode = '22023';
  end if;
end;
$$;

drop function public.create_care_task(uuid, uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint, smallint);
create function public.create_care_task(
  task_id uuid, target_pet_id uuid, task_title text, task_care_type public.care_type,
  task_note text, task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz, task_starts_on date,
  task_local_time time without time zone, task_time_zone text,
  task_week_day smallint, task_month_day smallint,
  task_category public.care_task_category default 'standard'
)
returns public.care_tasks language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid();
declare created_task public.care_tasks;
declare existing_task public.care_tasks;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if task_id is null or target_pet_id is null or not private.can_contribute_to_pet(target_pet_id) then raise exception 'pet not found' using errcode = '42501'; end if;
  if task_care_type = 'health' then raise exception 'health observations cannot be scheduled' using errcode = '23514'; end if;
  select * into existing_task from public.care_tasks where id = task_id;
  if existing_task.id is not null then
    if existing_task.created_by = caller_id and existing_task.pet_id = target_pet_id then return existing_task; end if;
    raise exception 'care task id is unavailable' using errcode = '23505';
  end if;
  perform private.validate_care_task_input(task_title, task_note, task_schedule_type, task_scheduled_at, task_starts_on, task_local_time, task_time_zone, task_week_day, task_month_day);
  if task_schedule_type = 'once' and (task_scheduled_at <= pg_catalog.clock_timestamp() or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years') then raise exception 'task time is outside the supported range' using errcode = '22023'; end if;
  if task_schedule_type <> 'once' and (task_starts_on < (pg_catalog.clock_timestamp() at time zone task_time_zone)::date or task_starts_on > (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826) then raise exception 'task start date is outside the supported range' using errcode = '22023'; end if;
  insert into public.care_tasks (id, pet_id, created_by, title, care_type, note, schedule_type, scheduled_at, starts_on, local_time, time_zone, week_day, month_day, task_category)
  values (task_id, target_pet_id, caller_id, btrim(task_title), task_care_type, nullif(btrim(coalesce(task_note, '')), ''), task_schedule_type, task_scheduled_at, task_starts_on, task_local_time::time(0), btrim(task_time_zone), task_week_day, task_month_day, coalesce(task_category, 'standard'))
  returning * into created_task;
  return created_task;
end;
$$;

drop function public.update_care_task(uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint, smallint);
create function public.update_care_task(
  target_task_id uuid, task_title text, task_care_type public.care_type,
  task_note text, task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz, task_starts_on date,
  task_local_time time without time zone, task_time_zone text,
  task_week_day smallint, task_month_day smallint,
  task_category public.care_task_category default null
)
returns public.care_tasks language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid();
declare existing_task public.care_tasks;
declare updated_task public.care_tasks;
declare safe_task_category public.care_task_category;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into existing_task from public.care_tasks where id = target_task_id for update;
  if existing_task.id is null or not private.is_pet_member(existing_task.pet_id) or (existing_task.created_by is distinct from caller_id and not private.is_pet_owner(existing_task.pet_id)) then raise exception 'care task not found' using errcode = '42501'; end if;
  if not existing_task.is_active then raise exception 'care task is inactive' using errcode = '22023'; end if;
  if existing_task.schedule_type = 'once' and exists (select 1 from public.care_task_completions where task_id = existing_task.id) then raise exception 'completed once task cannot be edited' using errcode = '22023'; end if;
  if task_care_type = 'health' then raise exception 'health observations cannot be scheduled' using errcode = '23514'; end if;
  safe_task_category := coalesce(task_category, existing_task.task_category);
  perform private.validate_care_task_input(task_title, task_note, task_schedule_type, task_scheduled_at, task_starts_on, task_local_time, task_time_zone, task_week_day, task_month_day);
  if task_schedule_type = 'once' and (task_scheduled_at <= pg_catalog.clock_timestamp() or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years') then raise exception 'task time is outside the supported range' using errcode = '22023'; end if;
  if task_schedule_type <> 'once' and task_starts_on > (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826 then raise exception 'task start date is outside the supported range' using errcode = '22023'; end if;
  update public.care_tasks set title=btrim(task_title), care_type=task_care_type, note=nullif(btrim(coalesce(task_note,'')),''), schedule_type=task_schedule_type, scheduled_at=task_scheduled_at, starts_on=task_starts_on, local_time=task_local_time::time(0), time_zone=btrim(task_time_zone), week_day=task_week_day, month_day=task_month_day, task_category=safe_task_category
  where id=existing_task.id returning * into updated_task;
  return updated_task;
end;
$$;

revoke execute on function public.create_care_task(uuid, uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint, smallint, public.care_task_category) from public, anon;
grant execute on function public.create_care_task(uuid, uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint, smallint, public.care_task_category) to authenticated;
revoke execute on function public.update_care_task(uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint, smallint, public.care_task_category) from public, anon;
grant execute on function public.update_care_task(uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint, smallint, public.care_task_category) to authenticated;


drop function public.get_care_task_occurrences(timestamptz, timestamptz, uuid);

create function public.get_care_task_occurrences(
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
  task_category public.care_task_category,
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
        or (
          care_task.schedule_type = 'yearly'
          and (
            (
              extract(month from local_day.day_value) = extract(month from care_task.starts_on)
              and extract(day from local_day.day_value) = extract(day from care_task.starts_on)
            )
            or (
              extract(month from care_task.starts_on) = 2
              and extract(day from care_task.starts_on) = 29
              and extract(month from local_day.day_value) = 2
              and extract(day from local_day.day_value) = 28
              and not (
                extract(year from local_day.day_value)::integer % 4 = 0
                and (
                  extract(year from local_day.day_value)::integer % 100 <> 0
                  or extract(year from local_day.day_value)::integer % 400 = 0
                )
              )
            )
          )
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
    care_task.task_category,
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


revoke execute on function public.get_care_task_occurrences(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_care_task_occurrences(timestamptz, timestamptz, uuid) to authenticated;

drop policy "Active family can read care logs" on public.care_logs;
create policy "Contributing family can read care logs"
  on public.care_logs for select to authenticated
  using ((select private.can_contribute_to_pet(pet_id)));

drop policy "Performer or owner can delete care logs" on public.care_logs;
create policy "Performer or owner can delete care logs"
  on public.care_logs for delete to authenticated
  using (
    (performed_by = (select auth.uid()) and (select private.can_contribute_to_pet(pet_id)))
    or (select private.is_pet_owner(pet_id))
  );

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
    or not private.can_contribute_to_pet(existing_log.pet_id)
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


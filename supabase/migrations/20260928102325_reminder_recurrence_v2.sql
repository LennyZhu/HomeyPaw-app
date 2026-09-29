-- Additive recurrence v2. Legacy scalar/RPC contracts remain available.
-- No release gates, Push workers or existing notification jobs are changed.
alter table public.care_tasks
  add column week_days smallint[],
  add column ends_on date;

update public.care_tasks
set week_days = array[week_day]
where schedule_type = 'weekly';

create function private.normalize_care_task_week_days(days smallint[])
returns smallint[] language sql immutable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct day order by day), '{}'::smallint[])
  from unnest(days) as value(day);
$$;
revoke all on function private.normalize_care_task_week_days(smallint[]) from public, anon, authenticated;

create function private.normalize_care_task_recurrence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.schedule_type = 'weekly' then
    -- Legacy INSERTs (including old fixtures) still express a singleton rule.
    if new.week_days is null then new.week_days := array[new.week_day]; end if;
    if cardinality(new.week_days) = 0 or array_position(new.week_days, null) is not null
      or not (new.week_days <@ array[1,2,3,4,5,6,7]::smallint[]) then
      raise exception 'invalid weekly schedule' using errcode = '23514';
    end if;
    new.week_days := private.normalize_care_task_week_days(new.week_days);
    new.week_day := new.week_days[1]; -- legacy projection only
  end if;
  return new;
end;
$$;
revoke all on function private.normalize_care_task_recurrence() from public, anon, authenticated;
create trigger normalize_care_task_recurrence
before insert or update of schedule_type, week_days, week_day on public.care_tasks
for each row execute function private.normalize_care_task_recurrence();

alter table public.care_tasks add constraint care_tasks_week_days_shape check (
  (schedule_type = 'weekly' and week_days is not null
    and cardinality(week_days) > 0 and array_ndims(week_days) = 1
    and array_lower(week_days, 1) = 1 and array_position(week_days, null) is null
    and week_days <@ array[1,2,3,4,5,6,7]::smallint[]
    and week_days = private.normalize_care_task_week_days(week_days)
    and week_day = week_days[1])
  or (schedule_type <> 'weekly' and week_days is null)
);
alter table public.care_tasks add constraint care_tasks_ends_on_shape check (
  ends_on is null or (schedule_type <> 'once' and starts_on is not null and ends_on >= starts_on)
);
comment on column public.care_tasks.week_days is 'Canonical ISO weekdays, sorted/deduplicated. Legacy week_day is the first-day projection.';
comment on column public.care_tasks.ends_on is 'Inclusive end date in the saved time_zone; NULL means never ends.';

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
  if candidate_date < target_task.starts_on
    or (target_task.ends_on is not null and candidate_date > target_task.ends_on) or candidate_local::time(0) <> target_task.local_time::time(0) or expected_instant <> candidate then
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
    when 'weekly' then extract(isodow from candidate_date)::smallint = any(target_task.week_days)
    when 'monthly' then extract(day from candidate_date)::smallint = target_task.month_day
    else false
  end;
end;
$$;

revoke execute on function private.is_care_task_occurrence(public.care_tasks, timestamptz)
  from public, anon, authenticated;

create or replace function public.create_care_task(
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
  insert into public.care_tasks (id, pet_id, created_by, title, care_type, note, schedule_type, scheduled_at, starts_on, local_time, time_zone, week_day, month_day, task_category, week_days, ends_on)
  values (task_id, target_pet_id, caller_id, btrim(task_title), task_care_type, nullif(btrim(coalesce(task_note, '')), ''), task_schedule_type, task_scheduled_at, task_starts_on, task_local_time::time(0), btrim(task_time_zone), task_week_day, task_month_day, coalesce(task_category, 'standard'), case when task_schedule_type = 'weekly' then array[task_week_day] end, null)
  returning * into created_task;
  return created_task;
end;
$$;

create or replace function public.update_care_task(
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
  select * into existing_task from public.care_tasks where id = target_task_id;
  if existing_task.id is null or not private.is_pet_member(existing_task.pet_id) or (existing_task.created_by is distinct from caller_id and not private.is_pet_owner(existing_task.pet_id)) then raise exception 'care task not found' using errcode = '42501'; end if;
  perform shift.id from public.care_shifts as shift
  where shift.status = 'scheduled' and exists (
    select 1 from public.care_shift_tasks as item
    where item.shift_id = shift.id and item.care_task_id = target_task_id
  ) order by shift.id for update;
  select * into existing_task from public.care_tasks where id = target_task_id for update;
  if existing_task.id is null or not private.is_pet_member(existing_task.pet_id) or (existing_task.created_by is distinct from caller_id and not private.is_pet_owner(existing_task.pet_id)) then raise exception 'care task not found' using errcode = '42501'; end if;
  if existing_task.ends_on is not null or (existing_task.schedule_type = 'weekly' and cardinality(existing_task.week_days) > 1) then
    raise exception 'REMINDER_REQUIRES_NEWER_CLIENT' using errcode = '22023';
  end if;
  if not existing_task.is_active then raise exception 'care task is inactive' using errcode = '22023'; end if;
  if existing_task.schedule_type = 'once' and exists (select 1 from public.care_task_completions where task_id = existing_task.id) then raise exception 'completed once task cannot be edited' using errcode = '22023'; end if;
  if task_care_type = 'health' then raise exception 'health observations cannot be scheduled' using errcode = '23514'; end if;
  safe_task_category := coalesce(task_category, existing_task.task_category);
  perform private.validate_care_task_input(task_title, task_note, task_schedule_type, task_scheduled_at, task_starts_on, task_local_time, task_time_zone, task_week_day, task_month_day);
  if task_schedule_type = 'once' and (task_scheduled_at <= pg_catalog.clock_timestamp() or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years') then raise exception 'task time is outside the supported range' using errcode = '22023'; end if;
  if task_schedule_type <> 'once' and task_starts_on > (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826 then raise exception 'task start date is outside the supported range' using errcode = '22023'; end if;
  update public.care_tasks set title=btrim(task_title), care_type=task_care_type, note=nullif(btrim(coalesce(task_note,'')),''), schedule_type=task_schedule_type, scheduled_at=task_scheduled_at, starts_on=task_starts_on, local_time=task_local_time::time(0), time_zone=btrim(task_time_zone), week_day=task_week_day, month_day=task_month_day, task_category=safe_task_category, week_days=case when task_schedule_type = 'weekly' then array[task_week_day] end, ends_on=null
  where id=existing_task.id returning * into updated_task;
  return updated_task;
end;
$$;

create or replace function public.create_care_task_v2(
  task_id uuid, target_pet_id uuid, task_title text, task_care_type public.care_type,
  task_note text, task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz, task_starts_on date,
  task_local_time time without time zone, task_time_zone text,
  task_week_days smallint[], task_month_day smallint, task_ends_on date,
  task_category public.care_task_category default 'standard'
)
returns public.care_tasks language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid();
declare created_task public.care_tasks;
declare existing_task public.care_tasks;
declare safe_week_days smallint[];
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if task_id is null or target_pet_id is null or not private.can_contribute_to_pet(target_pet_id) then raise exception 'pet not found' using errcode = '42501'; end if;
  if task_care_type = 'health' then raise exception 'health observations cannot be scheduled' using errcode = '23514'; end if;
  select * into existing_task from public.care_tasks where id = task_id;
  if existing_task.id is not null then
    if existing_task.created_by = caller_id and existing_task.pet_id = target_pet_id then return existing_task; end if;
    raise exception 'care task id is unavailable' using errcode = '23505';
  end if;
  if task_schedule_type = 'weekly' then
    if task_week_days is null or cardinality(task_week_days) = 0
      or array_position(task_week_days, null) is not null
      or not (task_week_days <@ array[1,2,3,4,5,6,7]::smallint[]) then
      raise exception 'invalid weekly schedule' using errcode = '22023';
    end if;
    safe_week_days := private.normalize_care_task_week_days(task_week_days);
  elsif task_week_days is not null then
    raise exception 'weekdays require weekly schedule' using errcode = '22023';
  end if;
  if task_ends_on is not null and (task_schedule_type = 'once' or task_starts_on is null or task_ends_on < task_starts_on) then
    raise exception 'invalid task end date' using errcode = '22023';
  end if;
  perform private.validate_care_task_input(task_title, task_note, task_schedule_type, task_scheduled_at, task_starts_on, task_local_time, task_time_zone, safe_week_days[1], task_month_day);
  if task_schedule_type = 'once' and (task_scheduled_at <= pg_catalog.clock_timestamp() or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years') then raise exception 'task time is outside the supported range' using errcode = '22023'; end if;
  if task_schedule_type <> 'once' and (task_starts_on < (pg_catalog.clock_timestamp() at time zone task_time_zone)::date or task_starts_on > (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826) then raise exception 'task start date is outside the supported range' using errcode = '22023'; end if;
  insert into public.care_tasks (id, pet_id, created_by, title, care_type, note, schedule_type, scheduled_at, starts_on, local_time, time_zone, week_day, month_day, task_category, week_days, ends_on)
  values (task_id, target_pet_id, caller_id, btrim(task_title), task_care_type, nullif(btrim(coalesce(task_note, '')), ''), task_schedule_type, task_scheduled_at, task_starts_on, task_local_time::time(0), btrim(task_time_zone), safe_week_days[1], task_month_day, coalesce(task_category, 'standard'), safe_week_days, task_ends_on)
  returning * into created_task;
  return created_task;
end;
$$;

create or replace function public.update_care_task_v2(
  target_task_id uuid, task_title text, task_care_type public.care_type,
  task_note text, task_schedule_type public.care_task_schedule_type,
  task_scheduled_at timestamptz, task_starts_on date,
  task_local_time time without time zone, task_time_zone text,
  task_week_days smallint[], task_month_day smallint, task_ends_on date,
  task_category public.care_task_category default null
)
returns public.care_tasks language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid();
declare existing_task public.care_tasks;
declare safe_week_days smallint[];
declare updated_task public.care_tasks;
declare safe_task_category public.care_task_category;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into existing_task from public.care_tasks where id = target_task_id;
  if existing_task.id is null or not private.is_pet_member(existing_task.pet_id) or (existing_task.created_by is distinct from caller_id and not private.is_pet_owner(existing_task.pet_id)) then raise exception 'care task not found' using errcode = '42501'; end if;
  perform shift.id from public.care_shifts as shift
  where shift.status = 'scheduled' and exists (
    select 1 from public.care_shift_tasks as item
    where item.shift_id = shift.id and item.care_task_id = target_task_id
  ) order by shift.id for update;
  select * into existing_task from public.care_tasks where id = target_task_id for update;
  if existing_task.id is null or not private.is_pet_member(existing_task.pet_id) or (existing_task.created_by is distinct from caller_id and not private.is_pet_owner(existing_task.pet_id)) then raise exception 'care task not found' using errcode = '42501'; end if;
  if not existing_task.is_active then raise exception 'care task is inactive' using errcode = '22023'; end if;
  if existing_task.schedule_type = 'once' and exists (select 1 from public.care_task_completions where task_id = existing_task.id) then raise exception 'completed once task cannot be edited' using errcode = '22023'; end if;
  if task_care_type = 'health' then raise exception 'health observations cannot be scheduled' using errcode = '23514'; end if;
  safe_task_category := coalesce(task_category, existing_task.task_category);
  if task_schedule_type = 'weekly' then
    if task_week_days is null or cardinality(task_week_days) = 0
      or array_position(task_week_days, null) is not null
      or not (task_week_days <@ array[1,2,3,4,5,6,7]::smallint[]) then
      raise exception 'invalid weekly schedule' using errcode = '22023';
    end if;
    safe_week_days := private.normalize_care_task_week_days(task_week_days);
  elsif task_week_days is not null then
    raise exception 'weekdays require weekly schedule' using errcode = '22023';
  end if;
  if task_ends_on is not null and (task_schedule_type = 'once' or task_starts_on is null or task_ends_on < task_starts_on) then
    raise exception 'invalid task end date' using errcode = '22023';
  end if;
  perform private.validate_care_task_input(task_title, task_note, task_schedule_type, task_scheduled_at, task_starts_on, task_local_time, task_time_zone, safe_week_days[1], task_month_day);
  if task_schedule_type = 'once' and (task_scheduled_at <= pg_catalog.clock_timestamp() or task_scheduled_at > pg_catalog.clock_timestamp() + interval '5 years') then raise exception 'task time is outside the supported range' using errcode = '22023'; end if;
  if task_schedule_type <> 'once' and task_starts_on > (pg_catalog.clock_timestamp() at time zone task_time_zone)::date + 1826 then raise exception 'task start date is outside the supported range' using errcode = '22023'; end if;
  update public.care_tasks set title=btrim(task_title), care_type=task_care_type, note=nullif(btrim(coalesce(task_note,'')),''), schedule_type=task_schedule_type, scheduled_at=task_scheduled_at, starts_on=task_starts_on, local_time=task_local_time::time(0), time_zone=btrim(task_time_zone), week_day=safe_week_days[1], month_day=task_month_day, task_category=safe_task_category, week_days=safe_week_days, ends_on=task_ends_on
  where id=existing_task.id returning * into updated_task;
  return updated_task;
end;
$$;

create function public.get_care_task_occurrences_v2(
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
  week_days smallint[],
  ends_on date,
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
    where (target_pet_id is null or care_task.pet_id = target_pet_id)
      and private.is_pet_member(care_task.pet_id)
  ),
  concrete_occurrences as (
    select care_task.id, care_task.scheduled_at as occurrence_at
    from accessible_tasks as care_task
    where care_task.is_active and care_task.schedule_type = 'once'
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
    where care_task.is_active and care_task.schedule_type <> 'once'
      and (care_task.ends_on is null or local_day.day_value::date <= care_task.ends_on)
      and (
        care_task.schedule_type = 'daily'
        or (
          care_task.schedule_type = 'weekly'
          and extract(isodow from local_day.day_value)::smallint = any(care_task.week_days)
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
  ),
  all_occurrences as (
    select id, occurrence_at from bounded_occurrences
    union
    -- Immutable completed instants survive edits and deactivation.
    select completion.task_id, completion.scheduled_for
    from public.care_task_completions as completion
    join accessible_tasks as care_task on care_task.id = completion.task_id
    where completion.scheduled_for >= window_start
      and completion.scheduled_for < window_end
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
    care_task.week_days,
    care_task.ends_on,
    care_task.is_active,
    (
      care_task.is_active and (coalesce(care_task.created_by = auth.uid(), false)
      or private.is_pet_owner(care_task.pet_id))
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
  from all_occurrences as occurrence
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

create or replace function public.get_care_task_occurrences(
  window_start timestamptz, window_end timestamptz, target_pet_id uuid default null
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
language sql stable security definer set search_path = '' as $$
  select occurrence.task_id, occurrence.pet_id, occurrence.pet_name, occurrence.created_by, occurrence.creator_display_name, occurrence.title, occurrence.care_type, occurrence.note, occurrence.task_category, occurrence.schedule_type, occurrence.scheduled_at, occurrence.starts_on, occurrence.local_time, occurrence.time_zone, occurrence.week_day, occurrence.month_day, occurrence.is_active, occurrence.can_edit, occurrence.can_undo, occurrence.scheduled_for, occurrence.completion_id, occurrence.completed_by, occurrence.completer_display_name, occurrence.completed_at, occurrence.care_log_id
  from public.get_care_task_occurrences_v2(window_start, window_end, target_pet_id) as occurrence
  order by occurrence.scheduled_for, occurrence.task_id;
$$;
create or replace function private.reconcile_care_schedule_after_task_change()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare
  affected_shift_id uuid;
  cancellation_time timestamptz := pg_catalog.clock_timestamp();
begin
  if row(new.starts_on,new.local_time,new.time_zone,new.week_days,new.week_day,new.month_day,new.ends_on,new.schedule_type,new.scheduled_at,new.is_active)
    is not distinct from row(old.starts_on,old.local_time,old.time_zone,old.week_days,old.week_day,old.month_day,old.ends_on,old.schedule_type,old.scheduled_at,old.is_active) then return new; end if;
  for affected_shift_id in
    select shift.id from public.care_shifts as shift
    where shift.status = 'scheduled' and exists (
      select 1 from public.care_shift_tasks as item
      where item.shift_id = shift.id and item.care_task_id = new.id
        and item.status = 'scheduled' and item.source_scheduled_for > cancellation_time
        and not private.is_care_shift_task_completed(item.id,item.care_task_id,item.source_scheduled_for)
        and (not new.is_active or not private.is_care_task_occurrence(new,item.source_scheduled_for))
    ) order by shift.id for update
  loop
    update public.care_shift_tasks as item set status='canceled', canceled_at=cancellation_time, canceled_by=auth.uid()
    where item.shift_id=affected_shift_id and item.care_task_id=new.id
      and item.status='scheduled' and item.source_scheduled_for > cancellation_time
      and not private.is_care_shift_task_completed(item.id,item.care_task_id,item.source_scheduled_for)
      and (not new.is_active or not private.is_care_task_occurrence(new,item.source_scheduled_for));
    perform private.normalize_care_shift_state(affected_shift_id,cancellation_time,auth.uid());
  end loop;
  return new;
end;
$$;
drop trigger reconcile_care_schedule_after_task_change on public.care_tasks;
create trigger reconcile_care_schedule_after_task_change
  after update of starts_on,local_time,time_zone,week_days,week_day,month_day,ends_on,schedule_type,scheduled_at,is_active
  on public.care_tasks for each row execute function private.reconcile_care_schedule_after_task_change();

revoke all on function public.create_care_task_v2(uuid, uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint[], smallint, date, public.care_task_category) from public, anon;
grant execute on function public.create_care_task_v2(uuid, uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint[], smallint, date, public.care_task_category) to authenticated;

revoke all on function public.update_care_task_v2(uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint[], smallint, date, public.care_task_category) from public, anon;
grant execute on function public.update_care_task_v2(uuid, text, public.care_type, text, public.care_task_schedule_type, timestamptz, date, time without time zone, text, smallint[], smallint, date, public.care_task_category) to authenticated;

revoke all on function public.get_care_task_occurrences_v2(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_care_task_occurrences_v2(timestamptz, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';

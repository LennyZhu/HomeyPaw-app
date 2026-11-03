-- Planned identity, actual occurrence and audit timestamps remain separate.
-- No backfill: historical occurred_at values are retained as recorded, not inferred.
-- Legacy completion RPCs remain unchanged, including their existing due rules.
create or replace function public.complete_care_task_v2(
  completion_id uuid,
  care_log_id uuid,
  target_task_id uuid,
  occurrence_scheduled_for timestamptz,
  care_occurred_at timestamptz,
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
  locked_member uuid;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if completion_id is null or care_log_id is null
    or target_task_id is null or occurrence_scheduled_for is null
    or care_occurred_at is null
  then
    raise exception 'completion fields are required' using errcode = '22023';
  end if;

  select * into existing_task
  from public.care_tasks as care_task
  where care_task.id = target_task_id;

  -- Canonical membership lock serializes completion against member removal.
  select membership.user_id into locked_member
  from public.family_members membership
  join public.pets pet on pet.family_id = membership.family_id
  where pet.id = existing_task.pet_id and membership.user_id = caller_id
    and membership.role in ('owner', 'member')
  for share of membership;
  if locked_member is null then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  select * into existing_task from public.care_tasks
  where id = target_task_id for update;

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

  if not pg_catalog.isfinite(care_occurred_at) or care_occurred_at > completion_time then
    raise exception 'actual care time must be finite and not in the future' using errcode = '22023';
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
    (care_occurred_at at time zone existing_task.time_zone)::date;

  insert into public.care_logs (
    id, pet_id, performed_by, care_type, occurred_at, time_zone,
    local_date, note, duration_minutes
  ) values (
    care_log_id,
    existing_task.pet_id,
    caller_id,
    resulting_care_type,
    care_occurred_at,
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

create or replace function public.complete_care_shift_task_v2(
  completion_id uuid,
  care_log_id uuid,
  target_shift_task_id uuid,
  care_occurred_at timestamptz,
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
  locked_member uuid;
  target_shift public.care_shifts;
  target_shift_task public.care_shift_tasks;
  completion_result record;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select shift_task.* into target_shift_task
  from public.care_shift_tasks as shift_task
  where shift_task.id = target_shift_task_id;

  if target_shift_task.id is null then
    raise exception 'care shift task not found' using errcode = '42501';
  end if;

  select membership.user_id into locked_member
  from public.family_members membership
  join public.pets pet on pet.family_id = membership.family_id
  where pet.id = target_shift_task.pet_id and membership.user_id = caller_id
    and membership.role in ('owner', 'member')
  for share of membership;
  if locked_member is null then
    raise exception 'care shift task not found' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_task.shift_id
  for update;

  perform 1
  from public.care_tasks as task
  where task.id = target_shift_task.care_task_id
  for update;

  select shift_task.* into target_shift_task
  from public.care_shift_tasks as shift_task
  where shift_task.id = target_shift_task_id
  for update;

  if target_shift_task.shift_id <> target_shift.id
    or target_shift_task.pet_id <> target_shift.pet_id
  then
    raise exception 'care shift task not found' using errcode = '42501';
  end if;

  if target_shift.status <> 'scheduled'
    or target_shift_task.status <> 'scheduled'
  then
    raise exception 'care shift task is canceled' using errcode = '22023';
  end if;

  select * into completion_result
  from public.complete_care_task_v2(
    completion_id,
    care_log_id,
    target_shift_task.care_task_id,
    target_shift_task.source_scheduled_for,
    care_occurred_at,
    completion_note,
    completion_duration_minutes
  );

  update public.care_task_completions as completion
  set care_shift_task_id = target_shift_task.id
  where completion.id = completion_result.result_completion_id
    and (
      completion.care_shift_task_id is null
      or completion.care_shift_task_id = target_shift_task.id
    );

  if not found then
    raise exception 'completion is linked to another shift task'
      using errcode = '23505';
  end if;

  return query select
    completion_result.completion_status::text,
    completion_result.result_completion_id::uuid,
    completion_result.result_care_log_id::uuid,
    completion_result.result_completed_by::uuid,
    completion_result.result_completed_at::timestamptz;
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
    or existing_log.performed_by is distinct from caller_id
    or not private.can_contribute_to_pet(existing_log.pet_id)
  then
    raise exception 'care log not found' using errcode = '42501';
  end if;

  if care_occurred_at is null then
    raise exception 'care time is required' using errcode = '22023';
  end if;

  if not pg_catalog.isfinite(care_occurred_at) or care_occurred_at > pg_catalog.clock_timestamp() then
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

-- Today is evaluated in each care fact's recorded timezone, never assumed from
-- the viewing device. Existing Care RLS remains the read security boundary.
create function public.get_today_care_logs(target_pet_id uuid)
returns setof public.care_logs language sql stable security invoker set search_path = '' as $$
  select log.* from public.care_logs log
  where log.pet_id = target_pet_id
    and log.local_date = (pg_catalog.statement_timestamp() at time zone log.time_zone)::date
  order by log.occurred_at desc, log.id desc limit 20;
$$;
revoke all on function public.complete_care_task_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,integer) from public, anon, authenticated;
revoke all on function public.complete_care_shift_task_v2(uuid,uuid,uuid,timestamptz,text,integer) from public, anon, authenticated;
revoke all on function public.get_today_care_logs(uuid) from public, anon, authenticated;
grant execute on function public.complete_care_task_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,integer) to authenticated;
grant execute on function public.complete_care_shift_task_v2(uuid,uuid,uuid,timestamptz,text,integer) to authenticated;
grant execute on function public.get_today_care_logs(uuid) to authenticated;

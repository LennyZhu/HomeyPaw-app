-- NULL actual time means just now / one-click completion, using the server clock.
-- Explicit planned/custom timestamps, signatures, authorization and audit semantics
-- remain unchanged. No backfill or historical record updates. CREATE OR REPLACE
-- preserves the existing authenticated-only EXECUTE grants.
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
  actual_care_time timestamptz;
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

  -- Take the server clock after acquiring completion locks, not at request start.
  -- A retry returns the original completed fact without changing either time.
  completion_time := pg_catalog.clock_timestamp();
  actual_care_time := coalesce(care_occurred_at, completion_time);

  if not pg_catalog.isfinite(actual_care_time) or actual_care_time > completion_time then
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
    (actual_care_time at time zone existing_task.time_zone)::date;

  insert into public.care_logs (
    id, pet_id, performed_by, care_type, occurred_at, time_zone,
    local_date, note, duration_minutes
  ) values (
    care_log_id,
    existing_task.pet_id,
    caller_id,
    resulting_care_type,
    actual_care_time,
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

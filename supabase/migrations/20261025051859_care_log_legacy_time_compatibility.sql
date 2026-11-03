-- Preserve the released 1.3.0 edit contract. V2 completion server-now and
-- strict explicit completion-time validation remain unchanged. CREATE OR REPLACE
-- retains the existing function identity, owner and EXECUTE ACL.
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

  if not pg_catalog.isfinite(care_occurred_at) or care_occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
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


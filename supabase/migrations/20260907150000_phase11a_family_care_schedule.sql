create type public.care_schedule_status as enum ('scheduled', 'canceled');

alter table public.care_tasks
  add constraint care_tasks_id_pet_unique unique (id, pet_id);

create table public.care_shifts (
  id uuid primary key,
  pet_id uuid not null references public.pets (id) on delete cascade,
  local_date date not null,
  assignee_user_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  status public.care_schedule_status not null default 'scheduled',
  note text,
  claimed_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references auth.users (id) on delete set null,
  split_from_shift_id uuid references public.care_shifts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_shifts_id_pet_unique unique (id, pet_id),
  constraint care_shifts_note_length check (
    note is null
    or (
      char_length(note) between 1 and 300
      and note = btrim(note)
      and note ~ '[^[:space:]]'
    )
  ),
  constraint care_shifts_canceled_state check (
    (status = 'scheduled' and canceled_at is null)
    or (status = 'canceled' and canceled_at is not null)
  )
);

comment on table public.care_shifts is
  'One date-level family responsibility bundle with zero or one assignee.';
comment on column public.care_shifts.local_date is
  'Date-only responsibility identity verified from every linked Care Task occurrence in that task fixed IANA timezone.';
comment on column public.care_shifts.assignee_user_id is
  'Current primary responsible user. Null means the whole Shift is claimable.';
comment on column public.care_shifts.split_from_shift_id is
  'Source Shift when pending items are split away from immutable completed history.';

create table public.care_shift_tasks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  pet_id uuid not null,
  care_task_id uuid not null,
  source_scheduled_for timestamptz not null,
  status public.care_schedule_status not null default 'scheduled',
  canceled_at timestamptz,
  canceled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint care_shift_tasks_shift_pet_fkey
    foreign key (shift_id, pet_id)
    references public.care_shifts (id, pet_id)
    on delete cascade,
  constraint care_shift_tasks_task_pet_fkey
    foreign key (care_task_id, pet_id)
    references public.care_tasks (id, pet_id)
    on delete cascade,
  constraint care_shift_tasks_occurrence_unique
    unique (care_task_id, source_scheduled_for),
  constraint care_shift_tasks_shift_occurrence_unique
    unique (shift_id, care_task_id, source_scheduled_for),
  constraint care_shift_tasks_canceled_state check (
    (status = 'scheduled' and canceled_at is null)
    or (status = 'canceled' and canceled_at is not null)
  )
);

comment on table public.care_shift_tasks is
  'One independently completable, server-verified Care Task occurrence inside a date-level Shift.';
comment on column public.care_shift_tasks.source_scheduled_for is
  'Immutable occurrence instant validated with the Phase 7 recurrence validator.';

alter table public.care_task_completions
  add column care_shift_task_id uuid,
  add constraint care_task_completions_shift_task_fkey
    foreign key (care_shift_task_id)
    references public.care_shift_tasks (id)
    on delete set null;

create unique index care_task_completions_shift_task_unique
  on public.care_task_completions (care_shift_task_id)
  where care_shift_task_id is not null;

create index care_shifts_pet_date_status_idx
  on public.care_shifts (pet_id, local_date, status, id);
create index care_shifts_pet_assignee_date_idx
  on public.care_shifts (pet_id, assignee_user_id, local_date);
create index care_shifts_active_date_idx
  on public.care_shifts (pet_id, local_date, id)
  where status = 'scheduled';
create index care_shifts_split_from_idx
  on public.care_shifts (split_from_shift_id)
  where split_from_shift_id is not null;
create index care_shift_tasks_shift_status_time_idx
  on public.care_shift_tasks (
    shift_id,
    status,
    source_scheduled_for,
    id
  );
create index care_shift_tasks_task_time_idx
  on public.care_shift_tasks (care_task_id, source_scheduled_for);

create or replace function private.has_care_schedule_access(
  target_pet_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pet_members as membership
    where membership.pet_id = target_pet_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'member')
  );
$$;

create or replace function private.lock_care_schedule_membership(
  target_pet_id uuid
)
returns public.pet_member_role
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_role public.pet_member_role;
begin
  select membership.role into caller_role
  from public.pet_members as membership
  where membership.pet_id = target_pet_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'member')
  for share;

  return caller_role;
end;
$$;

create or replace function private.is_care_shift_task_completed(
  target_shift_task_id uuid,
  target_task_id uuid,
  target_scheduled_for timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_task_completions as completion
    where completion.care_shift_task_id = target_shift_task_id
      or (
        completion.task_id = target_task_id
        and completion.scheduled_for = target_scheduled_for
      )
  );
$$;

create or replace function private.is_care_shift_task_pending_mutable(
  target_shift_task public.care_shift_tasks
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_shifts as shift
    join public.care_tasks as task
      on task.id = target_shift_task.care_task_id
      and task.pet_id = target_shift_task.pet_id
    where shift.id = target_shift_task.shift_id
      and shift.pet_id = target_shift_task.pet_id
      and shift.status = 'scheduled'
      and target_shift_task.status = 'scheduled'
      and shift.local_date >=
        (pg_catalog.clock_timestamp() at time zone task.time_zone)::date
      and not private.is_care_shift_task_completed(
        target_shift_task.id,
        target_shift_task.care_task_id,
        target_shift_task.source_scheduled_for
      )
  );
$$;

create or replace function private.normalize_care_shift_state(
  target_shift_id uuid,
  cancellation_time timestamptz,
  cancellation_actor uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.care_shift_tasks as shift_task
    where shift_task.shift_id = target_shift_id
      and shift_task.status = 'scheduled'
      and not private.is_care_shift_task_completed(
        shift_task.id,
        shift_task.care_task_id,
        shift_task.source_scheduled_for
      )
  )
  and not exists (
    select 1
    from public.care_shift_tasks as shift_task
    where shift_task.shift_id = target_shift_id
      and private.is_care_shift_task_completed(
        shift_task.id,
        shift_task.care_task_id,
        shift_task.source_scheduled_for
      )
  ) then
    update public.care_shifts
    set
      status = 'canceled',
      canceled_at = coalesce(canceled_at, cancellation_time),
      canceled_by = coalesce(canceled_by, cancellation_actor)
    where id = target_shift_id
      and status = 'scheduled';
  end if;
end;
$$;

create or replace function public.set_care_shift_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.assignee_user_id is null then
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

create trigger set_care_shift_updated_at
before update on public.care_shifts
for each row execute function public.set_care_shift_updated_at();

alter table public.care_shifts enable row level security;
alter table public.care_shift_tasks enable row level security;

revoke all on table public.care_shifts from anon, authenticated;
revoke all on table public.care_shift_tasks from anon, authenticated;
grant select on table public.care_shifts to authenticated;
grant select on table public.care_shift_tasks to authenticated;

create policy "Owner and Member can read care shifts"
  on public.care_shifts
  for select
  to authenticated
  using ((select private.has_care_schedule_access(pet_id)));

create policy "Owner and Member can read care shift tasks"
  on public.care_shift_tasks
  for select
  to authenticated
  using ((select private.has_care_schedule_access(pet_id)));

create or replace function private.validate_care_shift_note(shift_note text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  safe_note text;
begin
  safe_note := nullif(btrim(coalesce(shift_note, '')), '');
  if safe_note is not null and char_length(safe_note) > 300 then
    raise exception 'shift note is too long' using errcode = '22001';
  end if;
  return safe_note;
end;
$$;

create or replace function private.validate_care_shift_occurrence(
  target_pet_id uuid,
  target_local_date date,
  target_task_id uuid,
  target_scheduled_for timestamptz
)
returns public.care_tasks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_task public.care_tasks;
  derived_local_date date;
begin
  select task.* into target_task
  from public.care_tasks as task
  where task.id = target_task_id
  for share;

  if target_task.id is null
    or target_task.pet_id <> target_pet_id
    or not target_task.is_active
  then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  if not private.is_care_task_occurrence(
    target_task,
    target_scheduled_for
  ) then
    raise exception 'invalid task occurrence' using errcode = '22023';
  end if;

  derived_local_date :=
    (target_scheduled_for at time zone target_task.time_zone)::date;

  if derived_local_date <> target_local_date then
    raise exception 'shift local date does not match task occurrence'
      using errcode = '22023';
  end if;

  if target_local_date <
    (pg_catalog.clock_timestamp() at time zone target_task.time_zone)::date
  then
    raise exception 'historical task occurrence cannot be scheduled'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.care_task_completions as completion
    where completion.task_id = target_task.id
      and completion.scheduled_for = target_scheduled_for
  ) then
    raise exception 'completed task occurrence cannot be scheduled'
      using errcode = '22023';
  end if;

  return target_task;
end;
$$;

create or replace function private.validate_care_shift_assignee(
  target_pet_id uuid,
  target_assignee_user_id uuid,
  caller_role public.pet_member_role,
  caller_id uuid,
  allow_unassigned boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  assignee_role public.pet_member_role;
begin
  if caller_role = 'member' then
    if target_assignee_user_id is distinct from caller_id then
      raise exception 'member can only schedule self' using errcode = '42501';
    end if;
    return;
  end if;

  if caller_role <> 'owner' then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if target_assignee_user_id is null then
    if not allow_unassigned then
      raise exception 'assignee is required' using errcode = '22023';
    end if;
    return;
  end if;

  select membership.role into assignee_role
  from public.pet_members as membership
  where membership.pet_id = target_pet_id
    and membership.user_id = target_assignee_user_id
    and membership.role in ('owner', 'member')
  for share;

  if assignee_role is null then
    raise exception 'assignee is not a current family member'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_care_shift(
  shift_id uuid,
  target_pet_id uuid,
  shift_local_date date,
  target_assignee_user_id uuid,
  shift_note text,
  task_items jsonb
)
returns public.care_shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  safe_note text;
  created_shift public.care_shifts;
  requested record;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  caller_role := private.lock_care_schedule_membership(target_pet_id);
  if caller_role is null then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if shift_id is null or shift_local_date is null
    or task_items is null
    or pg_catalog.jsonb_typeof(task_items) <> 'array'
    or pg_catalog.jsonb_array_length(task_items) < 1
    or pg_catalog.jsonb_array_length(task_items) > 50
  then
    raise exception 'invalid care shift input' using errcode = '22023';
  end if;

  perform private.validate_care_shift_assignee(
    target_pet_id,
    target_assignee_user_id,
    caller_role,
    caller_id,
    true
  );
  safe_note := private.validate_care_shift_note(shift_note);

  if (
    select count(*)
    from pg_catalog.jsonb_to_recordset(task_items)
      as item(care_task_id uuid, source_scheduled_for timestamptz)
    where item.care_task_id is not null
      and item.source_scheduled_for is not null
  ) <> pg_catalog.jsonb_array_length(task_items)
  then
    raise exception 'invalid care shift task input' using errcode = '22023';
  end if;

  for requested in
    select item.care_task_id, item.source_scheduled_for
    from pg_catalog.jsonb_to_recordset(task_items)
      as item(care_task_id uuid, source_scheduled_for timestamptz)
    order by item.care_task_id, item.source_scheduled_for
  loop
    perform private.validate_care_shift_occurrence(
      target_pet_id,
      shift_local_date,
      requested.care_task_id,
      requested.source_scheduled_for
    );
  end loop;

  insert into public.care_shifts (
    id,
    pet_id,
    local_date,
    assignee_user_id,
    created_by,
    note
  ) values (
    shift_id,
    target_pet_id,
    shift_local_date,
    target_assignee_user_id,
    caller_id,
    safe_note
  )
  returning * into created_shift;

  insert into public.care_shift_tasks (
    shift_id,
    pet_id,
    care_task_id,
    source_scheduled_for
  )
  select
    created_shift.id,
    created_shift.pet_id,
    item.care_task_id,
    item.source_scheduled_for
  from pg_catalog.jsonb_to_recordset(task_items)
    as item(care_task_id uuid, source_scheduled_for timestamptz);

  return created_shift;
end;
$$;

create or replace function public.add_care_shift_tasks(
  target_shift_id uuid,
  task_items jsonb
)
returns setof public.care_shift_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  target_shift public.care_shifts;
  requested record;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id;

  if target_shift.id is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  caller_role := private.lock_care_schedule_membership(target_shift.pet_id);
  if caller_role is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  if caller_role <> 'owner'
    and target_shift.assignee_user_id is distinct from caller_id
  then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  if task_items is null
    or pg_catalog.jsonb_typeof(task_items) <> 'array'
    or pg_catalog.jsonb_array_length(task_items) < 1
    or pg_catalog.jsonb_array_length(task_items) > 50
  then
    raise exception 'invalid care shift task input' using errcode = '22023';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id
  for update;

  if target_shift.status <> 'scheduled' then
    raise exception 'care shift is canceled' using errcode = '22023';
  end if;

  if caller_role <> 'owner'
    and target_shift.assignee_user_id is distinct from caller_id
  then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  for requested in
    select item.care_task_id, item.source_scheduled_for
    from pg_catalog.jsonb_to_recordset(task_items)
      as item(care_task_id uuid, source_scheduled_for timestamptz)
    order by item.care_task_id, item.source_scheduled_for
  loop
    perform private.validate_care_shift_occurrence(
      target_shift.pet_id,
      target_shift.local_date,
      requested.care_task_id,
      requested.source_scheduled_for
    );
  end loop;

  return query
  insert into public.care_shift_tasks (
    shift_id,
    pet_id,
    care_task_id,
    source_scheduled_for
  )
  select
    target_shift.id,
    target_shift.pet_id,
    item.care_task_id,
    item.source_scheduled_for
  from pg_catalog.jsonb_to_recordset(task_items)
    as item(care_task_id uuid, source_scheduled_for timestamptz)
  returning *;
end;
$$;

create or replace function public.update_care_shift(
  target_shift_id uuid,
  target_assignee_user_id uuid,
  shift_note text
)
returns public.care_shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  target_shift public.care_shifts;
  updated_shift public.care_shifts;
  safe_note text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id;

  if target_shift.id is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  caller_role := private.lock_care_schedule_membership(target_shift.pet_id);
  if caller_role is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id
  for update;

  if target_shift.status <> 'scheduled'
    or not exists (
      select 1
      from public.care_shift_tasks as shift_task
      where shift_task.shift_id = target_shift.id
        and private.is_care_shift_task_pending_mutable(shift_task)
    )
  then
    raise exception 'care shift is not mutable' using errcode = '22023';
  end if;

  if caller_role <> 'owner'
    and target_shift.assignee_user_id is distinct from caller_id
  then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  perform private.validate_care_shift_assignee(
    target_shift.pet_id,
    target_assignee_user_id,
    caller_role,
    caller_id,
    true
  );

  if target_shift.assignee_user_id is distinct from target_assignee_user_id
    and exists (
      select 1
      from public.care_shift_tasks as shift_task
      where shift_task.shift_id = target_shift.id
        and private.is_care_shift_task_completed(
          shift_task.id,
          shift_task.care_task_id,
          shift_task.source_scheduled_for
        )
    )
  then
    raise exception 'completed shift responsibility is immutable'
      using errcode = '22023';
  end if;

  safe_note := private.validate_care_shift_note(shift_note);

  update public.care_shifts
  set
    assignee_user_id = target_assignee_user_id,
    note = safe_note,
    claimed_at = case
      when assignee_user_id is distinct from target_assignee_user_id then null
      else claimed_at
    end
  where id = target_shift.id
  returning * into updated_shift;

  return updated_shift;
end;
$$;

create or replace function public.claim_care_shift(target_shift_id uuid)
returns public.care_shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  target_shift public.care_shifts;
  claimed_shift public.care_shifts;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id;

  if target_shift.id is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  caller_role := private.lock_care_schedule_membership(target_shift.pet_id);
  if caller_role is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id
  for update;

  if target_shift.status <> 'scheduled' then
    raise exception 'care shift is canceled' using errcode = '22023';
  end if;

  if target_shift.assignee_user_id is not null then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.care_shift_tasks as shift_task
    where shift_task.shift_id = target_shift.id
      and private.is_care_shift_task_pending_mutable(shift_task)
  ) then
    raise exception 'care shift is not actionable' using errcode = '22023';
  end if;

  update public.care_shifts
  set
    assignee_user_id = caller_id,
    claimed_at = pg_catalog.clock_timestamp()
  where id = target_shift.id
    and assignee_user_id is null
    and status = 'scheduled'
  returning * into claimed_shift;

  if claimed_shift.id is null then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  return claimed_shift;
end;
$$;

create or replace function public.cancel_care_shift_task(
  target_shift_task_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  target_shift public.care_shifts;
  target_shift_task public.care_shift_tasks;
  cancellation_time timestamptz;
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

  caller_role := private.lock_care_schedule_membership(
    target_shift_task.pet_id
  );
  if caller_role is null then
    raise exception 'care shift task not found' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_task.shift_id
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

  if caller_role <> 'owner'
    and target_shift.assignee_user_id is distinct from caller_id
  then
    raise exception 'care shift task not found' using errcode = '42501';
  end if;

  if not private.is_care_shift_task_pending_mutable(target_shift_task) then
    raise exception 'care shift task is not mutable' using errcode = '22023';
  end if;

  cancellation_time := pg_catalog.clock_timestamp();
  update public.care_shift_tasks
  set
    status = 'canceled',
    canceled_at = cancellation_time,
    canceled_by = caller_id
  where id = target_shift_task.id;

  perform private.normalize_care_shift_state(
    target_shift.id,
    cancellation_time,
    caller_id
  );

  return 'canceled';
end;
$$;

create or replace function public.cancel_care_shift(target_shift_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  target_shift public.care_shifts;
  cancellation_time timestamptz;
  canceled_count integer;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id;

  if target_shift.id is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  caller_role := private.lock_care_schedule_membership(target_shift.pet_id);
  if caller_role is null then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  select shift.* into target_shift
  from public.care_shifts as shift
  where shift.id = target_shift_id
  for update;

  if caller_role <> 'owner'
    and target_shift.assignee_user_id is distinct from caller_id
  then
    raise exception 'care shift not found' using errcode = '42501';
  end if;

  cancellation_time := pg_catalog.clock_timestamp();
  update public.care_shift_tasks as shift_task
  set
    status = 'canceled',
    canceled_at = cancellation_time,
    canceled_by = caller_id
  where shift_task.shift_id = target_shift.id
    and private.is_care_shift_task_pending_mutable(shift_task);
  get diagnostics canceled_count = row_count;

  if canceled_count = 0 then
    raise exception 'care shift is not actionable' using errcode = '22023';
  end if;

  perform private.normalize_care_shift_state(
    target_shift.id,
    cancellation_time,
    caller_id
  );

  return case
    when exists (
      select 1
      from public.care_shift_tasks as shift_task
      where shift_task.shift_id = target_shift.id
        and private.is_care_shift_task_completed(
          shift_task.id,
          shift_task.care_task_id,
          shift_task.source_scheduled_for
        )
    ) then 'canceled_remaining'
    else 'canceled'
  end;
end;
$$;

create or replace function public.complete_care_shift_task(
  completion_id uuid,
  care_log_id uuid,
  target_shift_task_id uuid,
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
  caller_role public.pet_member_role;
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

  caller_role := private.lock_care_schedule_membership(
    target_shift_task.pet_id
  );
  if caller_role is null then
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
  from public.complete_care_task(
    completion_id,
    care_log_id,
    target_shift_task.care_task_id,
    target_shift_task.source_scheduled_for,
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

create or replace function public.get_care_schedule_range(
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

create or replace function public.deactivate_care_task(target_task_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  caller_role public.pet_member_role;
  existing_task public.care_tasks;
  affected_shift_id uuid;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select task.* into existing_task
  from public.care_tasks as task
  where task.id = target_task_id;

  if existing_task.id is null then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  caller_role := private.lock_care_schedule_membership(existing_task.pet_id);
  if caller_role is null
    or (
      caller_role <> 'owner'
      and existing_task.created_by is distinct from caller_id
    )
  then
    raise exception 'care task not found' using errcode = '42501';
  end if;

  for affected_shift_id in
    select distinct shift_task.shift_id
    from public.care_shift_tasks as shift_task
    where shift_task.care_task_id = existing_task.id
    order by shift_task.shift_id
  loop
    perform 1
    from public.care_shifts as shift
    where shift.id = affected_shift_id
    for update;
  end loop;

  select task.* into existing_task
  from public.care_tasks as task
  where task.id = target_task_id
  for update;

  if not existing_task.is_active then
    return 'already_inactive';
  end if;

  update public.care_tasks
  set is_active = false, deactivated_at = pg_catalog.clock_timestamp()
  where id = existing_task.id;

  return 'deactivated';
end;
$$;

create or replace function private.reconcile_care_schedule_after_task_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_shift_id uuid;
  cancellation_time timestamptz;
begin
  if new.is_active is not distinct from old.is_active then
    return new;
  end if;

  cancellation_time := pg_catalog.clock_timestamp();

  for affected_shift_id in
    select distinct shift_task.shift_id
    from public.care_shift_tasks as shift_task
    join public.care_shifts as shift on shift.id = shift_task.shift_id
    where shift_task.care_task_id = new.id
      and shift_task.status = 'scheduled'
      and shift.local_date >=
        (cancellation_time at time zone old.time_zone)::date
      and not private.is_care_shift_task_completed(
        shift_task.id,
        shift_task.care_task_id,
        shift_task.source_scheduled_for
      )
      and not new.is_active
    order by shift_task.shift_id
  loop
    update public.care_shift_tasks as shift_task
    set
      status = 'canceled',
      canceled_at = cancellation_time,
      canceled_by = auth.uid()
    where shift_task.shift_id = affected_shift_id
      and shift_task.care_task_id = new.id
      and shift_task.status = 'scheduled'
      and not private.is_care_shift_task_completed(
        shift_task.id,
        shift_task.care_task_id,
        shift_task.source_scheduled_for
      );

    perform private.normalize_care_shift_state(
      affected_shift_id,
      cancellation_time,
      auth.uid()
    );
  end loop;

  return new;
end;
$$;

create trigger reconcile_care_schedule_after_task_change
after update of is_active
on public.care_tasks
for each row execute function private.reconcile_care_schedule_after_task_change();

create or replace function private.reconcile_removed_member_care_shifts()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_shift public.care_shifts;
  completed_count integer;
  pending_count integer;
  replacement_shift_id uuid;
begin
  if old.role not in ('owner', 'member') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and new.role in ('owner', 'member') then
    return new;
  end if;

  if not exists (
    select 1 from public.pets as pet where pet.id = old.pet_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  for target_shift in
    select shift.*
    from public.care_shifts as shift
    where shift.pet_id = old.pet_id
      and shift.assignee_user_id = old.user_id
      and shift.status = 'scheduled'
      and exists (
        select 1
        from public.care_shift_tasks as shift_task
        where shift_task.shift_id = shift.id
          and private.is_care_shift_task_pending_mutable(shift_task)
      )
    order by shift.id
    for update
  loop
    select
      count(*) filter (
        where private.is_care_shift_task_completed(
          shift_task.id,
          shift_task.care_task_id,
          shift_task.source_scheduled_for
        )
      ),
      count(*) filter (
        where private.is_care_shift_task_pending_mutable(shift_task)
      )
    into completed_count, pending_count
    from public.care_shift_tasks as shift_task
    where shift_task.shift_id = target_shift.id;

    if pending_count = 0 then
      continue;
    end if;

    if completed_count = 0 then
      update public.care_shifts
      set assignee_user_id = null, claimed_at = null
      where id = target_shift.id;
      continue;
    end if;

    replacement_shift_id := gen_random_uuid();
    insert into public.care_shifts (
      id,
      pet_id,
      local_date,
      assignee_user_id,
      created_by,
      note,
      split_from_shift_id
    ) values (
      replacement_shift_id,
      target_shift.pet_id,
      target_shift.local_date,
      null,
      target_shift.created_by,
      target_shift.note,
      target_shift.id
    );

    update public.care_shift_tasks as shift_task
    set shift_id = replacement_shift_id
    where shift_task.shift_id = target_shift.id
      and private.is_care_shift_task_pending_mutable(shift_task);
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger reconcile_removed_member_care_shifts
before delete or update of role on public.pet_members
for each row execute function private.reconcile_removed_member_care_shifts();

create or replace function private.split_care_shift_after_assignee_null()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  replacement_shift_id uuid;
begin
  if old.assignee_user_id is null
    or new.assignee_user_id is not null
    or new.status <> 'scheduled'
    or not exists (
      select 1
      from public.pets as pet
      where pet.id = new.pet_id
    )
    or not exists (
      select 1
      from public.care_shift_tasks as shift_task
      where shift_task.shift_id = new.id
        and private.is_care_shift_task_completed(
          shift_task.id,
          shift_task.care_task_id,
          shift_task.source_scheduled_for
        )
    )
    or not exists (
      select 1
      from public.care_shift_tasks as shift_task
      where shift_task.shift_id = new.id
        and private.is_care_shift_task_pending_mutable(shift_task)
    )
  then
    return new;
  end if;

  replacement_shift_id := gen_random_uuid();
  insert into public.care_shifts (
    id,
    pet_id,
    local_date,
    assignee_user_id,
    created_by,
    note,
    split_from_shift_id
  ) values (
    replacement_shift_id,
    new.pet_id,
    new.local_date,
    null,
    new.created_by,
    new.note,
    new.id
  );

  update public.care_shift_tasks as shift_task
  set shift_id = replacement_shift_id
  where shift_task.shift_id = new.id
    and private.is_care_shift_task_pending_mutable(shift_task);

  return new;
end;
$$;

create trigger split_care_shift_after_assignee_null
after update of assignee_user_id on public.care_shifts
for each row execute function private.split_care_shift_after_assignee_null();

revoke execute on function private.has_care_schedule_access(uuid)
  from public, anon;
grant execute on function private.has_care_schedule_access(uuid)
  to authenticated;
revoke execute on function private.lock_care_schedule_membership(uuid)
  from public, anon, authenticated;
revoke execute on function private.is_care_shift_task_completed(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke execute on function private.is_care_shift_task_pending_mutable(
  public.care_shift_tasks
) from public, anon, authenticated;
revoke execute on function private.normalize_care_shift_state(
  uuid, timestamptz, uuid
) from public, anon, authenticated;
revoke execute on function public.set_care_shift_updated_at()
  from public, anon, authenticated;
revoke execute on function private.validate_care_shift_note(text)
  from public, anon, authenticated;
revoke execute on function private.validate_care_shift_occurrence(
  uuid, date, uuid, timestamptz
) from public, anon, authenticated;
revoke execute on function private.validate_care_shift_assignee(
  uuid, uuid, public.pet_member_role, uuid, boolean
) from public, anon, authenticated;
revoke execute on function private.reconcile_care_schedule_after_task_change()
  from public, anon, authenticated;
revoke execute on function private.reconcile_removed_member_care_shifts()
  from public, anon, authenticated;
revoke execute on function private.split_care_shift_after_assignee_null()
  from public, anon, authenticated;

revoke execute on function public.create_care_shift(
  uuid, uuid, date, uuid, text, jsonb
) from public, anon;
revoke execute on function public.update_care_shift(uuid, uuid, text)
  from public, anon;
revoke execute on function public.cancel_care_shift(uuid)
  from public, anon;
revoke execute on function public.claim_care_shift(uuid)
  from public, anon;
revoke execute on function public.add_care_shift_tasks(uuid, jsonb)
  from public, anon;
revoke execute on function public.cancel_care_shift_task(uuid)
  from public, anon;
revoke execute on function public.complete_care_shift_task(
  uuid, uuid, uuid, text, integer
) from public, anon;
revoke execute on function public.get_care_schedule_range(uuid, date, date)
  from public, anon;

grant execute on function public.create_care_shift(
  uuid, uuid, date, uuid, text, jsonb
) to authenticated;
grant execute on function public.update_care_shift(uuid, uuid, text)
  to authenticated;
grant execute on function public.cancel_care_shift(uuid)
  to authenticated;
grant execute on function public.claim_care_shift(uuid)
  to authenticated;
grant execute on function public.add_care_shift_tasks(uuid, jsonb)
  to authenticated;
grant execute on function public.cancel_care_shift_task(uuid)
  to authenticated;
grant execute on function public.complete_care_shift_task(
  uuid, uuid, uuid, text, integer
) to authenticated;
grant execute on function public.get_care_schedule_range(uuid, date, date)
  to authenticated;

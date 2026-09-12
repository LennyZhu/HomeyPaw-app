-- Keep canceled Schedule items as history while allowing the same Care Task
-- occurrence to be scheduled again. Completed items remain status = scheduled
-- and are therefore still protected by the replacement partial unique index.

do $migration$
begin
  if exists (
    select 1
    from public.care_shift_tasks
    where status <> 'canceled'
    group by care_task_id, source_scheduled_for
    having count(*) > 1
  ) then
    raise exception
      'cannot create Schedule occurrence uniqueness: duplicate non-canceled rows exist'
      using errcode = '23505';
  end if;
end;
$migration$;

alter table public.care_shift_tasks
  drop constraint care_shift_tasks_occurrence_unique;

create unique index care_shift_tasks_non_canceled_occurrence_unique_idx
  on public.care_shift_tasks (care_task_id, source_scheduled_for)
  where status <> 'canceled';

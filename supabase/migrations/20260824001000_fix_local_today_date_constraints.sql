alter table public.posts
  drop constraint posts_event_date_not_future;

alter table public.posts
  add constraint posts_event_date_not_future
  check (event_date <= ((now() at time zone 'UTC')::date + 1));

comment on constraint posts_event_date_not_future on public.posts is
  'Allows the latest possible local calendar date worldwide (UTC date + 1). The app applies the exact device-local today limit.';

create or replace function public.set_pet_updated_at_and_validate_dates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  latest_supported_local_date date;
begin
  latest_supported_local_date :=
    (now() at time zone 'UTC')::date + 1;

  if new.birthday is not null
    and new.birthday > latest_supported_local_date
  then
    raise exception 'birthday cannot be in the future'
      using errcode = '23514';
  end if;

  if new.adoption_date is not null
    and new.adoption_date > latest_supported_local_date
  then
    raise exception 'adoption_date cannot be in the future'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_pet_updated_at_and_validate_dates() is
  'Validates date-only Pet fields against the latest possible local calendar date worldwide while keeping the database in UTC.';

revoke execute on function public.set_pet_updated_at_and_validate_dates()
  from public, anon, authenticated;

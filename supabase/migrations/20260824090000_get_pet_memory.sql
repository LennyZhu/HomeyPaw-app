create or replace function public.get_pet_memory(
  target_pet_id uuid,
  local_today date
)
returns table (
  memory_post_id uuid,
  memory_kind text,
  memory_years_ago integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_pet_member(target_pet_id) then
    raise exception 'pet not found' using errcode = '42501';
  end if;

  if local_today is null
    or local_today < ((now() at time zone 'utc')::date - 1)
    or local_today > ((now() at time zone 'utc')::date + 1)
  then
    raise exception 'invalid local date' using errcode = '22023';
  end if;

  return query
  select
    post.id,
    'on_this_day'::text,
    extract(year from age(local_today, post.event_date))::integer
  from public.posts as post
  where post.pet_id = target_pet_id
    and post.event_date < local_today
    and extract(month from post.event_date) = extract(month from local_today)
    and extract(day from post.event_date) = extract(day from local_today)
  order by post.event_date desc, post.created_at desc, post.id desc
  limit 1;

  if found then
    return;
  end if;

  return query
  select
    post.id,
    'recent'::text,
    null::integer
  from public.posts as post
  where post.pet_id = target_pet_id
    and post.event_date < (local_today - 30)
  order by post.event_date desc, post.created_at desc, post.id desc
  limit 1;
end;
$$;

revoke execute on function public.get_pet_memory(uuid, date)
  from public, anon;
grant execute on function public.get_pet_memory(uuid, date)
  to authenticated;

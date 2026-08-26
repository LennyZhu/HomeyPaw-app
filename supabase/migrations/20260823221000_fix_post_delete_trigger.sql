create or replace function public.validate_post_has_content_or_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post_id uuid;
begin
  if tg_table_name = 'posts' then
    target_post_id := coalesce(new.id, old.id);
  else
    target_post_id := coalesce(new.post_id, old.post_id);
  end if;

  if exists (
    select 1
    from public.posts as post
    where post.id = target_post_id
      and post.content is null
      and not exists (
        select 1
        from public.post_media as media
        where media.post_id = post.id
      )
  ) then
    raise exception 'post must contain text or at least one image'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

comment on function public.validate_post_has_content_or_media() is
  'Deferred journal invariant check. Runs as its migration owner so Auth user deletion cascades can evaluate Posts safely.';

revoke execute on function public.validate_post_has_content_or_media()
  from public, anon, authenticated;

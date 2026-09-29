begin;

-- Preserve the executed create_profiles migration. Change only future Auth
-- inserts; existing profile names, trigger wiring, owner and ACLs stay intact.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_name text;
  safe_display_name text;
  safe_locale text;
begin
  metadata_name := nullif(
    regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'display_name', ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  if metadata_name is not null and metadata_name !~ '[^[:space:]]' then
    metadata_name := null;
  end if;
  safe_display_name := left(
    coalesce(
      metadata_name,
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'HomeyPaw user'
    ),
    80
  );
  safe_locale := case
    when new.raw_user_meta_data ->> 'locale' in ('zh-HK', 'en')
      then new.raw_user_meta_data ->> 'locale'
    else 'zh-HK'
  end;

  insert into public.profiles (id, display_name, locale)
  values (new.id, safe_display_name, safe_locale)
  on conflict (id) do nothing;

  return new;
end;
$$;

commit;

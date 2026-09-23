begin;

create or replace function public.delete_family(target_family_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  locked_family_id uuid;
begin
  caller_id := auth.uid();

  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if target_family_id is null then
    raise exception 'family not found' using errcode = '42501';
  end if;

  -- All canonical Family mutations share this lock namespace and acquire it
  -- before membership, Pet, invite, Chat, or Schedule rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  select family.id into locked_family_id
  from public.families as family
  where family.id = target_family_id
  for update;

  if locked_family_id is null
    or not exists (
      select 1
      from public.family_members as membership
      where membership.family_id = target_family_id
        and membership.user_id = caller_id
        and membership.role = 'owner'
    )
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

  -- Match the established Family mutation lock order before the destructive
  -- aggregate operation. The authorization source remains family_members.
  perform membership.user_id
  from public.family_members as membership
  where membership.family_id = target_family_id
  order by membership.user_id
  for update;

  perform pet.id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.id
  for update;

  -- pets.family_id intentionally remains RESTRICT so accidental Family DELETE
  -- statements cannot orphan or silently erase Pet aggregates. This canonical
  -- RPC deletes every Pet by family_id in the same transaction. Existing Pet
  -- cascades remove history and C4E triggers durably enqueue owned media.
  delete from public.pets
  where family_id = target_family_id;

  delete from public.families
  where id = target_family_id;

  return 'deleted';
end;
$$;

comment on function public.delete_family(uuid) is
  'Owner-only atomic deletion of one Family aggregate. Deletes every Pet by canonical family_id and relies on database cascades plus durable C4E media cleanup.';

revoke execute on function public.delete_family(uuid)
  from public, anon;
grant execute on function public.delete_family(uuid)
  to authenticated;

commit;

create or replace function public.validate_pet_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pet_id uuid;
begin
  target_pet_id := old.pet_id;

  if exists (
    select 1 from public.pets as pet where pet.id = target_pet_id
  ) and not exists (
    select 1
    from public.pet_members as membership
    where membership.pet_id = target_pet_id
      and membership.role = 'owner'
  ) then
    raise exception 'pet must keep one owner' using errcode = '23514';
  end if;

  return old;
end;
$$;

comment on function public.validate_pet_keeps_owner() is
  'Deferred owner invariant check. Runs as its migration owner so Auth user deletion cascades can evaluate the Pet safely.';

revoke execute on function public.validate_pet_keeps_owner()
  from public, anon, authenticated;

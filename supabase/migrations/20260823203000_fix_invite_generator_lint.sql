create or replace function private.generate_pet_invite_code()
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  random_bytes bytea;
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  generated_code text := '';
begin
  random_bytes := extensions.gen_random_bytes(8);

  for index in 0..7 loop
    generated_code := generated_code || pg_catalog.substr(
      alphabet,
      (pg_catalog.get_byte(random_bytes, index) % 32) + 1,
      1
    );
  end loop;

  return generated_code;
end;
$$;

revoke execute on function private.generate_pet_invite_code()
  from public, anon, authenticated;

-- 1.4.1 Family headcount. No Billing/Quota/Storage flag or existing membership mutation.
-- Cutover captures only already-valid invitations; their original expiry/use budget
-- and original Owner/Member ceiling are retained. New invitations count all roles.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.families, public.pets, public.family_members, public.pet_members,
  public.family_invites, public.pet_invites in share row exclusive mode;

create table private.family_invite_legacy_allowances (
  invite_id uuid primary key,
  family_id uuid not null,
  code_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  max_uses integer not null check(max_uses between 1 and 5),
  used_at_cutover integer not null,
  remaining_uses integer not null check(remaining_uses between 1 and 5),
  member_count_at_cutover integer not null,
  counted_members_at_cutover integer not null,
  total_ceiling integer not null check(total_ceiling>=10),
  captured_at timestamptz not null default statement_timestamp(),
  check(used_at_cutover >= 0 and used_at_cutover + remaining_uses = max_uses),
  check(counted_members_at_cutover between 0 and member_count_at_cutover),
  check(total_ceiling=10+member_count_at_cutover-counted_members_at_cutover)
);
create table private.family_invite_legacy_admissions (
  invite_id uuid not null references private.family_invite_legacy_allowances(invite_id),
  use_number integer not null check(use_number between 1 and 5),
  family_id uuid not null,
  user_id uuid not null,
  transaction_id bigint not null,
  member_count_before integer not null check(member_count_before>=0),
  plan_limit integer not null check(plan_limit in (2,10)),
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(invite_id,use_number)
);
create index family_invite_legacy_admission_transaction
  on private.family_invite_legacy_admissions(transaction_id,family_id,user_id);
alter table private.family_invite_legacy_allowances enable row level security;
alter table private.family_invite_legacy_admissions enable row level security;
revoke all on private.family_invite_legacy_allowances, private.family_invite_legacy_admissions
  from public, anon, authenticated, service_role;

-- Fail rather than snapshot a mismatched canonical/legacy invitation.
do $$ begin
  if exists(select 1 from public.family_invites i
    where i.revoked_at is null and i.expires_at > statement_timestamp() and i.used_count < i.max_uses
      and not exists(select 1 from public.pet_invites p join public.pets pet on pet.id=p.pet_id
        where p.id=i.id and pet.family_id=i.family_id and p.code_hash=i.code_hash
          and p.expires_at=i.expires_at and p.max_uses=i.max_uses and p.used_count=i.used_count
          and p.revoked_at is null and p.created_at=i.created_at)) then
    raise exception 'family invitation mirror drift';
  end if;
end $$;
insert into private.family_invite_legacy_allowances
  (invite_id,family_id,code_hash,created_at,expires_at,max_uses,used_at_cutover,remaining_uses,
    member_count_at_cutover,counted_members_at_cutover,total_ceiling)
select i.id,i.family_id,i.code_hash,i.created_at,i.expires_at,i.max_uses,i.used_count,i.max_uses-i.used_count,
  counts.total,counts.counted,10+counts.total-counts.counted
from public.family_invites i cross join lateral (
  select count(*)::integer total,count(*) filter(where role in('owner','member'))::integer counted
  from public.family_members m where m.family_id=i.family_id
) counts where i.revoked_at is null and i.expires_at > statement_timestamp()
  and i.used_count < i.max_uses;

create function private.guard_family_invite_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'family invite history is append only' using errcode='42501'; end $$;
revoke all on function private.guard_family_invite_history() from public,anon,authenticated,service_role;
create trigger immutable_family_invite_allowance before update or delete
  on private.family_invite_legacy_allowances for each row execute function private.guard_family_invite_history();
create trigger immutable_family_invite_admission before update or delete
  on private.family_invite_legacy_admissions for each row execute function private.guard_family_invite_history();

-- Only an active, server-verified App Store subscription and its matching private
-- entitlement grant ten seats. No client flags, media transition, or bare tier row.
-- Closing checkout/Billing does not revoke an already verified paid entitlement.
create function private.family_member_plan(target_family uuid, at_time timestamptz)
returns table(member_limit integer,plus_until timestamptz)
language sql stable security definer set search_path='' as $$
  select case when max(least(e.ends_at,s.access_until)) is null then 2 else 10 end,
    max(least(e.ends_at,s.access_until))
  from private.family_media_entitlements e
  join private.family_store_subscriptions s on s.id=e.billing_subscription_id and s.family_id=e.family_id
    and s.environment=e.billing_environment and s.store='APP_STORE'
  join private.family_billing_config c on c.singleton and c.environment=s.environment
  where e.family_id=target_family and e.tier='plus' and e.revoked_at is null
    and e.starts_at<=at_time and e.ends_at>at_time
    and s.gives_access and s.status in('active','cancelled','in_grace_period')
    and s.started_at<=at_time and s.access_until>at_time
    and s.product_id in(c.monthly_product_id,c.yearly_product_id);
$$;
revoke all on function private.family_member_plan(uuid,timestamptz) from public,anon,authenticated,service_role;

-- All paths use the existing Family advisory lock. Reject stale-snapshot isolation
-- instead of risking a repeatable-read write skew after waiting for that lock.
create function private.lock_family_member_capacity(target_family uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'family capacity requires a fresh transaction' using errcode='40001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_family::text,4815162342));
end $$;
revoke all on function private.lock_family_member_capacity(uuid) from public,anon,authenticated,service_role;

-- Also guard INSERT itself: an old RPC already running at cutover may resume
-- with its cached five-use body after the migration commits. Clamp that new
-- code's reservation, or fail atomically without revoking the historical code.
create function private.enforce_family_invite_capacity()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare total integer; plan record;
begin
  perform private.lock_family_member_capacity(new.family_id);
  select count(*) into total from public.family_members where family_id=new.family_id;
  select * into plan from private.family_member_plan(new.family_id,clock_timestamp());
  if total>=plan.member_limit then
    raise exception 'family_member_limit_reached' using errcode='P0001',
      detail=format('member_limit=%s;plan=%s',plan.member_limit,case when plan.member_limit=2 then 'free' else 'plus' end);
  end if;
  if new.max_uses is null then raise exception 'invalid invite uses' using errcode='22023'; end if;
  new.max_uses:=least(new.max_uses,plan.member_limit-total);
  return new;
end $$;
revoke all on function private.enforce_family_invite_capacity() from public,anon,authenticated,service_role;
create trigger enforce_family_invite_capacity_before_insert before insert on public.family_invites
  for each row execute function private.enforce_family_invite_capacity();

create function private.reserve_family_invite_admission(invitation public.family_invites, joining_user uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare total integer; counted integer; plan record; legacy private.family_invite_legacy_allowances;
begin
  perform private.lock_family_member_capacity(invitation.family_id);
  select count(*),count(*) filter(where role in('owner','member')) into total,counted
    from public.family_members where family_id=invitation.family_id;
  select * into plan from private.family_member_plan(invitation.family_id,clock_timestamp());
  if invitation.revoked_at is not null or invitation.expires_at<=clock_timestamp()
    or invitation.used_count>=invitation.max_uses then
    raise exception 'invite_invalid' using errcode='P0001';
  end if;
  select * into legacy from private.family_invite_legacy_allowances l
    where l.invite_id=invitation.id and l.family_id=invitation.family_id and l.code_hash=invitation.code_hash
      and l.created_at=invitation.created_at and l.expires_at=invitation.expires_at and l.max_uses=invitation.max_uses;
  if legacy.invite_id is not null then
    if counted>=10 or total>=legacy.total_ceiling then
      raise exception 'family_member_limit_reached' using errcode='P0001', detail='member_limit=10;plan=legacy';
    end if;
    if invitation.used_count<legacy.used_at_cutover
      or invitation.used_count>=legacy.used_at_cutover+legacy.remaining_uses then
      raise exception 'invite_invalid' using errcode='P0001';
    end if;
    insert into private.family_invite_legacy_admissions
      (invite_id,use_number,family_id,user_id,transaction_id,member_count_before,plan_limit)
    values(invitation.id,invitation.used_count+1,invitation.family_id,joining_user,txid_current(),total,plan.member_limit);
  elsif total>=plan.member_limit then
    raise exception 'family_member_limit_reached' using errcode='P0001',
      detail=format('member_limit=%s;plan=%s',plan.member_limit,case when plan.member_limit=2 then 'free' else 'plus' end);
  end if;
end $$;
revoke all on function private.reserve_family_invite_admission(public.family_invites,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.enforce_family_member_limit()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare total integer; plan record;
begin
  -- A role/Owner change within an existing membership never adds a person.
  if tg_op='UPDATE' then
    if new.family_id=old.family_id and new.user_id=old.user_id then return new; end if;
  end if;
  perform private.lock_family_member_capacity(new.family_id);
  if exists(select 1 from public.family_members where family_id=new.family_id and user_id=new.user_id) then return new; end if;
  select count(*) into total from public.family_members where family_id=new.family_id;
  select * into plan from private.family_member_plan(new.family_id,clock_timestamp());
  if total>=plan.member_limit and not exists(
    select 1 from private.family_invite_legacy_admissions a
    join private.family_invite_legacy_allowances l on l.invite_id=a.invite_id and l.family_id=a.family_id
    where a.family_id=new.family_id and a.user_id=new.user_id and a.transaction_id=txid_current()
      and a.member_count_before=total and total<l.total_ceiling) then
    raise exception 'family_member_limit_reached' using errcode='P0001',
      detail=format('member_limit=%s;plan=%s',plan.member_limit,case when plan.member_limit=2 then 'free' else 'plus' end);
  end if;
  return new;
end $$;
revoke all on function private.enforce_family_member_limit() from public,anon,authenticated,service_role;

create or replace function private.enforce_pet_family_member_limit()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare target_family uuid; total integer; plan record;
begin
  if tg_op='UPDATE' then
    if new.pet_id=old.pet_id and new.user_id=old.user_id then return new; end if;
  end if;
  select family_id into target_family from public.pets where id=new.pet_id;
  if target_family is null then raise exception 'family not found' using errcode='42501'; end if;
  perform private.lock_family_member_capacity(target_family);
  -- Pet mirrors (including a newly created Pet in an over-limit historical
  -- Family) do not add a Family member. The canonical insert is authoritative.
  if exists(select 1 from public.family_members where family_id=target_family and user_id=new.user_id) then return new; end if;
  select count(*) into total from public.family_members where family_id=target_family;
  select * into plan from private.family_member_plan(target_family,clock_timestamp());
  if total>=plan.member_limit then
    raise exception 'family_member_limit_reached' using errcode='P0001',
      detail=format('member_limit=%s;plan=%s',plan.member_limit,case when plan.member_limit=2 then 'free' else 'plus' end);
  end if;
  return new;
end $$;
revoke all on function private.enforce_pet_family_member_limit() from public,anon,authenticated,service_role;

create or replace function public.create_family_invite(target_family_id uuid)
returns table (
  invite_id uuid,
  invite_code text,
  invite_expires_at timestamptz,
  invite_max_uses integer,
  invite_used_count integer,
  invite_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  locked_family_id uuid;
  anchor_pet_id uuid;
  generated_code text;
  generated_hash text;
  created_invite public.family_invites;
  revocation_time timestamptz := now();
  attempt integer := 0;
  member_total integer;
  plan record;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_family_owner(target_family_id) then
    raise exception 'family not found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_family_id::text, 4815162342)
  );

  select family.id into locked_family_id
  from public.families as family
  where family.id = target_family_id
  for update;

  if locked_family_id is null
    or not private.is_family_owner(target_family_id)
  then
    raise exception 'family not found' using errcode = '42501';
  end if;

  select pet.id into anchor_pet_id
  from public.pets as pet
  where pet.family_id = target_family_id
  order by pet.created_at, pet.id
  limit 1
  for update;

  if anchor_pet_id is null then
    raise exception 'family has no display pet' using errcode = 'P0001';
  end if;

  perform private.lock_family_member_capacity(target_family_id);
  select count(*) into member_total from public.family_members where family_id=target_family_id;
  select * into plan from private.family_member_plan(target_family_id,clock_timestamp());
  if member_total>=plan.member_limit then
    raise exception 'family_member_limit_reached' using errcode='P0001',
      detail=format('member_limit=%s;plan=%s',plan.member_limit,case when plan.member_limit=2 then 'free' else 'plus' end);
  end if;

  if exists (
    select 1
    from public.family_invites as invite
    where invite.family_id = target_family_id
      and invite.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'invite creation rate limited' using errcode = 'P0001';
  end if;

  update public.family_invites
  set revoked_at = revocation_time
  where family_id = target_family_id
    and revoked_at is null;

  update public.pet_invites as invite
  set revoked_at = revocation_time
  where invite.revoked_at is null
    and exists (
      select 1
      from public.pets as pet
      where pet.id = invite.pet_id
        and pet.family_id = target_family_id
    );

  loop
    attempt := attempt + 1;
    generated_code := private.generate_pet_invite_code();
    generated_hash := private.pet_invite_code_hash(generated_code);

    begin
      insert into public.family_invites (
        family_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses
      )
      values (
        target_family_id,
        caller_id,
        generated_hash,
        now() + interval '7 days',
        least(5,plan.member_limit-member_total)
      )
      returning * into created_invite;

      insert into public.pet_invites (
        id,
        pet_id,
        invited_by,
        code_hash,
        expires_at,
        max_uses,
        used_count,
        revoked_at,
        created_at
      )
      values (
        created_invite.id,
        anchor_pet_id,
        created_invite.invited_by,
        created_invite.code_hash,
        created_invite.expires_at,
        created_invite.max_uses,
        created_invite.used_count,
        created_invite.revoked_at,
        created_invite.created_at
      );

      exit;
    exception
      when unique_violation then
        if attempt >= 5 then
          raise exception 'invite generation failed' using errcode = 'P0001';
        end if;
    end;
  end loop;

  return query
  select
    created_invite.id,
    generated_code,
    created_invite.expires_at,
    created_invite.max_uses,
    created_invite.used_count,
    created_invite.created_at;
end;
$$;


create or replace function public.join_family_with_invite(invite_code text)
returns table (
  join_status text,
  joined_family_id uuid,
  display_pet_id uuid,
  display_pet_name text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  normalized_code text;
  invite_hash text;
  matched_family_id uuid;
  matched_invite public.family_invites;
  anchor_pet_id uuid;
  anchor_pet_name text;
  membership_created_at timestamptz;
  updated_invite public.family_invites;
  mirrored_count integer;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  normalized_code := private.normalize_pet_invite_code(invite_code);
  if normalized_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  invite_hash := private.pet_invite_code_hash(normalized_code);

  select invite.family_id into matched_family_id
  from public.family_invites as invite
  where invite.code_hash = invite_hash;

  if matched_family_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(matched_family_id::text, 4815162342)
  );

  select invite.* into matched_invite
  from public.family_invites as invite
  where invite.code_hash = invite_hash
    and invite.family_id = matched_family_id
  for update;

  if matched_invite.id is null
    or matched_invite.revoked_at is not null
    or matched_invite.expires_at <= now()
  then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  perform pet.id
  from public.pets as pet
  where pet.family_id = matched_family_id
  order by pet.id
  for share;

  select pet.id, pet.name
  into anchor_pet_id, anchor_pet_name
  from public.pets as pet
  where pet.family_id = matched_family_id
  order by pet.created_at, pet.id
  limit 1;

  if anchor_pet_id is null then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  -- Preserve the Family-first lock order, then serialize all joins for this
  -- account with the same Auth row lock used by C4G deletion preparation.
  perform 1 from auth.users where id = caller_id for update;
  if exists (
    select 1 from public.family_members where user_id = caller_id
  ) then
    raise exception 'ALREADY_IN_FAMILY' using errcode = 'P0001';
  end if;

  if matched_invite.used_count >= matched_invite.max_uses then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  perform private.reserve_family_invite_admission(matched_invite,caller_id);

  membership_created_at := now();
  insert into public.family_members (family_id, user_id, role, created_at)
  values (matched_family_id, caller_id, 'member', membership_created_at);

  insert into public.pet_members (pet_id, user_id, role, created_at)
  select pet.id, caller_id, 'member', membership_created_at
  from public.pets as pet
  where pet.family_id = matched_family_id
  order by pet.id;

  update public.family_invites
  set used_count = used_count + 1
  where id = matched_invite.id
  returning * into updated_invite;

  update public.pet_invites
  set
    invited_by = updated_invite.invited_by,
    code_hash = updated_invite.code_hash,
    expires_at = updated_invite.expires_at,
    max_uses = updated_invite.max_uses,
    used_count = updated_invite.used_count,
    revoked_at = updated_invite.revoked_at,
    created_at = updated_invite.created_at
  where id = updated_invite.id;

  get diagnostics mirrored_count = row_count;
  if mirrored_count <> 1 then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;

  return query
  select 'joined'::text, matched_family_id, anchor_pet_id, anchor_pet_name;
end;
$$;

-- Additive read contract; old RPC signatures/return columns remain unchanged.
create function public.get_family_member_capacity(target_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); viewer_role text; total integer; counted integer; legacy_ceiling integer; plan record;
  invitation public.family_invites; legacy_remaining integer:=0; reserved integer:=0;
  at_time timestamptz:=statement_timestamp();
begin
  if viewer is null then raise exception 'authentication required' using errcode='42501'; end if;
  select role::text into viewer_role from public.family_members
    where family_id=target_family_id and user_id=viewer;
  if viewer_role is null then raise exception 'family not found' using errcode='42501'; end if;
  select count(*),count(*) filter(where role in('owner','member')) into total,counted
    from public.family_members where family_id=target_family_id;
  select * into plan from private.family_member_plan(target_family_id,at_time);
  select * into invitation from public.family_invites i where i.family_id=target_family_id
    and i.revoked_at is null and i.expires_at>at_time and i.used_count<i.max_uses;
  if invitation.id is not null then
    reserved:=invitation.max_uses-invitation.used_count;
    select least(reserved,l.max_uses-invitation.used_count),l.total_ceiling into legacy_remaining,legacy_ceiling
      from private.family_invite_legacy_allowances l where l.invite_id=invitation.id and l.family_id=target_family_id
        and l.code_hash=invitation.code_hash and l.created_at=invitation.created_at
        and l.expires_at=invitation.expires_at and l.max_uses=invitation.max_uses
        and invitation.used_count>=l.used_at_cutover;
    if coalesce(legacy_remaining,0)>0 then
      reserved:=least(reserved,greatest(0,legacy_ceiling-total),greatest(0,10-counted));
    else
      reserved:=least(reserved,greatest(0,plan.member_limit-total));
    end if;
  end if;
  return jsonb_build_object('schema_version',1,'family_id',target_family_id,'viewer_user_id',viewer,
    'server_time',at_time,'member_count',total,'member_limit',plan.member_limit,'plus_until',plan.plus_until,
    'can_create_invite',viewer_role='owner' and total<plan.member_limit,
    'reserved_seats',reserved,'invite_expires_at',invitation.expires_at,
    'legacy_invite_remaining',case when viewer_role='owner' then coalesce(legacy_remaining,0) else 0 end);
end $$;
revoke all on function public.get_family_member_capacity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_family_member_capacity(uuid) to authenticated;
revoke all on function public.create_family_invite(uuid), public.join_family_with_invite(text)
  from public,anon,authenticated,service_role;
grant execute on function public.create_family_invite(uuid), public.join_family_with_invite(text) to authenticated;
comment on function public.get_family_member_capacity(uuid) is
  '1.4.1: read-only Family count including Owner and Viewers; verified subscription seats 2/10. Does not gate existing members.';
comment on table private.family_invite_legacy_allowances is
  'Immutable cutover snapshot; original expiry/remaining uses, Owner+Member ceiling 10 plus fixed existing Viewer allowance. No new legacy allowances.';
comment on table private.family_invite_legacy_admissions is
  'Append-only legacy invite consumption. Transaction-scoped evidence for the canonical membership trigger, never client-set session flags.';
commit;

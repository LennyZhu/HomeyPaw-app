-- Synthetic dependency fixture for the 1.4.1 migration only, never a deployment.
-- Runs in a new network-disabled container, not a linked or persistent database.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
grant usage on schema auth,public,private to authenticated;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create type public.pet_member_role as enum('owner','member','viewer');
create table public.families(id uuid primary key,created_at timestamptz not null default now());
create table public.family_members(
  family_id uuid references public.families(id),user_id uuid references auth.users(id),
  role public.pet_member_role not null,created_at timestamptz default now(),primary key(family_id,user_id));
create unique index family_members_one_family_per_user on public.family_members(user_id);
create unique index family_members_one_owner_per_family on public.family_members(family_id) where role='owner';
create table public.pets(id uuid primary key,family_id uuid references public.families(id),
  name text,created_at timestamptz default now());
create table public.pet_members(pet_id uuid references public.pets(id),user_id uuid references auth.users(id),
  role public.pet_member_role not null,created_at timestamptz default now(),primary key(pet_id,user_id));
create table public.family_invites(
  id uuid primary key default gen_random_uuid(),family_id uuid references public.families(id),
  invited_by uuid references auth.users(id),code_hash text not null unique,expires_at timestamptz not null,
  max_uses integer not null default 5 check(max_uses between 1 and 5),
  used_count integer not null default 0 check(used_count between 0 and max_uses),
  revoked_at timestamptz,created_at timestamptz not null default now());
create unique index family_invites_one_unrevoked_per_family on public.family_invites(family_id) where revoked_at is null;
create table public.pet_invites(like public.family_invites including defaults including constraints including indexes);
alter table public.pet_invites drop column family_id;
alter table public.pet_invites add column pet_id uuid references public.pets(id);
create table private.family_billing_config(singleton boolean primary key default true,enabled boolean default false,
  environment text,monthly_product_id text,yearly_product_id text);
insert into private.family_billing_config values(true,false,'PRODUCTION','synthetic.monthly','synthetic.yearly');
create table private.family_store_subscriptions(id uuid primary key,family_id uuid,environment text,store text,
  product_id text,status text,gives_access boolean,started_at timestamptz,access_until timestamptz);
create table private.family_media_entitlements(id uuid primary key default gen_random_uuid(),family_id uuid,tier text,
  starts_at timestamptz,ends_at timestamptz,revoked_at timestamptz,billing_subscription_id uuid,billing_environment text);
create function private.is_family_owner(f uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.family_members where family_id=f and user_id=auth.uid() and role='owner');
$$;
create function private.is_family_member(f uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.family_members where family_id=f and user_id=auth.uid());
$$;
create function private.is_pet_owner(p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_family_owner((select family_id from public.pets where id=p));
$$;
-- Only token generation/hashing is mocked; invitation/capacity SQL is real.
create function private.normalize_pet_invite_code(c text) returns text language sql immutable as $$
  select upper(trim(c));
$$;
create function private.pet_invite_code_hash(c text) returns text language sql immutable as $$
  select encode(sha256(convert_to(c,'UTF8')),'hex');
$$;
create function private.generate_pet_invite_code() returns text language sql volatile as $$
  select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',1+floor(random()*32)::int,1),'') from generate_series(1,8);
$$;
alter table public.family_members enable row level security;
alter table public.pet_members enable row level security;
create policy read_members on public.family_members for select to authenticated using(private.is_family_member(family_id));
create policy read_mirrors on public.pet_members for select to authenticated using(
  private.is_family_member((select family_id from public.pets where id=pet_id)));
grant select on public.family_members,public.pet_members,public.pets to authenticated;

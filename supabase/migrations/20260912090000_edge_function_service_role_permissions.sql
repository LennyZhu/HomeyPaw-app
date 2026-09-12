-- Lifecycle Edge Functions use a service-role Supabase client after validating
-- the caller JWT. Grant only the table operations exercised by those server-side
-- code paths; Storage and Auth administration remain behind their own APIs.

revoke insert, update, truncate, references, trigger on table
  public.pet_invites,
  public.pet_members,
  public.pets,
  public.post_media,
  public.posts,
  public.profiles
from service_role;

revoke delete on table
  public.pet_invites,
  public.pet_members,
  public.post_media,
  public.profiles
from service_role;

grant select on table
  public.pet_invites,
  public.pet_members,
  public.pets,
  public.post_media,
  public.posts,
  public.profiles
to service_role;

grant delete on table
  public.pets,
  public.posts
to service_role;

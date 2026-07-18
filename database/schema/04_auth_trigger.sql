-- =====================================================================
-- Auto-create a `profiles` row whenever a new user signs up via
-- Supabase Auth. Required for the RLS policies in saloniq_rls_policies.sql
-- to work correctly — those policies join against `profiles.role`, so a
-- user with no profiles row will be blocked from everything.
--
-- Defaults new signups to 'business_owner'. Superadmin accounts should
-- be promoted manually afterward:
--   update public.profiles set role = 'superadmin' where id = '<user-id>';
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer -- bypasses RLS so it can insert into profiles
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (new.id, 'business_owner', new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
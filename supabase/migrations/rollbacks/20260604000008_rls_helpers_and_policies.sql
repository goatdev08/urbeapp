-- Rollback 0008 — elimina políticas RLS, helpers y deshabilita RLS.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I disable row level security', r.tablename);
  end loop;
end$$;

drop function if exists public.can_edit_lead(uuid);
drop function if exists public.can_view_lead(uuid);
drop function if exists public.property_is_public(uuid);
drop function if exists public.can_manage_property(uuid);
drop function if exists public.owns_property(uuid);
drop function if exists public.current_user_agency_id();
drop function if exists public.is_agency_owner_of(uuid);
drop function if exists public.manages_agency(uuid);
drop function if exists public.is_admin();
drop function if exists public.current_user_role();

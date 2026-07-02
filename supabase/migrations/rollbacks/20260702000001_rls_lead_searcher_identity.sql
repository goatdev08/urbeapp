-- Rollback: 20260702000001_rls_lead_searcher_identity.sql
-- Restaura users_select a su definición original (sin la cláusula del helper nuevo,
-- copiada EXACTA de 20260604000010 líneas 111-118) y elimina el helper
-- private.can_view_user_as_lead_searcher.

drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or private.is_agency_owner_of(id)
    or (role = 'agent' and deleted_at is null and is_verified_agent = true)
  );

drop function if exists private.can_view_user_as_lead_searcher(uuid);

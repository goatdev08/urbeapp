-- Rollback: 20260805000009_switch_agency_and_suspension.sql
-- (1) Elimina la RPC switch_agency_atomic (sin cambios de esquema asociados).
-- (2) Restaura properties_insert a la versión previa (20260604000010), sin la
--     cláusula de membresía activa por agencia.

drop function if exists public.switch_agency_atomic(uuid, uuid);

drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and private.current_user_role() in ('agent', 'admin'));

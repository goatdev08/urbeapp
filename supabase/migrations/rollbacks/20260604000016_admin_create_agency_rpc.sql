-- Rollback 0016 — elimina la RPC admin_create_agency_atomic
-- Ejecutar ANTES de borrar la migración 0016 del historial.

revoke execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid)
  from service_role;

drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid);

-- Rollback 0016 — elimina la RPC admin_create_agency_atomic (versión 7-parámetros)
-- Ejecutar ANTES de borrar la migración 0016 del historial.

revoke execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid)
  from service_role;

drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid);
-- Por si acaso la versión de 6 parámetros todavía existe
drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid);

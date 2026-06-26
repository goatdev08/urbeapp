-- Rollback 0016 — elimina la función unificada admin_create_agency_atomic (9-param con defaults).
-- Ejecutar ANTES de borrar la migración 0016 del historial.

-- Función unificada de 9 parámetros (versión 7.6)
revoke execute on function public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid, text, integer)
  from service_role;

drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid, text, integer);

-- Por si acaso overloads anteriores todavía existieran (limpieza defensiva)
drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid, uuid);
drop function if exists public.admin_create_agency_atomic(text, text, text, text, text, uuid);

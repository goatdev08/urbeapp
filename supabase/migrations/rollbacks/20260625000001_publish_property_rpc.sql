-- Rollback 0017 — elimina la función publish_property_atomic.
-- Ejecutar ANTES de borrar la migración 0017 del historial.

revoke execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, uuid, text
) from service_role;

drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, uuid, text
);

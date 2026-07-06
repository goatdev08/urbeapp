-- Rollback 0018 (subtarea 40.1) — elimina la función properties_within_radius.
-- Ejecutar ANTES de borrar la migración 20260706000001 del historial.

revoke execute on function public.properties_within_radius(double precision, double precision, double precision)
  from authenticated;

drop function if exists public.properties_within_radius(double precision, double precision, double precision);

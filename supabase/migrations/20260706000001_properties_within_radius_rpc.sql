-- Migración 0018 (subtarea 40.1) — RPC properties_within_radius
-- Propósito: dado un centro (lat, lng) y un radio en metros, devuelve las propiedades
-- ACTIVAS y NO borradas dentro de ese radio, ordenadas por distancia ascendente.
-- Lo usarán el feed y el mapa (subtarea Fase C #42) desde el cliente autenticado —
-- el cliente resuelve filtros adicionales (precio, tipo, etc.) con build_filter_query;
-- este RPC SOLO resuelve la cercanía geoespacial (enfoque A1 "flaco", exploración 027).
--
-- Devuelve SOLO {id uuid, distance_m float8} — el cliente hace un segundo fetch con los
-- ids para traer el resto de columnas (evita duplicar el shape completo de properties aquí).
--
-- Seguridad (RLS como 2ª capa, PRD/lineamientos): aunque es SECURITY DEFINER, el filtro
-- status='active' AND deleted_at IS NULL vive DENTRO del cuerpo SQL — nunca expone
-- propiedades pausadas/borradas, sin depender de las políticas RLS de la tabla.
--
-- GOTCHA orden de coordenadas: ST_Point(lng, lat) — x=lng, y=lat (misma convención que
-- publish_property_atomic, migración 20260625000001).
--
-- Índice: reusa el GiST existente properties_location_gix (migración 20260604000005);
-- ST_DWithin lo aprovecha automáticamente. NO se crea índice nuevo aquí.
--
-- Idempotente: create or replace function.
-- Rollback: supabase/migrations/rollbacks/20260706000001_properties_within_radius_rpc.sql

create or replace function public.properties_within_radius(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  double precision
)
returns table (id uuid, distance_m double precision)
language plpgsql
security definer
-- PostGIS (geography, ST_Point, ST_Distance, ST_DWithin) vive en el schema `extensions`
-- en Supabase; se incluye en el search_path y se califica explícitamente abajo (mismo
-- patrón que publish_property_atomic, migración 20260625000001, líneas 52-55).
set search_path = public, extensions
as $$
begin
  return query
  select
    p.id,
    extensions.ST_Distance(
      p.location,
      extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography
    ) as distance_m
  from public.properties p
  where p.status = 'active'
    and p.deleted_at is null
    and extensions.ST_DWithin(
      p.location,
      extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography,
      p_radius_m
    )
  order by distance_m asc;
end;
$$;

comment on function public.properties_within_radius(double precision, double precision, double precision) is
  'Propiedades activas y no borradas dentro de un radio (metros) de un punto (lat, lng), ordenadas por distancia ascendente. Devuelve solo {id, distance_m}; el cliente resuelve el resto de columnas y filtros adicionales. Llamado por el feed/mapa como usuario authenticated.';

-- Defense-in-depth (lineamientos: RLS/seguridad NO está sujeta a minimalismo): el feed y el
-- mapa que consumen este RPC viven detrás del auth wall (gate B1, exploración 027) → SOLO los
-- llama un usuario `authenticated`. `anon` no tiene caso de uso legítimo, así que se revoca el
-- EXECUTE que Postgres otorga a PUBLIC por defecto (advisor 0028 anon_security_definer) y se
-- concede explícito solo a `authenticated`. Idempotente (revoke/grant repetibles).
revoke execute on function public.properties_within_radius(double precision, double precision, double precision)
  from public, anon;
grant execute on function public.properties_within_radius(double precision, double precision, double precision)
  to authenticated;

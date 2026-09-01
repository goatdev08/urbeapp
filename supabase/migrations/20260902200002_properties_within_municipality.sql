-- Migración 20260902200002 — properties_within_municipality (tarea #160)
--
-- QUÉ BUG MATA (origen: subtarea 157.8, review PR #76/#77): seleccionar un
-- municipio reusaba filters.area, un CÍRCULO derivado del bbox, y
-- viewport_to_area lo clampa a MAX_RADIUS_M = 50 km. Los municipios grandes
-- (Ensenada, Mexicali, Hermosillo: 100–300 km de extremo a extremo) jamás
-- cargaban los pins de más allá de 50 km del centroide, y sin error visible;
-- los chicos sobre-incluían ~57% (Zapopan mostraba propiedades de Guadalajara
-- y Tlaquepaque). Un círculo no es un municipio.
--
-- Espejo exacto de properties_within_neighborhood (20260813000002): patrón A1
-- "flaco" —devuelve SOLO {id}, el cliente hace .in('id', ids) y aplica los
-- demás filtros con build_filter_query (INVARIANTE A1: los parámetros
-- geoespaciales nunca pasan por build_filter_query)—, security definer,
-- search_path fijo, PostGIS calificado con `extensions.`, revoke de
-- PUBLIC/anon y grant explícito a authenticated (el mapa vive detrás del auth
-- wall — gate B1, exploración 027; advisor 0028). Filtros de visibilidad
-- DENTRO del cuerpo: nunca expone pausadas ni borradas aunque sea definer.
--
-- 🔴 DECISIÓN — UNIÓN DE COLONIAS, NO OTRO RECTÁNGULO. mx_municipalities NO
-- tiene columna de polígono (solo bbox_min/max_lat/lng, D4 de 0065), así que
-- la única geometría municipal real disponible es la unión de los polígonos
-- de sus colonias. Se expresa como EXISTS y no como ST_Union: son
-- equivalentes —un punto intersecta la unión sii intersecta alguna colonia—
-- pero el EXISTS usa el GiST mx_neighborhoods_geom_gix, corta en la primera
-- coincidencia y no materializa un polígono de 1,033 partes (Zapopan) en cada
-- llamada. Además evita el `distinct` que haría falta con un join si un punto
-- tocara dos colonias vecinas.
--
-- Fallback por bbox cuando el municipio no tiene colonias cargadas: hoy es una
-- rama estrecha —el bbox lo llena el MISMO import a partir de las colonias
-- (D4), así que "sin colonias" implica casi siempre "sin bbox" y el resultado
-- termina siendo 0 filas— pero se implementa porque es el contrato pedido y
-- porque desacopla la función de CÓMO se pobló el bbox: si mañana entra de
-- otra fuente, esta rama ya sirve el municipio en vez de dejarlo mudo.
--
-- Aditiva (crea una función; no toca tablas, columnas ni filas). Idempotente:
-- create or replace + revoke/grant repetibles.
-- Rollback: rollbacks/20260902200002_properties_within_municipality.sql
-- Tests: supabase/tests/81_properties_within_municipality_test.sql

create or replace function public.properties_within_municipality(p_municipality_id text)
returns table (id uuid)
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_bbox extensions.geography;
begin
  -- Sin guard de NULL a propósito (igual que properties_within_neighborhood):
  -- un id NULL no matchea ninguna colonia ni ningún municipio y sale por la
  -- rama de v_bbox NULL con 0 filas. Un `if` extra sería una rama sin efecto.
  if exists (select 1 from public.mx_neighborhoods n
              where n.municipality_id = p_municipality_id) then
    return query
    select p.id
    from public.properties p
    where p.status = 'active'
      and p.deleted_at is null
      -- ST_Intersects (no ST_Contains): geography vs geography usa el GiST
      -- properties_location_gix y no excluye puntos exactamente en el borde
      -- del polígono — mismo criterio que la hermana por colonia.
      and exists (
        select 1
        from public.mx_neighborhoods n
        where n.municipality_id = p_municipality_id
          and extensions.ST_Intersects(p.location, n.geom)
      );
    return;
  end if;

  -- Sin colonias cargadas: la mejor geometría disponible es el bbox
  -- precalculado. ST_MakeEnvelope es STRICT, así que un bbox incompleto deja
  -- v_bbox en NULL y la función devuelve 0 filas en vez de inventar un área.
  select extensions.ST_MakeEnvelope(m.bbox_min_lng, m.bbox_min_lat,
                                    m.bbox_max_lng, m.bbox_max_lat,
                                    4326)::extensions.geography
    into v_bbox
  from public.mx_municipalities m
  where m.id = p_municipality_id;

  if v_bbox is null then
    return;
  end if;

  return query
  select p.id
  from public.properties p
  where p.status = 'active'
    and p.deleted_at is null
    and extensions.ST_Intersects(p.location, v_bbox);
end;
$$;

comment on function public.properties_within_municipality(text) is
  'Propiedades activas y no borradas dentro de un municipio: ST_Intersects '
  'contra la UNIÓN de los polígonos de sus colonias (expresada como EXISTS '
  'para usar el GiST y no materializar el union), con fallback al bbox '
  'precalculado si el municipio no tiene colonias cargadas y 0 filas si no hay '
  'geometría alguna. Devuelve solo {id}; el cliente resuelve columnas y filtros '
  'adicionales (patrón A1 flaco). #160: reemplaza el círculo de viewport_to_area, '
  'que se clampaba a 50 km y dejaba mudos los municipios grandes. Llamado por el '
  'mapa como authenticated.';

revoke execute on function public.properties_within_municipality(text) from public, anon;
grant execute on function public.properties_within_municipality(text) to authenticated;

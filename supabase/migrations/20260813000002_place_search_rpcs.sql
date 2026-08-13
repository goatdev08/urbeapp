-- Migración 0066 — RPCs de búsqueda de lugares (tarea #157.2)
-- search_places · get_neighborhood_geojson · properties_within_neighborhood
-- Aditiva e idempotente (create or replace + revoke/grant repetibles).
-- Rollback: rollbacks/20260813000002_place_search_rpcs.sql
-- Tests: supabase/tests/43_search_places_test.sql · 44_properties_within_neighborhood_test.sql
--
-- Las tres calcan el patrón de properties_within_radius (20260706000001):
--   security definer + search_path fijo + funciones PostGIS calificadas con
--   `extensions.` + revoke de PUBLIC/anon + grant explícito a authenticated
--   (el mapa vive detrás del auth wall — gate B1, exploración 027; advisor 0028).
--   `private` va en el search_path porque normalize_search_text vive ahí (0065).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) search_places — autocomplete unificado (colonias + municipios)
-- ════════════════════════════════════════════════════════════════════════════
-- Contrato: el cliente manda texto crudo ("Provi", "álvaro"); aquí se normaliza
-- con la MISMA función que generó name_normalized, así el match es simétrico.
-- Predicado LIKE 'q%' (prefijo) OR % (similitud trgm) — ambos usan los índices
-- GIN gin_trgm_ops de 0065. Ranking: prefijo > similarity > municipio > alfabético.
-- Bbox: municipios lo llevan precalculado (D4, columnas de 0065); colonias lo
-- calculan on-the-fly con ST_X/YMin/Max — solo sobre las <= p_limit candidatas.
-- GOTCHA orden de coordenadas: X = lng, Y = lat (mismo que parse_location).

create or replace function public.search_places(
  p_query text,
  p_limit integer default 10
)
returns table (
  kind    text,
  id      text,
  name    text,
  context text,
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision
)
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_q     text;
  v_limit integer;
begin
  v_q := private.normalize_search_text(trim(p_query));
  -- Guard: menos de 2 caracteres útiles no dispara ningún scan (cada keystroke
  -- del autocomplete llega aquí; 1 char matchearía media tabla).
  if v_q is null or length(v_q) < 2 then
    return;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 20);

  return query
  select t.kind, t.id, t.name, t.context, t.min_lat, t.min_lng, t.max_lat, t.max_lng
  from (
    select
      'municipality'::text as kind,
      m.id::text           as id,
      m.name               as name,
      s.name               as context,
      m.bbox_min_lat       as min_lat,
      m.bbox_min_lng       as min_lng,
      m.bbox_max_lat       as max_lat,
      m.bbox_max_lng       as max_lng,
      (m.name_normalized like v_q || '%')          as is_prefix,
      extensions.similarity(m.name_normalized, v_q) as sim
    from public.mx_municipalities m
    join public.mx_states s on s.id = m.state_id
    where m.name_normalized like v_q || '%'
       or m.name_normalized % v_q
    union all
    select
      'neighborhood'::text,
      n.id::text,
      n.name,
      m.name || ', ' || s.abbr,
      extensions.ST_YMin(n.geom::extensions.geometry),
      extensions.ST_XMin(n.geom::extensions.geometry),
      extensions.ST_YMax(n.geom::extensions.geometry),
      extensions.ST_XMax(n.geom::extensions.geometry),
      (n.name_normalized like v_q || '%'),
      extensions.similarity(n.name_normalized, v_q)
    from public.mx_neighborhoods n
    join public.mx_municipalities m on m.id = n.municipality_id
    join public.mx_states s on s.id = m.state_id
    where n.name_normalized like v_q || '%'
       or n.name_normalized % v_q
  ) t
  order by t.is_prefix desc, t.sim desc, (t.kind = 'municipality') desc, t.name asc
  limit v_limit;
end;
$$;

comment on function public.search_places(text, integer) is
  'Autocomplete unificado de lugares: colonias (mx_neighborhoods) + municipios (mx_municipalities), match por prefijo o similitud trgm sobre nombres normalizados. Devuelve kind/id/name/context + bbox (municipio: precalculado, NULL si sin colonias cargadas; colonia: del geom). Llamado por el mapa como authenticated.';

revoke execute on function public.search_places(text, integer) from public, anon;
grant execute on function public.search_places(text, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) get_neighborhood_geojson — el polígono de UNA colonia, bajo demanda
-- ════════════════════════════════════════════════════════════════════════════
-- ST_AsGeoJSON(geom, 5): 5 decimales ≈ 1 m de precisión — controla el payload
-- (el cliente solo baja el polígono de la colonia seleccionada, no el catálogo).
-- 0 filas si el id no existe: el cliente lo trata como not-found, sin excepción.

create or replace function public.get_neighborhood_geojson(p_neighborhood_id bigint)
returns table (
  id      bigint,
  name    text,
  geojson text,
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision
)
language plpgsql
security definer
set search_path = public, extensions, private
as $$
begin
  return query
  select
    n.id,
    n.name,
    extensions.ST_AsGeoJSON(n.geom, 5),
    extensions.ST_YMin(n.geom::extensions.geometry),
    extensions.ST_XMin(n.geom::extensions.geometry),
    extensions.ST_YMax(n.geom::extensions.geometry),
    extensions.ST_XMax(n.geom::extensions.geometry)
  from public.mx_neighborhoods n
  where n.id = p_neighborhood_id;
end;
$$;

comment on function public.get_neighborhood_geojson(bigint) is
  'GeoJSON (MultiPolygon, 5 decimales) + bbox de una colonia. El cliente lo pide al seleccionar una sugerencia kind=neighborhood para dibujar el perímetro. 0 filas = not-found.';

revoke execute on function public.get_neighborhood_geojson(bigint) from public, anon;
grant execute on function public.get_neighborhood_geojson(bigint) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) properties_within_neighborhood — filtro espacial A1 "flaco"
-- ════════════════════════════════════════════════════════════════════════════
-- Devuelve SOLO {id}: el cliente hace .in('id', ids) y aplica los demás filtros
-- con build_filter_query (INVARIANTE A1: parámetros geoespaciales nunca pasan
-- por build_filter_query — mismo contrato que properties_within_radius).
-- ST_Intersects (no ST_Contains): geography vs geography usa el GiST existente
-- properties_location_gix y no excluye puntos exactamente en el borde.
-- Filtros de visibilidad DENTRO del cuerpo (no dependen de RLS): nunca expone
-- propiedades pausadas/borradas aunque sea security definer.

create or replace function public.properties_within_neighborhood(p_neighborhood_id bigint)
returns table (id uuid)
language plpgsql
security definer
set search_path = public, extensions, private
as $$
begin
  return query
  select p.id
  from public.properties p
  join public.mx_neighborhoods n on n.id = p_neighborhood_id
  where p.status = 'active'
    and p.deleted_at is null
    and extensions.ST_Intersects(p.location, n.geom);
end;
$$;

comment on function public.properties_within_neighborhood(bigint) is
  'Propiedades activas y no borradas cuyo punto cae dentro del polígono de la colonia (ST_Intersects). Devuelve solo {id}; el cliente resuelve columnas y filtros adicionales (patrón A1 flaco). Llamado por el mapa como authenticated.';

revoke execute on function public.properties_within_neighborhood(bigint) from public, anon;
grant execute on function public.properties_within_neighborhood(bigint) to authenticated;

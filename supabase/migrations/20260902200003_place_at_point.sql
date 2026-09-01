-- Migración 20260902200003 — place_at_point (subtarea 232.1)
--
-- Resuelve un PUNTO a una zona DE CATÁLOGO. Es la pieza que le falta a la
-- búsqueda unificada de #232: el buscador acepta colonias, municipios Y
-- direcciones; una dirección se geocodifica con Google Places y su punto
-- entra aquí para convertirse en la colonia (o el municipio) del catálogo
-- INEGI que lo contiene.
--
-- 🔒 NUNCA INVENTA ZONA. Fuera de cobertura devuelve 0 filas y el cliente lo
-- comunica; jamás se guarda una zona fabricada a partir del texto de una
-- dirección. Es una decisión de calidad de datos: todo lo que sale de aquí
-- existe en mx_neighborhoods / mx_municipalities, con su id real, y por eso
-- se puede usar después como zona de campaña o como filtro del mapa.
--
-- 🔴 EL SHAPE DE LA FILA ES EL DE search_places, no uno propio
-- (kind/id/name/context/min_lat/min_lng/max_lat/max_lng): el cliente
-- unificado mezcla sugerencias de catálogo y direcciones resueltas en UNA
-- sola lista, así que una dirección resuelta tiene que ser indistinguible de
-- una sugerencia. El test 6 de 82_place_at_point_test.sql lo fija con un
-- UNION ALL contra search_places, que falla si los tipos divergen.
--
-- ⚠️ ST_Intersects, no ST_Contains (desviación deliberada del enunciado de la
-- subtarea): (i) geography no tiene ST_Contains y forzarlo exigiría castear a
-- geometry, perdiendo el GiST mx_neighborhoods_geom_gix; (ii) ST_Contains da
-- FALSE para un punto EXACTAMENTE sobre el borde, o sea que un domicilio
-- geocodificado sobre una calle límite se reportaría como "sin cobertura".
-- Es además el criterio que ya usan properties_within_neighborhood (#157.2),
-- ads_for_zone y resolve_ad_zone (#194): una sola semántica de pertenencia
-- para todo el producto.
--
-- El fallback municipal copia el order by de #194 PALABRA POR PALABRA: los
-- bboxes son rectángulos sobre formas irregulares, así que los de municipios
-- vecinos SIEMPRE se solapan; gana el de MENOR ÁREA (un municipio pequeño
-- anidado en el bbox de uno grande es la respuesta correcta) y se desempata
-- por id para que dos áreas idénticas también sean deterministas. Si este
-- criterio divergiera del de ads_for_zone, la misma dirección caería en un
-- municipio al buscarla y en otro al contabilizar su impresión.
--
-- Aditiva (crea una función; no toca tablas, columnas ni filas). Idempotente:
-- create or replace + revoke/grant repetibles.
-- Rollback: rollbacks/20260902200003_place_at_point.sql
-- Tests: supabase/tests/82_place_at_point_test.sql

create or replace function public.place_at_point(
  p_lat double precision,
  p_lng double precision
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
  v_point extensions.geography;
  v_id    bigint;
begin
  -- Guard de rango: sin él, el cast a geography lanza "Latitude/longitude is
  -- out of range" y el buscador se cae por un GPS raro o un geocoder que
  -- devolvió basura. Un punto imposible no está en ninguna zona: 0 filas.
  -- `between` ya deja fuera NULL, NaN e Infinity.
  if not (p_lat between -90 and 90) or not (p_lng between -180 and 180) then
    return;
  end if;

  -- GOTCHA de orden: X = lng, Y = lat (igual que parse_location y ads_for_zone).
  v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

  -- 1) La colonia gana: es la zona más específica que el catálogo puede dar.
  select n.id into v_id
  from public.mx_neighborhoods n
  where extensions.ST_Intersects(n.geom, v_point)
  order by n.id  -- #194: determinista si dos polígonos llegaran a solaparse
  limit 1;

  if v_id is not null then
    return query
    select
      'neighborhood'::text,
      n.id::text,
      n.name,
      m.name || ', ' || s.abbr,
      extensions.ST_YMin(n.geom::extensions.geometry),
      extensions.ST_XMin(n.geom::extensions.geometry),
      extensions.ST_YMax(n.geom::extensions.geometry),
      extensions.ST_XMax(n.geom::extensions.geometry)
    from public.mx_neighborhoods n
    join public.mx_municipalities m on m.id = n.municipality_id
    join public.mx_states s on s.id = m.state_id
    where n.id = v_id;
    return;
  end if;

  -- 2) Hueco de cobertura del DCAH (la cobertura de polígonos es incompleta —
  -- gotcha de #157): fallback al bbox precalculado del municipio.
  return query
  select
    'municipality'::text,
    m.id,
    m.name,
    s.name,
    m.bbox_min_lat,
    m.bbox_min_lng,
    m.bbox_max_lat,
    m.bbox_max_lng
  from public.mx_municipalities m
  join public.mx_states s on s.id = m.state_id
  where p_lat between m.bbox_min_lat and m.bbox_max_lat
    and p_lng between m.bbox_min_lng and m.bbox_max_lng
  -- 🔴 #194, palabra por palabra: menor área primero, desempate por id.
  order by (m.bbox_max_lat - m.bbox_min_lat) * (m.bbox_max_lng - m.bbox_min_lng) asc,
           m.id asc
  limit 1;

  -- 3) Ni polígono ni bbox: 0 filas. 🔒 No hay rama que invente una zona.
end;
$$;

comment on function public.place_at_point(double precision, double precision) is
  'Resuelve un punto (lat, lng) a una zona DE CATÁLOGO, con el MISMO shape de '
  'fila que search_places para que el buscador unificado de #232 mezcle '
  'sugerencias y direcciones geocodificadas en una sola lista. Orden: colonia '
  'de mx_neighborhoods por ST_Intersects (incluye la frontera) > municipio '
  'cuyo bbox precalculado contiene el punto, el de MENOR ÁREA con desempate '
  'por id (#194) > 0 filas. 🔒 Fuera de cobertura devuelve 0 filas: nunca '
  'fabrica una zona. Coordenadas fuera de rango, NaN o NULL -> 0 filas. '
  'Llamada por el cliente como authenticated.';

revoke execute on function public.place_at_point(double precision, double precision) from public, anon;
grant execute on function public.place_at_point(double precision, double precision) to authenticated;

-- Rollback de 20260903200001_municipality_at_point.sql (tarea #235)
--
-- Restaura los TRES cuerpos anteriores TAL CUAL —cada uno con el `order by`
-- de #194 escrito palabra por palabra, que es justo la triplicación que la
-- migración eliminó— y después elimina el helper.
--
-- 🔴 ORDEN OBLIGATORIO: primero se reemplazan las tres funciones (así ninguna
-- queda apuntando a un helper inexistente) y solo entonces se hace el DROP.
-- Los cuerpos son plpgsql, así que Postgres NO registra la dependencia y el
-- DROP no fallaría por sí solo: invertir el orden dejaría a las tres RPC
-- lanzando 42883 en la rama de fallback municipal hasta que corriera el
-- `create or replace`. En producción viva eso es el buscador y el servidor de
-- anuncios caídos en el hueco de cobertura del DCAH.
--
-- Firmas, returns table, volatilidad, search_path y grants no cambiaron en la
-- migración, así que no hay nada más que revertir. Los comments tampoco: el
-- de las tres funciones de public se dejó byte por byte y el único comment
-- nuevo se va con el DROP.
--
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/rollbacks/20260903200001_municipality_at_point.sql

-- ── 1) public.ads_for_zone — cuerpo previo (20260820000004 + #194) ──────────
create or replace function public.ads_for_zone(
  p_lat double precision,
  p_lng double precision,
  p_neighborhood_id bigint default null,
  p_municipality_id text default null
)
returns table (
  id uuid,
  creative_id uuid,
  title text,
  description text,
  cta_type ad_cta_type,
  cta_value text,
  cloudflare_uid text,
  agency_name text,
  agency_logo_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_neighborhood_id bigint;
  v_municipality_id text;
  v_point           extensions.geography;
begin
  if p_neighborhood_id is not null then
    -- 1a) Colonia declarada gana sobre el GPS -- resuelve también su
    -- municipio para que el inventario municipal de esa zona se sirva.
    v_neighborhood_id := p_neighborhood_id;
    select n.municipality_id into v_municipality_id
    from public.mx_neighborhoods n
    where n.id = p_neighborhood_id;
  elsif p_municipality_id is not null then
    -- 1b) Municipio declarado gana sobre el GPS -- SIN colonia implícita
    -- (declarar el municipio no implica una colonia específica).
    v_municipality_id := p_municipality_id;
  else
    -- 2) Sin zona activa: resolver por coordenadas. GOTCHA de orden: x=lng,
    -- y=lat (misma convención que properties_within_radius/publish_property_atomic).
    v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

    select n.id, n.municipality_id
      into v_neighborhood_id, v_municipality_id
    from public.mx_neighborhoods n
    where extensions.ST_Intersects(n.geom, v_point)
    order by n.id  -- #194: determinista si dos polígonos llegaran a solaparse
    limit 1;

    if v_neighborhood_id is null then
      -- 3) Hueco de cobertura DCAH: fallback por bbox precalculado del
      -- municipio. Solo municipio, sin colonia (no hay colonia resuelta).
      --
      -- 🔴 #194: `order by` OBLIGATORIO, no una optimización. Los bboxes de
      -- municipios vecinos se solapan casi siempre; gana el de MENOR ÁREA
      -- (mejor aproximación sin geometría real), desempatando por id para
      -- que dos áreas idénticas también sean deterministas.
      -- public.resolve_ad_zone usa este MISMO order by, palabra por palabra:
      -- si divergen, el anuncio se sirve en un municipio y se cobra en otro.
      select m.id into v_municipality_id
      from public.mx_municipalities m
      where p_lat between m.bbox_min_lat and m.bbox_max_lat
        and p_lng between m.bbox_min_lng and m.bbox_max_lng
      order by (m.bbox_max_lat - m.bbox_min_lat) * (m.bbox_max_lng - m.bbox_min_lng) asc,
               m.id asc
      limit 1;
    end if;
    -- 4) Si tampoco hay bbox: v_neighborhood_id y v_municipality_id quedan
    -- NULL -- el WHERE de abajo sirve únicamente el inventario nacional
    -- (🔒 nunca vacío).
  end if;

  return query
  select
    a.id,
    -- 170.8: el cliente necesita el creative_id para pedirle a mint-ad-urls la
    -- URL firmada de reproducción. Sin esto el anuncio era una tarjeta
    -- estática en un feed de video. NO se expone cloudflare_uid como llave de
    -- firma: ese ya viajaba y no basta — mint-ad-urls autoriza por creativo.
    a.creative_id,
    a.title,
    a.description,
    a.cta_type,
    a.cta_value,
    c.cloudflare_uid,
    ag.name::text,
    ag.logo_url
  from public.ads a
  join public.ad_creatives c on c.id = a.creative_id
  join public.agencies ag on ag.id = a.agency_id
  where a.status = 'active'
    and now() between a.starts_at and a.ends_at
    and c.status = 'ready'
    and (
      -- D3 (169.1): cero filas en ad_zones = inventario nacional.
      not exists (select 1 from public.ad_zones z where z.ad_id = a.id)
      or (
        v_neighborhood_id is not null
        and exists (
          select 1 from public.ad_zones z
          where z.ad_id = a.id and z.neighborhood_id = v_neighborhood_id
        )
      )
      or (
        v_municipality_id is not null
        and exists (
          select 1 from public.ad_zones z
          where z.ad_id = a.id and z.municipality_id = v_municipality_id
        )
      )
    );
end;
$$;

revoke execute on function public.ads_for_zone(double precision, double precision, bigint, text) from public, anon;
grant execute on function public.ads_for_zone(double precision, double precision, bigint, text) to authenticated;

-- ── 2) public.resolve_ad_zone — cuerpo previo (20260820000001, #194) ────────
create or replace function public.resolve_ad_zone(
  p_lat double precision,
  p_lng double precision
)
returns table (
  municipality_id text,
  neighborhood_id bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_neighborhood_id bigint;
  v_municipality_id text;
  v_point           extensions.geography;
begin
  -- GOTCHA de orden (mismo que properties_within_radius / ads_for_zone):
  -- x = lng, y = lat.
  v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

  select n.id, n.municipality_id
    into v_neighborhood_id, v_municipality_id
  from public.mx_neighborhoods n
  where extensions.ST_Intersects(n.geom, v_point)
  order by n.id  -- #194: mismo criterio que ads_for_zone
  limit 1;

  if v_neighborhood_id is null then
    -- Hueco de cobertura DCAH: fallback por bbox precalculado del
    -- municipio. Solo municipio, sin colonia.
    --
    -- 🔴 #194: este `order by` debe ser IDÉNTICO al de public.ads_for_zone.
    -- Esta función decide en qué municipio se CONTABILIZA la impresión
    -- facturable; aquella decide en cuál se SIRVE el anuncio. Si divergen,
    -- ad_impressions_monthly —la base de cobro— queda mal atribuido.
    select m.id into v_municipality_id
    from public.mx_municipalities m
    where p_lat between m.bbox_min_lat and m.bbox_max_lat
      and p_lng between m.bbox_min_lng and m.bbox_max_lng
    order by (m.bbox_max_lat - m.bbox_min_lat) * (m.bbox_max_lng - m.bbox_min_lng) asc,
             m.id asc
    limit 1;
  end if;
  -- Si tampoco hay bbox: ambas columnas quedan NULL — la fila de
  -- ad_impressions se escribe igual (inventario nacional, 🔒 nunca se
  -- rechaza un item por falta de zona).

  return query select v_municipality_id, v_neighborhood_id;
end;
$$;

revoke execute on function public.resolve_ad_zone(double precision, double precision) from public, anon, authenticated;

-- ── 3) public.place_at_point — cuerpo previo (20260902200003, 232.1) ────────
create or replace function public.place_at_point(
  p_lat double precision,
  p_lng double precision
)
returns table (
  kind text,
  id text,
  name text,
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

revoke execute on function public.place_at_point(double precision, double precision) from public, anon;
grant execute on function public.place_at_point(double precision, double precision) to authenticated;

-- ── 4) Y solo ahora, el helper ──────────────────────────────────────────────
drop function if exists private.municipality_at_point(double precision, double precision);

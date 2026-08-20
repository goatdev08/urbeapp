-- Migración 20260820000001 — determinismo del fallback por bbox (tarea #194).
--
-- PROBLEMA (sonda directa del guardián de 170.2, reproducido en
-- supabase/tests/56_ads_for_zone_bbox_determinism_test.sql): cuando el punto
-- no cae en ningún polígono del DCAH, la zona se resuelve por los bboxes
-- precalculados de mx_municipalities con `limit 1` SIN `order by`. Los bboxes
-- son RECTÁNGULOS sobre formas irregulares, así que municipios vecinos
-- SIEMPRE se solapan: un punto en el traslape gana uno cualquiera según el
-- orden físico de las filas, y el inventario del municipio perdedor se
-- descarta en silencio y de forma no determinista. Con datos INEGI reales el
-- solapamiento es la NORMA, y esta rama se ejerce de verdad porque la
-- cobertura de polígonos del DCAH es incompleta (gotcha de #157).
--
-- 🔴 EL DEFECTO ESTABA DUPLICADO en dos funciones, y arreglar solo una era
-- peor que no arreglar ninguna:
--   · public.ads_for_zone   (20260818000002) decide QUÉ anuncio se sirve.
--   · public.resolve_ad_zone (20260819000002) decide en qué municipio se
--     CONTABILIZA la impresión (record-ad-impressions recalcula la zona
--     server-side y la estampa en ad_impressions).
-- Si discrepan sobre el mismo punto, el anuncio se sirve en el municipio X y
-- su impresión FACTURABLE se contabiliza en el Y — el rollup de
-- ad_impressions_monthly, que es la base de cobro, queda mal atribuido. El
-- test exige que ambas COINCIDAN, no solo que cada una sea determinista.
--
-- CRITERIO (Abraham, 2026-08-20): gana el bbox de MENOR ÁREA que contiene el
-- punto, desempatando por `id`. Es la mejor aproximación disponible sin
-- geometría real — mx_municipalities NO tiene columna de polígono, solo
-- bbox_min/max_lat/lng, así que "resolver contra la geometría municipal" no
-- era una opción sobre este dataset. Un municipio pequeño anidado dentro del
-- bbox de uno grande gana, que es el resultado correcto.
--
-- Se descartó "servir el inventario de TODOS los municipios que solapan":
-- no pierde inventario vendido, pero cobra una impresión al anunciante de un
-- municipio donde la persona probablemente NO está — la misma familia de
-- inflado de facturación que #193, y erosiona la promesa de §5 del aviso de
-- privacidad ("elegimos por el lugar que estás viendo").
--
-- DE PASO, misma clase de defecto: el `select ... from mx_neighborhoods where
-- ST_Intersects(...) limit 1` de ambas funciones también carecía de `order
-- by`. Los polígonos del DCAH no deberían solaparse, pero "no deberían" no es
-- una defensa: `order by n.id` lo hace determinista al costo de nada (el
-- conjunto que matchea es de 1 fila en el caso sano).
--
-- ADITIVA y sin riesgo en producción viva (§0.5): solo `create or replace` de
-- dos funciones; no toca datos, ni tablas, ni grants, ni la firma de ninguna
-- de las dos (los callers publicados siguen compilando).
-- Idempotente: create or replace repetible.
-- Rollback: supabase/migrations/rollbacks/20260820000001_ads_zone_bbox_determinism.sql

create or replace function public.ads_for_zone(
  p_lat double precision,
  p_lng double precision,
  p_neighborhood_id bigint default null,
  p_municipality_id text default null
)
returns table (
  id uuid,
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
as $function$
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
$function$;

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
as $function$
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
$function$;

comment on function public.ads_for_zone(double precision, double precision, bigint, text) is
  'Anuncios elegibles para una zona (#170.2, #192). Orden de resolución: zona '
  'declarada > polígono DCAH > bbox de municipio > inventario nacional. '
  '#194: el fallback por bbox resuelve al de MENOR ÁREA (desempate por id) — '
  'los bboxes de municipios vecinos se solapan y sin order by el resultado '
  'era arbitrario. Mismo criterio, palabra por palabra, que public.resolve_ad_zone.';

comment on function public.resolve_ad_zone(double precision, double precision) is
  'Resuelve municipality_id/neighborhood_id por coordenadas para '
  'record-ad-impressions (#170.6): ST_Intersects contra mx_neighborhoods.geom, '
  'fallback a bbox de mx_municipalities, NULL/NULL si no hay match (inventario '
  'nacional). #194: el fallback por bbox usa el MISMO order by que '
  'public.ads_for_zone (menor área, desempate por id) — si divergieran, el '
  'anuncio se serviría en un municipio y su impresión se cobraría en otro. '
  'SOLO service_role la invoca.';

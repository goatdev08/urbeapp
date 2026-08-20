-- Migración 20260820000004 — ads_for_zone devuelve creative_id (subtarea 170.8).
--
-- POR QUÉ. El feed recibía `cloudflare_uid` pero no el `creative_id`, y
-- mint-ad-urls (169.5) autoriza y firma POR CREATIVO. Sin ese id el cliente no
-- podía pedir la URL de reproducción, así que un anuncio era una tarjeta
-- ESTÁTICA dentro de un feed de video — y el anunciante paga por una impresión
-- de video.
--
-- 🔴 ESTA MIGRACIÓN HACE DROP + CREATE, no `create or replace`: cambiar las
-- columnas de un `returns table` es un cambio de tipo de retorno, y Postgres
-- exige soltar la función primero (42P13 si no). Por eso el `grant` a
-- `authenticated` se vuelve a otorgar explícitamente abajo — un drop se lleva
-- los grants, y olvidarlo dejaría la RPC muerta para el cliente con la suite
-- en verde (los tests de permisos de 53_* lo cazan, y por eso están ahí).
--
-- SEGURIDAD DEL DROP (gate §0.5): `ads_for_zone` NO está desplegada — vive solo
-- en esta rama, junto con el resto de 168-172. Soltar una función publicada sí
-- sería destructivo y exigiría expand→migrate→contract; este no es ese caso.
--
-- Idempotente: drop if exists + create.
-- Rollback: supabase/migrations/rollbacks/20260820000004_ads_for_zone_creative_id.sql

drop function if exists public.ads_for_zone(double precision, double precision, bigint, text);

CREATE OR REPLACE FUNCTION public.ads_for_zone(p_lat double precision, p_lng double precision, p_neighborhood_id bigint DEFAULT NULL::bigint, p_municipality_id text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, creative_id uuid, title text, description text, cta_type ad_cta_type, cta_value text, cloudflare_uid text, agency_name text, agency_logo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;


comment on function public.ads_for_zone(double precision, double precision, bigint, text) is
  'Anuncios elegibles para una zona (#170.2, #192, #194). Devuelve creative_id '
  '(170.8) para que el cliente pueda pedir la URL firmada de reproducción a '
  'mint-ad-urls. Orden de resolución: zona declarada > polígono DCAH > bbox de '
  'municipio (el de MENOR ÁREA, #194) > inventario nacional.';

revoke execute on function public.ads_for_zone(double precision, double precision, bigint, text)
  from public, anon;
grant execute on function public.ads_for_zone(double precision, double precision, bigint, text)
  to authenticated;

-- Rollback: 20260903300003_ads_for_zone_promos.sql (tarea #213, subtarea 213.3-SQL)
--
-- Restaura public.ads_for_zone a la versión de 9 columnas de #235
-- (20260903200001): sin `property_id`, con `join ad_creatives` INNER y sin la
-- rama de promociones. El cuerpo se copia VERBATIM de esa migración —
-- incluyendo la delegación en private.municipality_at_point, que NO se
-- revierte aquí (es de otra tarea y sigue viva; EC-31 de la suite 86 lo exige).
--
-- 🔴 ORDEN respecto al cliente: el OTA que quita el consumo de `property_id`
-- va PRIMERO. Un cliente que pida la columna contra esta versión recibe 42703
-- y el feed se queda SIN NINGÚN anuncio (no solo sin promociones).
--
-- Efecto sobre datos: ninguno. Las promociones siguen siendo filas de `ads`;
-- simplemente dejan de servirse en el feed hasta que se vuelva a aplicar la
-- migración. Nada se borra.
--
-- Re-ejecutable (drop if exists + create).

drop function if exists public.ads_for_zone(double precision, double precision, bigint, text);

create function public.ads_for_zone(
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
      -- #235: el criterio de #194 (menor área, desempate por id) vive en
      -- private.municipality_at_point, no aquí. public.resolve_ad_zone y
      -- public.place_at_point llaman al MISMO helper, así que ya no pueden
      -- divergir: el anuncio se sirve y se cobra en el mismo municipio por
      -- construcción, no por copiar bien el order by.
      v_municipality_id := private.municipality_at_point(p_lat, p_lng);
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
    -- firma: ese ya viajaba y no basta -- mint-ad-urls autoriza por creativo.
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

comment on function public.ads_for_zone(double precision, double precision, bigint, text) is
  'Anuncios elegibles para una zona (#170.2, #192, #194). Devuelve creative_id (170.8) para que el cliente pueda pedir la URL firmada de reproducción a mint-ad-urls. Orden de resolución: zona declarada > polígono DCAH > bbox de municipio (el de MENOR ÁREA, #194) > inventario nacional.';

revoke execute on function public.ads_for_zone(double precision, double precision, bigint, text) from public, anon;
grant execute on function public.ads_for_zone(double precision, double precision, bigint, text) to authenticated;

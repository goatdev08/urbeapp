-- Rollback: 20260820000001_ads_zone_bbox_determinism.sql (tarea #194)
--
-- Restaura ads_for_zone y resolve_ad_zone a sus cuerpos previos —los de
-- 20260818000002 y 20260819000002— es decir, SIN el `order by` del fallback
-- por bbox. Re-ejecutable (create or replace).
--
-- ⚠️ Revertir REINTRODUCE la no-determinación: un punto en el traslape de dos
-- bboxes volverá a resolver a un municipio arbitrario, y ads_for_zone y
-- resolve_ad_zone podrán discrepar entre sí (anuncio servido en un municipio,
-- impresión facturada en otro). Solo tiene sentido si el `order by` resultara
-- ser el causante de un problema de plan/rendimiento medido.

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
    v_neighborhood_id := p_neighborhood_id;
    select n.municipality_id into v_municipality_id
    from public.mx_neighborhoods n
    where n.id = p_neighborhood_id;
  elsif p_municipality_id is not null then
    v_municipality_id := p_municipality_id;
  else
    v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

    select n.id, n.municipality_id
      into v_neighborhood_id, v_municipality_id
    from public.mx_neighborhoods n
    where extensions.ST_Intersects(n.geom, v_point)
    limit 1;

    if v_neighborhood_id is null then
      select m.id into v_municipality_id
      from public.mx_municipalities m
      where p_lat between m.bbox_min_lat and m.bbox_max_lat
        and p_lng between m.bbox_min_lng and m.bbox_max_lng
      limit 1;
    end if;
  end if;

  return query
  select
    a.id, a.title, a.description, a.cta_type, a.cta_value,
    c.cloudflare_uid, ag.name::text, ag.logo_url
  from public.ads a
  join public.ad_creatives c on c.id = a.creative_id
  join public.agencies ag on ag.id = a.agency_id
  where a.status = 'active'
    and now() between a.starts_at and a.ends_at
    and c.status = 'ready'
    and (
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
  v_point := extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography;

  select n.id, n.municipality_id
    into v_neighborhood_id, v_municipality_id
  from public.mx_neighborhoods n
  where extensions.ST_Intersects(n.geom, v_point)
  limit 1;

  if v_neighborhood_id is null then
    select m.id into v_municipality_id
    from public.mx_municipalities m
    where p_lat between m.bbox_min_lat and m.bbox_max_lat
      and p_lng between m.bbox_min_lng and m.bbox_max_lng
    limit 1;
  end if;

  return query select v_municipality_id, v_neighborhood_id;
end;
$function$;

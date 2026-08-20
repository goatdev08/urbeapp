-- Migración 20260818000002 — RPC public.ads_for_zone (subtarea #170.2, "zona
-- vista > GPS, fallback por bbox, inventario nacional" + ampliación de
-- contrato de #192, decisión de Abraham 2026-08-18: description + identidad
-- del anunciante). Numeración corregida: el plan original decía
-- 20260815000020, pero eso correría ANTES de 20260816000005_ads_schema.sql
-- (crea public.ads) y de 20260818000001_ads_description.sql (crea la columna
-- description que este contrato devuelve) -- 20260818000002 es el siguiente
-- slot libre real.
--
-- ── Contrato (fijado por supabase/tests/53_ads_for_zone_test.sql) ──────────
-- public.ads_for_zone(p_lat double precision, p_lng double precision,
--   p_neighborhood_id bigint default null, p_municipality_id text default null)
-- returns table (id uuid, title text, description text, cta_type ad_cta_type,
--   cta_value text, cloudflare_uid text, agency_name text, agency_logo_url text)
-- security definer, set search_path = public, pg_temp (🔴 SIN extensions/
-- private -- ST_Point/ST_SetSRID/ST_Intersects se llaman SIEMPRE calificadas
-- como extensions.*, igual que properties_within_radius/
-- properties_within_neighborhood; el search_path fijo es defensa, no
-- comodidad de resolución de nombres).
-- revoke execute from public, anon; grant execute to authenticated.
--
-- ── ORDEN DE RESOLUCIÓN DE ZONA (regla, no optimización) ────────────────────
-- 1) zona activa DECLARADA por el cliente (p_neighborhood_id o
--    p_municipality_id) gana sobre el GPS. Si viene p_neighborhood_id, el
--    municipio de ESA colonia se resuelve también (join a mx_neighborhoods)
--    para que el inventario municipal de esa zona también se sirva.
-- 2) sin zona activa: ST_Intersects(mx_neighborhoods.geom, punto) -- resuelve
--    colonia Y (vía la misma fila) su municipio. Usa el GiST existente
--    mx_neighborhoods_geom_gix (20260813000001), sin casts que lo tiren.
-- 3) sin match de polígono (hueco de cobertura DCAH, gotcha de #157):
--    mx_municipalities por bbox precalculado (bbox_min/max_lat/lng) --
--    resuelve SOLO municipio, sin colonia.
-- 4) sin match de bbox tampoco: sin colonia, sin municipio -- SOLO
--    inventario nacional (🔒 invariante: nunca "sin anuncios", un hueco del
--    dataset no puede convertirse en inventario vendido que se pierde).
--
-- ELEGIBILIDAD: status='active' AND now() BETWEEN starts_at AND ends_at AND
--   ad_creatives.status='ready' AND (ad_zones matchea la colonia o el
--   municipio RESUELTOS OR el ad no tiene ninguna fila en ad_zones =
--   nacional, D3 de 169.1).
--
-- 🔒 El join a agencies expone ÚNICAMENTE name/logo_url (agency_name/
-- agency_logo_url) -- agencies tiene columnas (contact_phone, contact_email,
-- status, created_by_user_id...) que un usuario final NUNCA debe ver.
--
-- 🔒 NO se toca properties_within_radius ni properties_within_neighborhood:
-- su contrato {id, distance_m} lo consumen feed y mapa y ya está desplegado
-- en el remoto. Los anuncios llegan por esta RPC SEPARADA.
--
-- Idempotente: create or replace function, revoke/grant repetibles.
-- Rollback: supabase/migrations/rollbacks/20260818000002_ads_for_zone.sql
-- Test: supabase/tests/53_ads_for_zone_test.sql (plan 76)

create or replace function public.ads_for_zone(
  p_lat double precision,
  p_lng double precision,
  p_neighborhood_id bigint default null,
  p_municipality_id text default null
)
returns table (
  id               uuid,
  title            text,
  description      text,
  cta_type         ad_cta_type,
  cta_value        text,
  cloudflare_uid   text,
  agency_name      text,
  agency_logo_url  text
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
    limit 1;

    if v_neighborhood_id is null then
      -- 3) Hueco de cobertura DCAH: fallback por bbox precalculado del
      -- municipio. Solo municipio, sin colonia (no hay colonia resuelta).
      select m.id into v_municipality_id
      from public.mx_municipalities m
      where p_lat between m.bbox_min_lat and m.bbox_max_lat
        and p_lng between m.bbox_min_lng and m.bbox_max_lng
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
$$;

comment on function public.ads_for_zone(double precision, double precision, bigint, text) is
  'Anuncios elegibles para una zona (subtarea 170.2): la zona activa DECLARADA '
  '(colonia o municipio que el usuario YA está viendo) gana sobre el GPS; sin '
  'zona activa resuelve por ST_Intersects contra mx_neighborhoods.geom; sin '
  'match de polígono cae al bbox precalculado de mx_municipalities; sin match '
  'de bbox tampoco, sirve SOLO el inventario nacional (🔒 nunca "sin '
  'anuncios"). Elegibilidad: status=active, vigente, creativo ready, y '
  '(ad_zones matchea la zona resuelta OR el ad no tiene ad_zones = nacional). '
  'Devuelve description (#192) y la identidad del anunciante (agency_name/'
  'agency_logo_url, ÚNICAMENTE name/logo_url de agencies -- nada más). Llamado '
  'por el feed como usuario authenticated.';

revoke execute on function public.ads_for_zone(double precision, double precision, bigint, text)
  from public, anon;
grant execute on function public.ads_for_zone(double precision, double precision, bigint, text)
  to authenticated;

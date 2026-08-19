-- Migración 20260819000002 — RPC public.resolve_ad_zone (subtarea #170.6).
--
-- Adapter real de ZoneResolver.resolve_zone(lat, lng) para la Edge Function
-- record-ad-impressions (contrato en supabase/functions/record-ad-impressions/
-- types.ts). La EF recalcula SIEMPRE la zona server-side por coordenadas —
-- nunca confía en lo que declara el cliente (ver handler.test.ts, sección
-- "Zona — recalculada, nunca la declarada").
--
-- Es la MISMA regla de resolución por coordenadas que public.ads_for_zone
-- (20260818000002, pasos 2-4: colonia por ST_Intersects → fallback bbox de
-- municipio → sin match, NULL/NULL = inventario nacional) extraída a su
-- propia función porque record-ad-impressions solo necesita resolver por
-- (lat, lng) — no conoce "zona declarada" (ads_for_zone sí, para el
-- ordenamiento zona-vista > GPS del feed, que es un concern distinto).
--
-- security definer + search_path fijo (public, pg_temp) — SIN extensions,
-- misma paridad EXACTA que ads_for_zone: todas las llamadas PostGIS ya van
-- calificadas extensions.*, así que excluir extensions del search_path es
-- seguro y es la defensa (no depender de que `extensions` esté primero en
-- la resolución de nombres). SOLO service_role la llama (la EF corre con la
-- service_role key); sin grant a authenticated/anon.
--
-- Idempotente: create or replace + revoke/grant repetibles.
-- Rollback: supabase/migrations/rollbacks/20260819000002_resolve_ad_zone.sql

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
  limit 1;

  if v_neighborhood_id is null then
    -- Hueco de cobertura DCAH: fallback por bbox precalculado del
    -- municipio. Solo municipio, sin colonia.
    select m.id into v_municipality_id
    from public.mx_municipalities m
    where p_lat between m.bbox_min_lat and m.bbox_max_lat
      and p_lng between m.bbox_min_lng and m.bbox_max_lng
    limit 1;
  end if;
  -- Si tampoco hay bbox: ambas columnas quedan NULL — la fila de
  -- ad_impressions se escribe igual (inventario nacional, 🔒 nunca se
  -- rechaza un item por falta de zona).

  return query select v_municipality_id, v_neighborhood_id;
end;
$$;

comment on function public.resolve_ad_zone(double precision, double precision) is
  'Resuelve municipality_id/neighborhood_id por coordenadas para '
  'record-ad-impressions (#170.6): ST_Intersects contra mx_neighborhoods.geom, '
  'fallback a bbox de mx_municipalities, NULL/NULL si no hay match (inventario '
  'nacional). Extraído de la misma regla de public.ads_for_zone (pasos 2-4). '
  'SOLO service_role la invoca.';

revoke execute on function public.resolve_ad_zone(double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.resolve_ad_zone(double precision, double precision)
  to service_role;

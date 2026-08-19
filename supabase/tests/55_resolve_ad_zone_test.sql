-- Tests pgTAP — RPC public.resolve_ad_zone (subtarea #170.6, adapter real de
-- ZoneResolver.resolve_zone(lat,lng) para la Edge Function
-- record-ad-impressions). Ejecutar con:
--   supabase test db supabase/tests/55_resolve_ad_zone_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO — (lat, lng) → (municipality_id,
-- neighborhood_id). Misma regla de resolución que public.ads_for_zone (pasos
-- 2-4: colonia por ST_Intersects gana, fallback a bbox de municipio, sin
-- match = NULL/NULL). Se ejercita la llamada real, nunca internals.
--
-- Edge cases:
--   1) punto DENTRO de una colonia -> neighborhood_id + su municipality_id.
--   2) punto FUERA de cualquier colonia pero DENTRO del bbox del municipio
--      (el hueco de cobertura DCAH) -> SOLO municipality_id, neighborhood_id NULL.
--   3) punto fuera de todo -> NULL/NULL (inventario nacional, nunca rechaza).
--   4) colonia gana sobre bbox cuando el punto cae en ambos a la vez.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(6);

-- Fixtures self-contained, aislados con state '59' (fuera del rango real
-- 01-32 INEGI y de los usados por otros archivos de test).
insert into public.mx_states (id, name, abbr) values ('59', 'Estado Resolve Ad Zone Test 59', 'RZ');

insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  ('59001', '59', 'Municipio Resolve Ad Zone 59', 19.20, -99.50, 19.60, -99.00);

insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-resolvezone-59-a1', '59001', 'Colonia Resolve Ad Zone 59',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

create temp table test_ctx_55 as
select (select id from public.mx_neighborhoods where source_key = 'test-resolvezone-59-a1') as neighborhood_id;

-- Puntos (x=lng, y=lat):
--   p_in_neighborhood (19.31,-99.29): dentro de la colonia (y del bbox del municipio).
--   p_in_bbox_gap      (19.50,-99.45): dentro del bbox del municipio, FUERA de la colonia.
--   p_outside          (0, 0):         fuera de todo.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Punto dentro de la colonia -> neighborhood_id + municipality_id de esa colonia.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select neighborhood_id from public.resolve_ad_zone(19.31, -99.29)),
  (select neighborhood_id from test_ctx_55),
  'IN_NEIGHBORHOOD1_punto_dentro_de_la_colonia_resuelve_su_neighborhood_id'
);
select is(
  (select municipality_id from public.resolve_ad_zone(19.31, -99.29)),
  '59001',
  'IN_NEIGHBORHOOD2_punto_dentro_de_la_colonia_resuelve_tambien_su_municipio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Punto dentro del bbox del municipio, fuera de la colonia (hueco DCAH)
--    -> SOLO municipality_id, neighborhood_id NULL.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select municipality_id from public.resolve_ad_zone(19.50, -99.45)),
  '59001',
  'BBOX_GAP1_punto_fuera_de_la_colonia_pero_dentro_del_bbox_resuelve_solo_municipio'
);
select is(
  (select neighborhood_id from public.resolve_ad_zone(19.50, -99.45)),
  null,
  'BBOX_GAP2_neighborhood_id_queda_null_sin_match_de_poligono'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Punto fuera de todo -> NULL/NULL (inventario nacional, nunca rechaza).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select (municipality_id is null and neighborhood_id is null) from public.resolve_ad_zone(0, 0)),
  true,
  'OUTSIDE1_punto_fuera_de_todo_devuelve_null_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) La colonia gana sobre el bbox del municipio (el punto de 1) cae en
--    ambos): neighborhood_id presente confirma que NO se usó únicamente el
--    fallback de bbox.
-- ════════════════════════════════════════════════════════════════════════════

select isnt(
  (select neighborhood_id from public.resolve_ad_zone(19.31, -99.29)),
  null,
  'PRIORITY1_colonia_gana_sobre_bbox_cuando_el_punto_cae_en_ambos'
);

select * from finish();
rollback;

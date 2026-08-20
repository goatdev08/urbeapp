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
--
-- Z7 (fix guardián 170.6) — grants/prosecdef/search_path, mismo estándar que
-- 53_ads_for_zone_test.sql (SIG4/SIG5/GRANT1/GRANT2): la migración afirma en
-- su propio comentario "SOLO service_role la invoca" pero, sin este bloque,
-- ningún test verificaba prosecdef, el valor EXACTO de search_path ni los
-- grants — dejar EXECUTE a `authenticated` hoy no rompería ni un solo test.
-- 🔴 SIG_SEARCH_PATH se escribe contra el valor CORRECTO ('public, pg_temp',
-- igual que ads_for_zone) a propósito: la migración actual tiene
-- 'public, extensions, pg_temp' (una entrada de más, innecesaria porque
-- ST_Intersects/ST_SetSRID/geography ya se llaman SIEMPRE calificados como
-- extensions.*) -- este test queda en ROJO hasta que el GREEN la corrija.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(11);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

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

-- ════════════════════════════════════════════════════════════════════════════
-- Z7 — 5) prosecdef, search_path EXACTO y grants (fix guardián 170.6).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select prosecdef from pg_proc where proname = 'resolve_ad_zone' and pronamespace = 'public'::regnamespace),
  true,
  'SIG4_resolve_ad_zone_es_security_definer'
);

select is(
  (select proconfig::text[] @> array['search_path=public, pg_temp'] from pg_proc
    where proname = 'resolve_ad_zone' and pronamespace = 'public'::regnamespace),
  true,
  'SIG5_search_path_fijo_a_public_pg_temp_sin_extensions_de_mas_igual_que_ads_for_zone'
);

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.resolve_ad_zone(19.31, -99.29) $$,
  '42501', null,
  'GRANT1_anon_no_puede_ejecutar_resolve_ad_zone_sin_grant_de_execute'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000550001', 'authenticated');
select throws_ok(
  $$ select * from public.resolve_ad_zone(19.31, -99.29) $$,
  '42501', null,
  'GRANT2_authenticated_TAMPOCO_puede_ejecutar_resolve_ad_zone_a_diferencia_de_ads_for_zone_esta_es_SOLO_de_service_role'
);
reset role;

select pg_temp.act_as(null, 'service_role');
create temp table result_grant_service_55 (ok boolean, err_sqlstate text);
do $$
begin
  perform count(*) from public.resolve_ad_zone(19.31, -99.29);
  insert into result_grant_service_55 values (true, null);
exception when others then
  insert into result_grant_service_55 values (false, sqlstate);
end $$;
reset role;
select is((select ok from result_grant_service_55), true,
  'GRANT3_service_role_SI_puede_ejecutar_resolve_ad_zone');

select * from finish();
rollback;

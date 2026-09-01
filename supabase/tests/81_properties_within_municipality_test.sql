-- Tests pgTAP — RPC properties_within_municipality (tarea #160)
-- Ejecutar con: supabase test db supabase/tests/81_properties_within_municipality_test.sql
--
-- RED (2026-09-02): la función AÚN NO EXISTE. La migración GREEN
-- (20260902200002_properties_within_municipality.sql) debe crearla como ESPEJO
-- de properties_within_neighborhood (20260813000002): patrón A1 "flaco"
-- —devuelve SOLO {id uuid}, el cliente hace .in('id', ids) y aplica el resto
-- de filtros con build_filter_query—, security definer, search_path fijo,
-- revoke public/anon + grant authenticated.
--
--   properties_within_municipality(p_municipality_id text) -> table (id uuid)
--
-- QUÉ BUG MATA: hoy seleccionar un municipio reusa filters.area (un CÍRCULO
-- derivado del bbox) y viewport_to_area lo clampa a MAX_RADIUS_M = 50 km.
-- Municipios grandes (Ensenada, Mexicali, Hermosillo) NUNCA cargan los pins
-- a más de 50 km del centroide, sin error visible; los chicos sobre-incluyen
-- (Zapopan mostraba propiedades de Guadalajara y Tlaquepaque).
--
-- 🔒 EL ASSERT QUE DEFINE EL CONTRATO es el 4: una propiedad que cae en el
-- HUECO entre dos colonias del municipio —dentro del bbox de la unión, fuera
-- de la unión— NO debe aparecer. Es lo único que distingue "unión de los
-- polígonos de las colonias" de "otro rectángulo más", que es el defecto que
-- esta tarea vino a quitar. El municipio NO tiene geometría propia en el
-- esquema (mx_municipalities solo lleva bbox_min/max_lat/lng, D4 de 0065).
--
-- Fixtures: municipios sintéticos con cvegeo 149xx —INEGI no los asigna
-- (Jalisco llega a 14125)— para que el archivo no dependa de si el import de
-- colonias de #157 corrió en esta base (lección #175). Geometría en el mar
-- frente a BCS (patrón del test 44): la base local trae propiedades sembradas
-- en el centro de Guadalajara y un cuadrado ahí rompería los conteos exactos.

begin;
select plan(14);

-- ── Fixtures: tres municipios sintéticos, tres escenarios ───────────────────
insert into public.mx_municipalities (id, state_id, name,
                                      bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  -- A) Con colonias cargadas: el camino normal (unión de polígonos).
  ('14997', '14', 'Municipiotest Con Colonias', null, null, null, null),
  -- B) Sin colonias pero con bbox precalculado: el fallback.
  ('14998', '14', 'Municipiotest Solo Bbox', 23.00, -111.00, 23.10, -110.90),
  -- C) Sin colonias y sin bbox: no hay geometría que usar -> 0 filas.
  ('14996', '14', 'Municipiotest Sin Geometria', null, null, null, null);

-- Dos colonias DISJUNTAS del municipio A, con un hueco entre ellas.
-- Unión: [-110.00..-109.96] ∪ [-110.10..-110.08] (en latitud 22.00..22.04).
-- Bbox de la unión: [-110.10..-109.96] — el hueco [-110.08..-110.00] queda
-- DENTRO del bbox y FUERA de la unión: ahí vive la propiedad del assert 4.
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-160-nb-a', '14997', 'Coloniatest Este',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-110.00, 22.00, -109.96, 22.04, 4326))::extensions.geography),
  ('test-160-nb-b', '14997', 'Coloniatest Oeste',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-110.10, 22.00, -110.08, 22.04, 4326))::extensions.geography);

-- El trigger handle_new_user (0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000160', 'owner_muni@urbea.mx');

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  -- p1: dentro de la colonia Este, activa -> DEBE aparecer.
  ('00000000-0000-0000-0000-000000016001', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — colonia Este',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.98, 22.02), 4326)::extensions.geography, 10000, 'active'),
  -- p2: dentro de la colonia Oeste, activa -> DEBE aparecer (unión, no una sola colonia).
  ('00000000-0000-0000-0000-000000016002', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — colonia Oeste',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-110.09, 22.02), 4326)::extensions.geography, 10000, 'active'),
  -- p3: en el HUECO entre las dos colonias -> NO debe aparecer (🔒 assert 4).
  ('00000000-0000-0000-0000-000000016003', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — hueco entre colonias',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-110.04, 22.02), 4326)::extensions.geography, 10000, 'active'),
  -- p4: dentro de la colonia Este pero pausada -> NO.
  ('00000000-0000-0000-0000-000000016004', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — pausada',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.99, 22.01), 4326)::extensions.geography, 10000, 'paused'),
  -- p5: dentro de la colonia Este pero soft-deleted -> NO.
  ('00000000-0000-0000-0000-000000016005', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — borrada',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-109.97, 22.03), 4326)::extensions.geography, 10000, 'active'),
  -- p6: dentro del bbox del municipio B (sin colonias) -> DEBE aparecer por fallback.
  ('00000000-0000-0000-0000-000000016006', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — dentro del bbox de B',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-110.95, 23.05), 4326)::extensions.geography, 10000, 'active'),
  -- p7: fuera del bbox del municipio B -> NO.
  ('00000000-0000-0000-0000-000000016007', '00000000-0000-0000-0000-000000000160',
   'departamento', 'rent', 'Fixture muni — fuera del bbox de B',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-110.50, 23.05), 4326)::extensions.geography, 10000, 'active');
update public.properties set deleted_at = now()
  where id = '00000000-0000-0000-0000-000000016005';

-- ── 1) La función existe con la firma espejo ───────────────────────────────
select has_function('public', 'properties_within_municipality', array['text'],
  'public.properties_within_municipality(text) existe');

-- ── 2-3) Las dos colonias del municipio cuentan, no solo una ───────────────
select is(
  (select count(*)::int from public.properties_within_municipality('14997')
    where id = '00000000-0000-0000-0000-000000016001'),
  1,
  'properties_within_municipality: la propiedad de la colonia Este aparece');
select is(
  (select count(*)::int from public.properties_within_municipality('14997')
    where id = '00000000-0000-0000-0000-000000016002'),
  1,
  'properties_within_municipality: la propiedad de la colonia Oeste también (unión de TODAS las colonias)');

-- ── 4) 🔒 El hueco entre colonias NO se incluye ────────────────────────────
-- Dentro del bbox de la unión, fuera de la unión. Si este assert pasa a verde
-- sin los demás, la implementación volvió a ser "otro rectángulo" (el bug).
select is(
  (select count(*)::int from public.properties_within_municipality('14997')
    where id = '00000000-0000-0000-0000-000000016003'),
  0,
  '🔒 properties_within_municipality: el hueco entre dos colonias NO se incluye (unión real, no bbox)');

-- ── 5-6) Visibilidad resuelta en el cuerpo, no por RLS ─────────────────────
select is(
  (select count(*)::int from public.properties_within_municipality('14997')
    where id = '00000000-0000-0000-0000-000000016004'),
  0,
  'properties_within_municipality: paused dentro del municipio NO aparece');
select is(
  (select count(*)::int from public.properties_within_municipality('14997')
    where id = '00000000-0000-0000-0000-000000016005'),
  0,
  'properties_within_municipality: soft-deleted dentro del municipio NO aparece');

-- ── 7) Conteo exacto del municipio A ───────────────────────────────────────
-- También ancla que la unión no duplica ids si un punto tocara dos colonias.
select is(
  (select count(*)::int from public.properties_within_municipality('14997')),
  2,
  'properties_within_municipality: exactamente 2 resultados en el municipio A (sin duplicados)');

-- ── 8-10) Fallback por bbox cuando el municipio no tiene colonias ──────────
select is(
  (select count(*)::int from public.properties_within_municipality('14998')
    where id = '00000000-0000-0000-0000-000000016006'),
  1,
  'properties_within_municipality: sin colonias cargadas cae al bbox precalculado del municipio');
select is(
  (select count(*)::int from public.properties_within_municipality('14998')
    where id = '00000000-0000-0000-0000-000000016007'),
  0,
  'properties_within_municipality: el fallback por bbox tampoco incluye lo que queda fuera');
select is(
  (select count(*)::int from public.properties_within_municipality('14998')),
  1,
  'properties_within_municipality: conteo exacto del fallback por bbox');

-- ── 11) Sin colonias y sin bbox -> 0 filas, sin excepción ──────────────────
select is(
  (select count(*)::int from public.properties_within_municipality('14996')),
  0,
  'properties_within_municipality: municipio sin geometría alguna -> 0 filas (no error)');

-- ── 12) Municipio inexistente -> 0 filas ───────────────────────────────────
select is(
  (select count(*)::int from public.properties_within_municipality('99999')),
  0,
  'properties_within_municipality: cvegeo inexistente -> 0 filas (no error)');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad: grants espejo de properties_within_neighborhood
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 13-14) anon NO puede ejecutar / authenticated SÍ ───────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.properties_within_municipality('14997') $$,
  '42501', null,
  'anon no puede ejecutar properties_within_municipality');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000000160', 'authenticated');
select lives_ok(
  $$ select * from public.properties_within_municipality('14997') $$,
  'authenticated puede ejecutar properties_within_municipality');
reset role;

select * from finish();
rollback;

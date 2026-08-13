-- Tests pgTAP — RPC import_neighborhoods_batch (tarea #157.4)
-- Ejecutar con: supabase test db
--
-- RED (2026-08-13): la función AÚN NO EXISTE. La migración GREEN
-- (20260813000003_import_neighborhoods_batch_rpc.sql) debe crearla.
--
-- Contexto: el import remoto de colonias NO puede usar psql (no hay contraseña de
-- la DB en esta máquina y Abraham prefirió no compartirla). El camino elegido es
-- una EF desechable (import-neighborhoods) que recibe lotes por HTTP y llama esta
-- RPC con el service_role inyectado — el MISMO upsert validado del script psql
-- (import-neighborhoods.sh), empaquetado en SQL:
--
--   import_neighborhoods_batch(p_rows jsonb) -> table (inserted int, skipped int)
--     p_rows = array de {source_key, municipality_id, name, postal_code?, geojson}.
--     Upsert por source_key; municipio fuera del catálogo se SALTA (no truena la
--     FK); geometría pasa por ST_MakeValid + CollectionExtract(3) + ST_Multi y las
--     vacías se saltan. inserted = filas upserteadas; skipped = resto del lote.
--     🔒 EXECUTE SOLO service_role — ni anon NI authenticated (es una herramienta
--     de operación, no un endpoint de la app).

begin;
select plan(13);

-- ── 1) La función existe ────────────────────────────────────────────────────
select has_function('public', 'import_neighborhoods_batch', array['jsonb'],
  'public.import_neighborhoods_batch(jsonb) existe');

-- ── 2-3) Lote válido de 2 filas (municipio real 14039) ─────────────────────
create temp table r1 as
select * from public.import_neighborhoods_batch('[
  {"source_key": "test-157-batch-a", "municipality_id": "14039", "name": "Colonia Batch Á",
   "postal_code": "44100",
   "geojson": "{\"type\":\"Polygon\",\"coordinates\":[[[-110.0,22.0],[-109.98,22.0],[-109.98,22.02],[-110.0,22.02],[-110.0,22.0]]]}"},
  {"source_key": "test-157-batch-b", "municipality_id": "14039", "name": "Colonia Batch B",
   "postal_code": "",
   "geojson": "{\"type\":\"Polygon\",\"coordinates\":[[[-110.1,22.0],[-110.08,22.0],[-110.08,22.02],[-110.1,22.02],[-110.1,22.0]]]}"}
]'::jsonb);
select is((select inserted from r1), 2, 'lote válido de 2: inserted = 2');
select is((select skipped from r1), 0, 'lote válido de 2: skipped = 0');

-- ── 4-6) Las filas quedaron bien: normalizada, MultiPolygon, CP vacío -> NULL ─
select is(
  (select name_normalized from public.mx_neighborhoods where source_key = 'test-157-batch-a'),
  'colonia batch a',
  'name_normalized se genera al insertar por la RPC');
select is(
  (select extensions.GeometryType(geom::extensions.geometry) from public.mx_neighborhoods
   where source_key = 'test-157-batch-a'),
  'MULTIPOLYGON',
  'la geometría Polygon del lote se normaliza a MULTIPOLYGON');
select is(
  (select postal_code from public.mx_neighborhoods where source_key = 'test-157-batch-b'),
  null,
  'postal_code vacío del lote queda NULL');

-- ── 7-8) Municipio fuera del catálogo: se salta, no truena ─────────────────
create temp table r2 as
select * from public.import_neighborhoods_batch('[
  {"source_key": "test-157-batch-huerfana", "municipality_id": "99999", "name": "Huérfana",
   "geojson": "{\"type\":\"Polygon\",\"coordinates\":[[[-110.0,22.0],[-109.98,22.0],[-109.98,22.02],[-110.0,22.02],[-110.0,22.0]]]}"}
]'::jsonb);
select is((select inserted from r2), 0, 'municipio desconocido: inserted = 0 (sin error de FK)');
select is((select skipped from r2), 1, 'municipio desconocido: skipped = 1');

-- ── 9-10) Upsert: mismo source_key con nombre nuevo actualiza, no duplica ──
create temp table r3 as
select * from public.import_neighborhoods_batch('[
  {"source_key": "test-157-batch-a", "municipality_id": "14039", "name": "Colonia Batch Á Renombrada",
   "geojson": "{\"type\":\"Polygon\",\"coordinates\":[[[-110.0,22.0],[-109.98,22.0],[-109.98,22.02],[-110.0,22.02],[-110.0,22.0]]]}"}
]'::jsonb);
select is(
  (select name from public.mx_neighborhoods where source_key = 'test-157-batch-a'),
  'Colonia Batch Á Renombrada',
  'upsert: el nombre se actualiza en el re-import');
select is(
  (select count(*)::int from public.mx_neighborhoods where source_key like 'test-157-batch-%'),
  2,
  'upsert: el re-import no duplica filas');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad: SOLO service_role (ni anon ni authenticated)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 11) anon NO puede ──────────────────────────────────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.import_neighborhoods_batch('[]'::jsonb) $$,
  '42501', null,
  'anon no puede ejecutar import_neighborhoods_batch');
reset role;

-- ── 12) authenticated TAMPOCO (herramienta de operación, no de la app) ─────
select pg_temp.act_as('00000000-0000-0000-0000-000000000001', 'authenticated');
select throws_ok(
  $$ select * from public.import_neighborhoods_batch('[]'::jsonb) $$,
  '42501', null,
  'authenticated no puede ejecutar import_neighborhoods_batch');
reset role;

-- ── 13) service_role SÍ puede ──────────────────────────────────────────────
select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select * from public.import_neighborhoods_batch('[]'::jsonb) $$,
  'service_role puede ejecutar import_neighborhoods_batch');
reset role;

select * from finish();
rollback;

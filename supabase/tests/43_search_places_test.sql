-- Tests pgTAP — RPCs search_places + get_neighborhood_geojson (tarea #157.2)
-- Ejecutar con: supabase test db
--
-- RED (2026-08-13): las funciones AÚN NO EXISTEN. La migración GREEN
-- (20260813000002_place_search_rpcs.sql) debe crear, con el patrón de
-- properties_within_radius (security definer, search_path = public, extensions,
-- private; revoke public/anon + grant authenticated):
--
--   search_places(p_query text, p_limit int default 10)
--     -> (kind 'neighborhood'|'municipality', id text, name, context,
--         min_lat, min_lng, max_lat, max_lng)
--     Guard: query normalizada < 2 chars -> 0 filas. Clamp p_limit a [1,20].
--     UNION ALL: municipios (bbox precalculado D4, context = nombre del estado) +
--     colonias (bbox on-the-fly ST_X/YMin/Max, context = 'Municipio, Abbr').
--     Predicado sobre name_normalized: LIKE 'q%' OR % (similitud trgm — ambos
--     usan los índices GIN de la migración 0065).
--     Ranking: prefijo primero, luego similarity desc, municipio sobre colonia.
--
--   get_neighborhood_geojson(p_neighborhood_id bigint)
--     -> (id, name, geojson text /* ST_AsGeoJSON(geom, 5) */, min/max lat/lng)
--     0 o 1 filas (el cliente trata vacío como not-found).
--
-- ⚠️ Patrón RED (ver 16/42): has_function reporta "not ok" limpio; desde la
-- primera consulta RAW que invoca la función inexistente, la transacción aborta
-- y el resto cae en cascada hasta el rollback.
--
-- Fixtures: colonias sintéticas en Guadalajara (14039) con ST_MakeEnvelope
-- alrededor del centro GDL; el catálogo 72.1 ya siembra municipios y estados.

begin;
select plan(24);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Bbox municipal precalculado (D4) — en producción lo llena el import.
update public.mx_municipalities
  set bbox_min_lat = 20.60, bbox_min_lng = -103.42,
      bbox_max_lat = 20.74, bbox_max_lng = -103.26
  where id = '14039';

insert into public.mx_neighborhoods (source_key, municipality_id, name, postal_code, geom) values
  ('test-157-providencia', '14039', 'Providencia', '44630',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.38, 20.69, -103.36, 20.71, 4326))::extensions.geography),
  ('test-157-providencia-2a', '14039', 'Providencia 2a Sección', '44639',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.36, 20.69, -103.34, 20.71, 4326))::extensions.geography),
  ('test-157-alvaro-obregon', '14039', 'Álvaro Obregón', '44720',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.32, 20.66, -103.30, 20.68, 4326))::extensions.geography);

-- 25 colonias homónimas para probar el techo del clamp (p_limit > 20 -> 20).
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom)
select 'test-157-villa-' || i, '14039', 'Villa Prueba ' || i,
       extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.40, 20.60, -103.39, 20.61, 4326))::extensions.geography
from generate_series(1, 25) as i;

-- ── 1-2) Las funciones existen ──────────────────────────────────────────────
select has_function('public', 'search_places', array['text', 'integer'],
  'public.search_places(text, integer) existe');
select has_function('public', 'get_neighborhood_geojson', array['bigint'],
  'public.get_neighborhood_geojson(bigint) existe');

-- ════════════════════════════════════════════════════════════════════════════
-- search_places: guard, matching, ranking, context, bbox, clamp
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3-4) Guard: menos de 2 caracteres útiles -> 0 filas ────────────────────
select is((select count(*)::int from public.search_places('p')), 0,
  'search_places: 1 carácter -> 0 filas (guard, no dispara scan)');
select is((select count(*)::int from public.search_places('   ')), 0,
  'search_places: solo espacios -> 0 filas');

-- ── 5-6) Prefijo: "provi" encuentra las 2 Providencias, la exacta primero ──
select is(
  (select count(*)::int from public.search_places('provi') where kind = 'neighborhood'),
  2,
  'search_places(provi): encuentra las 2 colonias Providencia*');
select is(
  (select name from public.search_places('provi') limit 1),
  'Providencia',
  'search_places(provi): la de mayor similitud (nombre exacto más corto) va primero');

-- ── 7-8) Acentos: la query se normaliza igual que la columna ───────────────
select ok(
  exists(select 1 from public.search_places('alvaro') where name = 'Álvaro Obregón' and kind = 'neighborhood'),
  'search_places(alvaro, sin acento): encuentra Álvaro Obregón');
select ok(
  exists(select 1 from public.search_places('Álvaro') where name = 'Álvaro Obregón' and kind = 'neighborhood'),
  'search_places(Álvaro, con acento y mayúscula): también lo encuentra');

-- ── 9) Fuzzy sin prefijo: "obregon" matchea por similitud trgm (%) ─────────
select ok(
  exists(select 1 from public.search_places('obregon') where name = 'Álvaro Obregón' and kind = 'neighborhood'),
  'search_places(obregon): matchea Álvaro Obregón sin ser prefijo (operador %)');

-- ── 10-12) Municipios: aparecen, con context = estado y bbox precalculado ──
select ok(
  exists(select 1 from public.search_places('guadal') where kind = 'municipality' and id = '14039'),
  'search_places(guadal): incluye el municipio Guadalajara (14039)');
select is(
  (select context from public.search_places('guadalajara') where id = '14039' and kind = 'municipality'),
  'Jalisco',
  'search_places: context del municipio = nombre del estado');
select is(
  (select min_lat from public.search_places('guadalajara') where id = '14039' and kind = 'municipality'),
  20.60::double precision,
  'search_places: el bbox precalculado del municipio (D4) fluye a la sugerencia');

-- ── 13-14) Colonias: context "Municipio, Abbr" y bbox on-the-fly del geom ──
select is(
  (select context from public.search_places('providencia') where name = 'Providencia'),
  'Guadalajara, Jal.',
  'search_places: context de la colonia = municipio + abreviatura del estado');
select ok(
  (select abs(min_lng - (-103.38)) < 1e-6 and abs(max_lat - 20.71) < 1e-6
   from public.search_places('providencia') where name = 'Providencia'),
  'search_places: bbox de la colonia sale del geom (ST_X/YMin/Max del envelope)');

-- ── 15-17) Clamp del límite: [1, 20] ───────────────────────────────────────
select is((select count(*)::int from public.search_places('villa prueba', 1)), 1,
  'search_places: p_limit=1 devuelve exactamente 1 fila');
select is((select count(*)::int from public.search_places('villa prueba', 0)), 1,
  'search_places: p_limit=0 se clampa a 1');
select is((select count(*)::int from public.search_places('villa prueba', 999)), 20,
  'search_places: p_limit=999 se clampa a 20 (hay 25 candidatas)');

-- ════════════════════════════════════════════════════════════════════════════
-- get_neighborhood_geojson
-- ════════════════════════════════════════════════════════════════════════════

-- ── 18-20) Colonia existente: 1 fila, GeoJSON MultiPolygon, bbox y nombre ──
select is(
  (select count(*)::int from public.get_neighborhood_geojson(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-providencia'))),
  1,
  'get_neighborhood_geojson: colonia existente -> exactamente 1 fila');
select ok(
  (select geojson like '%MultiPolygon%'
   from public.get_neighborhood_geojson(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-providencia'))),
  'get_neighborhood_geojson: el GeoJSON es MultiPolygon');
select ok(
  (select name = 'Providencia' and abs(min_lat - 20.69) < 1e-6 and abs(max_lng - (-103.36)) < 1e-6
   from public.get_neighborhood_geojson(
     (select n.id from public.mx_neighborhoods n where n.source_key = 'test-157-providencia'))),
  'get_neighborhood_geojson: nombre y bbox correctos');

-- ── 21) Id inexistente -> 0 filas (el cliente lo trata como not-found) ─────
select is((select count(*)::int from public.get_neighborhood_geojson(-1)), 0,
  'get_neighborhood_geojson: id inexistente -> 0 filas');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad: anon sin EXECUTE, authenticated sí (patrón RPC de radio)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 22-23) anon NO puede ejecutar ninguna de las dos ───────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.search_places('providencia') $$,
  '42501', null,
  'anon no puede ejecutar search_places (revoke explícito, advisor 0028)');
select throws_ok(
  $$ select * from public.get_neighborhood_geojson(1) $$,
  '42501', null,
  'anon no puede ejecutar get_neighborhood_geojson');
reset role;

-- ── 24) authenticated SÍ puede ─────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000000001', 'authenticated');
select lives_ok(
  $$ select * from public.search_places('providencia') $$,
  'authenticated puede ejecutar search_places');
reset role;

select * from finish();
rollback;

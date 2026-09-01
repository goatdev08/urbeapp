-- Tests pgTAP — RPC place_at_point (subtarea 232.1)
-- Ejecutar con: supabase test db supabase/tests/82_place_at_point_test.sql
--
-- RED (2026-09-02): la función AÚN NO EXISTE. La migración GREEN
-- (20260902200003_place_at_point.sql) debe crearla con el MISMO shape de fila
-- que search_places (kind/id/name/context/min_lat/min_lng/max_lat/max_lng) —
-- el cliente unificado de #232 mezcla sugerencias de catálogo y direcciones
-- geocodificadas en una sola lista, así que una dirección resuelta tiene que
-- ser indistinguible de una sugerencia:
--
--   place_at_point(p_lat double precision, p_lng double precision)
--     -> 0 o 1 fila
--     1) colonia de mx_neighborhoods cuyo polígono contiene el punto;
--     2) si no hay, municipio cuyo bbox precalculado lo contiene, el de MENOR
--        ÁREA, desempatando por id (precedente #194, palabra por palabra);
--     3) si tampoco, 0 filas.
--
-- 🔒 NUNCA INVENTA ZONA. La zona que se guarda es siempre de catálogo INEGI
-- (calidad de datos, #232): fuera de cobertura devuelve 0 filas y el cliente
-- lo comunica, jamás fabrica una colonia a partir de la dirección.
--
-- ⚠️ FRONTERA — desviación deliberada del enunciado: la subtarea dice
-- "ST_Contains", pero (i) el tipo geography no tiene ST_Contains y forzarlo
-- exigiría castear a geometry perdiendo el GiST de mx_neighborhoods, y
-- (ii) ST_Contains devuelve FALSE para un punto EXACTAMENTE sobre el borde,
-- lo que resolvería a "sin cobertura" un domicilio geocodificado sobre una
-- calle límite. Se usa ST_Intersects, igual que properties_within_neighborhood
-- (#157.2), ads_for_zone y resolve_ad_zone (#194). El assert 7 lo fija.
--
-- Fixtures: municipios sintéticos con cvegeo 149xx (INEGI no los asigna) y
-- geometría en el ATLÁNTICO SUR, lejos de México, para que ningún bbox real
-- del catálogo pueda contener los puntos de prueba aunque el import de #157
-- haya corrido en esta base (lección #175).

begin;
select plan(19);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.mx_municipalities (id, state_id, name,
                                      bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) values
  -- Grande (área 0.36) — contiene a la colonia y al chico.
  ('14999', '14', 'Municipiotest Grande', -40.30, -20.30, -39.70, -19.70),
  -- Chico (área 0.0025) — anidado en el grande, fuera de la colonia.
  ('14998', '14', 'Municipiotest Chico',  -40.10, -20.10, -40.05, -20.05),
  -- Par con áreas IDÉNTICAS en otra región: el desempate solo puede ser por id.
  ('14995', '14', 'Municipiotest Empate A', -50.10, -30.10, -50.00, -30.00),
  ('14996', '14', 'Municipiotest Empate B', -50.10, -30.10, -50.00, -30.00);

insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-232-colonia', '14999', 'Coloniatest Punto',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-20.00, -40.00, -19.96, -39.96, 4326))::extensions.geography);

-- ── 1) La función existe ────────────────────────────────────────────────────
select has_function('public', 'place_at_point', array['double precision', 'double precision'],
  'public.place_at_point(double precision, double precision) existe');

-- ════════════════════════════════════════════════════════════════════════════
-- Punto DENTRO de una colonia: gana el polígono, no el municipio
-- ════════════════════════════════════════════════════════════════════════════

-- ── 2) Exactamente 1 fila ───────────────────────────────────────────────────
select is((select count(*)::int from public.place_at_point(-39.98, -19.98)), 1,
  'place_at_point dentro de una colonia -> exactamente 1 fila');

-- ── 3) Es la colonia (no el municipio que también la contiene) ─────────────
select is(
  (select p.kind || '|' || p.id from public.place_at_point(-39.98, -19.98) p),
  'neighborhood|' || (select n.id::text from public.mx_neighborhoods n
                       where n.source_key = 'test-232-colonia'),
  'place_at_point: el polígono de la colonia gana sobre el bbox del municipio');

-- ── 4) name + context con el mismo formato que search_places ──────────────
select is(
  (select p.name || ' // ' || p.context from public.place_at_point(-39.98, -19.98) p),
  'Coloniatest Punto // Municipiotest Grande, Jal.',
  'place_at_point: name y context de la colonia con el formato de search_places');

-- ── 5) bbox derivado del geom ──────────────────────────────────────────────
select ok(
  (select abs(p.min_lat - (-40.00)) < 1e-6 and abs(p.min_lng - (-20.00)) < 1e-6
      and abs(p.max_lat - (-39.96)) < 1e-6 and abs(p.max_lng - (-19.96)) < 1e-6
   from public.place_at_point(-39.98, -19.98) p),
  'place_at_point: bbox de la colonia = extents de su geom');

-- ── 6) 🔒 Shape idéntico al de search_places ───────────────────────────────
-- UNION ALL exige mismo número de columnas y mismos tipos: si el shape
-- divergiera, el cliente unificado de #232 no podría mezclar ambas fuentes.
select lives_ok(
  $$ select * from public.place_at_point(-39.98, -19.98)
     union all
     select * from public.search_places('coloniatest', 1) $$,
  '🔒 place_at_point devuelve el MISMO shape de fila que search_places');

-- ── 7) Punto EXACTAMENTE sobre la frontera de la colonia ──────────────────
select is(
  (select p.kind || '|' || p.id from public.place_at_point(-40.00, -19.98) p),
  'neighborhood|' || (select n.id::text from public.mx_neighborhoods n
                       where n.source_key = 'test-232-colonia'),
  'place_at_point: un punto sobre el borde resuelve a la colonia (ST_Intersects, no ST_Contains)');

-- ════════════════════════════════════════════════════════════════════════════
-- Fallback a municipio por bbox (hueco de cobertura DCAH)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 8) Fuera de toda colonia, dentro de dos bboxes anidados -> 1 fila ─────
select is((select count(*)::int from public.place_at_point(-40.07, -20.07)), 1,
  'place_at_point fuera de colonia pero dentro de bboxes municipales -> 1 fila');

-- ── 9) 🔒 Gana el bbox de MENOR ÁREA (precedente #194) ────────────────────
select is(
  (select p.kind || '|' || p.id from public.place_at_point(-40.07, -20.07) p),
  'municipality|14998',
  '🔒 place_at_point: entre bboxes que se solapan gana el de menor área (#194), no el grande');

-- ── 10) name/context/bbox del municipio: context = estado, bbox precalculado ──
select ok(
  (select p.name = 'Municipiotest Chico' and p.context = 'Jalisco'
      and abs(p.min_lat - (-40.10)) < 1e-6 and abs(p.max_lng - (-20.05)) < 1e-6
   from public.place_at_point(-40.07, -20.07) p),
  'place_at_point: name, context (estado) y bbox precalculado del municipio');

-- ── 11) 🔒 Áreas idénticas: desempate determinista por id ─────────────────
select is(
  (select p.id from public.place_at_point(-50.05, -30.05) p),
  '14995',
  '🔒 place_at_point: con áreas idénticas desempata por id asc (determinismo #194)');

-- ════════════════════════════════════════════════════════════════════════════
-- 🔒 Fuera de cobertura y entradas hostiles: 0 filas, nunca una zona inventada
-- ════════════════════════════════════════════════════════════════════════════

-- ── 12) En el mar, fuera de todo polígono y todo bbox ─────────────────────
select is((select count(*)::int from public.place_at_point(-60.00, -50.00)), 0,
  '🔒 place_at_point en el mar (sin colonia ni bbox) -> 0 filas, no inventa zona');

-- ── 13) Coordenadas fuera del rango geográfico válido ─────────────────────
-- Sin guard esto revienta: el cast a geography exige lat ∈ [-90,90].
select is((select count(*)::int from public.place_at_point(999, -999)), 0,
  'place_at_point con lat/lng fuera de rango -> 0 filas, sin excepción');

-- ── 14) NaN / Infinity ────────────────────────────────────────────────────
select is((select count(*)::int from public.place_at_point('NaN'::double precision, 'Infinity'::double precision)), 0,
  'place_at_point con NaN/Infinity -> 0 filas, sin excepción');

-- ── 15) NULLs ─────────────────────────────────────────────────────────────
select is((select count(*)::int from public.place_at_point(null, null)), 0,
  'place_at_point con NULLs -> 0 filas, sin excepción');

-- ── 16) Inyección: el payload muere en la frontera de tipos ───────────────
-- La firma es (double precision, double precision): un payload de texto ni
-- siquiera llega al cuerpo de la función — Postgres lo rechaza con 22P02.
-- Junto con el assert 17 (nada de SQL dinámico) cierra la superficie.
select throws_ok(
  $$ select * from public.place_at_point('-39.98); drop table public.properties; --'::double precision, -19.98) $$,
  '22P02', null,
  'place_at_point: un payload de inyección es rechazado por el tipo (22P02), no ejecutado');

-- ── 17) El cuerpo no arma SQL dinámico ────────────────────────────────────
select ok(
  (select prosrc !~* '\mexecute\M' from pg_proc
    where oid = 'public.place_at_point(double precision, double precision)'::regprocedure),
  'place_at_point: el cuerpo no usa EXECUTE (sin SQL dinámico que concatenar)');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad: grants espejo de sus hermanas
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 18) anon NO puede ejecutar / authenticated SÍ ─────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.place_at_point(-39.98, -19.98) $$,
  '42501', null,
  'anon no puede ejecutar place_at_point (revoke explícito, advisor 0028)');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000000232', 'authenticated');
select lives_ok(
  $$ select * from public.place_at_point(-39.98, -19.98) $$,
  'authenticated puede ejecutar place_at_point');
reset role;

select * from finish();
rollback;

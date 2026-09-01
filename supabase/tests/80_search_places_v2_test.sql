-- Tests pgTAP — search_places v2 (tarea #159, absorbe #163)
-- Ejecutar con: supabase test db supabase/tests/80_search_places_v2_test.sql
--
-- RED (2026-09-02): hoy solo existe public.search_places(text, integer)
-- (migración 20260813000002). La migración GREEN
-- (20260902200001_search_places_v2.sql) debe dejar UNA sola función:
--
--   search_places(p_query text, p_limit integer default 10,
--                 p_lat double precision default null,
--                 p_lng double precision default null)
--
-- 🔴 POR QUÉ SE REEMPLAZA LA DE 2 ARGUMENTOS EN VEZ DE SOBRECARGARLA
-- (gate §0.5, contrato publicado): si conviven `search_places(text,int)` y
-- `search_places(text,int,float8,float8)` con defaults, la llamada de los
-- builds instalados —PostgREST resuelve la sobrecarga por NOMBRE de parámetro:
-- {p_query, p_limit}— se vuelve AMBIGUA y Postgres tira 42725. Dejar UNA sola
-- función con los dos parámetros nuevos opcionales es lo que MANTIENE vivo el
-- contrato viejo, no lo que lo rompe. Por eso el test 3 (llamada de 2 args
-- viva) es el assert de compatibilidad y el test 2 documenta el mecanismo.
--
-- Los tres arreglos que verifica este archivo:
--   (a) #163 — escapar \, % y _ antes de concatenar el comodín: hoy '%%'
--       matchea el catálogo entero en un keystroke y '_a' hace scan ancho.
--   (b) #163 — rankear/limitar ANTES de resolver context (joins a
--       mx_municipalities/mx_states) y los 4 extents ST_X/YMin/Max. Es una
--       propiedad de PLAN, no observable desde SQL: aquí se blinda su
--       contrapositiva —el resultado, el context y el bbox NO cambian— y el
--       detalle vive en el comentario de la migración.
--   (c) #159 — p_lat/p_lng opcionales: desempatan HOMÓNIMAS por cercanía.
--       Sin coordenadas el orden queda idéntico (regresión); con coordenadas
--       la distancia desempata similitudes iguales pero NO las domina.
--
-- 🔴 NOMBRES ACUÑADOS A PROPÓSITO ('Estanciatest', 'Municipiotest ...') —
-- lección #175: 'La Estancia' existe ~19 veces solo en Jalisco y ataría el
-- archivo al estado global de mx_neighborhoods (el import de #157 deja filas
-- que solo borra un db reset). Los municipios fixture usan cvegeo 149xx, que
-- INEGI no asigna (Jalisco llega a 14125), para no depender del catálogo.

begin;
select plan(22);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Municipio sintético con bbox precalculado (D4) para el assert de municipios.
insert into public.mx_municipalities (id, state_id, name,
                                      bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng)
values ('14999', '14', 'Municipiotest Uno', 20.60, -103.42, 20.74, -103.26);

-- Dos colonias HOMÓNIMAS exactas (misma similitud, mismo is_prefix: solo la
-- distancia puede desempatarlas) + una tercera de menor similitud, lejos.
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-159-estancia-zap', '14120', 'Estanciatest',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.42, 20.70, -103.40, 20.72, 4326))::extensions.geography),
  ('test-159-estancia-col', '06002', 'Estanciatest',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.73, 19.24, -103.71, 19.26, 4326))::extensions.geography),
  ('test-159-estancia-paz', '03003', 'Estanciatest Nueva',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-110.32, 24.14, -110.30, 24.16, 4326))::extensions.geography);

-- Colonia que el comodín '_' pescaría si no se escapara ('_anatest' NO la
-- alcanza por similitud: similarity = 0.135, debajo del umbral 0.3).
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-159-zanatest', '14120', 'Zanatestquixote Prolongacion Norte',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.50, 20.50, -103.49, 20.51, 4326))::extensions.geography);

-- ════════════════════════════════════════════════════════════════════════════
-- Firma y compatibilidad hacia atrás (§0.5)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) La firma v2 existe ───────────────────────────────────────────────────
select has_function('public', 'search_places',
  array['text', 'integer', 'double precision', 'double precision'],
  'search_places(text, integer, double precision, double precision) existe');

-- ── 2) La firma vieja de 2 args ya NO existe (si conviviera: 42725) ────────
select hasnt_function('public', 'search_places', array['text', 'integer'],
  'search_places(text, integer) fue reemplazada, no sobrecargada (evita la ambigüedad 42725)');

-- ── 3-4) 🔒 Contrato publicado: los builds instalados llaman igual ─────────
select lives_ok(
  $$ select * from public.search_places('estanciatest', 10) $$,
  '🔒 contrato viejo: search_places(p_query, p_limit) sigue resolviendo sin ambigüedad');
select lives_ok(
  $$ select * from public.search_places('estanciatest') $$,
  '🔒 contrato viejo: search_places(p_query) con p_limit por default sigue vivo');

-- ════════════════════════════════════════════════════════════════════════════
-- (a) #163 — escape de metacaracteres LIKE
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5) '%%%%' no puede matchear el catálogo entero ──────────────────────────
-- Conteo GLOBAL a propósito: el defecto es justamente que devuelve filas de
-- toda la tabla. pg_trgm no genera trigramas de '%%%%', así que la rama de
-- similitud tampoco aporta nada: el resultado correcto es 0.
select is((select count(*)::int from public.search_places('%%%%', 20)), 0,
  'search_places(%%%%): 0 filas — el % se escapa, no se concatena como comodín');

-- ── 6) '____' tampoco ───────────────────────────────────────────────────────
select is((select count(*)::int from public.search_places('____', 20)), 0,
  'search_places(____): 0 filas — el _ se escapa, no hace scan ancho');

-- ── 7) '_anatest' no pesca 'Zanatestquixote...' por comodín ────────────────
select is(
  (select count(*)::int from public.search_places('_anatest', 20) p
    where p.id = (select n.id::text from public.mx_neighborhoods n
                   where n.source_key = 'test-159-zanatest')),
  0,
  'search_places(_anatest): el _ inicial NO actúa como comodín de un carácter');

-- ── 8) Un backslash en la query no aborta el LIKE ──────────────────────────
select lives_ok(
  $$ select * from public.search_places('\estanciatest', 10) $$,
  'search_places: un backslash en la query se escapa y no aborta el patrón');

-- ── 9) Regresión: la rama fuzzy (trgm) sigue viva pese al escape ───────────
select ok(
  exists(select 1 from public.search_places('estanciates', 10)
          where name = 'Estanciatest'),
  'search_places(estanciates): el typo sigue matcheando por similitud (escape solo toca el LIKE)');

-- ── 10) Regresión del guard: < 2 caracteres útiles -> 0 filas ──────────────
select is((select count(*)::int from public.search_places('p')), 0,
  'search_places: 1 carácter -> 0 filas (guard intacto)');

-- ── 11-12) Regresión del clamp de p_limit ──────────────────────────────────
select is((select count(*)::int from public.search_places('estanciatest', 1)), 1,
  'search_places: p_limit=1 devuelve exactamente 1 fila (clamp intacto)');
select is((select count(*)::int from public.search_places('estanciatest', 0)), 1,
  'search_places: p_limit=0 se clampa a 1 (clamp intacto)');

-- ════════════════════════════════════════════════════════════════════════════
-- (c) #159 — ranking por cercanía con p_lat/p_lng opcionales
-- ════════════════════════════════════════════════════════════════════════════

-- ── 13) Sin coordenadas las 3 candidatas siguen apareciendo ────────────────
select is(
  (select count(*)::int from public.search_places('estanciatest', 10) p
    where p.kind = 'neighborhood'
      and p.id in (select n.id::text from public.mx_neighborhoods n
                    where n.source_key like 'test-159-estancia-%')),
  3,
  'search_places(estanciatest) sin coordenadas: las 3 candidatas siguen en el resultado');

-- ── 14) Con coordenadas en Zapopan gana la homónima de Zapopan ─────────────
-- Éste es el bug reportado por Abraham: 'La Estancia' de Zapopan existía y no
-- salía porque las homónimas de otros estados llenaban los 10 lugares.
select is(
  (select p.id from public.search_places('estanciatest', 10, 20.71, -103.41) p limit 1),
  (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-159-estancia-zap'),
  'search_places con coordenadas en Zapopan: la homónima de Zapopan va primero');

-- ── 15) Con coordenadas en Colima gana la de Colima ────────────────────────
-- El par 14/15 prueba que manda la DISTANCIA, no un orden físico afortunado.
select is(
  (select p.id from public.search_places('estanciatest', 10, 19.25, -103.72) p limit 1),
  (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-159-estancia-col'),
  'search_places con coordenadas en Colima: la homónima de Colima va primero');

-- ── 16) 🔒 La distancia DESEMPATA la similitud, no la domina ───────────────
-- El punto cae DENTRO de 'Estanciatest Nueva' (distancia 0) y aun así las dos
-- 'Estanciatest' exactas van antes: sim manda, dist solo rompe empates.
select isnt(
  (select p.id from public.search_places('estanciatest', 10, 24.15, -110.31) p limit 1),
  (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-159-estancia-paz'),
  'search_places: la distancia NO adelanta a una candidata de menor similitud');

-- ── 17) Coordenadas NULL explícitas == omitirlas ───────────────────────────
select is(
  (select count(*)::int from public.search_places('estanciatest', 10, null, null) p
    where p.kind = 'neighborhood'
      and p.id in (select n.id::text from public.mx_neighborhoods n
                    where n.source_key like 'test-159-estancia-%')),
  3,
  'search_places(p_lat=>null, p_lng=>null): idéntico a omitirlas');

-- ── 18) Coordenadas fuera de rango: se ignoran, no revientan ───────────────
select is(
  (select count(*)::int from public.search_places('estanciatest', 10, 999, -999) p
    where p.kind = 'neighborhood'
      and p.id in (select n.id::text from public.mx_neighborhoods n
                    where n.source_key like 'test-159-estancia-%')),
  3,
  'search_places con lat/lng fuera de rango: ignora el sesgo, no lanza excepción');

-- ════════════════════════════════════════════════════════════════════════════
-- (b) #163 — el shape no cambia al mover extents y joins detrás del LIMIT
-- ════════════════════════════════════════════════════════════════════════════

-- ── 19) Colonia: context 'Municipio, Abbr' y bbox del geom ─────────────────
select ok(
  (select p.context = 'Zapopan, Jal.'
      and abs(p.min_lng - (-103.42)) < 1e-6 and abs(p.max_lat - 20.72) < 1e-6
   from public.search_places('estanciatest', 10) p
    where p.id = (select n.id::text from public.mx_neighborhoods n
                   where n.source_key = 'test-159-estancia-zap')),
  'search_places: context y bbox de la colonia intactos tras mover los joins detrás del LIMIT');

-- ── 20) Municipio: context = estado y bbox precalculado ────────────────────
select ok(
  (select p.kind = 'municipality' and p.context = 'Jalisco'
      and abs(p.min_lat - 20.60) < 1e-6 and abs(p.max_lng - (-103.26)) < 1e-6
   from public.search_places('municipiotest', 10) p where p.id = '14999'),
  'search_places: context y bbox precalculado del municipio intactos');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad: grants espejo de la v1 (advisor 0028)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 21) anon NO puede ejecutar la v2 ───────────────────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.search_places('estanciatest', 10, 20.71, -103.41) $$,
  '42501', null,
  'anon no puede ejecutar search_places v2 (revoke explícito)');
reset role;

-- ── 22) authenticated SÍ puede (el mapa vive detrás del auth wall) ─────────
select pg_temp.act_as('00000000-0000-0000-0000-000000000159', 'authenticated');
select lives_ok(
  $$ select * from public.search_places('estanciatest', 10, 20.71, -103.41) $$,
  'authenticated puede ejecutar search_places v2');
reset role;

select * from finish();
rollback;

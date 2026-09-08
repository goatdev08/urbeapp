-- Tests pgTAP — search_places v3 (tarea #282.1, exploración 046 §E)
-- Ejecutar con: supabase test db supabase/tests/111_search_places_v3_test.sql
--
-- RED (2026-09-08): hoy public.search_places(text, integer, double precision,
-- double precision) es la v2 (migración 20260902200001): con coordenadas, la
-- CERCANÍA solo desempata similitudes EMPATADAS (`dist asc` va después de
-- `sim desc`). El síntoma reportado (exploración 046, "provi" desde
-- Guadalajara): la colonia obvia (Providencia, GDL) queda enterrada bajo
-- homónimas lejanas con mayor similitud porque sim manda incondicionalmente.
--
-- CONTRATO v3 (a implementar en GREEN, migración 20260908300001):
--   - Con coordenadas: el ORDEN pasa a ser
--       bucket asc nulls last, is_prefix desc, sim desc,
--       (kind='municipality') desc, name asc
--     donde bucket = floor(dist / 0.05) (0.05° ≈ 5 km, dist = ST_Distance
--     contra el envelope, igual que hoy). La cercanía ahora DOMINA por
--     tramos de 5 km; dentro del mismo tramo, prefijo/similitud siguen
--     mandando igual que en la v2.
--   - Sin coordenadas: dist es NULL para TODAS las filas -> bucket NULL para
--     todas -> el `nulls last` es un NO-OP y el orden queda IDÉNTICO al de
--     la v2 (garantía de regresión, test 3 de este archivo).
--   - Firma, RETURNS TABLE, guard <2 chars, escape de metacaracteres LIKE,
--     clamp de p_limit y grants (revoke public/anon, grant authenticated):
--     TODOS intactos — el cambio vive SOLO en el ORDER BY de `top_candidates`.
--
-- 🔴 GATE §0.5 — mismo mecanismo que la v2 (CREATE OR REPLACE + revoke/grant
-- repetibles en la MISMA transacción de la migración): reemplazo de función,
-- no cambio de contrato. Los builds instalados llaman {p_query, p_limit} o
-- {p_query, p_limit, p_lat, p_lng}; ninguno de los dos deja de resolver.
--
-- 🔴 NOMBRES ACUÑADOS ('Providtest*') verificados contra el catálogo real
-- ANTES de fijar el archivo (`select count(*) from mx_neighborhoods where
-- name_normalized like 'providtest%'` = 0; igual para mx_municipalities y
-- para el patrón '%providtest%'). mx_neighborhoods está VACÍA en local (no
-- hay import de colonias corrido), así que los 7 fixtures de colonias son
-- las ÚNICAS filas de esa tabla dentro de esta transacción.
--
-- Distancias calibradas con ST_Distance real contra el punto (20.6736,
-- -103.344) usando el MISMO mecanismo que la v2 (envelope del geom/bbox),
-- medidas por fuera de este archivo antes de fijar las coordenadas (no son
-- recomputadas por el código bajo prueba — son un hecho geométrico
-- independiente, igual que los ejemplos con datos reales de "provi" en la
-- exploración 046):
--   Providtest            (base, GDL)         dist 0.0409  bucket 0  sim 1.000000
--   Providtest Sur        (GDL, más cerca)    dist 0.0355  bucket 0  sim 0.733333
--   Providtest Segunda S. (GDL)               dist 0.0385  bucket 0  sim 0.440000
--   La Providtest         (Tonalá, NO prefijo) dist 0.1130  bucket 2  sim 0.785714
--   Providtest Empate     (municipio)          dist 0.2095  bucket 4  sim 0.611111
--   Providtest Empate     (colonia)             dist 0.2095  bucket 4  sim 0.611111
--   Providtest            (homónima lejana)     dist 0.4686  bucket 9  sim 1.000000
--   Providtesta           (nombre corto, muy lejos) dist 1.0545 bucket 21 sim 0.769231
--
-- El par "Providtest Empate" (colonia + municipio, MISMO nombre, MISMO
-- bucket) es el fixture del desempate de kind: sim y prefijo empatados ->
-- gana el municipio (`kind='municipality' desc`), luego iría name asc si
-- hiciera falta.
--
-- 🔴 ESCAPE (a)/#163: NO se reutiliza el patrón "provid\_" tal cual porque
-- CUALQUIER variante de 'providtest' con un solo carácter alterado sigue por
-- encima del umbral de similitud (0.3) de pg_trgm — el bug de comodín
-- quedaría enmascarado por la rama difusa. Se reusa el fixture YA validado
-- del test 80 (caso 7): '_anatest' vs 'Zanatestquixote Prolongacion Norte'
-- (similarity 0.135, bien debajo del umbral, y ninguna 'Providtest*' se
-- acerca tampoco — verificado antes de escribir este archivo).
--
-- 🔴 CLAMP SUPERIOR (p_limit=100 -> ≤20): con solo 8 fixtures 'providtest'
-- la aserción sería vacua (8 ≤ 20 sin que el clamp haga nada). Se usa el
-- prefijo 'san' contra mx_municipalities (catálogo OFICIAL INEGI, estable,
-- 610 filas reales que empiezan así — a diferencia de mx_neighborhoods, que
-- SÍ se vacía con cada import/reset local, lección #175) para una aserción
-- que de verdad ejercita el `least(..., 20)`.

begin;
select plan(19);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.mx_municipalities (id, state_id, name,
                                      bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng)
values ('14997', '14', 'Providtest Empate', 20.8831, -103.3445, 20.8841, -103.3435);

insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('t282-base',   '14120', 'Providtest',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 20.7145, -103.3435, 20.7155, 4326))::extensions.geography),
  ('t282-sur',    '14120', 'Providtest Sur',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 20.7091, -103.3435, 20.7101, 4326))::extensions.geography),
  ('t282-2sec',   '14120', 'Providtest Segunda Seccion',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 20.7121, -103.3435, 20.7131, 4326))::extensions.geography),
  ('t282-laprov', '14120', 'La Providtest',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 20.7866, -103.3435, 20.7876, 4326))::extensions.geography),
  ('t282-far',    '06002', 'Providtest',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 21.1422, -103.3435, 21.1432, 4326))::extensions.geography),
  ('t282-vfar',   '03003', 'Providtesta',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 21.7281, -103.3435, 21.7291, 4326))::extensions.geography),
  ('t282-empate', '14120', 'Providtest Empate',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.3445, 20.8831, -103.3435, 20.8841, 4326))::extensions.geography),
  ('t282-esc',    '14120', 'Zanatestquixote Prolongacion Norte',
    extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.50, 20.50, -103.49, 20.51, 4326))::extensions.geography);

-- ════════════════════════════════════════════════════════════════════════════
-- Firma y compatibilidad hacia atrás (§0.5) — deben seguir intactas
-- ════════════════════════════════════════════════════════════════════════════

-- Hallazgo del guardian (282.1): NADA fijaba dónde caen las candidatas con
-- dist NULL (municipios sin bbox — en el catálogo real son TODOS los que no
-- tienen colonias cargadas). Con `nulls first` una colonia a 2 km desaparecía
-- del top expulsada por municipios lejanos sin bbox: el síntoma que #282
-- corrige. Fixture propia (query 'sinbboxtest') para no tocar las listas
-- exactas de 'providtest'.
insert into public.mx_municipalities (id, state_id, name)
values ('14996', '14', 'Sinbboxtest');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('t282-sinbbox-col', '14120', 'Sinbboxtest Colonia',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.36, 20.68, -103.35, 20.69, 4326))::extensions.geography);

-- ── 1) La firma de 4 args sigue siendo la única ────────────────────────────
select has_function('public', 'search_places',
  array['text', 'integer', 'double precision', 'double precision'],
  'search_places(text, integer, double precision, double precision) existe (v3 no cambia la firma)');

-- ── 2) La firma de 2 args sigue sin existir (evita 42725) ──────────────────
select hasnt_function('public', 'search_places', array['text', 'integer'],
  'search_places(text, integer) sigue sin existir tras la v3');

-- ── 3-4) 🔒 Contrato publicado: los builds instalados llaman igual ─────────
select lives_ok(
  $$ select * from public.search_places('providtest', 10) $$,
  '🔒 contrato viejo: search_places(p_query, p_limit) sigue resolviendo sin ambigüedad en v3');
select lives_ok(
  $$ select * from public.search_places('providtest') $$,
  '🔒 contrato viejo: search_places(p_query) con p_limit por default sigue vivo en v3');

-- ════════════════════════════════════════════════════════════════════════════
-- Sin coordenadas: el orden debe ser IDÉNTICO al de la v2 (§0.5.2)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5) Lista exacta sin coords: is_prefix desc, sim desc, kind desc, name asc
select results_eq(
  $$ select p.kind, p.name from public.search_places('providtest', 20) p $$,
  $$ values
      ('neighborhood'::text, 'Providtest'::text),
      ('neighborhood'::text, 'Providtest'::text),
      ('neighborhood'::text, 'Providtesta'::text),
      ('neighborhood'::text, 'Providtest Sur'::text),
      ('municipality'::text, 'Providtest Empate'::text),
      ('neighborhood'::text, 'Providtest Empate'::text),
      ('neighborhood'::text, 'Providtest Segunda Seccion'::text),
      ('neighborhood'::text, 'La Providtest'::text)
  $$,
  'sin coordenadas: orden idéntico a la v2 — La Providtest (sim 0.785714, la 2ª más alta) queda AL FINAL por no ser prefijo');

-- ════════════════════════════════════════════════════════════════════════════
-- Con coordenadas GDL (20.6736, -103.344): la cercanía por bucket manda
-- ════════════════════════════════════════════════════════════════════════════

-- ── 6) (a) primera fila = Providtest base (bucket 0, sim 1.0) ──────────────
select is(
  (select p.kind || ':' || p.name
     from public.search_places('providtest', 20, 20.6736, -103.344) p
    limit 1),
  'neighborhood:Providtest',
  'con coords GDL: primera fila = Providtest (base, bucket 0)');

-- ── 7) (b) Sur y Segunda Sección van INMEDIATAMENTE después (mismo bucket) ─
select is(
  (select array_agg(x.label) from (
     select p.kind || ':' || p.name as label
       from public.search_places('providtest', 20, 20.6736, -103.344) p
      offset 1 limit 2
   ) x),
  array['neighborhood:Providtest Sur', 'neighborhood:Providtest Segunda Seccion'],
  'con coords GDL: Providtest Sur y Segunda Sección justo después de la base (mismo bucket 0, sim desc)');

-- ── 8) (c) La Providtest (bucket 2, sin prefijo) antes que la homónima
--      lejana (bucket 9, CON prefijo, misma sim que la base) ───────────────
select ok(
  (with ranked as (
     select p.id, p.kind, p.name, row_number() over () as rn
       from public.search_places('providtest', 20, 20.6736, -103.344) p
   )
   select (select rn from ranked where name = 'La Providtest')
        < (select rn from ranked where kind = 'neighborhood' and name = 'Providtest'
            and id = (select n.id::text from public.mx_neighborhoods n where n.source_key = 't282-far'))),
  'con coords GDL: La Providtest (bucket 2) queda ANTES que Providtest lejana (bucket 9), pese a tener menor is_prefix y menor sim');

-- ── 9) (d)/(e) última fila = Providtesta — mutante «sim antes que bucket»
--      pondría aquí a La Providtest (is_prefix=false) en su lugar ─────────
select is(
  (select p.kind || ':' || p.name
     from public.search_places('providtest', 20, 20.6736, -103.344) p
    offset 7 limit 1),
  'neighborhood:Providtesta',
  'con coords GDL: Providtesta (sim 0.769231, la 3ª más alta) queda AL FINAL por estar en el bucket más lejano (21)');

-- ── 10) Coordenadas fuera de rango se ignoran: mismo orden que sin coords ──
select results_eq(
  $$ select p.kind, p.name from public.search_places('providtest', 20, 999, -999) p $$,
  $$ values
      ('neighborhood'::text, 'Providtest'::text),
      ('neighborhood'::text, 'Providtest'::text),
      ('neighborhood'::text, 'Providtesta'::text),
      ('neighborhood'::text, 'Providtest Sur'::text),
      ('municipality'::text, 'Providtest Empate'::text),
      ('neighborhood'::text, 'Providtest Empate'::text),
      ('neighborhood'::text, 'Providtest Segunda Seccion'::text),
      ('neighborhood'::text, 'La Providtest'::text)
  $$,
  'lat/lng fuera de rango (999): se ignora el sesgo, mismo orden que sin coordenadas');

-- ════════════════════════════════════════════════════════════════════════════
-- Guard, clamp y escape — regresión sobre lo que la v3 NO debe tocar
-- ════════════════════════════════════════════════════════════════════════════

-- ── 11) Guard: <2 caracteres útiles -> 0 filas ─────────────────────────────
select is((select count(*)::int from public.search_places('p')), 0,
  'search_places: 1 carácter útil -> 0 filas (guard intacto en v3)');

-- ── 12-13) Clamp inferior intacto ───────────────────────────────────────────
select is((select count(*)::int from public.search_places('providtest', 0)), 1,
  'search_places: p_limit=0 se clampa a 1 (clamp inferior intacto en v3)');
select is((select count(*)::int from public.search_places('providtest', 1)), 1,
  'search_places: p_limit=1 devuelve exactamente 1 fila');

-- ── 14) Clamp superior: p_limit=100 se clampa a 20 (catálogo real 'san') ───
select is((select count(*)::int from public.search_places('san', 100)), 20,
  'search_places(san, 100): se clampa a 20 filas (610 municipios reales con ese prefijo)');

-- ── 15) Escape de metacaracteres: el _ inicial no actúa como comodín ───────
select is((select count(*)::int from public.search_places('_anatest', 20)), 0,
  'search_places(_anatest): el _ inicial no actúa como comodín (escape intacto en v3)');

-- ════════════════════════════════════════════════════════════════════════════
-- Seguridad: grants espejo de la v2 (advisor 0028)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 16) anon NO puede ejecutar ──────────────────────────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.search_places('providtest', 10, 20.6736, -103.344) $$,
  '42501', null,
  'anon no puede ejecutar search_places v3 (revoke explícito)');
reset role;

-- ── 17) authenticated SÍ puede ──────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000000282', 'authenticated');
select lives_ok(
  $$ select * from public.search_places('providtest', 10, 20.6736, -103.344) $$,
  'authenticated puede ejecutar search_places v3');
reset role;

-- ── 18-19) 🔒 dist NULL (municipio sin bbox) va AL FINAL con coords ──────────
-- Sin coords el municipio gana (sim 1.0, kind desc); con coords la colonia
-- cercana (bucket 0) lo adelanta y el NULL cae al final (nulls last). Un
-- mutante `nulls first` invierte el 19 sin tocar el 18.
select is(
  (select p.kind || ':' || p.name from public.search_places('sinbboxtest', 5) p limit 1),
  'municipality:Sinbboxtest',
  'sin coords: el municipio sin bbox gana por similitud exacta (orden v2 intacto)');
select is(
  (select array_agg(p.kind || ':' || p.name order by p.rn)
     from (select kind, name, row_number() over () as rn
             from public.search_places('sinbboxtest', 5, 20.6736, -103.344)) p),
  array['neighborhood:Sinbboxtest Colonia', 'municipality:Sinbboxtest'],
  'con coords: la colonia cercana (bucket 0) adelanta al municipio sin bbox (dist NULL → nulls last)');

select * from finish();
rollback;

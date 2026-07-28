-- Tests pgTAP — Catálogo oficial MX (estados + municipios), tarea 72.1
-- Ejecutar con: supabase test db
--
-- RED (2026-07-27): public.mx_states y public.mx_municipalities AÚN NO EXISTEN. La migración
-- GREEN (fuera de esta subtarea de tests) debe crear:
--   public.mx_states (id text PK check '^[0-9]{2}$' = cve_agee INEGI, name text, abbr text)
--   public.mx_municipalities (id text PK check '^[0-9]{5}$' = cvegeo INEGI, state_id text FK
--     -> mx_states(id) on delete restrict, name text,
--     constraint mx_muni_cvegeo_coherente check (left(id,2) = state_id))
--   + índice (state_id, name) + RLS habilitada + policy select a anon,authenticated using (true)
--     (patrón de public.terms_versions, 20260604000008_rls_helpers_and_policies.sql
--     líneas ~159-165 y grant línea ~399)
--   + seed con el catálogo INEGI completo: 32 estados, 2478 municipios.
--
-- 📌 Dos correcciones que salieron al implementar el GREEN, anotadas aquí para que el
--    próximo lector no repita el error de esta cabecera:
--    1) El helper de admin es `private.is_admin()`, NO `public.is_admin()`: la migración
--       0010 movió los helpers de RLS al schema `private` (0010:22) y dropeó los de
--       `public` (0010:394). 0008 todavía muestra el nombre viejo; copiarlo de ahí
--       revienta la migración con 42883.
--    2) La migración final NO lleva policy de escritura. A `authenticated` nunca se le
--       otorga INSERT/UPDATE/DELETE sobre el catálogo, así que una policy de admin sería
--       letra muerta (nunca se evaluaría). RLS habilitada + cero policies de escritura =
--       denegado por defecto. Por eso los asserts 38-40 verifican el comportamiento
--       observable (anon no escribe), que es lo que de verdad protege aquí: el GRANT.
--
-- ⚠️ Estructura del archivo / por qué una vez que el catálogo no existe TODO lo demás cae:
-- La sección 1 usa SOLO funciones catalográficas de pgTAP (has_table/has_column/col_type_is/
-- col_is_pk/is_indexed) y una consulta propia con JOIN+COALESCE contra pg_class — estas NUNCA
-- lanzan excepción aunque la tabla no exista, así que reportan "not ok" limpio, uno por uno.
-- A partir de la sección 2 se hacen consultas RAW contra las tablas (conteos, lookups,
-- inserts). Si la tabla no existe, Postgres aborta la transacción completa en el primer RAW
-- query ("relation ... does not exist") y todo lo que sigue en este archivo se reporta como
-- fallo en cascada hasta el rollback final. Es el MISMO patrón ya usado en este repo para RED
-- de tablas inexistentes (ver 12_stream_schema_test.sql, sección de public.app_config).
--
-- Datos de referencia (verificados contra gaia.inegi.org.mx/wscatgeo, 2026-07-27):
--   32 estados · 2478 municipios · Jalisco(14)=125 · Oaxaca(20)=570 · CDMX(09)=16 · BC(02)=7
--   '14039' = Guadalajara (estado '14') · '09' = 'Ciudad de México'
--
-- Patrón de impersonación: igual que 02_rls_test.sql / 12_stream_schema_test.sql
-- (pg_temp.act_as(uid, role) + set local role + request.jwt.claims).

begin;
select plan(42);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Existencia de tablas, columnas, tipos, PK, índice y RLS habilitada
--    (metadata pgTAP: no aborta la transacción si el objeto no existe)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1-2) Las tablas existen ────────────────────────────────────────────────
select has_table('public', 'mx_states', 'tabla public.mx_states existe');
select has_table('public', 'mx_municipalities', 'tabla public.mx_municipalities existe');

-- ── 3-8) Las columnas existen ──────────────────────────────────────────────
select has_column('public', 'mx_states', 'id', 'mx_states.id existe');
select has_column('public', 'mx_states', 'name', 'mx_states.name existe');
select has_column('public', 'mx_states', 'abbr', 'mx_states.abbr existe');
select has_column('public', 'mx_municipalities', 'id', 'mx_municipalities.id existe');
select has_column('public', 'mx_municipalities', 'state_id', 'mx_municipalities.state_id existe');
select has_column('public', 'mx_municipalities', 'name', 'mx_municipalities.name existe');

-- ── 9-14) Tipos de columna: todas text (claves INEGI con ceros a la izquierda) ─
select col_type_is('public', 'mx_states', 'id', 'text', 'mx_states.id es text (preserva ceros a la izquierda, p.ej. 01)');
select col_type_is('public', 'mx_states', 'name', 'text', 'mx_states.name es text');
select col_type_is('public', 'mx_states', 'abbr', 'text', 'mx_states.abbr es text');
select col_type_is('public', 'mx_municipalities', 'id', 'text', 'mx_municipalities.id es text (cvegeo INEGI)');
select col_type_is('public', 'mx_municipalities', 'state_id', 'text', 'mx_municipalities.state_id es text');
select col_type_is('public', 'mx_municipalities', 'name', 'text', 'mx_municipalities.name es text');

-- ── 15-16) Primary key en id ────────────────────────────────────────────────
select col_is_pk('public', 'mx_states', 'id', 'mx_states.id es primary key');
select col_is_pk('public', 'mx_municipalities', 'id', 'mx_municipalities.id es primary key');

-- ── 17) Índice de soporte (state_id, name) para filtros de feed/mapa/búsqueda ─
select is_indexed('public', 'mx_municipalities', array['state_id', 'name'],
  'existe índice sobre mx_municipalities (state_id, name)');

-- ── 18-19) RLS habilitada en ambas tablas ──────────────────────────────────
-- Consulta propia (no pgTAP) vía JOIN+COALESCE — a propósito NO se hace ::regclass porque
-- ese cast lanza excepción si la tabla no existe (rompería el patrón "RED limpio" de esta
-- sección); el JOIN simplemente no encuentra filas y coalesce cae a false.
select ok(
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'mx_states'), false),
  'RLS habilitada en public.mx_states'
);
select ok(
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'mx_municipalities'), false),
  'RLS habilitada en public.mx_municipalities'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Conteos exactos y datos puntuales del seed INEGI
--    (consultas RAW: a partir de aquí, si las tablas no existen, la transacción
--    aborta y el resto del archivo cae en cascada — ver nota del encabezado)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 20) 32 estados exactos ─────────────────────────────────────────────────
select is((select count(*)::int from public.mx_states), 32, 'mx_states tiene exactamente 32 estados');

-- ── 21) 2478 municipios en total (NO 2469: INEGI incluye municipios recientes) ─
select is((select count(*)::int from public.mx_municipalities), 2478, 'mx_municipalities tiene exactamente 2478 municipios');

-- ── 22-25) Conteos por estado (fuente independiente: INEGI, verificados hoy) ──
select is((select count(*)::int from public.mx_municipalities where state_id = '14'), 125, 'Jalisco (14) tiene 125 municipios');
select is((select count(*)::int from public.mx_municipalities where state_id = '20'), 570, 'Oaxaca (20) tiene 570 municipios (el máximo del país)');
select is((select count(*)::int from public.mx_municipalities where state_id = '09'), 16, 'CDMX (09) tiene 16 demarcaciones');
select is((select count(*)::int from public.mx_municipalities where state_id = '02'), 7, 'Baja California (02) tiene 7 municipios');

-- ── 26-27) Datos puntuales del seed ────────────────────────────────────────
select is((select name from public.mx_municipalities where id = '14039'), 'Guadalajara', '14039 = Guadalajara');
select is((select name from public.mx_states where id = '09'), 'Ciudad de México', '09 = Ciudad de México');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Integridad referencial y coherencia del cvegeo
-- ════════════════════════════════════════════════════════════════════════════

-- ── 28) FK: state_id inexistente ('00' no es una clave INEGI válida) es rechazado ─
select throws_ok(
  $$ insert into public.mx_municipalities (id, state_id, name) values ('00001', '00', 'Municipio fantasma') $$,
  '23503', null,
  'mx_municipalities: state_id inexistente (00) es rechazado por la FK'
);

-- ── 29) Invariante cvegeo: left(id,2) debe coincidir con state_id, aunque el
--        estado referenciado SÍ exista (atrapa un seed mal generado) ───────────
-- id '14001' empieza con '14' (Jalisco) pero se referencia state_id '09' (CDMX, sí existe):
-- la FK pasaría, pero el CHECK de coherencia debe rechazarlo.
select throws_ok(
  $$ insert into public.mx_municipalities (id, state_id, name) values ('14001', '09', 'Municipio incoherente') $$,
  '23514', null,
  'mx_municipalities: left(id,2) <> state_id (14001 con state_id 09) es rechazado pese a que el estado 09 existe'
);

-- ── 30) Boundary: municipio coherente (prefijo = state_id) y con FK válida se acepta ─
select lives_ok(
  $$ insert into public.mx_municipalities (id, state_id, name) values ('14999', '14', 'Municipio ficticio de prueba') $$,
  'mx_municipalities: id 14999 con state_id 14 (coherente y FK válida) se acepta'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Checks de formato de clave (regex INEGI)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 31-32) mx_states.id mal formado es rechazado ───────────────────────────
select throws_ok(
  $$ insert into public.mx_states (id, name, abbr) values ('1', 'Estado corto', 'Cor.') $$,
  '23514', null,
  'mx_states: id de 1 dígito (1) es rechazado por el CHECK de formato'
);
select throws_ok(
  $$ insert into public.mx_states (id, name, abbr) values ('ab', 'Estado no numérico', 'No.') $$,
  '23514', null,
  'mx_states: id no numérico (ab) es rechazado por el CHECK de formato'
);

-- ── 33) Boundary: mx_states.id bien formado (2 dígitos, aunque no sea un
--        estado real de INEGI) se acepta — el CHECK solo valida forma ────────
select lives_ok(
  $$ insert into public.mx_states (id, name, abbr) values ('90', 'Estado ficticio de prueba', 'Fic.') $$,
  'mx_states: id de 2 dígitos (90) respeta el formato y se acepta'
);

-- ── 34-35) mx_municipalities.id mal formado es rechazado ───────────────────
select throws_ok(
  $$ insert into public.mx_municipalities (id, state_id, name) values ('140391', '14', 'Municipio largo') $$,
  '23514', null,
  'mx_municipalities: id de 6 dígitos (140391) es rechazado por el CHECK de formato'
);
select throws_ok(
  $$ insert into public.mx_municipalities (id, state_id, name) values ('ab123', '14', 'Municipio no numérico') $$,
  '23514', null,
  'mx_municipalities: id no numérico (ab123) es rechazado por el CHECK de formato'
);

-- ── Limpieza de los fixtures de frontera (asserts 30 y 33) ─────────────────
-- Los dos `lives_ok` de arriba insertan a propósito filas ficticias que SÍ respetan
-- el formato ('90' y '14999'). Si no se borran aquí, inflan los conteos de los
-- asserts 36-37 (33 estados / 2479 municipios) y el rojo parecería un seed mal
-- generado cuando en realidad lo ensució el propio test. El municipio va primero:
-- la FK es `on delete restrict` y '14999' cuelga de '14', no de '90', pero el orden
-- explícito documenta la dependencia.
delete from public.mx_municipalities where id = '14999';
delete from public.mx_states         where id = '90';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) RLS observable vía impersonación: anon lee, anon NO escribe
--    (crítico: el registro escoge estado/ciudad ANTES de autenticarse)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 36-37) anon PUEDE leer ambos catálogos completos ───────────────────────
select pg_temp.act_as(null, 'anon');
select is((select count(*)::int from public.mx_states), 32, 'anon lee los 32 estados (necesario para el formulario de registro)');
select is((select count(*)::int from public.mx_municipalities), 2478, 'anon lee los 2478 municipios (necesario para el formulario de registro)');
reset role;

-- ── 38-40) anon NO PUEDE escribir (ni INSERT, ni UPDATE, ni DELETE) ────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ insert into public.mx_states (id, name, abbr) values ('91', 'Intento anon', 'An.') $$,
  '42501', null,
  'anon no puede INSERT en mx_states'
);
select throws_ok(
  $$ update public.mx_states set name = 'hackeado' where id = '09' $$,
  '42501', null,
  'anon no puede UPDATE mx_states'
);
select throws_ok(
  $$ delete from public.mx_states where id = '09' $$,
  '42501', null,
  'anon no puede DELETE en mx_states'
);
reset role;

-- ── 41-42) anon NO PUEDE hacer TRUNCATE ────────────────────────────────────
-- El agujero que ninguna RLS tapa: TRUNCATE NO pasa por row level security, y Supabase
-- lo regala de fábrica — `pg_default_acl` da el bit D (TRUNCATE) a anon/authenticated en
-- toda tabla nueva de `public`. Sin el `revoke truncate` de la migración, estos dos pasan
-- de rojo a verde solos: un cliente anónimo vacía el catálogo entero sin un solo grant de
-- escritura y sin violar ninguna policy. Por eso se asserta el comportamiento, no el grant.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ truncate public.mx_municipalities $$,
  '42501', null,
  'anon no puede TRUNCATE mx_municipalities (TRUNCATE no lo filtra la RLS)'
);
select throws_ok(
  $$ truncate public.mx_states cascade $$,
  '42501', null,
  'anon no puede TRUNCATE mx_states (TRUNCATE no lo filtra la RLS)'
);
reset role;

select * from finish();
rollback;

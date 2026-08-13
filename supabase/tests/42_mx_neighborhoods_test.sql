-- Tests pgTAP — Catálogo de colonias con geometría (mx_neighborhoods), tarea #157.1
-- Ejecutar con: supabase test db
--
-- RED (2026-08-13): public.mx_neighborhoods AÚN NO EXISTE. La migración GREEN
-- (20260813000001_mx_neighborhoods.sql) debe crear:
--   private.normalize_search_text(text) — lower+translate del set español (sin unaccent,
--     decisión de 20260727000002: se evitó la extensión por el wrapper IMMUTABLE).
--   public.mx_neighborhoods (id bigint identity PK, source_key text unique — ancla del
--     upsert idempotente del import, municipality_id text FK -> mx_municipalities(id)
--     on delete restrict, name text, name_normalized text GENERADA con normalize_search_text,
--     postal_code text null, geom extensions.geography(MultiPolygon,4326) not null, created_at)
--   + índices: GiST(geom), GIN gin_trgm_ops(name_normalized), btree(municipality_id)
--   + en mx_municipalities: name_normalized GENERADA + GIN trgm + bbox_min/max_lat/lng
--     (double precision NULL — se llenan al final del import con ST_Extent, decisión D4)
--   + RLS patrón catálogo (20260727000001): select a anon+authenticated, cero policies de
--     escritura, grants espejo, revoke truncate (el agujero que la RLS no tapa).
--
-- ⚠️ Estructura del archivo (mismo patrón que 16_mx_catalog_test.sql): la sección 1 usa solo
-- funciones catalográficas de pgTAP y consultas propias con COALESCE — en RED reportan
-- "not ok" limpio uno por uno. Desde la sección 2 hay consultas RAW: si la función o la
-- tabla no existen, la transacción aborta ahí y el resto cae en cascada hasta el rollback.
--
-- Fixture geométrico: cuadrado ST_MakeEnvelope alrededor del centro de GDL (-103.35, 20.67),
-- municipio real '14039' (Guadalajara) que el catálogo 72.1 ya siembra.

begin;
select plan(36);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Metadata: tabla, columnas, tipos, PK, unique, índices, RLS, función
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) La tabla existe ─────────────────────────────────────────────────────
select has_table('public', 'mx_neighborhoods', 'tabla public.mx_neighborhoods existe');

-- ── 2-7) Las columnas existen ──────────────────────────────────────────────
select has_column('public', 'mx_neighborhoods', 'source_key', 'mx_neighborhoods.source_key existe (ancla del upsert del import)');
select has_column('public', 'mx_neighborhoods', 'municipality_id', 'mx_neighborhoods.municipality_id existe');
select has_column('public', 'mx_neighborhoods', 'name', 'mx_neighborhoods.name existe');
select has_column('public', 'mx_neighborhoods', 'name_normalized', 'mx_neighborhoods.name_normalized existe (generada, para GIN trgm)');
select has_column('public', 'mx_neighborhoods', 'postal_code', 'mx_neighborhoods.postal_code existe');
select has_column('public', 'mx_neighborhoods', 'geom', 'mx_neighborhoods.geom existe');

-- ── 8) PK ───────────────────────────────────────────────────────────────────
select col_is_pk('public', 'mx_neighborhoods', 'id', 'mx_neighborhoods.id es primary key');

-- ── 9) geom es geography(MultiPolygon,4326) — D1: geography casa con
--       properties.location sin casts y ST_Intersects usa su GiST ────────────
-- Consulta propia con COALESCE (no ::regclass) para que en RED reporte "not ok"
-- limpio en vez de abortar la transacción.
select ok(
  coalesce((select format_type(a.atttypid, a.atttypmod) like '%geography(MultiPolygon,4326)'
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'mx_neighborhoods'
              and a.attname = 'geom'), false),
  'mx_neighborhoods.geom es geography(MultiPolygon,4326)'
);

-- ── 10) source_key es unique (ancla del ON CONFLICT del import) ────────────
select col_is_unique('public', 'mx_neighborhoods', 'source_key', 'mx_neighborhoods.source_key es unique');

-- ── 11-12) Índices por método de acceso: GiST(geom) y GIN(name_normalized) ──
-- is_indexed no distingue el access method; consulta propia contra pg_index/pg_am.
select ok(
  coalesce((select count(*) > 0
            from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
            join pg_class tc on tc.oid = i.indrelid
            join pg_namespace n on n.oid = tc.relnamespace
            join pg_am am on am.oid = ic.relam
            where n.nspname = 'public' and tc.relname = 'mx_neighborhoods'
              and am.amname = 'gist'), false),
  'mx_neighborhoods tiene un índice GiST (geom)'
);
select ok(
  coalesce((select count(*) > 0
            from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
            join pg_class tc on tc.oid = i.indrelid
            join pg_namespace n on n.oid = tc.relnamespace
            join pg_am am on am.oid = ic.relam
            join pg_attribute a on a.attrelid = tc.oid and a.attnum = any(i.indkey)
            where n.nspname = 'public' and tc.relname = 'mx_neighborhoods'
              and am.amname = 'gin' and a.attname = 'name_normalized'), false),
  'mx_neighborhoods tiene un índice GIN sobre name_normalized (trgm para el autocomplete)'
);

-- ── 13) Índice btree de soporte para joins por municipio ───────────────────
select is_indexed('public', 'mx_neighborhoods', array['municipality_id'],
  'existe índice sobre mx_neighborhoods (municipality_id)');

-- ── 14-18) Columnas nuevas de mx_municipalities (aditivas, D4) ─────────────
select has_column('public', 'mx_municipalities', 'name_normalized', 'mx_municipalities.name_normalized existe (generada)');
select has_column('public', 'mx_municipalities', 'bbox_min_lat', 'mx_municipalities.bbox_min_lat existe');
select has_column('public', 'mx_municipalities', 'bbox_min_lng', 'mx_municipalities.bbox_min_lng existe');
select has_column('public', 'mx_municipalities', 'bbox_max_lat', 'mx_municipalities.bbox_max_lat existe');
select has_column('public', 'mx_municipalities', 'bbox_max_lng', 'mx_municipalities.bbox_max_lng existe');

-- ── 19) GIN trgm sobre mx_municipalities.name_normalized ───────────────────
select ok(
  coalesce((select count(*) > 0
            from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
            join pg_class tc on tc.oid = i.indrelid
            join pg_namespace n on n.oid = tc.relnamespace
            join pg_am am on am.oid = ic.relam
            join pg_attribute a on a.attrelid = tc.oid and a.attnum = any(i.indkey)
            where n.nspname = 'public' and tc.relname = 'mx_municipalities'
              and am.amname = 'gin' and a.attname = 'name_normalized'), false),
  'mx_municipalities tiene un índice GIN sobre name_normalized (autocomplete unificado)'
);

-- ── 20) RLS habilitada ──────────────────────────────────────────────────────
select ok(
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'mx_neighborhoods'), false),
  'RLS habilitada en public.mx_neighborhoods'
);

-- ── 21) Policy de SELECT (única policy — escritura denegada por defecto) ───
select ok(
  coalesce((select count(*) = 1 from pg_policies
            where schemaname = 'public' and tablename = 'mx_neighborhoods'
              and cmd = 'SELECT'), false),
  'mx_neighborhoods tiene exactamente una policy y es de SELECT (catálogo de solo lectura)'
);

-- ── 22) La función de normalización existe en private ──────────────────────
select has_function('private', 'normalize_search_text', array['text'],
  'private.normalize_search_text(text) existe');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Comportamiento (consultas RAW — en RED la transacción aborta aquí y el
--    resto cae en cascada, ver nota del encabezado)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 23-25) Normalización: acentos del set español, ñ/ü, y NULL (strict) ────
select is(private.normalize_search_text('Álvaro Obregón'), 'alvaro obregon',
  'normalize_search_text: Álvaro Obregón -> alvaro obregon (mismo contrato que filter_zones de mobile)');
select is(private.normalize_search_text('Ñuñoa GÜERO'), 'nunoa guero',
  'normalize_search_text: ñ/Ñ -> n y ü/Ü -> u');
select is(private.normalize_search_text(null), null,
  'normalize_search_text: NULL -> NULL (strict, no revienta la columna generada)');

-- ── 26) Fixture: colonia válida en Guadalajara (14039) se acepta ───────────
select lives_ok(
  $$ insert into public.mx_neighborhoods (source_key, municipality_id, name, postal_code, geom)
     values ('test-157-alvaro', '14039', 'Colonia Prueba Álvaro', '44100',
             extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.36, 20.66, -103.34, 20.68, 4326))::extensions.geography) $$,
  'mx_neighborhoods: colonia con municipio real (14039) y MultiPolygon válido se acepta'
);

-- ── 27) La columna generada normaliza el nombre al insertar ────────────────
select is(
  (select name_normalized from public.mx_neighborhoods where source_key = 'test-157-alvaro'),
  'colonia prueba alvaro',
  'name_normalized se genera normalizado (colonia prueba alvaro)'
);

-- ── 28) El tipo geométrico almacenado es MULTIPOLYGON ──────────────────────
select is(
  (select extensions.GeometryType(geom::extensions.geometry) from public.mx_neighborhoods
   where source_key = 'test-157-alvaro'),
  'MULTIPOLYGON',
  'geom del fixture es MULTIPOLYGON (ST_Multi normaliza polígonos sueltos)'
);

-- ── 29) FK: municipio inexistente es rechazado ─────────────────────────────
select throws_ok(
  $$ insert into public.mx_neighborhoods (source_key, municipality_id, name, geom)
     values ('test-157-fk', '99999', 'Colonia huérfana',
             extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.36, 20.66, -103.34, 20.68, 4326))::extensions.geography) $$,
  '23503', null,
  'mx_neighborhoods: municipality_id inexistente (99999) es rechazado por la FK'
);

-- ── 30) geom NOT NULL ───────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.mx_neighborhoods (source_key, municipality_id, name)
     values ('test-157-singeom', '14039', 'Colonia sin geometría') $$,
  '23502', null,
  'mx_neighborhoods: geom es NOT NULL (una colonia sin polígono no sirve de nada aquí)'
);

-- ── 31) source_key duplicado es rechazado (el import hace upsert sobre él) ─
select throws_ok(
  $$ insert into public.mx_neighborhoods (source_key, municipality_id, name, geom)
     values ('test-157-alvaro', '14039', 'Duplicada',
             extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.36, 20.66, -103.34, 20.68, 4326))::extensions.geography) $$,
  '23505', null,
  'mx_neighborhoods: source_key duplicado es rechazado (unique, ancla del ON CONFLICT)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RLS observable vía impersonación (patrón 16_mx_catalog_test.sql)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── 32) anon PUEDE leer (el autocomplete corre detrás del auth wall, pero el
--        catálogo sigue el patrón de lectura pública de mx_states/municipios) ─
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from public.mx_neighborhoods where source_key = 'test-157-alvaro'),
  1,
  'anon puede leer mx_neighborhoods (catálogo público, patrón 72.1)'
);
reset role;

-- ── 33-35) anon NO PUEDE escribir ──────────────────────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ insert into public.mx_neighborhoods (source_key, municipality_id, name, geom)
     values ('test-157-anon', '14039', 'Intento anon',
             extensions.ST_Multi(extensions.ST_MakeEnvelope(-103.36, 20.66, -103.34, 20.68, 4326))::extensions.geography) $$,
  '42501', null,
  'anon no puede INSERT en mx_neighborhoods'
);
select throws_ok(
  $$ update public.mx_neighborhoods set name = 'hackeada' where source_key = 'test-157-alvaro' $$,
  '42501', null,
  'anon no puede UPDATE mx_neighborhoods'
);
select throws_ok(
  $$ delete from public.mx_neighborhoods where source_key = 'test-157-alvaro' $$,
  '42501', null,
  'anon no puede DELETE en mx_neighborhoods'
);
reset role;

-- ── 36) anon NO PUEDE TRUNCATE (la RLS no filtra TRUNCATE; ver 72.1) ───────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ truncate public.mx_neighborhoods $$,
  '42501', null,
  'anon no puede TRUNCATE mx_neighborhoods (TRUNCATE no pasa por RLS)'
);
reset role;

select * from finish();
rollback;

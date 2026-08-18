-- Tests pgTAP — public.ad_impressions + public.ad_impressions_monthly + purga a
-- 90 días vía pg_cron. Subtarea #170.5 (feed en producción viva, base
-- FACTURABLE de #172 CPM/CPC). Ejecutar con:
--   supabase test db supabase/tests/51_ad_impressions_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/46/47_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (comportamiento observable, NUNCA internals):
--   1) Shape catalográfico de ad_impressions (13 columnas) y
--      ad_impressions_monthly (9 columnas) + los 3 índices compuestos —
--      pg_catalog/pg_indexes, nunca lanzan aunque el objeto no exista.
--   2) FAIL-CLOSED por IMPERSONACIÓN REAL (pg_temp.act_as), NO por leer
--      pg_policy: anon/authenticated/service_role sobre la TABLA y sobre
--      purge_ad_impressions().
--   3) Comportamiento real de la PK como clave de idempotencia (2 INSERT
--      literales vs INSERT+UPSERT), con SQL real ejecutado, no simulado.
--   4) Comportamiento real de public.purge_ad_impressions(): filas
--      sembradas a 91/90/10 días de antigüedad + su registro en cron.job +
--      la NO alteración de ad_impressions_monthly.
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): migración
-- supabase/migrations/20260815000021_ad_impressions.sql (+ rollback) crea:
--   public.ad_impressions (id uuid pk SIN default -- lo genera el cliente,
--     ad_id uuid not null -> ads, agency_id uuid not null -> agencies
--     (denormalizado), user_id uuid not null, session_id uuid not null,
--     municipality_id text null, neighborhood_id bigint null -> mx_neighborhoods
--     (🔴 bigint, NO uuid -- ver 169.1/D2), shown_at timestamptz not null,
--     watched_ms integer not null, viewed boolean not null, completed boolean
--     not null, cta_tapped_at timestamptz null, device text null, created_at
--     timestamptz not null default now()). Índices: (agency_id, created_at
--     desc), (ad_id, created_at desc), (ad_id, municipality_id).
--   RLS ENABLED, FAIL-CLOSED ASIMÉTRICO CON DIENTES (decisión de contrato del
--   test-author, ver bitácora de la subtarea): `revoke all from anon,
--   authenticated` + `grant select on ad_impressions to authenticated` SIN
--   NINGUNA policy de SELECT (⇒ RLS filtra a 0 filas para CUALQUIER
--   authenticated, nunca error) + SIN grant de ningún tipo a anon (⇒ 42501).
--   Sin grant de INSERT/UPDATE/DELETE a authenticated (⇒ 42501); solo
--   service_role (rolbypassrls=true, verificado en el stack local) tiene
--   select/insert/update/delete.
--   public.ad_impressions_monthly (agency_id, ad_id, municipality_id,
--     neighborhood_id, year_month date, impressions/views/completions/cta_taps
--     integer not null default 0) -- rollup PERMANENTE, la purga nunca lo toca.
--   public.purge_ad_impressions() -- sin argumentos, borra de ad_impressions
--     lo que rebasa 90 días por created_at (frontera `<` estricta: exactamente
--     90 días se CONSERVA), programada vía pg_cron en cron.job con
--     jobname='purge_ad_impressions_daily', schedule='0 3 * * *',
--     command='select public.purge_ad_impressions();' (match exacto --
--     decisión de contrato del test-author, análoga a rejection_reason en
--     47_ads_schema_test.sql). Sin EXECUTE para `authenticated` (se apoya en
--     el default de plataforma ya verificado: EXECUTE se revoca de PUBLIC
--     salvo grant explícito -- confirmado con \df+ public.set_updated_at en
--     el stack local, Access privileges = solo postgres+service_role).
--
-- ── Nota sobre la técnica RED sin abortar la transacción (heredada de 06/37/
--    38/46/47_*) ────────────────────────────────────────────────────────────
-- Catálogo puro (has_table/has_column/col_type_is/col_not_null/has_function/
-- pg_constraint/pg_indexes/pg_class.relrowsecurity) NUNCA lanza aunque el
-- objeto no exista. throws_ok SÍ sobrevive un SQLSTATE inesperado (42P01
-- tabla, 42883 función) -- el esperado no matchea y reporta "not ok" limpio,
-- sin abortar el archivo. lives_ok y las consultas RAW NO sobreviven -- por
-- eso toda verificación positiva/de conteo va en un bloque `do $$ ...
-- exception when others ... $$` AUTO-PROTEGIDO que escribe su resultado en
-- una tabla temporal, nunca en lives_ok/RAW crudo. Los asserts de conteo
-- concatenan `ok::text || ':' || valor` (patrón PUR2 de 47_ads_schema_test)
-- para que un INSERT fallido en RED no produzca un "pasa por casualidad".
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author, ver bitácora
--    completa con las 6 decisiones de contrato en la subtarea 170.5) ─────────
-- Happy path (shape): 13 columnas de ad_impressions + 3 FKs + RLS enabled;
--   9 columnas de ad_impressions_monthly; purge_ad_impressions() existe.
-- Índices: los 3 compuestos EXACTOS del plan (orden importa).
-- Fail-closed por impersonación: anon SELECT->42501; authenticated (2 JWT
--   distintos) SELECT->0 filas sin error; authenticated INSERT->42501;
--   service_role INSERT+SELECT funcionan; authenticated EXECUTE sobre
--   purge_ad_impressions()->no autorizado.
-- Idempotencia: 2º INSERT mismo id->23505; INSERT+UPSERT de cta_tapped_at->
--   sigue habiendo 1 sola fila con el dato actualizado.
-- Purga (las 3 cosas + conservación del rollup): 91d borrada, 90d (frontera)
--   conservada, 10d conservada, cron.job con nombre/schedule/command
--   exactos, ad_impressions_monthly sembrada de antemano queda INTACTA.
-- Boundary/error: neighborhood_id inexistente->23503; ad_id inexistente->23503.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(76);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures compartidos — self-contained (lección #175: nunca contar sobre
--    datos de otro proceso). Estado '51' fuera del rango real 01-32 INEGI.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('51', 'Estado Ads Impressions Test 51', 'AI');
insert into public.mx_municipalities (id, state_id, name) values ('51001', '51', 'Municipio Ads Impressions Test 51');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-adsimp-51-001', '51001', 'Colonia Ads Impressions Test 51',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000510101', 'owner_adsimp51@urbea.mx'),
  ('00000000-0000-0000-0000-000000510102', 'user_a_adsimp51@urbea.mx'),
  ('00000000-0000-0000-0000-000000510103', 'user_b_adsimp51@urbea.mx');

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000510201', 'Inmobiliaria Ads Impressions 51', 'inmo-adsimp-51', 'active',
   '00000000-0000-0000-0000-000000510101');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510101', 'owner', 'active');

-- Creative + ad reales (necesarios para las FKs ad_id/agency_id). Protegido:
-- si ads_schema (169.1) no estuviera, esto fallaría limpio y las secciones
-- posteriores leerían "no sembrado" en vez de abortar el archivo.
create temp table result_ad_fixture (ok boolean);
do $$
begin
  insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds, status) values
    ('00000000-0000-0000-0000-000000510301', '00000000-0000-0000-0000-000000510201', 'cfuid-adsimp-51-fixture', 15, 'ready');
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000510401', '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510301',
     'Anuncio Fixture Impressions 51', 'whatsapp', '+525500005101', 'active', now() - interval '1 day', now() + interval '29 days');
  insert into result_ad_fixture values (true);
exception when others then
  insert into result_ad_fixture values (false);
end $$;

-- Contexto compartido (neighborhood_id real, bigint) para reusar en varios
-- bloques DO posteriores sin repetir el lookup.
create temp table test_ctx (neighborhood_id bigint);
insert into test_ctx
  select id from public.mx_neighborhoods where source_key = 'test-adsimp-51-001';

-- ════════════════════════════════════════════════════════════════════════════
-- 1) SHAPE — public.ad_impressions (catálogo puro, nunca lanza)
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'ad_impressions', 'ST1_tabla_ad_impressions_existe');
select col_is_pk('public', 'ad_impressions', 'id', 'COL1_ad_impressions_id_es_primary_key');
select col_type_is('public', 'ad_impressions', 'id', 'uuid', 'COL2_ad_impressions_id_es_uuid_generado_por_el_cliente');

select has_column('public', 'ad_impressions', 'ad_id', 'COL3_ad_impressions_ad_id_existe');
select col_type_is('public', 'ad_impressions', 'ad_id', 'uuid', 'COL4_ad_impressions_ad_id_es_uuid');
select col_not_null('public', 'ad_impressions', 'ad_id', 'COL5_ad_impressions_ad_id_es_not_null');

select has_column('public', 'ad_impressions', 'agency_id', 'COL6_ad_impressions_agency_id_existe_denormalizado_para_el_reporte');
select col_type_is('public', 'ad_impressions', 'agency_id', 'uuid', 'COL7_ad_impressions_agency_id_es_uuid');
select col_not_null('public', 'ad_impressions', 'agency_id', 'COL8_ad_impressions_agency_id_es_not_null');

select has_column('public', 'ad_impressions', 'user_id', 'COL9_ad_impressions_user_id_existe');
select col_type_is('public', 'ad_impressions', 'user_id', 'uuid', 'COL10_ad_impressions_user_id_es_uuid');

select has_column('public', 'ad_impressions', 'session_id', 'COL11_ad_impressions_session_id_existe');
select col_type_is('public', 'ad_impressions', 'session_id', 'uuid', 'COL12_ad_impressions_session_id_es_uuid');

select has_column('public', 'ad_impressions', 'municipality_id', 'COL13_ad_impressions_municipality_id_existe');
select col_type_is('public', 'ad_impressions', 'municipality_id', 'text', 'COL14_ad_impressions_municipality_id_es_text');

select has_column('public', 'ad_impressions', 'neighborhood_id', 'COL15_ad_impressions_neighborhood_id_existe');
select col_type_is('public', 'ad_impressions', 'neighborhood_id', 'bigint', 'COL16_ad_impressions_neighborhood_id_es_bigint_NO_uuid_ver_1691_D2');

select has_column('public', 'ad_impressions', 'shown_at', 'COL17_ad_impressions_shown_at_existe');
select col_type_is('public', 'ad_impressions', 'shown_at', 'timestamp with time zone', 'COL18_ad_impressions_shown_at_es_timestamptz');
select col_not_null('public', 'ad_impressions', 'shown_at', 'COL19_ad_impressions_shown_at_es_not_null');

select has_column('public', 'ad_impressions', 'watched_ms', 'COL20_ad_impressions_watched_ms_existe');
select col_type_is('public', 'ad_impressions', 'watched_ms', 'integer', 'COL21_ad_impressions_watched_ms_es_integer');
select col_not_null('public', 'ad_impressions', 'watched_ms', 'COL22_ad_impressions_watched_ms_es_not_null');

select has_column('public', 'ad_impressions', 'viewed', 'COL23_ad_impressions_viewed_existe');
select col_type_is('public', 'ad_impressions', 'viewed', 'boolean', 'COL24_ad_impressions_viewed_es_boolean');
select col_not_null('public', 'ad_impressions', 'viewed', 'COL25_ad_impressions_viewed_es_not_null');

select has_column('public', 'ad_impressions', 'completed', 'COL26_ad_impressions_completed_existe');
select col_type_is('public', 'ad_impressions', 'completed', 'boolean', 'COL27_ad_impressions_completed_es_boolean');
select col_not_null('public', 'ad_impressions', 'completed', 'COL28_ad_impressions_completed_es_not_null');

select has_column('public', 'ad_impressions', 'cta_tapped_at', 'COL29_ad_impressions_cta_tapped_at_existe');
select col_type_is('public', 'ad_impressions', 'cta_tapped_at', 'timestamp with time zone', 'COL30_ad_impressions_cta_tapped_at_es_timestamptz');
select col_is_null('public', 'ad_impressions', 'cta_tapped_at', 'COL31_ad_impressions_cta_tapped_at_es_nullable_se_llena_al_tocar_el_cta');

select has_column('public', 'ad_impressions', 'device', 'COL32_ad_impressions_device_existe');
select col_type_is('public', 'ad_impressions', 'device', 'text', 'COL33_ad_impressions_device_es_text');

select has_column('public', 'ad_impressions', 'created_at', 'COL34_ad_impressions_created_at_existe');
select col_type_is('public', 'ad_impressions', 'created_at', 'timestamp with time zone', 'COL35_ad_impressions_created_at_es_timestamptz');
select col_not_null('public', 'ad_impressions', 'created_at', 'COL36_ad_impressions_created_at_es_not_null');

select is(
  coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ad_impressions'), false),
  true, 'RLS1_ad_impressions_tiene_row_level_security_enabled'
);

-- ── FKs (catálogo, nunca lanza) ─────────────────────────────────────────────
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_impressions' and c.contype = 'f' and ft.relname = 'ads'),
  1, 'FK1_ad_impressions_ad_id_tiene_foreign_key_hacia_ads'
);
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_impressions' and c.contype = 'f' and ft.relname = 'agencies'),
  1, 'FK2_ad_impressions_agency_id_tiene_foreign_key_hacia_agencies'
);
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_impressions' and c.contype = 'f' and ft.relname = 'mx_neighborhoods'),
  1, 'FK3_ad_impressions_neighborhood_id_tiene_foreign_key_hacia_mx_neighborhoods_bigint'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ÍNDICES — los 3 compuestos EXACTOS del plan (pg_indexes, catálogo puro,
--    devuelve 0 filas si la tabla no existe, nunca lanza). Orden de columnas
--    importa (contrato fijado por el test-author).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'ad_impressions'
    and indexdef ilike '%(agency_id, created_at DESC)%'),
  1, 'IDX1_indice_compuesto_agency_id_created_at_desc_existe'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'ad_impressions'
    and indexdef ilike '%(ad_id, created_at DESC)%'),
  1, 'IDX2_indice_compuesto_ad_id_created_at_desc_existe'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'ad_impressions'
    and indexdef ilike '%(ad_id, municipality_id)%'),
  1, 'IDX3_indice_compuesto_ad_id_municipality_id_existe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) SHAPE — public.ad_impressions_monthly (rollup PERMANENTE)
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'ad_impressions_monthly', 'ST2_tabla_ad_impressions_monthly_existe');

select has_column('public', 'ad_impressions_monthly', 'agency_id', 'COL37_monthly_agency_id_existe');
select col_type_is('public', 'ad_impressions_monthly', 'agency_id', 'uuid', 'COL38_monthly_agency_id_es_uuid');

select has_column('public', 'ad_impressions_monthly', 'ad_id', 'COL39_monthly_ad_id_existe');
select col_type_is('public', 'ad_impressions_monthly', 'ad_id', 'uuid', 'COL40_monthly_ad_id_es_uuid');

select has_column('public', 'ad_impressions_monthly', 'municipality_id', 'COL41_monthly_municipality_id_existe');
select has_column('public', 'ad_impressions_monthly', 'neighborhood_id', 'COL42_monthly_neighborhood_id_existe');
select col_type_is('public', 'ad_impressions_monthly', 'neighborhood_id', 'bigint', 'COL43_monthly_neighborhood_id_es_bigint');

select has_column('public', 'ad_impressions_monthly', 'year_month', 'COL44_monthly_year_month_existe');
select col_type_is('public', 'ad_impressions_monthly', 'year_month', 'date', 'COL45_monthly_year_month_es_date_primer_dia_del_mes');

select has_column('public', 'ad_impressions_monthly', 'impressions', 'COL46_monthly_impressions_existe');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) public.purge_ad_impressions() existe (catálogo puro)
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'purge_ad_impressions', 'FUNC1_purge_ad_impressions_existe_en_public');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) FAIL-CLOSED por impersonación — ancla obligatoria del plan. throws_ok
--    sobrevive 42P01 (tabla no existe en RED) sin abortar el archivo.
-- ════════════════════════════════════════════════════════════════════════════

-- anon: SIN NINGÚN grant -> permission denied (42501), no "RLS filtra a 0".
select pg_temp.act_as(null, 'anon');
select throws_ok($$ select count(*) from public.ad_impressions $$, '42501', null,
  'GRANT1_anon_no_puede_leer_ad_impressions_permission_denied');
reset role;

-- authenticated: CUALQUIER JWT -> select funciona (hay grant) pero devuelve
-- 0 filas (RLS sin ninguna policy de SELECT). Probado con 2 usuarios
-- DISTINTOS -- ninguno es "el dueño", porque no existe tal concepto aquí.
create temp table result_auth_select (label text, ok boolean, cnt int);
grant insert on result_auth_select to authenticated, anon;
do $$
declare v_cnt int;
begin
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000510102'::uuid)::text, true);
  select count(*) into v_cnt from public.ad_impressions;
  insert into result_auth_select values ('user_a', true, v_cnt);
  reset role;
exception when others then
  insert into result_auth_select values ('user_a', false, -1);
end $$;
do $$
declare v_cnt int;
begin
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000510103'::uuid)::text, true);
  select count(*) into v_cnt from public.ad_impressions;
  insert into result_auth_select values ('user_b', true, v_cnt);
  reset role;
exception when others then
  insert into result_auth_select values ('user_b', false, -1);
end $$;

select is(
  (select ok::text || ':' || cnt::text from result_auth_select where label = 'user_a'),
  'true:0', 'FAILCLOSED1_authenticated_user_a_lee_ad_impressions_sin_error_y_ve_0_filas'
);
select is(
  (select ok::text || ':' || cnt::text from result_auth_select where label = 'user_b'),
  'true:0', 'FAILCLOSED2_authenticated_user_b_CUALQUIER_JWT_tambien_ve_0_filas_sin_error'
);

-- authenticated: NO puede INSERT (sin grant) -> 42501. Razón de ser de la
-- tabla propia: events_raw_insert deja insertar filas arbitrarias hoy.
select pg_temp.act_as('00000000-0000-0000-0000-000000510102', 'authenticated');
select throws_ok(
  $$ insert into public.ad_impressions
       (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
     values
       ('00000000-0000-0000-0000-000000510901', '00000000-0000-0000-0000-000000510401',
        '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
        '00000000-0000-0000-0000-000000510910', now(), 5000, true, false) $$,
  '42501', null,
  'GRANT2_authenticated_no_puede_INSERT_directo_en_ad_impressions_fabricaria_impresiones_facturables'
);
reset role;

-- authenticated: NO puede ejecutar purge_ad_impressions(). En RED la función
-- ni existe (42883) -- throws_ok sobrevive y reporta not-ok limpio.
select pg_temp.act_as('00000000-0000-0000-0000-000000510102', 'authenticated');
select throws_ok(
  $$ select public.purge_ad_impressions() $$,
  '42501', null,
  'GRANT3_authenticated_no_puede_ejecutar_purge_ad_impressions_sin_grant_de_execute'
);
reset role;

-- service_role: SÍ puede INSERT y SÍ puede SELECT (bypassrls=true + grants
-- explícitos) -- prueba positiva de que el único rol autorizado funciona.
create temp table result_service_role_write (ok boolean, cnt int);
do $$
declare v_cnt int;
begin
  execute format('set local role %I', 'service_role');
  insert into public.ad_impressions
    (id, ad_id, agency_id, user_id, session_id, municipality_id, neighborhood_id,
     shown_at, watched_ms, viewed, completed, device)
    values
    ('00000000-0000-0000-0000-000000510801', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510920', '51001', (select neighborhood_id from test_ctx),
     now(), 12000, true, false, 'android');
  select count(*) into v_cnt from public.ad_impressions where id = '00000000-0000-0000-0000-000000510801';
  insert into result_service_role_write values (true, v_cnt);
  reset role;
exception when others then
  insert into result_service_role_write values (false, -1);
end $$;

select is(
  (select ok::text || ':' || cnt::text from result_service_role_write),
  'true:1', 'GRANT4_service_role_SI_puede_INSERT_y_SELECT_su_propia_fila_en_ad_impressions'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) IDEMPOTENCIA por id de cliente — comportamiento real, no catálogo.
-- ════════════════════════════════════════════════════════════════════════════

-- 2º INSERT con el MISMO id -> viola la PK (23505), "no duplica".
create temp table result_dup_id (attempt int, ok boolean, err_sqlstate text);
do $$
begin
  execute format('set local role %I', 'service_role');
  begin
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000510501', '00000000-0000-0000-0000-000000510401',
       '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
       '00000000-0000-0000-0000-000000510930', now(), 3000, false, false);
    insert into result_dup_id values (1, true, null);
  exception when others then
    insert into result_dup_id values (1, false, sqlstate);
  end;
  begin
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000510501', '00000000-0000-0000-0000-000000510401',
       '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510103',
       '00000000-0000-0000-0000-000000510931', now(), 9999, true, true);
    insert into result_dup_id values (2, true, null);
  exception when others then
    insert into result_dup_id values (2, false, sqlstate);
  end;
  reset role;
exception when others then
  insert into result_dup_id values (0, false, sqlstate);
end $$;

select is((select ok from result_dup_id where attempt = 1), true,
  'IDEMP1_primer_INSERT_con_un_id_de_cliente_se_inserta_sin_problema');
select is(coalesce((select err_sqlstate from result_dup_id where attempt = 2), 'NONE'), '23505',
  'IDEMP2_reenviar_el_MISMO_id_de_cliente_viola_la_PK_no_duplica');

-- INSERT inicial (cta_tapped_at NULL) + UPSERT posterior que llega DESPUÉS
-- del batch (el tap al CTA) -> sigue habiendo 1 sola fila y cta_tapped_at
-- quedó actualizado.
create temp table result_cta_upsert (ok boolean, cnt int, cta_tapped text);
do $$
declare v_tap timestamptz := now();
begin
  execute format('set local role %I', 'service_role');
  insert into public.ad_impressions
    (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed, cta_tapped_at)
    values
    ('00000000-0000-0000-0000-000000510502', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510932', now(), 28000, true, true, null);
  insert into public.ad_impressions
    (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed, cta_tapped_at)
    values
    ('00000000-0000-0000-0000-000000510502', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510932', now(), 28000, true, true, v_tap)
  on conflict (id) do update set cta_tapped_at = excluded.cta_tapped_at;
  insert into result_cta_upsert
    select true,
      (select count(*)::int from public.ad_impressions where id = '00000000-0000-0000-0000-000000510502'),
      (select (cta_tapped_at = v_tap)::text from public.ad_impressions where id = '00000000-0000-0000-0000-000000510502');
  reset role;
exception when others then
  insert into result_cta_upsert values (false, -1, 'ERR');
end $$;

select is(
  (select ok::text || ':' || cnt::text || ':' || cta_tapped from result_cta_upsert),
  'true:1:true',
  'IDEMP3_INSERT_mas_UPSERT_posterior_del_tap_al_cta_deja_1_sola_fila_con_cta_tapped_at_actualizado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Boundary/error — FKs reales (23503), no catálogo.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ insert into public.ad_impressions
       (id, ad_id, agency_id, user_id, session_id, neighborhood_id, shown_at, watched_ms, viewed, completed)
     values
       ('00000000-0000-0000-0000-000000510701', '00000000-0000-0000-0000-000000510401',
        '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
        '00000000-0000-0000-0000-000000510940', 999999999, now(), 1000, false, false) $$,
  '23503', null,
  'FK4_neighborhood_id_inexistente_en_mx_neighborhoods_es_rechazado'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ insert into public.ad_impressions
       (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
     values
       ('00000000-0000-0000-0000-000000510702', '00000000-0000-0000-0000-000000510999',
        '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
        '00000000-0000-0000-0000-000000510941', now(), 1000, false, false) $$,
  '23503', null,
  'FK5_ad_id_inexistente_en_ads_es_rechazado'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) PURGA a 90 días — las 3 cosas + conservación del rollup mensual.
--    Frontera decidida por el test-author: `<` estricta sobre created_at.
--    now()-90d se CONSERVA (dentro de la ventana prometida); now()-91d se
--    BORRA. Un bloque DO por fase para que un fallo parcial (p.ej. la tabla
--    existe pero la función no) no oculte el resto de los resultados.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_purge_seed (ok boolean);
do $$
begin
  execute format('set local role %I', 'service_role');
  insert into public.ad_impressions
    (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed, created_at) values
    ('00000000-0000-0000-0000-000000510601', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510950', now() - interval '91 days', 20000, true, true, now() - interval '91 days'),
    ('00000000-0000-0000-0000-000000510602', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510951', now() - interval '90 days', 20000, true, true, now() - interval '90 days'),
    ('00000000-0000-0000-0000-000000510603', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510952', now() - interval '10 days', 20000, true, true, now() - interval '10 days');
  insert into public.ad_impressions_monthly
    (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps)
    values
    ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401',
     '51001', (select neighborhood_id from test_ctx), date '2026-05-01', 1234, 567, 89, 12);
  reset role;
  insert into result_purge_seed values (true);
exception when others then
  insert into result_purge_seed values (false);
end $$;

create temp table result_purge_call (ok boolean);
do $$
begin
  perform public.purge_ad_impressions();
  insert into result_purge_call values (true);
exception when others then
  insert into result_purge_call values (false);
end $$;

create temp table result_purge_check (label text, val text);
do $$
begin
  insert into result_purge_check values ('row_91d_exists_after_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510601'))::text);
  insert into result_purge_check values ('row_90d_exists_after_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510602'))::text);
  insert into result_purge_check values ('row_10d_exists_after_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510603'))::text);
exception when others then
  insert into result_purge_check values ('error', 'ERR');
end $$;

create temp table result_monthly_after_purge (val text);
do $$
begin
  insert into result_monthly_after_purge
    select impressions::text || ':' || views::text || ':' || completions::text || ':' || cta_taps::text
      from public.ad_impressions_monthly
     where agency_id = '00000000-0000-0000-0000-000000510201'
       and ad_id = '00000000-0000-0000-0000-000000510401'
       and year_month = date '2026-05-01';
exception when others then
  insert into result_monthly_after_purge values ('ERR');
end $$;

create temp table result_cron_job (jobname text, schedule text, command text);
do $$
begin
  insert into result_cron_job
    select jobname, schedule, command from cron.job where jobname = 'purge_ad_impressions_daily';
exception when others then
  null; -- schema cron no existe todavía en RED -- 0 filas, no aborta el archivo.
end $$;

select is((select ok from result_purge_seed), true, 'PURGE1_sembrar_3_filas_de_ad_impressions_mas_el_rollup_no_lanza_excepcion');
select is((select ok from result_purge_call), true, 'PURGE2_llamar_a_purge_ad_impressions_no_lanza_excepcion');
select is(coalesce((select val from result_purge_check where label = 'row_91d_exists_after_purge'), 'ERR'), 'false',
  'PURGE3_una_fila_de_91_dias_de_antiguedad_es_BORRADA_por_la_purga');
select is(coalesce((select val from result_purge_check where label = 'row_90d_exists_after_purge'), 'ERR'), 'true',
  'PURGE4_una_fila_de_EXACTAMENTE_90_dias_frontera_se_CONSERVA_no_se_borra');
select is(coalesce((select val from result_purge_check where label = 'row_10d_exists_after_purge'), 'ERR'), 'true',
  'PURGE5_una_fila_de_10_dias_bien_dentro_de_la_ventana_se_CONSERVA');
select is(coalesce((select val from result_monthly_after_purge), 'ERR'), '1234:567:89:12',
  'PURGE6_ad_impressions_monthly_sembrada_de_antemano_SIGUE_INTACTA_tras_la_purga_el_crudo_caduca_el_agregado_no');
select is((select count(*)::int from result_cron_job), 1,
  'CRON1_existe_exactamente_1_fila_en_cron_job_para_purge_ad_impressions_daily');
select is(coalesce((select schedule from result_cron_job), 'NONE'), '0 3 * * *',
  'CRON2_el_schedule_del_job_es_diario_0_3_menos_diario_a_las_3am');
select is(coalesce((select command from result_cron_job), 'NONE'), 'select public.purge_ad_impressions();',
  'CRON3_el_command_del_job_es_exactamente_select_public_purge_ad_impressions');

select * from finish();
rollback;

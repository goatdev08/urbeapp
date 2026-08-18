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
select plan(90);

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
-- 🔴 fix guardian/coordinador (170.5): service_role NO es superusuario
-- (rolsuper=false, solo rolbypassrls=true) y bypassrls NO cubre grants de
-- TABLA -- una temp table creada por el rol de conexión (postgres) sigue
-- siendo ilegible/inescribible para service_role sin un GRANT explícito,
-- exactamente el mismo motivo por el que ya se otorga a authenticated/anon
-- más abajo (ver result_auth_select). Sin este grant, todo bloque `set local
-- role service_role` que toque test_ctx truena con "permission denied for
-- table test_ctx" -- silenciosamente capturado por el `exception when others`
-- y reportado como si el SUT hubiera fallado, cuando el problema era el
-- andamiaje del test.
create temp table test_ctx (neighborhood_id bigint);
grant select on test_ctx to service_role;
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
-- 3b) 🔴 FAIL-CLOSED — public.ad_impressions_monthly (fix guardián 170.5:
--    Bloqueante 2). El rollup PERMANENTE (nunca se purga, conserva
--    comportamiento por colonia para siempre) NO TENÍA ningún assert de
--    RLS/grants -- solo shape. El guardián mutó con `grant select to
--    authenticated` + una policy `using (true)` y la suite pasó incluso con
--    datos presentes. Asimetría real con ad_impressions (confirmada contra
--    la migración real 20260817000002, sección 2): aquí NO hay NINGÚN grant
--    de SELECT para authenticated (a diferencia de ad_impressions, que sí
--    tiene grant con RLS vacío) -- por eso el resultado esperado es 42501
--    (error de permiso), NUNCA "0 filas".
-- ════════════════════════════════════════════════════════════════════════════

select is(
  coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ad_impressions_monthly'), false),
  true, 'RLS2_ad_impressions_monthly_tiene_row_level_security_enabled'
);

select pg_temp.act_as(null, 'anon');
select throws_ok($$ select count(*) from public.ad_impressions_monthly $$, '42501', null,
  'GRANTM1_anon_no_puede_leer_ad_impressions_monthly_permission_denied');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000510102', 'authenticated');
select throws_ok($$ select count(*) from public.ad_impressions_monthly $$, '42501', null,
  'GRANTM2_authenticated_no_puede_leer_ad_impressions_monthly_permission_denied_NO_es_0_filas_asimetria_con_ad_impressions');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000510102', 'authenticated');
select throws_ok(
  $$ insert into public.ad_impressions_monthly
       (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions, views, completions, cta_taps)
     values
       ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401',
        '51001', null, date '2026-07-01', 1, 1, 1, 1) $$,
  '42501', null,
  'GRANTM3_authenticated_no_puede_INSERT_directo_en_ad_impressions_monthly'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3c) 🟡 LLAVE NATURAL de ad_impressions_monthly + CHECK de contadores >= 0
--    (fix guardián 170.5: Quinto). AÚN NO EXISTEN en el GREEN actual --
--    Abraham va a cerrar la unicidad (unique nulls not distinct: los ids de
--    zona son NULLABLE y un UNIQUE normal NO deduplica NULLs en Postgres,
--    dos filas "nacionales" NULL/NULL para el mismo agency_id+ad_id+
--    year_month se tratarían como distintas y fragmentarían el rollup).
--    FALLARÁN hasta que la migración cambie -- es el RED de este arreglo,
--    no un defecto del test.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'ad_impressions_monthly' and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%nulls not distinct%'
      and pg_get_constraintdef(c.oid) ilike '%agency_id%'
      and pg_get_constraintdef(c.oid) ilike '%ad_id%'
      and pg_get_constraintdef(c.oid) ilike '%municipality_id%'
      and pg_get_constraintdef(c.oid) ilike '%neighborhood_id%'
      and pg_get_constraintdef(c.oid) ilike '%year_month%'),
  1,
  'UNIQ1_ad_impressions_monthly_tiene_unique_nulls_not_distinct_sobre_agency_ad_municipio_colonia_mes'
);

-- Comportamiento real (no solo catálogo): dos filas NACIONALES (ambos ids de
-- zona NULL) para el MISMO agency_id/ad_id/year_month -- un UNIQUE normal no
-- las vería duplicadas (NULL <> NULL); NULLS NOT DISTINCT sí debe rechazar
-- la segunda. Corre como el rol de conexión (postgres, superusuario) -- no
-- hace falta impersonar ni otorgar grants nuevos para probar un constraint.
create temp table result_monthly_unique (attempt int, ok boolean, err_sqlstate text);
do $$
begin
  begin
    insert into public.ad_impressions_monthly
      (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions) values
      ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401', null, null, date '2026-06-01', 5);
    insert into result_monthly_unique values (1, true, null);
  exception when others then
    insert into result_monthly_unique values (1, false, sqlstate);
  end;
  begin
    insert into public.ad_impressions_monthly
      (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions) values
      ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401', null, null, date '2026-06-01', 7);
    insert into result_monthly_unique values (2, true, null);
  exception when others then
    insert into result_monthly_unique values (2, false, sqlstate);
  end;
exception when others then
  insert into result_monthly_unique values (0, false, sqlstate);
end $$;

select is((select ok from result_monthly_unique where attempt = 1), true,
  'UNIQ2_primera_fila_nacional_agency_ad_year_month_ambos_ids_de_zona_null_se_inserta_sin_problema');
select is(coalesce((select err_sqlstate from result_monthly_unique where attempt = 2), 'NONE'), '23505',
  'UNIQ3_segunda_fila_NACIONAL_mismo_agency_ad_year_month_AMBOS_null_viola_unique_nulls_not_distinct_no_fragmenta_el_rollup');

-- CHECK contadores >= 0, uno por columna.
select throws_ok(
  $$ insert into public.ad_impressions_monthly
       (agency_id, ad_id, municipality_id, neighborhood_id, year_month, impressions)
     values ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401', '51001', null, date '2026-08-01', -1) $$,
  '23514', null,
  'CHK1_impressions_negativo_es_rechazado_por_check_mayor_o_igual_a_0'
);
select throws_ok(
  $$ insert into public.ad_impressions_monthly
       (agency_id, ad_id, municipality_id, neighborhood_id, year_month, views)
     values ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401', '51001', null, date '2026-08-01', -1) $$,
  '23514', null,
  'CHK2_views_negativo_es_rechazado_por_check_mayor_o_igual_a_0'
);
select throws_ok(
  $$ insert into public.ad_impressions_monthly
       (agency_id, ad_id, municipality_id, neighborhood_id, year_month, completions)
     values ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401', '51001', null, date '2026-08-01', -1) $$,
  '23514', null,
  'CHK3_completions_negativo_es_rechazado_por_check_mayor_o_igual_a_0'
);
select throws_ok(
  $$ insert into public.ad_impressions_monthly
       (agency_id, ad_id, municipality_id, neighborhood_id, year_month, cta_taps)
     values ('00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510401', '51001', null, date '2026-08-01', -1) $$,
  '23514', null,
  'CHK4_cta_taps_negativo_es_rechazado_por_check_mayor_o_igual_a_0'
);

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

-- 🔴 fix guardián (170.5): Bloqueante 1. FAILCLOSED1/2 corrían ANTES de que
-- hubiera NINGUNA fila en ad_impressions -- sobre una tabla vacía, RLS
-- fail-closed y una policy fugada `using (true)` dan el MISMO resultado
-- observable (0 filas). El guardián lo demostró: metió esa policy y la
-- suite pasó 78/78; con datos reales una sonda REST filtró user_id/
-- session_id de terceros. Fix: sembrar 2 filas REALES por service_role
-- ANTES de leer -- una con user_id = el MISMO `sub` del JWT que la lee
-- después, para probar que NI SIQUIERA su propia "dueña" la ve (en esta
-- tabla no existe el concepto de dueño -- es la base facturable del
-- anunciante). Compuesto anti-vacío (mismo patrón que PURGE3/4/5):
-- 'service_role_ve:N -> authenticated_ve:M' con N hardcodeado a la fuente
-- independiente (2 filas sembradas) -- si la siembra no se materializa, N
-- no será 2 y el assert falla ruidoso, no pasa por casualidad.
create temp table result_failclosed_seed (ok boolean, cnt int);
grant insert on result_failclosed_seed to service_role;
do $$
declare v_cnt int;
begin
  execute format('set local role %I', 'service_role');
  insert into public.ad_impressions
    (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed) values
    ('00000000-0000-0000-0000-000000510110', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102', -- user_a: MISMO sub que intentará leerla abajo
     '00000000-0000-0000-0000-000000510960', now(), 4000, true, false),
    ('00000000-0000-0000-0000-000000510111', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510103', -- user_b
     '00000000-0000-0000-0000-000000510961', now(), 4500, true, false);
  select count(*) into v_cnt from public.ad_impressions;
  insert into result_failclosed_seed values (true, v_cnt);
  reset role;
exception when others then
  insert into result_failclosed_seed values (false, -1);
end $$;

-- authenticated: CUALQUIER JWT -> 0 filas, INCLUSO la propia "dueña" del
-- user_id de una fila real recién sembrada. Probado con 2 usuarios
-- DISTINTOS.
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
  'service_role_ve:' || coalesce((select cnt::text from result_failclosed_seed), 'ERR')
  || '->authenticated_ve:' || coalesce((select cnt::text from result_auth_select where label = 'user_a'), 'ERR'),
  'service_role_ve:2->authenticated_ve:0',
  'FAILCLOSED1_authenticated_user_a_es_la_MISMA_persona_duena_del_user_id_de_una_fila_real_y_AUN_ASI_ve_0_filas_no_existe_concepto_de_dueno'
);
select is(
  'service_role_ve:' || coalesce((select cnt::text from result_failclosed_seed), 'ERR')
  || '->authenticated_ve:' || coalesce((select cnt::text from result_auth_select where label = 'user_b'), 'ERR'),
  'service_role_ve:2->authenticated_ve:0',
  'FAILCLOSED2_authenticated_user_b_CUALQUIER_JWT_tambien_ve_0_filas_con_datos_reales_presentes_sin_fuga'
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
grant insert on result_service_role_write to service_role;
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
grant insert on result_dup_id to service_role;
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
grant insert on result_cta_upsert to service_role;
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
grant insert on result_purge_seed to service_role;
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
     '00000000-0000-0000-0000-000000510952', now() - interval '10 days', 20000, true, true, now() - interval '10 days'),
    -- 🔴 fix guardián (170.5), Tercero: MUTANTE F. shown_at RECIENTE (1 día,
    -- lo manda el cliente y NO es de fiar -- un cliente malicioso podría
    -- mandar cualquier fecha) pero created_at (server-side, default now())
    -- de hace 91 días. Si la purga filtrara por shown_at en vez de
    -- created_at, esta fila sería INMORTAL -- un cliente podría volver
    -- cualquier impresión imborrable con solo mandar una fecha futura,
    -- rompiendo la promesa escrita del aviso de privacidad §5.
    ('00000000-0000-0000-0000-000000510604', '00000000-0000-0000-0000-000000510401',
     '00000000-0000-0000-0000-000000510201', '00000000-0000-0000-0000-000000510102',
     '00000000-0000-0000-0000-000000510953', now() - interval '1 day', 20000, true, true, now() - interval '91 days');
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

-- 🔴 fix guardian/coordinador (170.5), 3er caso del antipatrón "assert que no
-- puede fallar": si la siembra de arriba falla (result_purge_seed.ok=false),
-- las 3 filas NUNCA existieron -- y entonces "la fila de 91d fue BORRADA"
-- (val='false' tras la purga) pasaría en VACÍO: una purga correcta y una
-- purga que no hace absolutamente nada dan el MISMO resultado observable
-- sobre una tabla vacía. La purga es justo lo que sostiene la promesa
-- escrita del aviso de privacidad §5 -- no puede depender de un assert que
-- no puede fallar. Blindaje en dos capas:
--   (a) PRECONDICIÓN DURA (PURGE0a/PURGE0b) ANTES de llamar la purga: si la
--       siembra no se materializó, estos 2 asserts fallan de forma explícita
--       y ruidosa (no silenciosa) -- capturado en result_purge_preseed,
--       leído por el rol de conexión (postgres, bypassrls) para no
--       depender de otro grant.
--   (b) Los 3 asserts de retención (PURGE3/4/5) dejan de comparar solo el
--       estado "después" -- comparan "¿existía ANTES?" concatenado con
--       "¿existe DESPUÉS?" en un solo string. Si la fila nunca existió, el
--       "antes" ya es 'false', y ningún mutante (purga no-op, purga que
--       borra todo, purga que nunca corrió) puede producir el string
--       esperado 'true->false' (borrada) o 'true->true' (conservada) sobre
--       datos que nunca estuvieron ahí. Esto es lo que hace que el mutante
--       "cuerpo vacío" mate PURGE3 y el mutante "borra todo sin filtro"
--       mate PURGE4/PURGE5 (demostrado por SAVEPOINT, ver bitácora).
create temp table result_purge_preseed (label text, val text);
do $$
begin
  insert into result_purge_preseed values ('raw_rows_seeded',
    (select count(*)::int from public.ad_impressions
      where id in ('00000000-0000-0000-0000-000000510601',
                   '00000000-0000-0000-0000-000000510602',
                   '00000000-0000-0000-0000-000000510603',
                   '00000000-0000-0000-0000-000000510604'))::text);
  insert into result_purge_preseed values ('row_91d_exists_before_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510601'))::text);
  insert into result_purge_preseed values ('row_90d_exists_before_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510602'))::text);
  insert into result_purge_preseed values ('row_10d_exists_before_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510603'))::text);
  insert into result_purge_preseed values ('row_mutantF_exists_before_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510604'))::text);
  insert into result_purge_preseed
    select 'monthly_seeded',
      impressions::text || ':' || views::text || ':' || completions::text || ':' || cta_taps::text
      from public.ad_impressions_monthly
     where agency_id = '00000000-0000-0000-0000-000000510201'
       and ad_id = '00000000-0000-0000-0000-000000510401'
       and year_month = date '2026-05-01';
exception when others then
  insert into result_purge_preseed values ('error', 'ERR');
end $$;

select is(coalesce((select val from result_purge_preseed where label = 'raw_rows_seeded'), 'ERR'), '4',
  'PURGE0a_precondicion_dura_las_4_filas_sembradas_EXISTEN_antes_de_llamar_la_purga');
select is(coalesce((select val from result_purge_preseed where label = 'monthly_seeded'), 'ERR'), '1234:567:89:12',
  'PURGE0b_precondicion_dura_el_rollup_mensual_sembrado_EXISTE_con_los_totales_esperados_antes_de_purgar');

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
  insert into result_purge_check values ('row_mutantF_exists_after_purge',
    (exists(select 1 from public.ad_impressions where id = '00000000-0000-0000-0000-000000510604'))::text);
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
-- PURGE3/4/5: compuestos "existía ANTES -> existe DESPUÉS" en un solo string
-- (blindaje anti-vacío, ver comentario arriba) -- ya NO comparan solo el
-- estado final aislado.
select is(
  coalesce((select val from result_purge_preseed where label = 'row_91d_exists_before_purge'), 'ERR')
  || '->' ||
  coalesce((select val from result_purge_check where label = 'row_91d_exists_after_purge'), 'ERR'),
  'true->false',
  'PURGE3_una_fila_de_91_dias_de_antiguedad_EXISTIA_antes_y_es_BORRADA_por_la_purga'
);
select is(
  coalesce((select val from result_purge_preseed where label = 'row_90d_exists_before_purge'), 'ERR')
  || '->' ||
  coalesce((select val from result_purge_check where label = 'row_90d_exists_after_purge'), 'ERR'),
  'true->true',
  'PURGE4_una_fila_de_EXACTAMENTE_90_dias_frontera_EXISTIA_antes_y_se_CONSERVA_no_se_borra'
);
select is(
  coalesce((select val from result_purge_preseed where label = 'row_10d_exists_before_purge'), 'ERR')
  || '->' ||
  coalesce((select val from result_purge_check where label = 'row_10d_exists_after_purge'), 'ERR'),
  'true->true',
  'PURGE5_una_fila_de_10_dias_bien_dentro_de_la_ventana_EXISTIA_antes_y_se_CONSERVA'
);
-- 🔴 fix guardián (170.5), Tercero: MUTANTE F. Prueba que la purga filtra
-- por created_at (server-side, no de fiar el cliente) y NO por shown_at
-- (cliente-controlado). Esta fila tiene shown_at RECIENTE (1 día) pero
-- created_at de 91 días -- si mutas el DELETE para filtrar por shown_at,
-- esta fila sobrevive (se vuelve INMORTAL) y este assert muere. Con la
-- migración real (filtra por created_at) se borra igual que PURGE3.
select is(
  coalesce((select val from result_purge_preseed where label = 'row_mutantF_exists_before_purge'), 'ERR')
  || '->' ||
  coalesce((select val from result_purge_check where label = 'row_mutantF_exists_after_purge'), 'ERR'),
  'true->false',
  'PURGE_MUTF_fila_con_shown_at_reciente_pero_created_at_de_91_dias_es_BORRADA_la_purga_filtra_por_created_at_NO_por_shown_at_controlado_por_el_cliente'
);
select is(coalesce((select val from result_monthly_after_purge), 'ERR'), '1234:567:89:12',
  'PURGE6_ad_impressions_monthly_sembrada_de_antemano_SIGUE_INTACTA_tras_la_purga_el_crudo_caduca_el_agregado_no');
select is((select count(*)::int from result_cron_job), 1,
  'CRON1_existe_exactamente_1_fila_en_cron_job_para_purge_ad_impressions_daily');
-- 🔴 fix guardián (170.5), Cuarto: el servidor corre en UTC y pg_cron
-- interpreta el schedule en la zona del servidor -- '0 3 * * *' son las
-- 21:00 en Ciudad de México (hora pico del feed), NO las 3am. México
-- central es UTC-6 fijo todo el año (sin horario de verano desde 2022), así
-- que 3am CDMX = 9am UTC. El literal correcto y esperado es '0 9 * * *'.
-- Este assert FALLA hasta que la migración cambie -- es el RED de este
-- arreglo, no un defecto del test (decisión pendiente de Abraham).
select is(coalesce((select schedule from result_cron_job), 'NONE'), '0 9 * * *',
  'CRON2_el_schedule_del_job_es_0_9_UTC_equivalente_a_las_3am_hora_Ciudad_de_Mexico_NO_hora_pico');
select is(coalesce((select command from result_cron_job), 'NONE'), 'select public.purge_ad_impressions();',
  'CRON3_el_command_del_job_es_exactamente_select_public_purge_ad_impressions');

select * from finish();
rollback;

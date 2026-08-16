-- Tests pgTAP — Migración base del dominio de publicidad: public.ad_creatives,
-- public.ads, public.ad_zones, public.ad_prices + 4 enums nuevos + RLS/grants.
-- Subtarea #169.1 (exploración 039, "Tarea B"). Ejecutar con:
--   supabase test db supabase/tests/47_ads_schema_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/46_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (comportamiento observable, NO internals):
--   1) Shape catalográfico de las 4 tablas + los 4 enums nuevos (has_table/
--      has_column/col_type_is/col_not_null/col_is_null/col_default_is/col_is_pk
--      + pg_constraint/pg_enum crudos) — NUNCA lanzan aunque el objeto no exista.
--   2) Comportamiento real de los CHECK (duration_seconds 6-30, XOR de zona,
--      rejection_reason<->status) ejercitado con INSERT reales.
--   3) RLS por impersonación con JWT real (pg_temp.act_as) — aislamiento entre
--      organizaciones, visibilidad pública de un ad activo/vigente, doble
--      candado status+vigencia.
--   4) Grants explícitos: anon sin acceso a ninguna de las 4 tablas;
--      authenticated solo con lo abierto a propósito (SELECT de ads/ad_prices
--      con RLS de por medio, INSERT de ad_creatives scoped a su propia
--      organización) — nunca escritura directa de ads/ad_zones/ad_prices.
--   5) ad_prices sembrada con los 3 alcances a 30 días (PRD §17.2: el precio
--      vive en la tabla, no en código) — valores literales de una fuente
--      independiente (el plan de la subtarea 169.1, no recalculados aquí).
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): migración
-- supabase/migrations/20260816000005_ads_schema.sql debe crear:
--   ENUMS: ad_creative_status (uploading|processing|ready|failed),
--     ad_status (draft|pending_review|active|paused|expired|rejected — SIN
--     'approved'), ad_cta_type (external_url|whatsapp|phone), ad_zone_scope
--     (neighborhood|municipality|national).
--   public.ad_creatives (id uuid pk, agency_id uuid not null -> agencies,
--     cloudflare_uid text unique parcial (where not null), thumbnail_url text
--     null, duration_seconds integer null check (null or entre 6 y 30),
--     status ad_creative_status not null default 'uploading', created_at,
--     updated_at).
--   public.ads (id uuid pk, agency_id uuid not null -> agencies, creative_id
--     uuid not null -> ad_creatives, title text not null, cta_type ad_cta_type
--     not null, cta_value text not null, status ad_status not null default
--     'draft', rejection_reason text null CHECK (status='rejected') =
--     (rejection_reason is not null), starts_at/ends_at timestamptz not null,
--     purchase_id uuid null (sin FK activa hasta #84, NULL toda la beta),
--     created_at, updated_at).
--   public.ad_zones (id uuid pk, ad_id uuid not null -> ads on delete cascade,
--     municipality_id text null -> mx_municipalities, neighborhood_id bigint
--     null -> mx_neighborhoods, CHECK exactamente uno de los dos no nulo;
--     0 filas para un ad = inventario NACIONAL, documentado en comment on
--     table).
--   public.ad_prices (id uuid pk, scope ad_zone_scope not null, days integer
--     not null, amount_mxn numeric not null, currency text not null, valid_from
--     timestamptz not null) sembrada con 3 filas (neighborhood/municipality/
--     national) a 30 días, montos "early partner" 1500/4000/12000 MXN.
--   RLS: las 4 tablas nacen SIN heredar el blanket grant de 0008 — revoke all +
--     grant explícito por columna/rol. ad_creatives SELECT: solo su
--     organización (agency_role_of) + admin, INSERT permitido a authenticated
--     scoped a su propia organización (patrón property_videos). ads SELECT:
--     agency_role_of(agency_id) is not null (cualquier estado) OR
--     (status='active' AND vigente) para authenticated; SIN policy de
--     INSERT/UPDATE (exclusivo de RPC/EF security definer futura). ad_zones:
--     SIN policy de INSERT/UPDATE para authenticated. ad_prices: SELECT
--     abierto a authenticated (catálogo de precios), sin escritura para
--     authenticated. anon: SIN acceso a ninguna de las 4 tablas.
--
-- ── Nota sobre la técnica RED sin abortar la transacción (heredada de 06/37/
--    38/46_*) ──────────────────────────────────────────────────────────────
-- Los checks de catálogo puro (has_table/has_column/col_type_is/col_not_null/
-- col_is_null/col_default_is/col_is_pk/has_type + consultas propias contra
-- pg_constraint/pg_enum/pg_class) NUNCA lanzan aunque el objeto no exista.
-- throws_ok SÍ sobrevive un "relation does not exist" (42P01) — el SQLSTATE
-- no matchea el esperado y reporta "not ok" limpio, sin abortar el archivo
-- (verificado empíricamente en 38_property_video_slots_test.sql, nota de
-- cabecera). lives_ok y las consultas RAW NO sobreviven un 42P01 — por eso
-- toda verificación positiva (INSERT que debe funcionar + leer el resultado)
-- va en un bloque `do $$ ... exception when others ... $$` AUTO-PROTEGIDO que
-- escribe su resultado en una tabla temporal, nunca en lives_ok/RAW crudo.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Happy path (shape):
--   · Los 4 enums existen con exactamente los valores esperados, en orden.
--   · Las 4 tablas existen con las columnas/tipos/nullability/defaults del
--     diseño acordado; RLS está ENABLED en las 4.
--   · Los 6 FKs de referencia (creatives.agency_id, ads.agency_id,
--     ads.creative_id, zones.ad_id, zones.municipality_id,
--     zones.neighborhood_id) existen en pg_constraint.
--   · ad_prices trae sembradas EXACTAMENTE 3 filas (scope/days/amount_mxn/
--     currency), valores de la fuente independiente del plan, no
--     recalculados.
-- Boundary / error (CHECKs, uno por uno):
--   · duration_seconds: 5 y 31 rechazados; 6 y 30 aceptados (fronteras
--     exactas inclusive).
--   · cloudflare_uid: UNIQUE — el segundo creative con el mismo uid viola la
--     constraint.
--   · rejection_reason NOT NULL si y solo si status='rejected' (ambas
--     direcciones: rejected+null rechazado, rejected+texto aceptado,
--     no-rejected+null aceptado, no-rejected+texto rechazado — criterio
--     decidido por el test-author per instrucción explícita del orquestador).
--   · ad_zones: ambos ids rechazado, ninguno rechazado, exactamente uno
--     aceptado (municipio solo, colonia sola).
--   · purchase_id: nullable, NULL aceptado sin necesitar tabla purchases.
-- Ramas no obvias (invariantes 🔒, RLS/grants con dientes):
--   · 🔒 Semántica que parece bug: un ad con CERO filas en ad_zones es válido
--     (inventario nacional) — no un estado inválido; documentado en comment
--     on table.
--   · anon: permission denied (fail-closed) en las 4 tablas — SIN grant, no
--     "RLS filtra a 0 filas" (ver nota de property_video_slots: aquí se
--     decide fail-closed por AUSENCIA de grant, criterio explícito del
--     orquestador "con dientes").
--   · authenticated NO puede escribir directo ads/ad_zones/ad_prices
--     (exclusivo de RPC/EF futura); SÍ puede INSERT ad_creatives scoped a su
--     propia organización (patrón property_videos), pero NO con el
--     agency_id de una organización ajena.
--   · RLS ad_creatives: un miembro de la organización A NO ve los creatives
--     de la organización B; un admin SÍ ve cualquiera.
--   · RLS ads: un miembro de A NO ve un ad DRAFT de B; CUALQUIER
--     authenticated (sin importar organización) SÍ ve un ad de B que está
--     'active' Y vigente (el feed lo necesita); un ad 'active' pero con
--     ends_at ya vencido NO se muestra a un tercero (doble candado
--     status+vigencia) aunque SÍ lo sigue viendo su propio dueño.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(147);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures compartidos — self-contained, no depende de datos preexistentes
--    (lección #175: nunca contar sobre lo que otro proceso pobló).
-- ════════════════════════════════════════════════════════════════════════════

-- Catálogo geo mínimo propio (state '47' fuera del rango real 01-32 de INEGI,
-- cero riesgo de colisión con el dataset real de #157).
insert into public.mx_states (id, name, abbr) values ('47', 'Estado Ads Test 47', 'AT');
insert into public.mx_municipalities (id, state_id, name) values ('47001', '47', 'Municipio Ads Test 47');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-ads-47-001', '47001', 'Colonia Ads Test 47',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.20, 19.20, -99.18, 19.22, 4326))::extensions.geography);

-- Dos organizaciones (A y B) + owners + un tercero authenticated ajeno a ambas
-- + un admin global.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000470101', 'owner_a_ads47@urbea.mx'),
  ('00000000-0000-0000-0000-000000470102', 'owner_b_ads47@urbea.mx'),
  ('00000000-0000-0000-0000-000000470103', 'admin_ads47@urbea.mx'),
  ('00000000-0000-0000-0000-000000470104', 'tercero_ads47@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000470103';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000470201', 'Inmobiliaria Ads A 47', 'inmo-ads-a-47', 'active',
   '00000000-0000-0000-0000-000000470101'),
  ('00000000-0000-0000-0000-000000470202', 'Inmobiliaria Ads B 47', 'inmo-ads-b-47', 'active',
   '00000000-0000-0000-0000-000000470102');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470101', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000470202', '00000000-0000-0000-0000-000000470102', 'owner', 'active');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ENUMS — catálogo puro, nunca lanza aunque el tipo no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_type('public', 'ad_creative_status', 'ENUM1_el_enum_public_ad_creative_status_existe');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typname = 'ad_creative_status'),
  array['uploading', 'processing', 'ready', 'failed']::text[],
  'ENUM2_ad_creative_status_tiene_exactamente_los_4_valores_esperados_en_orden'
);

select has_type('public', 'ad_status', 'ENUM3_el_enum_public_ad_status_existe');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typname = 'ad_status'),
  array['draft', 'pending_review', 'active', 'paused', 'expired', 'rejected']::text[],
  'ENUM4_ad_status_tiene_exactamente_los_6_valores_esperados_en_orden_SIN_approved'
);

select has_type('public', 'ad_cta_type', 'ENUM5_el_enum_public_ad_cta_type_existe');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typname = 'ad_cta_type'),
  array['external_url', 'whatsapp', 'phone']::text[],
  'ENUM6_ad_cta_type_tiene_exactamente_los_3_valores_esperados_en_orden'
);

select has_type('public', 'ad_zone_scope', 'ENUM7_el_enum_public_ad_zone_scope_existe');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
    where t.typname = 'ad_zone_scope'),
  array['neighborhood', 'municipality', 'national']::text[],
  'ENUM8_ad_zone_scope_tiene_exactamente_los_3_valores_esperados_en_orden'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) RLS ENABLED en las 4 tablas — catálogo puro (pg_class.relrowsecurity),
--    nunca lanza si la tabla no existe (JOIN sin filas -> NULL, no aborta).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ad_creatives'), false),
  true, 'RLS0_ad_creatives_tiene_row_level_security_enabled'
);
select is(
  coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ads'), false),
  true, 'RLS0_ads_tiene_row_level_security_enabled'
);
select is(
  coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ad_zones'), false),
  true, 'RLS0_ad_zones_tiene_row_level_security_enabled'
);
select is(
  coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ad_prices'), false),
  true, 'RLS0_ad_prices_tiene_row_level_security_enabled'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) SHAPE — public.ad_creatives
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'ad_creatives', 'ST1_tabla_ad_creatives_existe');
select col_is_pk('public', 'ad_creatives', 'id', 'COL1_ad_creatives_id_es_primary_key');
select col_type_is('public', 'ad_creatives', 'id', 'uuid', 'COL2_ad_creatives_id_es_uuid');

select has_column('public', 'ad_creatives', 'agency_id', 'COL3_ad_creatives_agency_id_existe');
select col_type_is('public', 'ad_creatives', 'agency_id', 'uuid', 'COL4_ad_creatives_agency_id_es_uuid');
select col_not_null('public', 'ad_creatives', 'agency_id', 'COL5_ad_creatives_agency_id_es_not_null');

select has_column('public', 'ad_creatives', 'cloudflare_uid', 'COL6_ad_creatives_cloudflare_uid_existe');
select col_type_is('public', 'ad_creatives', 'cloudflare_uid', 'text', 'COL7_ad_creatives_cloudflare_uid_es_text');

select has_column('public', 'ad_creatives', 'thumbnail_url', 'COL8_ad_creatives_thumbnail_url_existe');
select col_type_is('public', 'ad_creatives', 'thumbnail_url', 'text', 'COL9_ad_creatives_thumbnail_url_es_text');
select col_is_null('public', 'ad_creatives', 'thumbnail_url', 'COL10_ad_creatives_thumbnail_url_es_nullable_se_llena_al_terminar_el_procesamiento');

select has_column('public', 'ad_creatives', 'duration_seconds', 'COL11_ad_creatives_duration_seconds_existe');
select col_type_is('public', 'ad_creatives', 'duration_seconds', 'integer', 'COL12_ad_creatives_duration_seconds_es_integer');
select col_is_null('public', 'ad_creatives', 'duration_seconds', 'COL13_ad_creatives_duration_seconds_es_nullable_se_llena_al_terminar_el_procesamiento');

select has_column('public', 'ad_creatives', 'status', 'COL14_ad_creatives_status_existe');
select col_type_is('public', 'ad_creatives', 'status', 'ad_creative_status', 'COL15_ad_creatives_status_es_del_enum_ad_creative_status');
select col_not_null('public', 'ad_creatives', 'status', 'COL16_ad_creatives_status_es_not_null');
select col_default_is('public', 'ad_creatives', 'status', 'uploading', 'COL17_ad_creatives_status_default_uploading');

-- ── FK ad_creatives.agency_id -> agencies (catálogo, nunca lanza) ──────────
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_creatives' and c.contype = 'f' and ft.relname = 'agencies'),
  1, 'FK1_ad_creatives_agency_id_tiene_foreign_key_hacia_agencies'
);

-- ── UNIQUE cloudflare_uid (catálogo) ────────────────────────────────────────
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public' and t.relname = 'ad_creatives' and c.contype = 'u' and a.attname = 'cloudflare_uid')
  +
  (select count(*)::int from pg_index i
     join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey::int2[])
    where n.nspname = 'public' and t.relname = 'ad_creatives' and i.indisunique and not i.indisprimary
      and a.attname = 'cloudflare_uid'),
  1, 'UQ1_ad_creatives_cloudflare_uid_tiene_una_unique_constraint_o_indice_unico_total_o_parcial'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) SHAPE — public.ads
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'ads', 'ST2_tabla_ads_existe');
select col_is_pk('public', 'ads', 'id', 'COL18_ads_id_es_primary_key');
select col_type_is('public', 'ads', 'id', 'uuid', 'COL19_ads_id_es_uuid');

select has_column('public', 'ads', 'agency_id', 'COL20_ads_agency_id_existe');
select col_type_is('public', 'ads', 'agency_id', 'uuid', 'COL21_ads_agency_id_es_uuid');
select col_not_null('public', 'ads', 'agency_id', 'COL22_ads_agency_id_es_not_null');

select has_column('public', 'ads', 'creative_id', 'COL23_ads_creative_id_existe');
select col_type_is('public', 'ads', 'creative_id', 'uuid', 'COL24_ads_creative_id_es_uuid');
select col_not_null('public', 'ads', 'creative_id', 'COL25_ads_creative_id_es_not_null');

select has_column('public', 'ads', 'title', 'COL26_ads_title_existe');
select col_type_is('public', 'ads', 'title', 'text', 'COL27_ads_title_es_text');
select col_not_null('public', 'ads', 'title', 'COL28_ads_title_es_not_null');

select has_column('public', 'ads', 'cta_type', 'COL29_ads_cta_type_existe');
select col_type_is('public', 'ads', 'cta_type', 'ad_cta_type', 'COL30_ads_cta_type_es_del_enum_ad_cta_type');
select col_not_null('public', 'ads', 'cta_type', 'COL31_ads_cta_type_es_not_null');

select has_column('public', 'ads', 'cta_value', 'COL32_ads_cta_value_existe');
select col_type_is('public', 'ads', 'cta_value', 'text', 'COL33_ads_cta_value_es_text');
select col_not_null('public', 'ads', 'cta_value', 'COL34_ads_cta_value_es_not_null');

select has_column('public', 'ads', 'status', 'COL35_ads_status_existe');
select col_type_is('public', 'ads', 'status', 'ad_status', 'COL36_ads_status_es_del_enum_ad_status');
select col_not_null('public', 'ads', 'status', 'COL37_ads_status_es_not_null');
select col_default_is('public', 'ads', 'status', 'draft', 'COL38_ads_status_default_draft');

select has_column('public', 'ads', 'rejection_reason', 'COL39_ads_rejection_reason_existe');
select col_type_is('public', 'ads', 'rejection_reason', 'text', 'COL40_ads_rejection_reason_es_text');
select col_is_null('public', 'ads', 'rejection_reason', 'COL41_ads_rejection_reason_es_nullable_solo_obligatorio_si_rejected');

select has_column('public', 'ads', 'starts_at', 'COL42_ads_starts_at_existe');
select col_type_is('public', 'ads', 'starts_at', 'timestamp with time zone', 'COL43_ads_starts_at_es_timestamptz');
select col_not_null('public', 'ads', 'starts_at', 'COL44_ads_starts_at_es_not_null');

select has_column('public', 'ads', 'ends_at', 'COL45_ads_ends_at_existe');
select col_type_is('public', 'ads', 'ends_at', 'timestamp with time zone', 'COL46_ads_ends_at_es_timestamptz');
select col_not_null('public', 'ads', 'ends_at', 'COL47_ads_ends_at_es_not_null');

select has_column('public', 'ads', 'purchase_id', 'COL48_ads_purchase_id_existe');
select col_type_is('public', 'ads', 'purchase_id', 'uuid', 'COL49_ads_purchase_id_es_uuid');
select col_is_null('public', 'ads', 'purchase_id', 'COL50_ads_purchase_id_es_nullable_engancha_84_stripe_queda_null_toda_la_beta');

-- ── FKs ads.agency_id -> agencies, ads.creative_id -> ad_creatives ─────────
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ads' and c.contype = 'f' and ft.relname = 'agencies'),
  1, 'FK2_ads_agency_id_tiene_foreign_key_hacia_agencies'
);
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ads' and c.contype = 'f' and ft.relname = 'ad_creatives'),
  1, 'FK3_ads_creative_id_tiene_foreign_key_hacia_ad_creatives'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) SHAPE — public.ad_zones
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'ad_zones', 'ST3_tabla_ad_zones_existe');
select col_is_pk('public', 'ad_zones', 'id', 'COL51_ad_zones_id_es_primary_key');
select col_type_is('public', 'ad_zones', 'id', 'uuid', 'COL52_ad_zones_id_es_uuid');

select has_column('public', 'ad_zones', 'ad_id', 'COL53_ad_zones_ad_id_existe');
select col_type_is('public', 'ad_zones', 'ad_id', 'uuid', 'COL54_ad_zones_ad_id_es_uuid');
select col_not_null('public', 'ad_zones', 'ad_id', 'COL55_ad_zones_ad_id_es_not_null');

select has_column('public', 'ad_zones', 'municipality_id', 'COL56_ad_zones_municipality_id_existe');
select col_type_is('public', 'ad_zones', 'municipality_id', 'text', 'COL57_ad_zones_municipality_id_es_text_cvegeo_no_uuid');
select col_is_null('public', 'ad_zones', 'municipality_id', 'COL58_ad_zones_municipality_id_es_nullable_para_permitir_el_xor');

select has_column('public', 'ad_zones', 'neighborhood_id', 'COL59_ad_zones_neighborhood_id_existe');
select col_type_is('public', 'ad_zones', 'neighborhood_id', 'bigint', 'COL60_ad_zones_neighborhood_id_es_bigint_NO_uuid_correccion_del_analista');
select col_is_null('public', 'ad_zones', 'neighborhood_id', 'COL61_ad_zones_neighborhood_id_es_nullable_para_permitir_el_xor');

-- ── FKs ad_zones.ad_id -> ads, .municipality_id -> mx_municipalities,
--    .neighborhood_id -> mx_neighborhoods ─────────────────────────────────
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_zones' and c.contype = 'f' and ft.relname = 'ads'),
  1, 'FK4_ad_zones_ad_id_tiene_foreign_key_hacia_ads'
);
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_zones' and c.contype = 'f' and ft.relname = 'mx_municipalities'),
  1, 'FK5_ad_zones_municipality_id_tiene_foreign_key_hacia_mx_municipalities'
);
select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public' and t.relname = 'ad_zones' and c.contype = 'f' and ft.relname = 'mx_neighborhoods'),
  1, 'FK6_ad_zones_neighborhood_id_tiene_foreign_key_hacia_mx_neighborhoods'
);

-- ── 🔒 comment on table documenta la semántica "0 filas = inventario
--    nacional" (para que nadie la "arregle" en una revisión futura) ────────
-- Catálogo puro vía pg_class/pg_description (NUNCA lanza si la tabla no
-- existe, a diferencia de castear el nombre a ::regclass, que sí lanza
-- "relation does not exist" y aborta la transacción -- gotcha detectado en
-- esta misma sesión de RED).
select is(
  coalesce((
    select d.description ilike '%nacional%'
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_description d on d.objoid = c.oid and d.objsubid = 0
     where n.nspname = 'public' and c.relname = 'ad_zones'
  ), false),
  true,
  'DOC1_comment_on_table_ad_zones_documenta_que_0_filas_significa_inventario_nacional'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) SHAPE — public.ad_prices
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'ad_prices', 'ST4_tabla_ad_prices_existe');
select col_is_pk('public', 'ad_prices', 'id', 'COL62_ad_prices_id_es_primary_key');
select col_type_is('public', 'ad_prices', 'id', 'uuid', 'COL63_ad_prices_id_es_uuid');

select has_column('public', 'ad_prices', 'scope', 'COL64_ad_prices_scope_existe');
select col_type_is('public', 'ad_prices', 'scope', 'ad_zone_scope', 'COL65_ad_prices_scope_es_del_enum_ad_zone_scope');
select col_not_null('public', 'ad_prices', 'scope', 'COL66_ad_prices_scope_es_not_null');

select has_column('public', 'ad_prices', 'days', 'COL67_ad_prices_days_existe');
select col_type_is('public', 'ad_prices', 'days', 'integer', 'COL68_ad_prices_days_es_integer');
select col_not_null('public', 'ad_prices', 'days', 'COL69_ad_prices_days_es_not_null');

select has_column('public', 'ad_prices', 'amount_mxn', 'COL70_ad_prices_amount_mxn_existe');
select col_type_is('public', 'ad_prices', 'amount_mxn', 'numeric', 'COL71_ad_prices_amount_mxn_es_numeric');
select col_not_null('public', 'ad_prices', 'amount_mxn', 'COL72_ad_prices_amount_mxn_es_not_null');

select has_column('public', 'ad_prices', 'currency', 'COL73_ad_prices_currency_existe');
select col_type_is('public', 'ad_prices', 'currency', 'text', 'COL74_ad_prices_currency_es_text');
select col_not_null('public', 'ad_prices', 'currency', 'COL75_ad_prices_currency_es_not_null');

select has_column('public', 'ad_prices', 'valid_from', 'COL76_ad_prices_valid_from_existe');
select col_type_is('public', 'ad_prices', 'valid_from', 'timestamp with time zone', 'COL77_ad_prices_valid_from_es_timestamptz');
select col_not_null('public', 'ad_prices', 'valid_from', 'COL78_ad_prices_valid_from_es_not_null');

-- ════════════════════════════════════════════════════════════════════════════
-- 7) 🔒 ad_prices sembrada — PRD §17.2: el precio vive EN LA TABLA. Valores
--    literales de una fuente independiente (el plan de 169.1: D1 vigencia
--    estándar 30 días, montos "early partner"), NO recalculados aquí.
--    Consulta protegida (DO $$ ... exception when others ... $$): si la
--    tabla no existe, se reporta como "no sembrada" en vez de abortar.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_ad_prices_seed (
  ok            boolean,
  total_count   int,
  neighborhood_days int, neighborhood_amount numeric, neighborhood_currency text,
  municipality_days int, municipality_amount numeric, municipality_currency text,
  national_days     int, national_amount     numeric, national_currency     text
);

do $$
declare
  v_total int; v_n_days int; v_n_amount numeric; v_n_cur text;
  v_m_days int; v_m_amount numeric; v_m_cur text;
  v_t_days int; v_t_amount numeric; v_t_cur text;
begin
  select count(*) into v_total from public.ad_prices;
  select days, amount_mxn, currency into v_n_days, v_n_amount, v_n_cur
    from public.ad_prices where scope = 'neighborhood'::ad_zone_scope limit 1;
  select days, amount_mxn, currency into v_m_days, v_m_amount, v_m_cur
    from public.ad_prices where scope = 'municipality'::ad_zone_scope limit 1;
  select days, amount_mxn, currency into v_t_days, v_t_amount, v_t_cur
    from public.ad_prices where scope = 'national'::ad_zone_scope limit 1;
  insert into result_ad_prices_seed values (
    true, v_total,
    v_n_days, v_n_amount, v_n_cur,
    v_m_days, v_m_amount, v_m_cur,
    v_t_days, v_t_amount, v_t_cur
  );
exception when others then
  insert into result_ad_prices_seed (ok, total_count) values (false, -1);
end $$;

select is(coalesce((select total_count from result_ad_prices_seed), -1), 3,
  'PRICE1_ad_prices_tiene_exactamente_3_filas_sembradas_los_3_alcances_a_30_dias');
select is(coalesce((select neighborhood_days from result_ad_prices_seed), -1), 30,
  'PRICE2_alcance_neighborhood_tiene_30_dias_de_vigencia');
select is(coalesce((select neighborhood_amount from result_ad_prices_seed), -1::numeric), 1500::numeric,
  'PRICE3_alcance_neighborhood_amount_mxn_1500_early_partner');
select is(coalesce((select neighborhood_currency from result_ad_prices_seed), 'X'), 'MXN',
  'PRICE4_alcance_neighborhood_currency_MXN');
select is(coalesce((select municipality_days from result_ad_prices_seed), -1), 30,
  'PRICE5_alcance_municipality_tiene_30_dias_de_vigencia');
select is(coalesce((select municipality_amount from result_ad_prices_seed), -1::numeric), 4000::numeric,
  'PRICE6_alcance_municipality_amount_mxn_4000_early_partner');
select is(coalesce((select national_days from result_ad_prices_seed), -1), 30,
  'PRICE7_alcance_national_tiene_30_dias_de_vigencia');
select is(coalesce((select national_amount from result_ad_prices_seed), -1::numeric), 12000::numeric,
  'PRICE8_alcance_national_amount_mxn_12000_early_partner');

-- ════════════════════════════════════════════════════════════════════════════
-- 8) CHECK duration_seconds — fronteras exactas 6..30 inclusive (comportamiento
--    real, no solo catálogo). Casos de rechazo -> throws_ok (sobrevive 42P01
--    si la tabla aún no existe). Casos de aceptación -> DO protegido.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.ad_creatives (agency_id, cloudflare_uid, duration_seconds)
     values ('00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-dur5', 5) $$,
  '23514', null,
  'DUR1_duration_seconds_5_es_rechazado_fuera_del_rango_6_30'
);
select throws_ok(
  $$ insert into public.ad_creatives (agency_id, cloudflare_uid, duration_seconds)
     values ('00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-dur31', 31) $$,
  '23514', null,
  'DUR2_duration_seconds_31_es_rechazado_fuera_del_rango_6_30'
);

create temp table result_dur_accept (label text, ok boolean, duration int);
do $$
begin
  begin
    insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds)
      values ('00000000-0000-0000-0000-000000470302', '00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-dur6', 6);
    insert into result_dur_accept values ('dur6', true, 6);
  exception when others then
    insert into result_dur_accept values ('dur6', false, null);
  end;
  begin
    insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds)
      values ('00000000-0000-0000-0000-000000470303', '00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-dur30', 30);
    insert into result_dur_accept values ('dur30', true, 30);
  exception when others then
    insert into result_dur_accept values ('dur30', false, null);
  end;
end $$;

select is((select ok from result_dur_accept where label = 'dur6'), true,
  'DUR3_duration_seconds_6_frontera_inferior_inclusive_es_aceptado');
select is((select ok from result_dur_accept where label = 'dur30'), true,
  'DUR4_duration_seconds_30_frontera_superior_inclusive_es_aceptado');

-- ════════════════════════════════════════════════════════════════════════════
-- 9) UNIQUE cloudflare_uid — comportamiento real.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_uid_unique (attempt int, ok boolean, err_sqlstate text);
do $$
begin
  begin
    insert into public.ad_creatives (agency_id, cloudflare_uid) values
      ('00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-unique');
    insert into result_uid_unique values (1, true, null);
  exception when others then
    insert into result_uid_unique values (1, false, sqlstate);
  end;
  begin
    insert into public.ad_creatives (agency_id, cloudflare_uid) values
      ('00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-unique');
    insert into result_uid_unique values (2, true, null);
  exception when others then
    insert into result_uid_unique values (2, false, sqlstate);
  end;
end $$;

select is((select ok from result_uid_unique where attempt = 1), true,
  'UQ2_primer_creative_con_un_cloudflare_uid_se_inserta_sin_problema');
select is(coalesce((select err_sqlstate from result_uid_unique where attempt = 2), 'NONE'), '23505',
  'UQ3_segundo_creative_con_el_MISMO_cloudflare_uid_viola_la_unique_constraint');

-- ════════════════════════════════════════════════════════════════════════════
-- 10) CHECK rejection_reason <-> status='rejected' — AMBAS direcciones
--     (criterio decidido: (status='rejected') = (rejection_reason is not null)).
--     Fixture: un creative 'ready' con duración válida para poder referenciarlo
--     como creative_id de cada ad.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_creative_for_ads (ok boolean);
do $$
begin
  insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds, status) values
    ('00000000-0000-0000-0000-000000470390', '00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-for-ads', 15, 'ready');
  insert into result_creative_for_ads values (true);
exception when others then
  insert into result_creative_for_ads values (false);
end $$;

select throws_ok(
  $$ insert into public.ads (agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at)
     values ('00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
             'Anuncio Rejected Sin Razon', 'phone', '+52 33 0000 0001', 'rejected', null, now(), now() + interval '30 days') $$,
  '23514', null,
  'REJ1_status_rejected_con_rejection_reason_null_es_rechazado'
);
select throws_ok(
  $$ insert into public.ads (agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at)
     values ('00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
             'Anuncio Draft Con Razon', 'phone', '+52 33 0000 0002', 'draft', 'motivo puesto sin estar rejected', now(), now() + interval '30 days') $$,
  '23514', null,
  'REJ2_status_no_rejected_ej_draft_con_rejection_reason_no_nulo_es_rechazado'
);

create temp table result_rej_accept (label text, ok boolean);
do $$
begin
  begin
    insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at)
      values ('00000000-0000-0000-0000-000000470391', '00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
              'Anuncio Rejected Con Razon', 'phone', '+52 33 0000 0003', 'rejected', 'contenido no cumple lineamientos', now(), now() + interval '30 days');
    insert into result_rej_accept values ('rejected_con_razon', true);
  exception when others then
    insert into result_rej_accept values ('rejected_con_razon', false);
  end;
  begin
    insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at)
      values ('00000000-0000-0000-0000-000000470392', '00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
              'Anuncio Draft Sin Razon', 'phone', '+52 33 0000 0004', 'draft', null, now(), now() + interval '30 days');
    insert into result_rej_accept values ('draft_sin_razon', true);
  exception when others then
    insert into result_rej_accept values ('draft_sin_razon', false);
  end;
end $$;

select is((select ok from result_rej_accept where label = 'rejected_con_razon'), true,
  'REJ3_status_rejected_con_rejection_reason_no_nulo_es_aceptado');
select is((select ok from result_rej_accept where label = 'draft_sin_razon'), true,
  'REJ4_status_draft_default_con_rejection_reason_null_es_aceptado');

-- ════════════════════════════════════════════════════════════════════════════
-- 11) CHECK ad_zones XOR — ambos ids rechazado, ninguno rechazado, exactamente
--     uno aceptado. Ad "contenedor" propio de esta sección.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_ad_for_zones (ok boolean);
do $$
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000470400', '00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
     'Anuncio Para Zonas', 'external_url', 'https://ejemplo.mx/promo', now(), now() + interval '30 days');
  insert into result_ad_for_zones values (true);
exception when others then
  insert into result_ad_for_zones values (false);
end $$;

select throws_ok(
  $$ insert into public.ad_zones (ad_id, municipality_id, neighborhood_id)
     values ('00000000-0000-0000-0000-000000470400', '47001', 1) $$,
  '23514', null,
  'ZONE1_ad_zones_con_municipality_id_Y_neighborhood_id_AMBOS_no_nulos_es_rechazado'
);
select throws_ok(
  $$ insert into public.ad_zones (ad_id, municipality_id, neighborhood_id)
     values ('00000000-0000-0000-0000-000000470400', null, null) $$,
  '23514', null,
  'ZONE2_ad_zones_sin_municipality_id_NI_neighborhood_id_es_rechazado'
);

create temp table result_zone_accept (label text, ok boolean);
do $$
declare v_neighborhood_id bigint;
begin
  select id into v_neighborhood_id from public.mx_neighborhoods where source_key = 'test-ads-47-001';

  begin
    insert into public.ad_zones (ad_id, municipality_id, neighborhood_id)
      values ('00000000-0000-0000-0000-000000470400', '47001', null);
    insert into result_zone_accept values ('solo_municipio', true);
  exception when others then
    insert into result_zone_accept values ('solo_municipio', false);
  end;

  begin
    insert into public.ad_zones (ad_id, municipality_id, neighborhood_id)
      values ('00000000-0000-0000-0000-000000470400', null, v_neighborhood_id);
    insert into result_zone_accept values ('solo_colonia', true);
  exception when others then
    insert into result_zone_accept values ('solo_colonia', false);
  end;
end $$;

select is((select ok from result_zone_accept where label = 'solo_municipio'), true,
  'ZONE3_ad_zones_con_SOLO_municipality_id_no_nulo_es_aceptado');
select is((select ok from result_zone_accept where label = 'solo_colonia'), true,
  'ZONE4_ad_zones_con_SOLO_neighborhood_id_no_nulo_es_aceptado');

-- ── 🔒 0 filas en ad_zones para un ad = inventario NACIONAL (no un estado
--    inválido) — un ad recién creado sin ninguna fila de zona es
--    perfectamente válido por sí mismo (nada en ad_zones lo exige). ────────
create temp table result_ad_zero_zones (ok boolean, zone_count int);
do $$
declare v_count int;
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000470401', '00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
     'Anuncio Inventario Nacional', 'whatsapp', '+525500000005', now(), now() + interval '30 days');
  select count(*) into v_count from public.ad_zones where ad_id = '00000000-0000-0000-0000-000000470401';
  insert into result_ad_zero_zones values (true, v_count);
exception when others then
  insert into result_ad_zero_zones values (false, -1);
end $$;

select is((select ok from result_ad_zero_zones), true,
  'ZONE5_crear_un_ad_sin_ninguna_fila_de_ad_zones_no_lanza_excepcion');
select is(coalesce((select zone_count from result_ad_zero_zones), -1), 0,
  'ZONE6_el_ad_recien_creado_tiene_0_filas_en_ad_zones_inventario_nacional_no_estado_invalido');

-- ════════════════════════════════════════════════════════════════════════════
-- 12) purchase_id — nullable, NULL aceptado sin tabla purchases.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_purchase_null (ok boolean, purchase_id uuid);
do $$
declare v_purchase_id uuid;
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000470402', '00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
     'Anuncio Sin Purchase', 'phone', '+52 33 0000 0006', now(), now() + interval '30 days');
  select purchase_id into v_purchase_id from public.ads where id = '00000000-0000-0000-0000-000000470402';
  insert into result_purchase_null values (true, v_purchase_id);
exception when others then
  insert into result_purchase_null values (false, null);
end $$;

select is((select ok from result_purchase_null), true,
  'PUR1_crear_un_ad_sin_purchase_id_no_lanza_excepcion');
-- Acoplado a "ok" a propósito (no solo "purchase_id is null" a secas): si el
-- INSERT falla en RED, la rama exception también deja purchase_id en NULL, lo
-- que volvería esta aserción vacua (pasaría por casualidad sin que el SUT
-- exista). Concatenar ok obliga a que el INSERT haya funcionado de verdad.
select is(
  (select ok::text || ':' || coalesce(purchase_id::text, 'NULL') from result_purchase_null),
  'true:NULL',
  'PUR2_purchase_id_queda_null_toda_la_beta_es_el_enganche_de_84_stripe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13) GRANTS fail-closed — anon SIN acceso a ninguna de las 4 tablas nuevas
--     (ausencia de grant, con dientes: 42501, NO "RLS filtra a 0 filas").
--     throws_ok sobrevive 42P01 (tabla aún no existe en RED) sin abortar.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok($$ select count(*) from public.ad_creatives $$, '42501', null,
  'GRANT1_anon_no_puede_leer_ad_creatives_permission_denied');
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok($$ select count(*) from public.ads $$, '42501', null,
  'GRANT2_anon_no_puede_leer_ads_permission_denied');
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok($$ select count(*) from public.ad_zones $$, '42501', null,
  'GRANT3_anon_no_puede_leer_ad_zones_permission_denied');
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok($$ select count(*) from public.ad_prices $$, '42501', null,
  'GRANT4_anon_no_puede_leer_ad_prices_permission_denied');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 14) GRANTS/escritura — authenticated NO escribe directo ads/ad_zones/
--     ad_prices (exclusivo de RPC/EF futura); SÍ puede INSERT ad_creatives
--     scoped a SU PROPIA organización, pero NO con el agency_id de otra.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000470101', 'authenticated'); -- owner_a
select throws_ok(
  $$ insert into public.ads (agency_id, creative_id, title, cta_type, cta_value, starts_at, ends_at)
     values ('00000000-0000-0000-0000-000000470201', '00000000-0000-0000-0000-000000470390',
             'Intento Directo', 'phone', '+52 33 0000 0007', now(), now() + interval '30 days') $$,
  '42501', null,
  'GRANT5_authenticated_no_puede_INSERT_directo_en_ads_ni_para_su_propia_organizacion'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000470101', 'authenticated'); -- owner_a
select throws_ok(
  $$ insert into public.ad_zones (ad_id, municipality_id) values ('00000000-0000-0000-0000-000000470400', '47001') $$,
  '42501', null,
  'GRANT6_authenticated_no_puede_INSERT_directo_en_ad_zones'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000470101', 'authenticated'); -- owner_a
select throws_ok(
  $$ insert into public.ad_prices (scope, days, amount_mxn, currency, valid_from)
     values ('national', 30, 1, 'MXN', now()) $$,
  '42501', null,
  'GRANT7_authenticated_no_puede_INSERT_directo_en_ad_prices_catalogo_administrado'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000470101', 'authenticated'); -- owner_a
select throws_ok(
  $$ insert into public.ad_creatives (agency_id, cloudflare_uid)
     values ('00000000-0000-0000-0000-000000470202', 'cfuid-ads-47-ajeno') $$,
  '42501', null,
  'GRANT8_authenticated_no_puede_INSERT_ad_creatives_con_el_agency_id_de_una_organizacion_ajena'
);
reset role;

create temp table result_creative_insert_own_org (ok boolean, agency_id uuid);
grant insert on result_creative_insert_own_org to authenticated, anon;
do $$
begin
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470101'::uuid)::text, true);
  begin
    insert into public.ad_creatives (id, agency_id, cloudflare_uid)
      values ('00000000-0000-0000-0000-000000470304', '00000000-0000-0000-0000-000000470201', 'cfuid-ads-47-propia-org');
    insert into result_creative_insert_own_org
      select true, agency_id from public.ad_creatives where id = '00000000-0000-0000-0000-000000470304';
  exception when others then
    insert into result_creative_insert_own_org values (false, null);
  end;
  reset role;
end $$;

select is((select ok from result_creative_insert_own_org), true,
  'GRANT9_authenticated_SI_puede_INSERT_ad_creatives_scoped_a_su_PROPIA_organizacion');
select is((select agency_id from result_creative_insert_own_org), '00000000-0000-0000-0000-000000470201'::uuid,
  'GRANT10_el_creative_insertado_queda_con_el_agency_id_correcto_de_la_propia_organizacion');

-- ════════════════════════════════════════════════════════════════════════════
-- 15) GRANTS/lectura — authenticated SÍ puede leer ad_prices (catálogo de
--     precios, PRD §17.2, sin restricción de organización).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_prices_read_authenticated (ok boolean, visible_count int);
grant insert on result_prices_read_authenticated to authenticated, anon;
do $$
declare v_count int;
begin
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470104'::uuid)::text, true); -- tercero, sin organización
  begin
    select count(*) into v_count from public.ad_prices;
    insert into result_prices_read_authenticated values (true, v_count);
  exception when others then
    insert into result_prices_read_authenticated values (false, -1);
  end;
  reset role;
end $$;

select is((select ok from result_prices_read_authenticated), true,
  'GRANT11_authenticated_sin_organizacion_puede_ejecutar_select_sobre_ad_prices_sin_error');
select is(coalesce((select visible_count from result_prices_read_authenticated), -1), 3,
  'GRANT12_authenticated_ve_las_3_filas_de_ad_prices_catalogo_publico_sin_restriccion_de_organizacion');

-- ════════════════════════════════════════════════════════════════════════════
-- 16) RLS ad_creatives — aislamiento entre organizaciones + admin ve cualquiera.
--     Fixture: creative propio de B, distinto del de A ya usado arriba.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_creative_b (ok boolean);
do $$
begin
  insert into public.ad_creatives (id, agency_id, cloudflare_uid) values
    ('00000000-0000-0000-0000-000000470311', '00000000-0000-0000-0000-000000470202', 'cfuid-ads-47-org-b');
  insert into result_creative_b values (true);
exception when others then
  insert into result_creative_b values (false);
end $$;

create temp table result_rls_creatives (label text, visible_count int);
grant insert on result_rls_creatives to authenticated, anon;
do $$
declare v_count int;
begin
  -- owner_a NO ve el creative de la organización B
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470101'::uuid)::text, true);
  select count(*) into v_count from public.ad_creatives where id = '00000000-0000-0000-0000-000000470311';
  insert into result_rls_creatives values ('owner_a_ve_creative_de_b', v_count);
  reset role;

  -- owner_a SÍ ve su propio creative
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470101'::uuid)::text, true);
  select count(*) into v_count from public.ad_creatives where id = '00000000-0000-0000-0000-000000470303';
  insert into result_rls_creatives values ('owner_a_ve_su_propio_creative', v_count);
  reset role;

  -- admin ve el creative de B (organización ajena)
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470103'::uuid)::text, true);
  select count(*) into v_count from public.ad_creatives where id = '00000000-0000-0000-0000-000000470311';
  insert into result_rls_creatives values ('admin_ve_creative_de_b', v_count);
  reset role;
exception when others then
  insert into result_rls_creatives values ('error', -1);
end $$;

select is(coalesce((select visible_count from result_rls_creatives where label = 'owner_a_ve_creative_de_b'), -1), 0,
  'RLS1_ad_creatives_un_miembro_de_la_organizacion_A_NO_ve_los_creatives_de_la_organizacion_B');
select is(coalesce((select visible_count from result_rls_creatives where label = 'owner_a_ve_su_propio_creative'), -1), 1,
  'RLS2_ad_creatives_un_miembro_SI_ve_los_creatives_de_su_PROPIA_organizacion');
select is(coalesce((select visible_count from result_rls_creatives where label = 'admin_ve_creative_de_b'), -1), 1,
  'RLS3_ad_creatives_un_admin_global_ve_el_creative_de_CUALQUIER_organizacion');

-- ════════════════════════════════════════════════════════════════════════════
-- 17) RLS ads — aislamiento por status para no-miembros + visibilidad pública
--     de un ad activo Y vigente + doble candado status+vigencia.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_ads_rls_fixture (ok boolean);
do $$
begin
  -- B: ad draft (NO debe ser visible fuera de B)
  insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
    ('00000000-0000-0000-0000-000000470312', '00000000-0000-0000-0000-000000470202', 'cfuid-ads-47-b-creative', 'ready');
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000470410', '00000000-0000-0000-0000-000000470202', '00000000-0000-0000-0000-000000470312',
     'Anuncio B Draft', 'phone', '+52 33 0000 0008', 'draft', now(), now() + interval '30 days');

  -- B: ad active Y vigente (starts_at en el pasado, ends_at en el futuro) ->
  -- debe ser visible a CUALQUIER authenticated (el feed lo necesita)
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000470411', '00000000-0000-0000-0000-000000470202', '00000000-0000-0000-0000-000000470312',
     'Anuncio B Activo Vigente', 'whatsapp', '+525500000009', 'active', now() - interval '10 days', now() + interval '10 days');

  -- B: ad active PERO ya vencido (ends_at en el pasado) -> doble candado:
  -- NO debe verse por un tercero, aunque status siga diciendo 'active'
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000470412', '00000000-0000-0000-0000-000000470202', '00000000-0000-0000-0000-000000470312',
     'Anuncio B Activo Vencido', 'external_url', 'https://ejemplo.mx/vencido', 'active', now() - interval '40 days', now() - interval '10 days');

  insert into result_ads_rls_fixture values (true);
exception when others then
  insert into result_ads_rls_fixture values (false);
end $$;

create temp table result_rls_ads (label text, visible_count int);
grant insert on result_rls_ads to authenticated, anon;
do $$
declare v_count int;
begin
  -- owner_a (organización A) NO ve el ad DRAFT de B
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470101'::uuid)::text, true);
  select count(*) into v_count from public.ads where id = '00000000-0000-0000-0000-000000470410';
  insert into result_rls_ads values ('a_ve_draft_de_b', v_count);
  reset role;

  -- tercero (sin organización) SÍ ve el ad active+vigente de B (cross-org, feed)
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470104'::uuid)::text, true);
  select count(*) into v_count from public.ads where id = '00000000-0000-0000-0000-000000470411';
  insert into result_rls_ads values ('tercero_ve_activo_vigente_de_b', v_count);
  reset role;

  -- tercero NO ve el ad active PERO vencido de B (doble candado status+vigencia)
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470104'::uuid)::text, true);
  select count(*) into v_count from public.ads where id = '00000000-0000-0000-0000-000000470412';
  insert into result_rls_ads values ('tercero_ve_activo_vencido_de_b', v_count);
  reset role;

  -- owner_b SÍ sigue viendo su propio ad vencido (es su anuncio, cualquier estado)
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000470102'::uuid)::text, true);
  select count(*) into v_count from public.ads where id = '00000000-0000-0000-0000-000000470412';
  insert into result_rls_ads values ('b_ve_su_propio_vencido', v_count);
  reset role;
exception when others then
  insert into result_rls_ads values ('error', -1);
end $$;

select is(coalesce((select visible_count from result_rls_ads where label = 'a_ve_draft_de_b'), -1), 0,
  'RLS4_ads_un_miembro_de_A_NO_ve_un_ad_DRAFT_de_la_organizacion_B');
select is(coalesce((select visible_count from result_rls_ads where label = 'tercero_ve_activo_vigente_de_b'), -1), 1,
  'RLS5_ads_CUALQUIER_authenticated_ve_un_ad_active_Y_vigente_de_OTRA_organizacion_el_feed_lo_necesita');
select is(coalesce((select visible_count from result_rls_ads where label = 'tercero_ve_activo_vencido_de_b'), -1), 0,
  'RLS6_ads_un_tercero_NO_ve_un_ad_active_pero_YA_VENCIDO_doble_candado_status_y_vigencia');
select is(coalesce((select visible_count from result_rls_ads where label = 'b_ve_su_propio_vencido'), -1), 1,
  'RLS7_ads_el_dueno_SIGUE_viendo_su_propio_ad_vencido_es_su_anuncio_cualquier_estado');

select * from finish();
rollback;

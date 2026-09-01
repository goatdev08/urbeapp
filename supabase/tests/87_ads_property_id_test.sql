-- Tests pgTAP — ads.property_id: la promoción de una propiedad como anuncio
-- (tarea #213, subtarea 213.1; exploración 040, decisiones 2-5 de Abraham
-- 2026-08-23). Ejecutar con:
--   supabase test db supabase/tests/87_ads_property_id_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el CONTRATO DE DATOS de public.ads tras la expansión —
-- qué combinaciones de columnas la tabla acepta y cuáles rechaza, observado
-- por el SQLSTATE de INSERTs reales. NO se valida el texto del cuerpo de un
-- CHECK ni el `pg_get_indexdef` literal: eso es internals y cambia con el
-- formateo de Postgres. Lo que se fija es el comportamiento.
--
-- SUT (AÚN NO EXISTE — RED 2026-09-01): la migración GREEN
-- supabase/migrations/20260903300001_ads_property_id.sql (+ rollback en
-- supabase/migrations/rollbacks/) debe:
--   · `ads.creative_id` → NULLABLE (hoy NOT NULL).
--   · `ads.property_id uuid null references public.properties(id) on delete
--     cascade` + índice parcial `ads_property_id_idx where property_id is not
--     null`.
--   · CHECK `ads_exactly_one_source`: num_nonnulls(creative_id, property_id)=1.
--   · `ads.cta_type` / `ads.cta_value` → NULLABLE + CHECK
--     `ads_cta_required_for_display`: property_id is not null or (cta_type is
--     not null and cta_value is not null). Un anuncio DISPLAY conserva su CTA
--     obligatorio; la promo no tiene CTA (decisión 4: es la propiedad, se toca
--     y abre el detalle — no hay call-to-action propio que configurar).
--   · Índice ÚNICO parcial `ads_one_open_promo_per_property on ads(property_id)
--     where property_id is not null and status in ('pending_review','active',
--     'paused')` — los estados NO TERMINALES del enum ad_status. 'draft' queda
--     fuera a propósito: una promo nunca nace en draft (promote_property_atomic
--     inserta directo en pending_review, 213.2); 'expired'/'rejected' son
--     terminales y LIBERAN la propiedad para volver a promocionarla.
--
-- ── Por qué esto es aditivo y seguro en producción viva (CLAUDE.md §0.5) ────
-- Relajar un NOT NULL y agregar una columna nullable no invalida ninguna fila
-- existente: los anuncios display vivos tienen creative_id, cta_type y
-- cta_value poblados y property_id NULL, así que satisfacen los dos CHECK
-- nuevos por construcción. El assert VAL1/VAL2 lo prueba de la única forma
-- que importa: exigiendo que los constraints estén VALIDADOS (convalidated),
-- no creados NOT VALID — si la migración tuviera que esquivar la validación
-- sería porque alguna fila real no cumple.
--
-- ── ROLLBACK (documentado aquí porque no se puede ejercitar desde pgTAP) ────
-- El rollback restaura `creative_id`/`cta_type`/`cta_value` a NOT NULL SOLO si
-- no quedan filas con property_id (promos). Si las hay, el ALTER fallaría; el
-- archivo de rollback las detecta y aborta con un mensaje explícito en vez de
-- borrar anuncios de gente real. Verificado por round-trip manual (aplicar →
-- rollback → re-aplicar), salida pegada en la bitácora de 213.1.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- CATÁLOGO: property_id existe/uuid/nullable; creative_id nullable; cta_type y
--   cta_value nullables; FK a properties con ON DELETE CASCADE; índice parcial
--   de property_id; índice ÚNICO parcial de promo abierta; los dos CHECK
--   existen y están VALIDADOS; authenticated conserva SELECT sobre la columna
--   nueva (el feed y /admin/ads la leen).
-- COMPORTAMIENTO (INSERT real, SQLSTATE observado):
--   LEGACY1 display clásico (creative + cta completos) sigue entrando.
--   PROMO1  promo (property_id, creative NULL, cta NULL) entra.
--   XOR1    creative_id Y property_id → 23514.
--   XOR2    ninguno de los dos → 23514.
--   CTA1    display sin cta_type → 23514.
--   CTA2    display sin cta_value → 23514.
--   UNIQ1   segunda promo pending_review de la MISMA propiedad → 23505.
--   UNIQ2   promo active + intento paused sobre la misma propiedad → 23505
--           (paused es NO terminal: el reloj está congelado, no cerrado).
--   UNIQ3   promo 'rejected' NO bloquea una nueva (terminal libera).
--   UNIQ4   promo 'expired' NO bloquea una nueva (terminal libera).
--   UNIQ5   promos de propiedades DISTINTAS conviven.
--   UNIQ6   dos display (property_id NULL) NO chocan entre sí — el índice es
--           PARCIAL; si fuera total, publicar un segundo anuncio display
--           reventaría (regresión que mataría la feature ya desplegada).
--   CASCADE1 borrar la propiedad borra su promo (on delete cascade).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(29);

-- ── Helper: ejecuta un INSERT y devuelve su SQLSTATE, SIEMPRE deshaciendo el
--    efecto. El `raise` interno es atrapado por el EXCEPTION del mismo bloque,
--    y un bloque BEGIN/EXCEPTION de plpgsql ES una subtransacción: al salir
--    por la excepción, la fila insertada se revierte. Así un caso "debe
--    fallar" que en RED no falla no deja basura que contamine los siguientes.
create or replace function pg_temp.insert_sqlstate(p_sql text)
returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'URBEA_NO_ERROR' using errcode = 'UB001';
  exception
    when sqlstate 'UB001' then return '00000';
    when others then return sqlstate;
  end;
end $$;

-- ── Helper: ejecuta un INSERT "ancla" que SÍ debe persistir cuando la
--    migración existe, sin abortar el archivo en RED (donde la columna
--    property_id todavía no existe y el INSERT muere con 42703). Devuelve el
--    SQLSTATE para que el ancla también sea observable.
create or replace function pg_temp.try_insert(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return '00000';
exception when others then
  return sqlstate;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — state '87', fuera del rango real INEGI (01-32).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('87', 'Estado Promo 87', 'PR');
insert into public.mx_municipalities (id, state_id, name, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng)
values ('87001', '87', 'Municipio Promo 87', 19.20, -99.50, 19.60, -99.00);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000870001', 'owner_promo87@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000870001';

insert into public.agencies (id, name, slug, status, created_by_user_id, can_publish_properties, can_advertise, advertiser_category)
values ('00000000-0000-0000-0000-000000870101', 'Inmobiliaria Promo 87', 'inmo-promo-87', 'active',
        '00000000-0000-0000-0000-000000870001', true, true, 'otro');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000870101', '00000000-0000-0000-0000-000000870001', 'owner', 'active');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000870201', '00000000-0000-0000-0000-000000870101', 'cf-promo87-ready', 'ready');

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status, published_at)
values
  ('00000000-0000-0000-0000-000000870301', '00000000-0000-0000-0000-000000870001',
   '00000000-0000-0000-0000-000000870101', 'casa', 'rent', 'Calle Promo 87 #1',
   extensions.ST_SetSRID(extensions.ST_Point(-99.29, 19.31), 4326)::extensions.geography,
   12000, 'active', now()),
  ('00000000-0000-0000-0000-000000870302', '00000000-0000-0000-0000-000000870001',
   '00000000-0000-0000-0000-000000870101', 'departamento', 'sale', 'Calle Promo 87 #2',
   extensions.ST_SetSRID(extensions.ST_Point(-99.28, 19.32), 4326)::extensions.geography,
   1800000, 'active', now()),
  -- Propiedad sacrificable para CASCADE1 (se borra de verdad).
  ('00000000-0000-0000-0000-000000870303', '00000000-0000-0000-0000-000000870001',
   '00000000-0000-0000-0000-000000870101', 'local', 'rent', 'Calle Promo 87 #3',
   extensions.ST_SetSRID(extensions.ST_Point(-99.27, 19.33), 4326)::extensions.geography,
   9000, 'active', now());

-- Anuncio DISPLAY sembrado con la forma PRE-migración (creative + CTA
-- completos, sin property_id). Representa el inventario vivo en producción:
-- si la migración lo invalidara, VAL1/VAL2 y LEGACY0 lo delatan.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at)
values ('00000000-0000-0000-0000-000000870401', '00000000-0000-0000-0000-000000870101',
        '00000000-0000-0000-0000-000000870201', 'Display Legado 87', 'phone', '+5213300000087',
        'active', now(), now() + interval '30 days');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Catálogo — columnas y nullability.
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'ads', 'property_id',
  'COL1_ads_gana_la_columna_property_id');

select col_type_is('public', 'ads', 'property_id', 'uuid',
  'COL2_property_id_es_uuid_como_properties_id');

select col_is_null('public', 'ads', 'property_id',
  'COL3_property_id_es_nullable_un_anuncio_display_no_tiene_propiedad');

select col_is_null('public', 'ads', 'creative_id',
  'COL4_creative_id_deja_de_ser_NOT_NULL_una_promo_no_tiene_creativo_propio');

select col_is_null('public', 'ads', 'cta_type',
  'COL5_cta_type_deja_de_ser_NOT_NULL_la_promo_no_tiene_CTA');

select col_is_null('public', 'ads', 'cta_value',
  'COL6_cta_value_deja_de_ser_NOT_NULL_la_promo_no_tiene_CTA');

-- FK con ON DELETE CASCADE leída del catálogo (confdeltype 'c'): si la
-- propiedad desaparece, su promo no puede sobrevivir apuntando al vacío.
select is(
  (select c.confdeltype::text
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_attribute a on a.attrelid = c.confrelid and a.attnum = c.confkey[1]
    where n.nspname = 'public' and t.relname = 'ads' and c.contype = 'f'
      and c.confrelid = 'public.properties'::regclass
      and a.attname = 'id'
    limit 1),
  'c',
  'FK1_property_id_referencia_properties_id_con_ON_DELETE_CASCADE'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Catálogo — índices y CHECKs.
-- ════════════════════════════════════════════════════════════════════════════

select has_index('public', 'ads', 'ads_property_id_idx',
  'IDX1_indice_parcial_por_property_id_para_buscar_la_promo_de_una_propiedad');

select has_index('public', 'ads', 'ads_one_open_promo_per_property',
  'IDX2_existe_el_indice_de_promo_abierta_por_propiedad');

select is(
  (select i.indisunique
     from pg_index i
     join pg_class ic on ic.oid = i.indexrelid
     join pg_namespace n on n.oid = ic.relnamespace
    where n.nspname = 'public' and ic.relname = 'ads_one_open_promo_per_property'),
  true,
  'IDX3_ads_one_open_promo_per_property_es_UNIQUE_no_un_indice_cualquiera'
);

select is(
  (select i.indpred is not null
     from pg_index i
     join pg_class ic on ic.oid = i.indexrelid
     join pg_namespace n on n.oid = ic.relnamespace
    where n.nspname = 'public' and ic.relname = 'ads_one_open_promo_per_property'),
  true,
  'IDX4_es_PARCIAL_un_unique_total_sobre_property_id_haria_chocar_a_todos_los_display_con_NULL_no_pero_a_las_promos_cerradas_si'
);

-- Los dos CHECK nuevos, por nombre y VALIDADOS. `convalidated=false` (NOT
-- VALID) significaría que alguna fila real no cumple y la migración esquivó
-- la verificación: en producción viva eso es exactamente lo que no puede pasar.
select is(
  (select c.convalidated from pg_constraint c
    where c.conrelid = 'public.ads'::regclass and c.conname = 'ads_exactly_one_source'),
  true,
  'VAL1_CHECK_ads_exactly_one_source_existe_y_esta_VALIDADO_contra_las_filas_vivas'
);

select is(
  (select c.convalidated from pg_constraint c
    where c.conrelid = 'public.ads'::regclass and c.conname = 'ads_cta_required_for_display'),
  true,
  'VAL2_CHECK_ads_cta_required_for_display_existe_y_esta_VALIDADO_contra_las_filas_vivas'
);

-- La columna nueva viaja al cliente: el feed la lee vía ads_for_zone (213.3) y
-- /admin/ads la selecciona directo sobre la tabla. Sin el grant de columna,
-- ese select devolvería 42501 con la RLS intacta.
select is(
  (select case
     when exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'ads'
                     and column_name = 'property_id')
     then has_column_privilege('authenticated', 'public.ads'::regclass, 'property_id', 'SELECT')
     else null end),
  true,
  'GRANT1_authenticated_conserva_SELECT_sobre_property_id'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Comportamiento — el anuncio DISPLAY (lo ya desplegado) no se rompe.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.ads where id = '00000000-0000-0000-0000-000000870401'),
  1,
  'LEGACY0_la_fila_display_sembrada_con_la_forma_pre_migracion_sigue_existiendo'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870402', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870201', 'Display Nuevo 87', 'whatsapp', '+5213312345687',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '00000',
  'LEGACY1_un_anuncio_display_clasico_creative_mas_CTA_sigue_insertando_sin_error'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Comportamiento — exactamente-una-fuente (creative XOR propiedad).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870403', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870301', 'Promo Casa 87',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '00000',
  'PROMO1_una_promo_property_id_sin_creative_y_sin_CTA_entra_sin_error'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, creative_id, property_id, title, cta_type, cta_value, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870404', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870201', '00000000-0000-0000-0000-000000870301',
            'Hibrido Invalido 87', 'phone', '+5213300000404',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '23514',
  'XOR1_creative_id_Y_property_id_a_la_vez_viola_ads_exactly_one_source'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, title, cta_type, cta_value, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870405', '00000000-0000-0000-0000-000000870101',
            'Huerfano Invalido 87', 'phone', '+5213300000405',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '23514',
  'XOR2_ni_creative_id_ni_property_id_viola_ads_exactly_one_source_un_anuncio_sin_video_no_existe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Comportamiento — el CTA sigue siendo obligatorio SOLO para display.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, creative_id, title, cta_value, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870406', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870201', 'Display Sin CtaType 87', '+5213300000406',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '23514',
  'CTA1_display_sin_cta_type_viola_ads_cta_required_for_display'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, creative_id, title, cta_type, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870407', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870201', 'Display Sin CtaValue 87', 'phone',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '23514',
  'CTA2_display_sin_cta_value_viola_ads_cta_required_for_display'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Comportamiento — una sola promo ABIERTA por propiedad.
-- ════════════════════════════════════════════════════════════════════════════

-- Promo ancla en pending_review sobre la propiedad 870301 (persiste para el
-- resto de la sección). Va por pg_temp.try_insert: en RED la columna no
-- existe (42703) y un INSERT crudo abortaría el archivo entero.
select pg_temp.try_insert($$
  insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
  values ('00000000-0000-0000-0000-000000870501', '00000000-0000-0000-0000-000000870101',
          '00000000-0000-0000-0000-000000870301', 'Promo Ancla 87',
          'pending_review', now(), now() + interval '30 days')
$$);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870502', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870301', 'Promo Duplicada 87',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '23505',
  'UNIQ1_segunda_promo_pending_review_de_la_MISMA_propiedad_choca_con_el_indice_unico'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, property_id, title, status, paused_at, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870503', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870301', 'Promo Pausada 87',
            'paused', now(), now(), now() + interval '30 days')
  $$),
  '23505',
  'UNIQ2_paused_cuenta_como_promo_ABIERTA_el_reloj_esta_congelado_no_cerrado'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, property_id, title, status, rejection_reason, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870504', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870302', 'Promo Rechazada 87',
            'rejected', 'No cumple', now(), now() + interval '30 days')
  $$),
  '00000',
  'UNIQ3_una_promo_rejected_es_terminal_y_NO_ocupa_el_cupo'
);

-- Ancla terminal REAL sobre 870302 para probar que no bloquea a la siguiente.
select pg_temp.try_insert($$
  insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
  values ('00000000-0000-0000-0000-000000870505', '00000000-0000-0000-0000-000000870101',
          '00000000-0000-0000-0000-000000870302', 'Promo Expirada 87',
          'expired', now() - interval '60 days', now() - interval '30 days')
$$);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870506', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870302', 'Promo Repetida Tras Expirar 87',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '00000',
  'UNIQ4_tras_una_promo_expired_la_propiedad_se_puede_volver_a_promocionar'
);

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870507', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870303', 'Promo Otra Propiedad 87',
            'pending_review', now(), now() + interval '30 days')
  $$),
  '00000',
  'UNIQ5_promos_abiertas_de_propiedades_DISTINTAS_conviven_el_cupo_es_por_propiedad'
);

-- 🔴 Regresión que mataría la feature ya desplegada: si el índice único no
-- fuera parcial por `property_id is not null`, los display (property_id NULL)
-- no chocarían en Postgres (NULLs distintos), pero un `nulls not distinct` o un
-- unique sobre (agency_id) sí. Se prueba con DOS display simultáneos activos.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at)
values ('00000000-0000-0000-0000-000000870508', '00000000-0000-0000-0000-000000870101',
        '00000000-0000-0000-0000-000000870201', 'Display Uno 87', 'phone', '+5213300000508',
        'active', now(), now() + interval '30 days');

select is(
  pg_temp.insert_sqlstate($$
    insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at)
    values ('00000000-0000-0000-0000-000000870509', '00000000-0000-0000-0000-000000870101',
            '00000000-0000-0000-0000-000000870201', 'Display Dos 87', 'phone', '+5213300000509',
            'active', now(), now() + interval '30 days')
  $$),
  '00000',
  'UNIQ6_dos_anuncios_display_activos_de_la_misma_organizacion_conviven_el_indice_es_PARCIAL'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Comportamiento — cascada desde properties.
-- ════════════════════════════════════════════════════════════════════════════

-- Assert COMPUESTO antes->despues: la promo EXISTE (1) y tras borrar la
-- propiedad DESAPARECE (0). Un assert suelto de "despues=0" pasaria vacio en
-- RED (donde la promo nunca llego a existir); el par 1/0 no.
create temp table cascade_87 (transicion text);
do $$
declare v_antes int; v_despues int;
begin
  insert into public.ads (id, agency_id, property_id, title, status, starts_at, ends_at)
  values ('00000000-0000-0000-0000-000000870601', '00000000-0000-0000-0000-000000870101',
          '00000000-0000-0000-0000-000000870303', 'Promo A Borrar 87',
          'active', now(), now() + interval '30 days');

  select count(*) into v_antes from public.ads where id = '00000000-0000-0000-0000-000000870601';
  delete from public.properties where id = '00000000-0000-0000-0000-000000870303';
  select count(*) into v_despues from public.ads where id = '00000000-0000-0000-0000-000000870601';

  insert into cascade_87 values (v_antes || '/' || v_despues);
exception when others then
  insert into cascade_87 values ('error:' || sqlstate);
end $$;

select is(
  (select transicion from cascade_87),
  '1/0',
  'CASCADE1_la_promo_existe_y_borrar_la_propiedad_la_borra_no_queda_un_anuncio_apuntando_al_vacio'
);

select is(
  (select count(*)::int from public.ads where id = '00000000-0000-0000-0000-000000870401'),
  1,
  'CASCADE2_la_cascada_no_toca_los_anuncios_display_de_la_misma_organizacion'
);

select * from finish();
rollback;

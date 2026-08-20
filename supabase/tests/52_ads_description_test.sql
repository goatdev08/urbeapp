-- Tests pgTAP — public.ads.description (texto opcional, autolinkificado en el
-- cliente) + democión automática a 'pending_review' al editar un ad 'active'.
-- Tarea #192 (derivada de 170.8, decisiones de Abraham 2026-08-18), bloque
-- BACKEND. Ejecutar con:
--   supabase test db supabase/tests/52_ads_description_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/46/
-- 47/48/51_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de
--   (a) el shape catalográfico de la columna nueva public.ads.description
--       (has_column/col_type_is/col_is_null — catálogo puro, NUNCA lanza
--       aunque la columna no exista) y su CHECK de longitud ejercitado con
--       INSERT reales;
--   (b) un UPDATE real sobre public.ads.description (y su efecto colateral en
--       public.ads.status + public.admin_actions) — NUNCA internals. No se
--       valida la existencia de un trigger por NOMBRE; se ejercita el UPDATE
--       real y se observa el resultado, igual que 48_ads_state_machine_test.sql
--       hace con la máquina de estados.
--
-- SUT (AÚN NO EXISTE — RED 2026-08-18): una migración GREEN
-- (supabase/migrations/20260818000001_ads_description.sql + rollback) debe
-- agregar:
--   (a) columna public.ads.description text null (aditiva, add column if not
--       exists), CHECK ads_description_length <= 500 caracteres. NULL
--       permitido — la descripción es opcional. Sin CHECK de esquemas de URL
--       a propósito: la allowlist http/https vive en UN SOLO lugar (el
--       linkificador del cliente + validate_ad_cta, #169), no duplicada en un
--       blocklist de base.
--   (b) trigger BEFORE UPDATE ads_description_review (función
--       public.handle_ad_description_edit()) WHEN (old.description IS
--       DISTINCT FROM new.description AND old.status = 'active' AND
--       new.status = old.status) -> new.status := 'pending_review'. El
--       nombre del trigger importa para el ORDEN de ejecución (BEFORE ROW
--       corre alfabético, 'ads_description_review' < 'ads_status_change' de
--       169.2 -- la democión debe ocurrir ANTES de que la máquina de estados
--       evalúe su propio WHEN) pero NO se valida el nombre aquí por catálogo
--       (sería un internal) -- solo su efecto observable.
--   (c) create or replace public.handle_ad_status_change() (169.2, NO se
--       edita 20260816000006_ads_state_machine.sql): la matriz gana
--       active->pending_review PERO SOLO como transición DE SISTEMA -- el
--       discriminador es que la descripción cambió en el MISMO UPDATE. Si
--       cambió: NO exige admin (private.resolve_admin_actor() no se llama) y
--       NO inserta en admin_actions (esa tabla audita decisiones de ADMIN,
--       admin_id es NOT NULL). Si NO cambió: sigue siendo
--       INVALID_AD_STATUS_TRANSITION (P0001) -- un admin no puede regresar un
--       ad a revisión a mano por esta vía.
--
-- ── Nota sobre la técnica RED sin abortar la transacción (heredada de 47/48/
--    51_*) ──────────────────────────────────────────────────────────────────
-- has_column/col_type_is/col_is_null (catálogo puro) NUNCA lanzan aunque la
-- columna no exista. throws_ok SÍ sobrevive un SQLSTATE inesperado (42703
-- "column does not exist" en vez del 23514/P0001 esperado) -- el esperado no
-- matchea y reporta "not ok" limpio, sin abortar el archivo. lives_ok y las
-- consultas RAW NO sobreviven un 42703 -- por eso TODA verificación positiva
-- que toque ads.description va en un bloque `do $$ ... exception when others
-- ... $$` AUTO-PROTEGIDO que escribe su resultado en una tabla temporal
-- (técnica de 47/48/51_*), nunca en lives_ok/RAW crudo.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Columna:
--   · existe, es text, es nullable.
--   · CHECK: 500 caracteres aceptado (frontera exacta, sin truncar), 501
--     rechazado (23514 explícito).
--   · un ad SIN descripción (NULL) sigue siendo insertable.
-- Democión automática:
--   · un ad 'active' al que se edita la descripción queda en
--     'pending_review' -- assert COMPUESTO antes->después en la MISMA
--     aserción (no pasa en vacío). No se insertó fila en admin_actions para
--     ese entity_id (conteo antes y después, ambos 0).
-- No se exige admin (assert central):
--   · la democión funciona SIN urbea.admin_actor_id en la sesión y sin JWT de
--     admin (service_role, GUC vacío, mismo patrón IMPERSONA3/AGMATRIZ11 de
--     48_ads_state_machine_test.sql pero invertido: aquí SÍ debe funcionar) --
--     hoy este bloque ni siquiera llega a STATUS_CHANGE_REQUIRES_ADMIN porque
--     la columna ni el trigger existen.
-- Lo que NO debe demoverse (assert COMPUESTO antes->después en cada caso):
--   · editar la descripción de un ad en draft/pending_review/paused deja el
--     status intacto (3 casos, la cláusula WHEN exige old.status='active').
--   · reescribir la MISMA descripción (IS DISTINCT FROM falso) no cambia nada.
--   · un UPDATE que no toca la descripción tampoco (este caso NO depende de
--     la columna nueva -- ya pasa hoy, guardarraíl).
-- Cambio simultáneo de status y descripción:
--   · un admin que hace active->paused y edita la descripción en el MISMO
--     UPDATE conserva 'paused' (la cláusula new.status=old.status del WHEN lo
--     protege) -- el trigger de descripción NO puede pisar la intención del
--     admin.
-- La matriz sigue apretada (regresión -- YA pasa hoy contra 20260816000006,
-- guardarraíl para que el GREEN de esta subtarea no la afloje):
--   · active->pending_review SIN cambio de descripción sigue lanzando
--     INVALID_AD_STATUS_TRANSITION.
--   · draft->active DIRECTO sigue fallando.
--   · rejected y expired siguen siendo terminales.
-- No regresión de la ruta de admin (regresión -- YA pasa hoy):
--   · pending_review->active sigue exigiendo admin y sigue auditando en
--     admin_actions en la misma transacción.
--   · ORGANIZATION_SUSPENDED sigue disparando.
-- Idempotencia de la migración: NO es un SEAM ejercitable dentro de esta
-- transacción pgTAP (aplicar el archivo de migración dos veces es una acción
-- de operador, no una aserción SQL sobre datos) -- se verifica en el GREEN
-- corriendo la migración dos veces sobre el stack local y confirmando que
-- este mismo archivo sigue en verde. No se declara aquí un assert relleno
-- por ese motivo (regla del repo: un assert que no puede fallar es un assert
-- vacío).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(41);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Captura ÚNICA de "ahora" para todo el archivo (mismo patrón que 48/51_*).
create temp table test_now_52 as select now() as v_now;

-- Admin actor único, reusado vía GUC en cada sección que lo necesita
-- (private.resolve_admin_actor, patrón 71.5/169.2).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000520001', 'admin_ads_desc_52@urbea.mx');
update public.users set role = 'admin'
 where id = '00000000-0000-0000-0000-000000520001';

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Columna — shape catalográfico (catálogo puro, nunca lanza).
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'ads', 'description', 'COL1_ads_description_existe');
select col_type_is('public', 'ads', 'description', 'text', 'COL2_ads_description_es_text');
select col_is_null('public', 'ads', 'description', 'COL3_ads_description_es_nullable_la_descripcion_es_opcional');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) CHECK ads_description_length — frontera exacta (500 aceptado sin
--    truncar, 501 rechazado 23514) + NULL sigue siendo insertable.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000521002', 'owner_check_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000521001', 'Inmobiliaria Check Desc 52', 'inmo-checkdesc-52', 'active',
   '00000000-0000-0000-0000-000000521002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000521003', '00000000-0000-0000-0000-000000521001', 'ready');

-- ── 2.1) exactamente 500 caracteres — aceptado, sin truncar ────────────────
create temp table result_chk500_52 (ok boolean, stored_len int, err_sqlstate text);
do $$
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, description, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000521011', '00000000-0000-0000-0000-000000521001',
     '00000000-0000-0000-0000-000000521003', 'Ad Check Desc 500', 'external_url', 'https://ejemplo.mx/chk500',
     'draft', repeat('a', 500), now(), now() + interval '30 days');
  insert into result_chk500_52
  select true, char_length(description), null from public.ads
   where id = '00000000-0000-0000-0000-000000521011';
exception when others then
  insert into result_chk500_52 values (false, null, sqlstate);
end $$;

select is((select ok from result_chk500_52), true,
  'CHK1_description_de_exactamente_500_caracteres_es_aceptada_frontera_inclusive');
select is((select stored_len from result_chk500_52), 500,
  'CHK1B_la_descripcion_almacenada_conserva_exactamente_los_500_caracteres_sin_truncar');

-- ── 2.2) 501 caracteres — rechazado (23514 explícito) ───────────────────────
select throws_ok(
  $$ insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, description, starts_at, ends_at) values
       ('00000000-0000-0000-0000-000000521012', '00000000-0000-0000-0000-000000521001',
        '00000000-0000-0000-0000-000000521003', 'Ad Check Desc 501', 'external_url', 'https://ejemplo.mx/chk501',
        'draft', repeat('a', 501), now(), now() + interval '30 days') $$,
  '23514', null,
  'CHK2_description_de_501_caracteres_rechazada_por_el_CHECK_ads_description_length'
);
select is(
  (select count(*)::int from public.ads where id = '00000000-0000-0000-0000-000000521012'),
  0,
  'CHK2B_el_intento_rechazado_no_dejo_ninguna_fila'
);

-- ── 2.3) NULL — sigue siendo insertable (descripción opcional) ─────────────
create temp table result_chknull_52 (ok boolean, is_null boolean, err_sqlstate text);
do $$
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000521013', '00000000-0000-0000-0000-000000521001',
     '00000000-0000-0000-0000-000000521003', 'Ad Check Desc Null', 'external_url', 'https://ejemplo.mx/chknull',
     'draft', now(), now() + interval '30 days');
  insert into result_chknull_52
  select true, (description is null) from public.ads
   where id = '00000000-0000-0000-0000-000000521013';
exception when others then
  insert into result_chknull_52 values (false, null, sqlstate);
end $$;

select is((select ok from result_chknull_52), true,
  'CHK3_un_ad_sin_descripcion_NULL_sigue_siendo_insertable_la_descripcion_es_opcional');
select is((select is_null from result_chknull_52), true,
  'CHK3B_la_descripcion_no_provista_queda_efectivamente_NULL');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Democión automática — un ad 'active' al que se edita la descripción
--    queda en 'pending_review'. Assert COMPUESTO antes->después en la MISMA
--    aserción (no pasa en vacío). No se auditó en admin_actions (conteo antes
--    y después, ambos 0 -- esa tabla es para decisiones de ADMIN, admin_id es
--    NOT NULL, y aquí nadie identificado tomó una decisión).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000522002', 'owner_demo_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000522001', 'Inmobiliaria Demo Desc 52', 'inmo-demodesc-52', 'active',
   '00000000-0000-0000-0000-000000522002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000522003', '00000000-0000-0000-0000-000000522001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000522011', '00000000-0000-0000-0000-000000522001',
   '00000000-0000-0000-0000-000000522003', 'Ad Demo Desc 3', 'external_url', 'https://ejemplo.mx/demo3',
   'active', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

create temp table result_demo_52 (
  ok boolean, status_before text, status_after text,
  actions_before int, actions_after int, err_sqlstate text
);
do $$
declare
  v_before text;
  v_after  text;
  v_actions_before int;
  v_actions_after  int;
begin
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000522011';
  select count(*)::int into v_actions_before from public.admin_actions
   where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000522011';

  update public.ads set description = 'Promoción especial este mes, visita https://ejemplo.mx/promo'
   where id = '00000000-0000-0000-0000-000000522011';

  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000522011';
  select count(*)::int into v_actions_after from public.admin_actions
   where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000522011';

  insert into result_demo_52 values (true, v_before, v_after, v_actions_before, v_actions_after, null);
exception when others then
  insert into result_demo_52 values (false, null, null, null, null, sqlstate);
end $$;

select is((select ok from result_demo_52), true,
  'DEMO1_editar_la_descripcion_de_un_ad_active_no_lanza_excepcion');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_demo_52),
  'active->pending_review',
  'DEMO2_un_ad_active_al_que_se_edita_la_descripcion_queda_en_pending_review_assert_compuesto_antes_despues'
);
select is((select actions_before from result_demo_52), 0,
  'DEMO3_antes_de_editar_la_descripcion_no_habia_ninguna_fila_de_auditoria_para_este_ad');
select is((select actions_after from result_demo_52), 0,
  'DEMO4_la_democion_automatica_NO_inserta_fila_en_admin_actions_admin_id_es_NOT_NULL_y_nadie_identificado_decidio');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) 🔒 No se exige admin — la democión funciona SIN urbea.admin_actor_id en
--    la sesión y sin JWT de admin (service_role con GUC vacío, mismo patrón
--    IMPERSONA3/AGMATRIZ11 de 48_ads_state_machine_test.sql, pero INVERTIDO:
--    aquí SÍ debe funcionar). Hoy este bloque falla antes de siquiera llegar
--    a STATUS_CHANGE_REQUIRES_ADMIN porque la columna ni el trigger existen.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000523002', 'owner_noadmin_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000523001', 'Inmobiliaria No Admin Desc 52', 'inmo-noadmindesc-52', 'active',
   '00000000-0000-0000-0000-000000523002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000523003', '00000000-0000-0000-0000-000000523001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000523011', '00000000-0000-0000-0000-000000523001',
   '00000000-0000-0000-0000-000000523003', 'Ad No Admin Desc 4', 'external_url', 'https://ejemplo.mx/noadmin4',
   'active', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select set_config('urbea.admin_actor_id', '', true);
select pg_temp.act_as(null, 'service_role');

create temp table result_noadmin_52 (
  ok boolean, status_before text, status_after text, err_sqlstate text
);
do $$
declare
  v_before text;
  v_after  text;
begin
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000523011';
  update public.ads set description = 'Otra descripción, sin admin identificado en la sesión'
   where id = '00000000-0000-0000-0000-000000523011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000523011';
  insert into result_noadmin_52 values (true, v_before, v_after, null);
exception when others then
  insert into result_noadmin_52 values (false, null, null, sqlstate);
end $$;

reset role;

select is((select ok from result_noadmin_52), true,
  'NOADMIN1_la_democion_funciona_SIN_admin_identificado_en_la_sesion_ni_JWT_de_admin');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_noadmin_52),
  'active->pending_review',
  'NOADMIN2_pese_a_no_haber_admin_identificado_el_ad_queda_en_pending_review_igual_que_con_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Lo que NO debe demoverse — editar la descripción de un ad en
--    draft/pending_review/paused deja el status intacto (la cláusula WHEN
--    exige old.status='active'). Reescribir la MISMA descripción (IS DISTINCT
--    FROM falso) y un UPDATE que no toca la descripción tampoco cambian nada.
--    Assert COMPUESTO antes->después en cada caso.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5.1) draft ───────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000524002', 'owner_nodemo_draft_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000524001', 'Inmobiliaria NoDemo Draft 52', 'inmo-nodemodraft-52', 'active',
   '00000000-0000-0000-0000-000000524002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000524003', '00000000-0000-0000-0000-000000524001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000524011', '00000000-0000-0000-0000-000000524001',
   '00000000-0000-0000-0000-000000524003', 'Ad NoDemo Draft 5.1', 'external_url', 'https://ejemplo.mx/nodemo51',
   'draft', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

create temp table result_nodemo_draft_52 (ok boolean, status_before text, status_after text, err_sqlstate text);
do $$
declare
  v_before text; v_after text;
begin
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000524011';
  update public.ads set description = 'Descripción en borrador'
   where id = '00000000-0000-0000-0000-000000524011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000524011';
  insert into result_nodemo_draft_52 values (true, v_before, v_after, null);
exception when others then
  insert into result_nodemo_draft_52 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nodemo_draft_52), true,
  'NODEMO_DRAFT1_editar_la_descripcion_de_un_ad_en_draft_no_lanza_excepcion');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_nodemo_draft_52),
  'draft->draft',
  'NODEMO_DRAFT2_editar_la_descripcion_de_un_ad_en_draft_deja_el_status_intacto_solo_active_se_demueve'
);

-- ── 5.2) pending_review ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000525002', 'owner_nodemo_pending_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000525001', 'Inmobiliaria NoDemo Pending 52', 'inmo-nodemopending-52', 'active',
   '00000000-0000-0000-0000-000000525002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000525003', '00000000-0000-0000-0000-000000525001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000525011', '00000000-0000-0000-0000-000000525001',
   '00000000-0000-0000-0000-000000525003', 'Ad NoDemo Pending 5.2', 'external_url', 'https://ejemplo.mx/nodemo52',
   'pending_review', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

create temp table result_nodemo_pending_52 (ok boolean, status_before text, status_after text, err_sqlstate text);
do $$
declare
  v_before text; v_after text;
begin
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000525011';
  update public.ads set description = 'Descripción en revisión'
   where id = '00000000-0000-0000-0000-000000525011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000525011';
  insert into result_nodemo_pending_52 values (true, v_before, v_after, null);
exception when others then
  insert into result_nodemo_pending_52 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nodemo_pending_52), true,
  'NODEMO_PENDING1_editar_la_descripcion_de_un_ad_en_pending_review_no_lanza_excepcion');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_nodemo_pending_52),
  'pending_review->pending_review',
  'NODEMO_PENDING2_editar_la_descripcion_de_un_ad_en_pending_review_deja_el_status_intacto'
);

-- ── 5.3) paused (paused_at ya estampado, satisface ads_paused_at_matches_status) ─
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000526002', 'owner_nodemo_paused_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000526001', 'Inmobiliaria NoDemo Paused 52', 'inmo-nodemopaused-52', 'active',
   '00000000-0000-0000-0000-000000526002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000526003', '00000000-0000-0000-0000-000000526001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, paused_at, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000526011', '00000000-0000-0000-0000-000000526001',
   '00000000-0000-0000-0000-000000526003', 'Ad NoDemo Paused 5.3', 'external_url', 'https://ejemplo.mx/nodemo53',
   'paused', (select v_now from test_now_52),
   (select v_now - interval '1 day' from test_now_52), (select v_now + interval '20 days' from test_now_52));

create temp table result_nodemo_paused_52 (ok boolean, status_before text, status_after text, err_sqlstate text);
do $$
declare
  v_before text; v_after text;
begin
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000526011';
  update public.ads set description = 'Descripción en pausa'
   where id = '00000000-0000-0000-0000-000000526011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000526011';
  insert into result_nodemo_paused_52 values (true, v_before, v_after, null);
exception when others then
  insert into result_nodemo_paused_52 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nodemo_paused_52), true,
  'NODEMO_PAUSED1_editar_la_descripcion_de_un_ad_en_paused_no_lanza_excepcion');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_nodemo_paused_52),
  'paused->paused',
  'NODEMO_PAUSED2_editar_la_descripcion_de_un_ad_en_paused_deja_el_status_intacto'
);

-- ── 5.4) reescribir la MISMA descripción (IS DISTINCT FROM falso) ─────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000527002', 'owner_nodemo_same_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000527001', 'Inmobiliaria NoDemo Same 52', 'inmo-nodemosame-52', 'active',
   '00000000-0000-0000-0000-000000527002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000527003', '00000000-0000-0000-0000-000000527001', 'ready');

create temp table result_nodemo_same_52 (ok boolean, status_before text, status_after text, err_sqlstate text);
do $$
declare
  v_before text; v_after text;
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, description, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000527011', '00000000-0000-0000-0000-000000527001',
     '00000000-0000-0000-0000-000000527003', 'Ad NoDemo Same 5.4', 'external_url', 'https://ejemplo.mx/nodemo54',
     'active', 'Frase idéntica antes y después',
     (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000527011';
  update public.ads set description = 'Frase idéntica antes y después'
   where id = '00000000-0000-0000-0000-000000527011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000527011';
  insert into result_nodemo_same_52 values (true, v_before, v_after, null);
exception when others then
  insert into result_nodemo_same_52 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nodemo_same_52), true,
  'NODEMO_SAME1_reescribir_la_MISMA_descripcion_no_lanza_excepcion');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_nodemo_same_52),
  'active->active',
  'NODEMO_SAME2_reescribir_la_MISMA_descripcion_IS_DISTINCT_FROM_falso_no_demueve_el_ad'
);

-- ── 5.5) UPDATE que no toca description (solo title) -- YA pasa hoy, ─────
--        guardarraíl (no depende de la columna nueva).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000528002', 'owner_nodemo_notouch_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000528001', 'Inmobiliaria NoDemo NoTouch 52', 'inmo-nodemonotouch-52', 'active',
   '00000000-0000-0000-0000-000000528002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000528003', '00000000-0000-0000-0000-000000528001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000528011', '00000000-0000-0000-0000-000000528001',
   '00000000-0000-0000-0000-000000528003', 'Ad NoDemo NoTouch 5.5', 'external_url', 'https://ejemplo.mx/nodemo55',
   'active', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

create temp table result_nodemo_notouch_52 (ok boolean, status_before text, status_after text, err_sqlstate text);
do $$
declare
  v_before text; v_after text;
begin
  select status::text into v_before from public.ads where id = '00000000-0000-0000-0000-000000528011';
  update public.ads set title = 'Ad NoDemo NoTouch 5.5 (editado)'
   where id = '00000000-0000-0000-0000-000000528011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000528011';
  insert into result_nodemo_notouch_52 values (true, v_before, v_after, null);
exception when others then
  insert into result_nodemo_notouch_52 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nodemo_notouch_52), true,
  'NODEMO_NOTOUCH1_un_UPDATE_que_no_toca_description_no_lanza_excepcion');
select is(
  (select coalesce(status_before,'NULL') || '->' || coalesce(status_after,'NULL') from result_nodemo_notouch_52),
  'active->active',
  'NODEMO_NOTOUCH2_un_UPDATE_que_no_toca_description_no_demueve_el_ad'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Cambio simultáneo de status y descripción — un admin que hace
--    active->paused Y edita la descripción en el MISMO UPDATE conserva
--    'paused' (la cláusula new.status=old.status del WHEN de
--    ads_description_review protege la intención del admin: el trigger de
--    descripción NO puede pisarla).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000529002', 'owner_simul_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000529001', 'Inmobiliaria Simul Desc 52', 'inmo-simuldesc-52', 'active',
   '00000000-0000-0000-0000-000000529002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000529003', '00000000-0000-0000-0000-000000529001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000529011', '00000000-0000-0000-0000-000000529001',
   '00000000-0000-0000-0000-000000529003', 'Ad Simul Desc 6', 'external_url', 'https://ejemplo.mx/simul6',
   'active', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000520001', true);

create temp table result_simul_52 (ok boolean, status_after text, err_sqlstate text);
do $$
declare
  v_after text;
begin
  update public.ads
     set status = 'paused', description = 'Pausado por el admin con nueva descripción'
   where id = '00000000-0000-0000-0000-000000529011';
  select status::text into v_after from public.ads where id = '00000000-0000-0000-0000-000000529011';
  insert into result_simul_52 values (true, v_after, null);
exception when others then
  insert into result_simul_52 values (false, null, sqlstate);
end $$;

select is((select ok from result_simul_52), true,
  'SIMUL1_active_a_paused_con_descripcion_editada_en_el_mismo_UPDATE_no_lanza_excepcion');
select is((select status_after from result_simul_52), 'paused',
  'SIMUL2_el_ad_queda_en_paused_no_en_pending_review_el_trigger_de_descripcion_no_pisa_la_intencion_del_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) La matriz sigue apretada (regresión — YA pasa hoy contra
--    20260816000006_ads_state_machine.sql, guardarraíl para que el GREEN de
--    esta subtarea no la afloje).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 7.1) active -> pending_review SIN cambio de descripción sigue fallando ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000530002', 'owner_matriz_apretada_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000530001', 'Inmobiliaria Matriz Apretada 52', 'inmo-matrizapretada-52', 'active',
   '00000000-0000-0000-0000-000000530002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000530003', '00000000-0000-0000-0000-000000530001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530011', '00000000-0000-0000-0000-000000530001',
   '00000000-0000-0000-0000-000000530003', 'Ad Matriz Apretada 7.1', 'external_url', 'https://ejemplo.mx/matriz71',
   'active', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000520001', true);
select throws_ok(
  $$ update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000530011' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'MATRIZ1_active_a_pending_review_SIN_cambio_de_descripcion_sigue_fallando_solo_es_valida_como_transicion_de_sistema'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000530011'),
  'active',
  'MATRIZ2_tras_el_intento_bloqueado_el_ad_sigue_en_active'
);

-- ── 7.2) draft -> active DIRECTO sigue fallando ─────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530012', '00000000-0000-0000-0000-000000530001',
   '00000000-0000-0000-0000-000000530003', 'Ad Matriz Apretada 7.2', 'external_url', 'https://ejemplo.mx/matriz72',
   'draft', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000530012' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'MATRIZ3_draft_a_active_DIRECTO_sigue_fallando'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000530012'),
  'draft',
  'MATRIZ4_tras_el_intento_bloqueado_el_ad_sigue_en_draft'
);

-- ── 7.3) rejected sigue siendo TERMINAL ─────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530013', '00000000-0000-0000-0000-000000530001',
   '00000000-0000-0000-0000-000000530003', 'Ad Matriz Apretada 7.3', 'external_url', 'https://ejemplo.mx/matriz73',
   'rejected', 'motivo original', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select throws_ok(
  $$ update public.ads set status = 'pending_review', rejection_reason = null
      where id = '00000000-0000-0000-0000-000000530013' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'MATRIZ5_rejected_sigue_siendo_terminal_no_se_reabre_hacia_pending_review'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000530013'),
  'rejected',
  'MATRIZ6_tras_el_intento_bloqueado_el_ad_sigue_en_rejected'
);

-- ── 7.4) expired sigue siendo TERMINAL ──────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000530014', '00000000-0000-0000-0000-000000530001',
   '00000000-0000-0000-0000-000000530003', 'Ad Matriz Apretada 7.4', 'external_url', 'https://ejemplo.mx/matriz74',
   'expired', (select v_now - interval '60 days' from test_now_52), (select v_now - interval '30 days' from test_now_52));

select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000530014' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'MATRIZ7_expired_sigue_siendo_terminal_no_se_reabre_hacia_active'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000530014'),
  'expired',
  'MATRIZ8_tras_el_intento_bloqueado_el_ad_sigue_en_expired'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) No regresión de la ruta de admin (YA pasa hoy) — pending_review->active
--    sigue exigiendo admin y sigue auditando en admin_actions en la MISMA
--    transacción; ORGANIZATION_SUSPENDED sigue disparando.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 8.1) pending_review -> active SIN admin identificado sigue fallando ────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000531002', 'owner_adminruta_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000531001', 'Inmobiliaria Admin Ruta 52', 'inmo-adminruta-52', 'active',
   '00000000-0000-0000-0000-000000531002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000531003', '00000000-0000-0000-0000-000000531001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000531011', '00000000-0000-0000-0000-000000531001',
   '00000000-0000-0000-0000-000000531003', 'Ad Admin Ruta 8.1', 'external_url', 'https://ejemplo.mx/adminruta81',
   'pending_review', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select set_config('urbea.admin_actor_id', '', true);
select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000531011' $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN',
  'ADMINRUTA1_pending_review_a_active_SIN_admin_identificado_sigue_fallando_no_se_afloja_por_esta_subtarea'
);
reset role;
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000531011'),
  'pending_review',
  'ADMINRUTA2_tras_el_intento_bloqueado_el_ad_sigue_en_pending_review'
);

-- ── 8.2) pending_review -> active CON admin sigue funcionando y auditando ──
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000531012', '00000000-0000-0000-0000-000000531001',
   '00000000-0000-0000-0000-000000531003', 'Ad Admin Ruta 8.2', 'external_url', 'https://ejemplo.mx/adminruta82',
   'pending_review', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000520001', true);
select lives_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000531012' $$,
  'ADMINRUTA3_pending_review_a_active_CON_admin_identificado_sigue_funcionando'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000531012'),
  1,
  'ADMINRUTA4_sigue_auditando_EXACTAMENTE_una_fila_en_admin_actions_en_la_misma_transaccion'
);

-- ── 8.3) ORGANIZATION_SUSPENDED sigue disparando ────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000532002', 'owner_orgsuspend_52@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000532001', 'Inmobiliaria Org Suspend 52', 'inmo-orgsuspend-52', 'suspended',
   '00000000-0000-0000-0000-000000532002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000532003', '00000000-0000-0000-0000-000000532001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000532011', '00000000-0000-0000-0000-000000532001',
   '00000000-0000-0000-0000-000000532003', 'Ad Org Suspend 8.3', 'external_url', 'https://ejemplo.mx/orgsuspend83',
   'pending_review', (select v_now from test_now_52), (select v_now + interval '30 days' from test_now_52));

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000520001', true);
select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000532011' $$,
  'P0001', 'ORGANIZATION_SUSPENDED',
  'ADMINRUTA5_ORGANIZATION_SUSPENDED_sigue_disparando_no_se_afloja_por_esta_subtarea'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000532011'),
  'pending_review',
  'ADMINRUTA6_tras_el_intento_bloqueado_el_ad_sigue_en_pending_review'
);

select * from finish();
rollback;

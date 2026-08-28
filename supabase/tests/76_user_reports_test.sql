-- Tests pgTAP — reporte de PERFIL de publicador, alcance mínimo (subtarea
-- #220.6 "Reporte de perfil de publicador (alcance mínimo) + enmienda PRD
-- §24.2", tarea 220 "reportes de usuarios", exploración 041-M3).
-- Ejecutar con: supabase test db supabase/tests/76_user_reports_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste) — el superusuario bypassa RLS para
-- los fixtures; las aserciones de RLS impersonan con pg_temp.act_as(uid, role)
-- (mismo patrón que 02/08/18/21/25/27/28/30/73_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: INSERT/SELECT directos del cliente sobre public.user_reports
-- (vía impersonación JWT) + los 2 CHECK constraints + el índice único de
-- dedupe + las RLS policies (insert propio / select propio+admin). Mismo
-- mecanismo de creación que property_reports (220.5: sin Edge Function, INSERT
-- directo) — decisión 2026-08-28 extendida a perfiles.
--
-- SUT (AÚN NO EXISTE — RED): tabla public.user_reports completa. A diferencia
-- de property_reports (que YA existía desde la migración 0007 y solo le
-- faltaba el CHECK de 220.1), esta tabla es NUEVA — la trae el STUB
-- 20260828000005_user_reports_stub.sql (columnas/tipos/FK/índice por target/
-- trigger set_updated_at, RLS ENABLED sin policies) SOLO para que la tabla
-- exista con la forma correcta y estos INSERT/SELECT no aborten por catálogo
-- (42P01/42703). El STUB deja fuera a propósito, porque SON las invariantes
-- nuevas bajo prueba en este archivo:
--   - CHECK user_reports_other_requires_text (mismo patrón que
--     property_reports_other_requires_text, 20260828000001: `reason <>
--     'other' or (reason_text is not null and reason_text ~ '\S')` — la clase
--     regex \S, NUNCA trim(), porque trim() en Postgres solo recorta el
--     espacio ASCII y deja pasar tabuladores/saltos de línea, hallazgo 220.1).
--   - CHECK user_reports_no_self_report (`reported_user_id <> reported_by_user_id`)
--     — invariante NUEVA sin equivalente en property_reports (una propiedad no
--     tiene identidad de usuario comparable 1:1 con auth.uid(); un perfil sí).
--   - Índice único user_reports_one_per_user (reported_user_id, reported_by_user_id).
--   - Policies user_reports_insert (with check reported_by_user_id = auth.uid())
--     y user_reports_select (using reported_by_user_id = auth.uid() or is_admin()).
--     SIN policies de update/delete: alcance mínimo (sin cola de acciones ni
--     auto-suspensión de cuentas, decisión Abraham 2026-08-28 — §28.3-4 es
--     tarea futura si hay volumen real).
--
-- ── Decisión: se REUSA el enum property_report_reason (NO se crea un gemelo) ──
-- Documentado en la cabecera del STUB (20260828000005). Los 7 valores existen
-- ya (0001_extensions_and_enums.sql); crear un ENUM idéntico en valores para
-- "perfiles" sería duplicación de esquema. Los labels en español del sheet
-- móvil SÍ pueden diferir por target (capa de presentación) sin tocar el enum.
--
-- ── Estrategia RED con migración-stub (igual criterio que 220.3) ────────────
-- La tabla es 100% nueva, así que prácticamente toda la suite ancla
-- comportamiento nuevo. Las secciones 1/2/4/9 (enum/defaults/reason_text
-- opcional/FK) SON estructurales — el STUB ya las deja correctas, así que
-- pasan HOY (INVARIANTE, sin que eso signifique "preexistente" como en
-- property_reports: es simplemente lo que el STUB mecánico ya resuelve sin
-- necesitar las 2 invariantes de negocio). Las secciones 3/5/6 (los 2 CHECK +
-- dedupe) SON las invariantes de negocio bajo prueba — fallan HOY por
-- ASERCIÓN (DELTA). La sección 7 (RLS) tiene una sutileza: con RLS ENABLED y
-- CERO policies, Postgres hace DENY-TOTAL a cualquier rol no-superusuario —
-- así que:
--   - RLS1 (el reportante SÍ puede insertar lo propio) es DELTA real: hoy
--     lanza 42501 (nadie puede nada) en vez de permitirlo.
--   - RLS3 (el reportante lee su propio reporte) es DELTA real: hoy ve 0 filas.
--   - RLS5 (el admin lee todo) es DELTA real: hoy ve 0 filas (ni siquiera el
--     admin tiene bypass sin una policy que lo otorgue).
--   - RLS2 (nadie inserta en nombre de otro) y RLS4 (un usuario no ve lo
--     ajeno) *COINCIDEN* con el resultado correcto HOY, pero por la razón
--     INCORRECTA (deny-total de "cero policies", no el check real por fila
--     `reported_by_user_id = auth.uid()`). El guardian DEBE re-verificar tras
--     el GREEN que siguen en verde por la razón correcta (con las policies ya
--     puestas), no por casualidad.
--
-- 🔴 EFECTO CASCADA verificado (throws_ok NO usa savepoint propio: si el
-- statement no lanza, su efecto PERSISTE dentro de la transacción — mismo
-- gotcha que 73_property_reports_create_test.sql):
--   - OTHER1/OTHER2/OTHER3/OTHER6 (sección 3) no lanzan hoy → los 4 INSERT
--     persisten filas reales (U1 -> T08/T09/T10/T11) que no existirán tras el
--     GREEN. No contaminan ningún conteo posterior porque cada assert de
--     conteo de este archivo está filtrado por el (target, reportante)
--     EXACTO que le corresponde (nunca un conteo global sin filtrar).
--   - SELF1 (sección 5) no lanza hoy → persiste una fila U1 -> U1. Tampoco
--     contamina conteos posteriores (mismo motivo).
--   - DEDUPE1b (sección 6) no lanza hoy → persiste una 2ª fila U1 -> T17. Esta
--     SÍ contamina DEDUPE3/DEDUPE4 (ambos filtran por T17), que por eso son
--     DELTA — documentado en la sección misma con el valor exacto de HOY.
--
-- ── Convención DELTA vs INVARIANTE (igual que 73_*.sql) ──────────────────────
-- DELTA      = falla HOY, debe pasar tras el GREEN por la razón correcta:
--              OTHER1/OTHER2/OTHER3/OTHER6, SELF1, DEDUPE1b/DEDUPE3/DEDUPE4,
--              RLS1/RLS3/RLS5.
-- COINCIDE   = pasa HOY pero por deny-total, no por la policy real — el
--              guardian revalida la razón tras el GREEN: RLS2, RLS4.
-- INVARIANTE = pasa HOY y seguirá pasando después, sin depender de las
--              invariantes nuevas: ENUM1-7, DEF1-4, OTHER4/OTHER5, TXT1/TXT2,
--              SELF2, DEDUPE2, ABSENCE1-3, FK1/FK2.
--
-- Verificado corriendo la suite completa contra el STUB (docker exec ... psql):
-- `# Looks like you failed 11 tests of 35` — exactamente OTHER1/OTHER2/OTHER3/
-- OTHER6, SELF1, DEDUPE1b/DEDUPE3/DEDUPE4, RLS1/RLS3/RLS5. Ninguno más, ninguno
-- menos — coincide 1:1 con la lista DELTA de arriba.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(35);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000076XXX' (subtarea
-- 220.6). U1/U2/ADMIN usan el sufijo corto (076001/076002/076003); los 20
-- "targets" (publicadores reportados, uno por caso) usan el sufijo largo
-- 0761NN para no colisionar.
--   U1     = reportante uno (bajo prueba en casi toda la suite)
--   U2     = reportante dos (dedupe cruzado + aislamiento RLS)
--   ADMIN  = rol admin (RLS select)
--   T01..T20 = publicadores reportados, uno (o pocos) por caso — evita que un
--     mismo (target, reportante) se reutilice entre secciones que no lo están
--     probando a propósito (el índice único de dedupe, aunque ausente en el
--     STUB, debe poder aplicarse sin romper el resto de la suite tras el GREEN).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000076001', 'reporter_uno_76@test.local'),
  ('00000000-0000-0000-0000-000000076002', 'reporter_dos_76@test.local'),
  ('00000000-0000-0000-0000-000000076003', 'admin_76@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000076003';

insert into auth.users (id, email)
select
  ('00000000-0000-0000-0000-0000000761' || lpad(n::text, 2, '0'))::uuid,
  'target_' || n || '_76@test.local'
from generate_series(1, 20) as n;
-- IDs resultantes (targets, publicadores reportados): 00000000-0000-0000-0000-000000076101 .. 076120

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/30/73_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) [INVARIANTE] Los 7 reasons del enum property_report_reason (reusado, ver
--    cabecera) son aceptados uno por uno. U1 reporta T01..T07 (un target por
--    reason — evita colisionar con el dedupe una vez exista tras el GREEN).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076101', '00000000-0000-0000-0000-000000076001', 'not_exist_fraud', null),
  ('00000000-0000-0000-0000-000000076102', '00000000-0000-0000-0000-000000076001', 'misleading', null),
  ('00000000-0000-0000-0000-000000076103', '00000000-0000-0000-0000-000000076001', 'false_price', null),
  ('00000000-0000-0000-0000-000000076104', '00000000-0000-0000-0000-000000076001', 'wrong_address', null),
  ('00000000-0000-0000-0000-000000076105', '00000000-0000-0000-0000-000000076001', 'inappropriate', null),
  ('00000000-0000-0000-0000-000000076106', '00000000-0000-0000-0000-000000076001', 'duplicate', null),
  ('00000000-0000-0000-0000-000000076107', '00000000-0000-0000-0000-000000076001', 'other', 'Perfil sospechoso, mismo texto en varios anuncios');

select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101'),
  'not_exist_fraud', 'ENUM1_reason_not_exist_fraud_aceptado'
);
select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076102'),
  'misleading', 'ENUM2_reason_misleading_aceptado'
);
select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076103'),
  'false_price', 'ENUM3_reason_false_price_aceptado'
);
select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076104'),
  'wrong_address', 'ENUM4_reason_wrong_address_aceptado'
);
select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076105'),
  'inappropriate', 'ENUM5_reason_inappropriate_aceptado'
);
select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076106'),
  'duplicate', 'ENUM6_reason_duplicate_aceptado'
);
select is(
  (select reason::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076107'),
  'other', 'ENUM7_reason_other_con_texto_aceptado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [INVARIANTE] Defaults: status nace 'new', reviewed_*/resolution nacen NULL.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select status::text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101'),
  'new', 'DEF1_status_nace_new'
);
select ok(
  (select reviewed_by_admin_id from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101') is null,
  'DEF2_reviewed_by_admin_id_nace_null'
);
select ok(
  (select reviewed_at from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101') is null,
  'DEF3_reviewed_at_nace_null'
);
select ok(
  (select resolution from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101') is null,
  'DEF4_resolution_nace_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [DELTA — RED] CHECK user_reports_other_requires_text: reason='other'
--    exige reason_text no vacío/no solo espacios (ninguna clase de whitespace).
--    SUT AÚN NO EXISTE: hoy estos 4 INSERT NO lanzan (throws_ok falla por "no
--    exception") y SÍ persisten (ver cascada en la cabecera). Los 2 de
--    boundary-aceptado ya pasan hoy (INVARIANTE).
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076108', '00000000-0000-0000-0000-000000076001', 'other', null) $$,
  '23514', null,
  'OTHER1_other_sin_reason_text_NULL_es_rechazado_por_el_check'
);
select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076109', '00000000-0000-0000-0000-000000076001', 'other', '') $$,
  '23514', null,
  'OTHER2_other_con_reason_text_vacio_es_rechazado_por_el_check'
);
select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076110', '00000000-0000-0000-0000-000000076001', 'other', '    ') $$,
  '23514', null,
  'OTHER3_other_con_reason_text_solo_espacios_ascii_es_rechazado_por_el_check'
);
select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076111', '00000000-0000-0000-0000-000000076001', 'other', E'\t\n\r ') $$,
  '23514', null,
  'OTHER6_other_con_reason_text_de_solo_whitespace_no_ascii_tab_nl_es_rechazado'
);

-- boundary: un solo carácter no-espacio ya cuenta como texto real.
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076112', '00000000-0000-0000-0000-000000076001', 'other', 'x');
select is(
  (select reason_text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076112'),
  'x', 'OTHER4_other_con_un_solo_caracter_no_espacio_se_acepta'
);

-- boundary: texto real con padding de espacios alrededor se acepta tal cual
-- se guardó (el CHECK usa la validación, no reescribe la columna).
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076113', '00000000-0000-0000-0000-000000076001', 'other', '  motivo real con padding  ');
select is(
  (select reason_text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076113'),
  '  motivo real con padding  ', 'OTHER5_other_con_texto_real_con_padding_se_acepta_y_no_se_reescribe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [INVARIANTE] reason <> 'other': reason_text es opcional (con y sin texto).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076114', '00000000-0000-0000-0000-000000076001', 'misleading', 'Se hace pasar por otro agente con fotos robadas');
select is(
  (select reason_text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076114'),
  'Se hace pasar por otro agente con fotos robadas', 'TXT1_reason_distinto_de_other_con_texto_se_acepta'
);

insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076115', '00000000-0000-0000-0000-000000076001', 'wrong_address', '');
select is(
  (select reason_text from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076115'),
  '', 'TXT2_reason_distinto_de_other_con_texto_vacio_tambien_se_acepta_el_check_no_aplica'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [DELTA — RED] CHECK user_reports_no_self_report: reported_user_id <>
--    reported_by_user_id. SUT AÚN NO EXISTE: hoy este INSERT NO lanza y
--    persiste una fila U1 -> U1 (ver cascada en la cabecera).
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076001', '00000000-0000-0000-0000-000000076001', 'inappropriate', null) $$,
  '23514', null,
  'SELF1_reportarse_a_si_mismo_es_rechazado_por_el_check'
);

-- boundary: dos usuarios DISTINTOS sí pueden generar un reporte normal.
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076116', '00000000-0000-0000-0000-000000076001', 'duplicate', null);
select isnt(
  (select reported_user_id from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076116'),
  (select reported_by_user_id from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076116'),
  'SELF2_reportado_y_reportante_distintos_se_acepta_boundary'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [DELTA — RED] Dedupe — user_reports_one_per_user (reported_user_id, reported_by_user_id).
-- ════════════════════════════════════════════════════════════════════════════

-- Primer reporte de U1 sobre T17 (no es, en sí, la aserción bajo prueba).
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076117', '00000000-0000-0000-0000-000000076001', 'inappropriate', null);

-- Un 2º INSERT del MISMO usuario sobre el MISMO publicador debe rechazarse.
select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076117', '00000000-0000-0000-0000-000000076001', 'misleading', null) $$,
  '23505', null,
  'DEDUPE1b_segundo_insert_del_mismo_reportante_sobre_el_mismo_publicador_es_rechazado'
);

-- [INVARIANTE] El MISMO usuario SÍ puede reportar OTRO publicador — conteo
-- filtrado a este par exacto, ajeno a la cascada de DEDUPE1b (que solo toca T17).
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076118', '00000000-0000-0000-0000-000000076001', 'duplicate', null);
select is(
  (select count(*)::int from public.user_reports
     where reported_user_id = '00000000-0000-0000-0000-000000076118' and reported_by_user_id = '00000000-0000-0000-0000-000000076001'),
  1, 'DEDUPE2_el_mismo_reportante_si_puede_reportar_otro_publicador_distinto'
);

-- [DELTA] OTRO reportante (U2) SÍ puede reportar al MISMO publicador que U1 ya
-- reportó — total esperado tras el GREEN: 2 filas (1×U1 + 1×U2). HOY: 3 filas
-- (2×U1 por la cascada de DEDUPE1b + 1×U2).
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000076117', '00000000-0000-0000-0000-000000076002', 'duplicate', null);
select is(
  (select count(*)::int from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076117'),
  2, 'DEDUPE3_otro_reportante_si_puede_reportar_al_mismo_publicador'
);

-- [DELTA] El intento de duplicado rechazado no debió dejar una 2ª fila del
-- MISMO reportante — esperado 1 tras el GREEN; HOY 2 (la cascada de DEDUPE1b).
select is(
  (select count(*)::int from public.user_reports
     where reported_user_id = '00000000-0000-0000-0000-000000076117' and reported_by_user_id = '00000000-0000-0000-0000-000000076001'),
  1, 'DEDUPE4_el_intento_de_duplicado_rechazado_no_dejo_una_segunda_fila_del_mismo_reportante'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) [DELTA/COINCIDE — RED] RLS — policies user_reports_insert/select, aún
--    sin crear (el STUB deja la tabla con RLS ENABLED y CERO policies).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 7.1 INSERT: solo con reported_by_user_id = auth.uid() ───────────────────

-- [DELTA] Hoy CUALQUIER insert impersonado se rechaza (deny-total sin
-- policies) — se espera que SÍ pueda insertar lo propio.
select pg_temp.act_as('00000000-0000-0000-0000-000000076001'); -- U1
select lives_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076119', '00000000-0000-0000-0000-000000076001', 'inappropriate', null) $$,
  'RLS1_un_usuario_autenticado_puede_insertar_con_reported_by_user_id_igual_a_si_mismo'
);
reset role;

-- [COINCIDE] Hoy también se rechaza (deny-total), pero por la razón
-- incorrecta — falta la policy real que valide reported_by_user_id = auth.uid()
-- fila a fila. El guardian debe re-verificar esto tras el GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-000000076001'); -- U1
select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076120', '00000000-0000-0000-0000-000000076002', 'inappropriate', null) $$,
  '42501', null,
  'RLS2_un_usuario_NO_puede_insertar_un_reporte_en_nombre_de_otro_usuario'
);
reset role;

-- ── 7.2 SELECT: un usuario solo lee lo propio; admin lee todo ───────────────
-- (usa el reporte de la sección 1: T01 reportado por U1, ya persistido como
-- superusuario — independiente del resultado de 7.1).

-- [DELTA] Hoy U1 tampoco ve su propio reporte (deny-total sin policy select).
select pg_temp.act_as('00000000-0000-0000-0000-000000076001'); -- U1, dueño del reporte sobre 076101
select is(
  (select count(*)::int from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101'),
  1, 'RLS3_el_reportante_ve_su_propio_reporte'
);
reset role;

-- [COINCIDE] Hoy U2 también ve 0 (deny-total), pero por la razón incorrecta —
-- el guardian debe re-verificar tras el GREEN que sigue en 0 por la policy real.
select pg_temp.act_as('00000000-0000-0000-0000-000000076002'); -- U2, NO es el reportante de 076101
select is(
  (select count(*)::int from public.user_reports where reported_user_id = '00000000-0000-0000-0000-000000076101'),
  0, 'RLS4_un_usuario_NO_ve_reportes_ajenos'
);
reset role;

-- [DELTA] El admin debe ver TODOS los reportes creados por este archivo (16
-- filas post-GREEN: 15×U1 + 1×U2, contando solo los INSERT que sobreviven al
-- GREEN — T01-T07, T12, T13, T14, T15, T16, T17(×1 U1), T18, T19, más
-- T17(×1 U2) = 15+1). Hoy ve 0 (deny-total, ni siquiera el admin tiene bypass
-- sin una policy que lo otorgue).
select pg_temp.act_as('00000000-0000-0000-0000-000000076003', 'authenticated'); -- ADMIN
select is(
  (select count(*)::int from public.user_reports
     where reported_by_user_id in ('00000000-0000-0000-0000-000000076001', '00000000-0000-0000-0000-000000076002')),
  16, 'RLS5_un_admin_ve_todos_los_reportes_del_archivo_16_filas_post_green'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) [INVARIANTE — ancla de AUSENCIA] Alcance mínimo: SIN cola de acciones ni
--    auto-suspensión de cuentas (§28.3-4 es tarea futura). Reportar 3 veces al
--    MISMO publicador (T17 acumula reportes en la sección 6) no cambia NADA de
--    su fila en public.users, ni escribe admin_actions, ni notifications.
--    Verdadero HOY y debe seguir siendo verdadero tras el GREEN — el alcance
--    de 220.6 deliberadamente NO incluye ese trigger.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select row(role, deleted_at)::text from public.users where id = '00000000-0000-0000-0000-000000076117'),
  (select row('user'::user_role, null::timestamptz)::text),
  'ABSENCE1_el_publicador_reportado_repetidamente_no_cambia_de_role_ni_se_marca_borrado'
);
select is(
  (select count(*)::int from public.admin_actions
     where entity_id in (
       '00000000-0000-0000-0000-000000076101', '00000000-0000-0000-0000-000000076117',
       '00000000-0000-0000-0000-000000076001', '00000000-0000-0000-0000-000000076002'
     )),
  0, 'ABSENCE2_cero_filas_nuevas_en_admin_actions_para_los_publicadores_reportados_de_este_archivo'
);
select is(
  (select count(*)::int from public.notifications
     where related_entity_id in (
       '00000000-0000-0000-0000-000000076101', '00000000-0000-0000-0000-000000076117'
     )),
  0, 'ABSENCE3_cero_notificaciones_generadas_reportar_un_perfil_no_dispara_ningun_aviso_alcance_minimo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) [INVARIANTE] FK: reported_user_id / reported_by_user_id inexistentes se rechazan.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076999', '00000000-0000-0000-0000-000000076001', 'misleading', null) $$,
  '23503', null,
  'FK1_reportar_un_reported_user_id_inexistente_es_rechazado_por_la_fk'
);
select throws_ok(
  $$ insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000076101', '00000000-0000-0000-0000-000000076998', 'misleading', null) $$,
  '23503', null,
  'FK2_reportar_con_un_reported_by_user_id_inexistente_es_rechazado_por_la_fk'
);

select * from finish();
rollback;

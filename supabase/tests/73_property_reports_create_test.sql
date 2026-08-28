-- Tests pgTAP — creación de reportes de propiedad (subtarea #220.1 "Backend:
-- creación de reporte — CHECK other + probes RLS/dedupe").
-- Ejecutar con: supabase test db supabase/tests/73_property_reports_create_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste) — el superusuario bypassa RLS para
-- los fixtures; las aserciones de RLS impersonan con pg_temp.act_as(uid, role)
-- (mismo patrón que 02/08/18/21/25/27/28/30_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: INSERT/SELECT/UPDATE/DELETE directos del cliente sobre
-- public.property_reports (vía impersonación JWT) + el CHECK constraint
-- aditivo. NO hay Edge Function nueva (decisión Abraham 2026-08-28) — la vía
-- de creación es INSERT directo, así que el contrato completo se ancla en SQL.
--
-- SUT (AÚN NO EXISTE — RED): CHECK constraint
-- property_reports_other_requires_text ("reason = 'other' exige reason_text
-- no vacío/no solo espacios"), calco de property_closed_requires_reason
-- (20260604000005) / property_videos_ready_requires_storage (20260604000012).
-- La tabla, el índice único de dedupe (property_reports_one_per_user) y las
-- 4 policies RLS (reports_select/insert/update/delete, 20260604000010:349-361)
-- YA EXISTEN — este archivo también las ancla por primera vez (hoy sin test).
--
-- ── Estrategia RED sin migración-stub ────────────────────────────────────────
-- No hay objeto inexistente que referenciar (tabla/policies/índice ya viven en
-- 0007/0010). Insertar reason='other' sin texto HOY simplemente NO lanza (el
-- CHECK no existe todavía) — las 3 aserciones OTHER1/OTHER2/OTHER3 (throws_ok
-- 23514) fallan LIMPIO por assert (pgTAP reporta "no exception thrown"), nunca
-- por error de sintaxis/catálogo. El resto de la suite (enum, defaults,
-- dedupe, RLS, FK) ya pasa HOY — es deliberado: son las policies/índice/enum
-- preexistentes que hoy no tenían ni un solo test.
--
-- 🔴 EFECTO CASCADA (verificado corriendo la suite): como OTHER1/OTHER2/OTHER3
-- NO lanzan hoy, el INSERT que intentan SÍ se ejecuta y SÍ persiste dentro de
-- la transacción (pgTAP throws_ok no usa un savepoint propio — si no hay
-- excepción, el efecto queda). Eso agrega 3 filas reales a property_reports
-- (usuario U1) que no existirán tras el GREEN. Dos aserciones de conteo
-- ABSOLUTO río abajo heredan esa contaminación y por eso TAMBIÉN fallan hoy
-- (DEDUPE2: 15 en vez de 12; RLS5: 17 en vez de 14) — no son bugs del test,
-- son DELTA indirecto del mismo CHECK inexistente y se corrigen solos en
-- cuanto el CHECK exista (las 3 filas espurias dejan de crearse). Verificado:
-- `select plan(33)` corre HOY con "Looks like you failed 5 tests of 33"
-- (OTHER1, OTHER2, OTHER3, DEDUPE2, RLS5) — exactamente estos 5, ninguno más.
--
-- ── Convención DELTA vs INVARIANTE ────────────────────────────────────────────
-- DELTA      = falla HOY (OTHER1/OTHER2/OTHER3 directo + DEDUPE2/RLS5
--              indirecto por la cascada de arriba) y debe pasar tras el
--              GREEN, con DEDUPE2/RLS5 pasando por la razón correcta (0 filas
--              espurias, no por casualidad numérica).
-- INVARIANTE = ya pasa HOY por ser comportamiento preexistente sin test
--              (enum, defaults, el resto de dedupe, RLS de 20260604000010,
--              FK) — el guardian debe re-verificar tras GREEN que sigue en
--              verde por la razón correcta y que el CHECK nuevo no rompió
--              ninguna.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(33);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000073XXX' (subtarea
-- 220.1, sin colisión con otros archivos pgTAP — cada uno corre en su propia
-- transacción revertida de todas formas).
--   U1 = reportante uno (bajo prueba en la mayoría de las secciones)
--   U2 = reportante dos (dedupe cruzado + aislamiento RLS)
--   OWNER  = dueño de las propiedades reportadas (rol 'user' por defecto, sin relevancia para el reporte)
--   ADMIN  = rol admin (RLS select/update/delete)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000073001', 'reporter_uno_73@test.local'),
  ('00000000-0000-0000-0000-000000073002', 'reporter_dos_73@test.local'),
  ('00000000-0000-0000-0000-000000073003', 'owner_73@test.local'),
  ('00000000-0000-0000-0000-000000073004', 'admin_73@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000073004';

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/30_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- 12 propiedades del OWNER, una por caso — evita colisionar con el índice
-- único de dedupe entre secciones que no lo están probando a propósito.
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
select
  ('00000000-0000-0000-0000-0000000731' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000073003',
  'rent', 'departamento', 9000, 'Calle Reportes 73 #' || n,
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'active'
from generate_series(1, 16) as n;
-- IDs resultantes: 00000000-0000-0000-0000-000000073101 .. 073116

-- ════════════════════════════════════════════════════════════════════════════
-- 1) [INVARIANTE] Los 7 reasons del enum son aceptados uno por uno.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073101', '00000000-0000-0000-0000-000000073001', 'not_exist_fraud', null),
  ('00000000-0000-0000-0000-000000073102', '00000000-0000-0000-0000-000000073001', 'misleading', null),
  ('00000000-0000-0000-0000-000000073103', '00000000-0000-0000-0000-000000073001', 'false_price', null),
  ('00000000-0000-0000-0000-000000073104', '00000000-0000-0000-0000-000000073001', 'wrong_address', null),
  ('00000000-0000-0000-0000-000000073105', '00000000-0000-0000-0000-000000073001', 'inappropriate', null),
  ('00000000-0000-0000-0000-000000073106', '00000000-0000-0000-0000-000000073001', 'duplicate', null),
  ('00000000-0000-0000-0000-000000073107', '00000000-0000-0000-0000-000000073001', 'other', 'Reporte con motivo personalizado real');

select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101'),
  'not_exist_fraud', 'ENUM1_reason_not_exist_fraud_aceptado'
);
select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073102'),
  'misleading', 'ENUM2_reason_misleading_aceptado'
);
select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073103'),
  'false_price', 'ENUM3_reason_false_price_aceptado'
);
select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073104'),
  'wrong_address', 'ENUM4_reason_wrong_address_aceptado'
);
select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073105'),
  'inappropriate', 'ENUM5_reason_inappropriate_aceptado'
);
select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073106'),
  'duplicate', 'ENUM6_reason_duplicate_aceptado'
);
select is(
  (select reason::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073107'),
  'other', 'ENUM7_reason_other_con_texto_aceptado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [INVARIANTE] Defaults: status nace 'new', reviewed_*/resolution nacen NULL.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select status::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101'),
  'new', 'DEF1_status_nace_new'
);
select ok(
  (select reviewed_by_admin_id from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101') is null,
  'DEF2_reviewed_by_admin_id_nace_null'
);
select ok(
  (select reviewed_at from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101') is null,
  'DEF3_reviewed_at_nace_null'
);
select ok(
  (select resolution from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101') is null,
  'DEF4_resolution_nace_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [DELTA — RED] CHECK property_reports_other_requires_text: reason='other'
--    exige reason_text no vacío/no solo espacios. SUT AÚN NO EXISTE: hoy estos
--    3 INSERT NO lanzan (throws_ok falla por "no exception"), y las 2 de
--    boundary-aceptado ya pasan hoy (INVARIANTE).
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073108', '00000000-0000-0000-0000-000000073001', 'other', null) $$,
  '23514', null,
  'OTHER1_other_sin_reason_text_NULL_es_rechazado_por_el_check'
);
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073109', '00000000-0000-0000-0000-000000073001', 'other', '') $$,
  '23514', null,
  'OTHER2_other_con_reason_text_vacio_es_rechazado_por_el_check'
);
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073110', '00000000-0000-0000-0000-000000073001', 'other', '    ') $$,
  '23514', null,
  'OTHER3_other_con_reason_text_solo_espacios_es_rechazado_por_el_check'
);

-- boundary: un solo carácter no-espacio ya cuenta como texto real.
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073111', '00000000-0000-0000-0000-000000073001', 'other', 'x');
select is(
  (select reason_text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073111'),
  'x', 'OTHER4_other_con_un_solo_caracter_no_espacio_se_acepta'
);

-- boundary: texto real con padding de espacios alrededor se acepta tal cual
-- se guardó (el CHECK usa trim() para VALIDAR, no para reescribir la columna).
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073112', '00000000-0000-0000-0000-000000073001', 'other', '  motivo real con padding  ');
select is(
  (select reason_text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073112'),
  '  motivo real con padding  ', 'OTHER5_other_con_texto_real_con_padding_se_acepta_y_no_se_reescribe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [INVARIANTE] reason <> 'other': reason_text es opcional (con y sin texto).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073113', '00000000-0000-0000-0000-000000073001', 'misleading', 'Precio inflado a propósito, comprobante adjunto');
select is(
  (select reason_text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073113'),
  'Precio inflado a propósito, comprobante adjunto', 'TXT1_reason_distinto_de_other_con_texto_se_acepta'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073114', '00000000-0000-0000-0000-000000073001', 'wrong_address', '');
select is(
  (select reason_text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073114'),
  '', 'TXT2_reason_distinto_de_other_con_texto_vacio_tambien_se_acepta_el_check_no_aplica'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [INVARIANTE] Dedupe — property_reports_one_per_user (property_id, reported_by_user_id).
-- ════════════════════════════════════════════════════════════════════════════

-- U1 ya reportó 073106 en la sección 1 (reason=duplicate) — un 2º INSERT del
-- MISMO usuario sobre la MISMA propiedad debe rechazarse.
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073106', '00000000-0000-0000-0000-000000073001', 'misleading', null) $$,
  '23505', null,
  'DEDUPE1_segundo_insert_del_mismo_usuario_sobre_la_misma_propiedad_es_rechazado'
);

-- El MISMO usuario SÍ puede reportar OTRA propiedad.
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073115', '00000000-0000-0000-0000-000000073001', 'duplicate', null);
select is(
  (select count(*)::int from public.property_reports where reported_by_user_id = '00000000-0000-0000-0000-000000073001'),
  12, 'DEDUPE2_el_mismo_usuario_si_puede_reportar_otra_propiedad_distinta'
);

-- OTRO usuario (U2) SÍ puede reportar la MISMA propiedad que U1 ya reportó.
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000073106', '00000000-0000-0000-0000-000000073002', 'duplicate', null);
select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000073106'),
  2, 'DEDUPE3_otro_usuario_si_puede_reportar_la_misma_propiedad'
);
select is(
  (select count(*)::int from public.property_reports
     where property_id = '00000000-0000-0000-0000-000000073106' and reported_by_user_id = '00000000-0000-0000-0000-000000073001'),
  1, 'DEDUPE4_el_intento_de_duplicado_rechazado_no_dejo_una_segunda_fila_del_mismo_usuario'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [INVARIANTE] RLS — policies reports_insert/select/update/delete
--    (20260604000010:349-361), sin ni un solo test hasta ahora.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 6.1 INSERT: solo con reported_by_user_id = auth.uid() ───────────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000073001'); -- U1
select lives_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073116', '00000000-0000-0000-0000-000000073001', 'inappropriate', null) $$,
  'RLS1_un_usuario_autenticado_puede_insertar_con_reported_by_user_id_igual_a_si_mismo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000073001'); -- U1
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073113', '00000000-0000-0000-0000-000000073002', 'inappropriate', null) $$,
  '42501', null,
  'RLS2_un_usuario_NO_puede_insertar_un_reporte_en_nombre_de_otro_usuario'
);
reset role;

-- ── 6.2 SELECT: un usuario solo lee lo propio; admin lee todo ───────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000073001'); -- U1, dueño del reporte sobre 073101
select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101'),
  1, 'RLS3_el_reportante_ve_su_propio_reporte'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000073002'); -- U2, NO es el reportante de 073101
select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101'),
  0, 'RLS4_un_usuario_NO_ve_reportes_ajenos'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000073004', 'authenticated'); -- ADMIN
select is(
  (select count(*)::int from public.property_reports),
  14, 'RLS5_un_admin_ve_todos_los_reportes_14_filas_creadas_hasta_este_punto'
);
reset role;

-- ── 6.3 UPDATE: solo admin (reports_update = private.is_admin() en using Y check) ──
select pg_temp.act_as('00000000-0000-0000-0000-000000073001'); -- U1, dueño del reporte sobre 073101
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    update public.property_reports set status = 'reviewing' where property_id = '00000000-0000-0000-0000-000000073101';
    get diagnostics v_count = row_count;
    if v_count is distinct from 0 then
      raise exception 'un usuario NO admin no debe poder actualizar ni su propio reporte; filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS6_el_reportante_NO_puede_actualizar_su_propio_reporte_solo_admin'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000073004', 'authenticated'); -- ADMIN
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    update public.property_reports set status = 'reviewing', reviewed_by_admin_id = '00000000-0000-0000-0000-000000073004'
      where property_id = '00000000-0000-0000-0000-000000073101';
    get diagnostics v_count = row_count;
    if v_count is distinct from 1 then
      raise exception 'el admin debe poder actualizar cualquier reporte; filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS7_el_admin_si_puede_actualizar_cualquier_reporte'
);
reset role;
select is(
  (select status::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000073101'),
  'reviewing', 'RLS8_el_update_del_admin_persistio_el_nuevo_status'
);

-- ── 6.4 DELETE: solo admin (reports_delete = private.is_admin()) ────────────
select pg_temp.act_as('00000000-0000-0000-0000-000000073001'); -- U1, dueño del reporte sobre 073102
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    delete from public.property_reports where property_id = '00000000-0000-0000-0000-000000073102';
    get diagnostics v_count = row_count;
    if v_count is distinct from 0 then
      raise exception 'un usuario NO admin no debe poder borrar ni su propio reporte; filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS9_el_reportante_NO_puede_borrar_su_propio_reporte_solo_admin'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000073004', 'authenticated'); -- ADMIN
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    delete from public.property_reports where property_id = '00000000-0000-0000-0000-000000073102';
    get diagnostics v_count = row_count;
    if v_count is distinct from 1 then
      raise exception 'el admin debe poder borrar cualquier reporte; filas afectadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS10_el_admin_si_puede_borrar_cualquier_reporte'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) [INVARIANTE] FK: property_id inexistente es rechazado.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000073999', '00000000-0000-0000-0000-000000073001', 'misleading', null) $$,
  '23503', null,
  'FK1_reportar_una_property_id_inexistente_es_rechazado_por_la_fk'
);

select * from finish();
rollback;

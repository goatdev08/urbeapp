-- Tests pgTAP — public.resolve_agency_registration (subtarea #221.2 ampliada,
-- tarea 221 "cola de solicitudes", exploración 041-M4).
-- Ejecutar con: supabase test db supabase/tests/84_resolve_agency_registration_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO QUE CIERRA (hallazgo de la investigación 221.2, verificado con
-- sonda contra el stack local): el tercer carril de la cola M4 —los REGISTROS
-- DE INMOBILIARIA en 'pending_approval'— NO tenía NINGUNA puerta para el admin:
--   (a) UPDATE directo con JWT de admin -> 42501 "permission denied for table
--       agencies": agencies.status está FUERA del grant de columna de 0008
--       (`grant update (name, slug, logo_url, contact_name, contact_phone,
--       contact_email, deleted_at) ... to authenticated`) — decisión D3 de
--       71.5, "la aprobación de agencias solo por Studio".
--   (b) La EF suspend-agency (#211.1) solo expone suspend|reactivate y su RPC
--       set_agency_status_atomic rechaza cualquier next_status que no sea
--       active|suspended (INVALID_NEXT_STATUS): aprobar solo se colaría como
--       "reactivate" (semántica equivocada) y RECHAZAR no tenía camino alguno.
-- El trigger handle_agency_status_change (71.5, extendido en 169.2/210.1 y
-- #219.2) ya implementa TODA la resolución. Lo que faltaba era la puerta.
--
-- SEAM bajo prueba: public.resolve_agency_registration(p_agency_id uuid,
-- p_approve boolean, p_reason text default null) llamada con el JWT del admin
-- (el camino real de la cola #221.4), y sus efectos observables en agencies,
-- agency_members, users, admin_actions y notifications.
--
-- SUT: supabase/migrations/20260902100003_resolve_agency_registration.sql.
-- RED: la función NO existe -> cada llamada va envuelta en throws_ok/lives_ok
-- (que capturan la excepción en su propia subtransacción), así que la suite
-- corre completa sin abortar; los asserts de efecto fallan por valor. NO hace
-- falta migración-stub aquí (a diferencia de 79_*: allí el SUT incluía una
-- TABLA, y sin tabla los INSERT de fixture fuera de un assert abortaban).
--
-- ── DECISIONES DE CONTRATO que este archivo FIJA ────────────────────────────
-- D-GATE    Wrapper delgado, igual que resolve_agent_application: la RPC valida
--           al actor (private.resolve_admin_actor) + 3 guards de puerta y hace
--           UN update. El grafo de estados, la membresía owner, la promoción
--           de role, la denormalización de agency_id, approved_by_admin_id, la
--           auditoría y el espejo a notifications los sigue haciendo ENTERO el
--           trigger. Cero duplicación.
-- D-CODES   P0001 uniformes con los otros dos carriles: AGENCY_NOT_FOUND
--           (inexistente O soft-deleted — mismo criterio compuesto que
--           set_org_advertising_atomic), ALREADY_RESOLVED (status <>
--           'pending_approval': cubre active/rejected/suspended, y da el mismo
--           verbo que el INVALID_STATUS_TRANSITION del trigger),
--           REASON_REQUIRED (motivo con contenido real, `~ '\S'`),
--           STATUS_CHANGE_REQUIRES_ADMIN (del helper, sin admin identificado).
-- D-REASON  🔴 agencies NO tiene columna de motivo de rechazo y esta migración
--           NO cambia el esquema (instrucción del orquestador). El motivo viaja
--           en la AUDITORÍA: una fila EXTRA en admin_actions con action_type
--           'reject_agency_registration' y reason = p_reason, ADEMÁS de la fila
--           'reject_agency' que escribe el trigger (esa es la del cambio de
--           estado y no admite reason). Solo en la rama de rechazo: aprobar no
--           tiene motivo que guardar, así que no se escribe fila extra.
--           LIMITACIÓN CONOCIDA anclada abajo (REJ5): el espejo
--           'agency_rejected' de #219.2 NO lleva el motivo — el owner ve "fue
--           rechazada" sin el porqué. Cerrarlo exige agencies.rejection_reason
--           (cambio de esquema) o tocar el trigger; se reporta, no se hace aquí.
--
-- Verificado en el RED (la función aún no existía):
--   Failed 23/27 subtests · Failed tests: 1-2, 4-8, 10-24, 26
-- Los 4 que YA pasaban (ADM3, NF3, REJ5, SELF1) son COINCIDE, no invariantes:
-- pasan porque NADA ocurrió (la agencia sigue pending_approval, no hay espejo
-- que pueda traer motivo, el admin no recibió aviso). El guardian debe
-- revalidar que siguen verdes tras el GREEN por la razón CORRECTA.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(27);

-- Fixtures — prefijo '00000000-0000-0000-0000-000000084XXX'.
--   ADMIN(084001)        admin de plataforma.
--   CREATOR1(084002)     creó AG1 -> APROBACIÓN.
--   CREATOR2(084003)     creó AG2 -> RECHAZO.
--   CREATOR3(084004)     creó AG3, ya 'active' -> ALREADY_RESOLVED.
--   CREATOR4(084005)     creó AG4, soft-deleted -> AGENCY_NOT_FOUND.
--   OUTSIDER(084006)     no admin.
--   ADMINCREATOR(084007) admin que creó AG5 -> guard SELF del espejo.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000084001', 'admin_84@test.local'),
  ('00000000-0000-0000-0000-000000084002', 'creator1_84@test.local'),
  ('00000000-0000-0000-0000-000000084003', 'creator2_84@test.local'),
  ('00000000-0000-0000-0000-000000084004', 'creator3_84@test.local'),
  ('00000000-0000-0000-0000-000000084005', 'creator4_84@test.local'),
  ('00000000-0000-0000-0000-000000084006', 'outsider_84@test.local'),
  ('00000000-0000-0000-0000-000000084007', 'admincreator_84@test.local');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000084001',
              '00000000-0000-0000-0000-000000084007');

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000084101', 'Agencia 84 Uno',   'agencia-84-uno',   'pending_approval', '00000000-0000-0000-0000-000000084002'),
  ('00000000-0000-0000-0000-000000084102', 'Agencia 84 Dos',   'agencia-84-dos',   'pending_approval', '00000000-0000-0000-0000-000000084003'),
  ('00000000-0000-0000-0000-000000084103', 'Agencia 84 Tres',  'agencia-84-tres',  'active',           '00000000-0000-0000-0000-000000084004'),
  ('00000000-0000-0000-0000-000000084104', 'Agencia 84 Cuatro','agencia-84-cuatro','pending_approval', '00000000-0000-0000-0000-000000084005'),
  ('00000000-0000-0000-0000-000000084105', 'Agencia 84 Cinco', 'agencia-84-cinco', 'pending_approval', '00000000-0000-0000-0000-000000084007');

update public.agencies set deleted_at = now()
 where id = '00000000-0000-0000-0000-000000084104';

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Autorización: primero QUIÉN, y sin revelar si la agencia existe.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000084006'); -- OUTSIDER
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084101', true) $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN', 'ADM1_un_no_admin_no_resuelve'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000084002'); -- el propio solicitante
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084101', true) $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN', 'ADM2_el_solicitante_no_se_aprueba_solo'
);
reset role;

select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000084101'),
  'pending_approval', 'ADM3_los_intentos_no_admin_no_movieron_nada'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Guards de entrada.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000084001'); -- ADMIN
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-0000000841ff', true) $$,
  'P0001', 'AGENCY_NOT_FOUND', 'NF1_agencia_inexistente'
);
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084104', true) $$,
  'P0001', 'AGENCY_NOT_FOUND', 'NF2_agencia_soft_deleted_no_existe_para_la_cola'
);
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084103', true) $$,
  'P0001', 'ALREADY_RESOLVED', 'STATE1_una_agencia_ya_activa_no_se_re_resuelve'
);
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084102', false) $$,
  'P0001', 'REASON_REQUIRED', 'REASON1_rechazo_sin_motivo'
);
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084102', false, E' \t\n ') $$,
  'P0001', 'REASON_REQUIRED', 'REASON2_motivo_solo_whitespace'
);
reset role;

select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000084104'),
  'pending_approval', 'NF3_la_soft_deleted_sigue_intacta'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) APROBACIÓN: la RPC hace UN update y el trigger de 71.5 aplica TODO.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000084001'); -- ADMIN
select lives_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084101', true) $$,
  'APP0_admin_aprueba_el_registro'
);
reset role;

select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000084101'),
  'active', 'APP1_agencia_activa'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-000000084101'
      and user_id   = '00000000-0000-0000-0000-000000084002'
      and member_role = 'owner' and status = 'active'),
  1, 'APP2_membresia_owner_del_creador_efecto_del_trigger'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000084002'),
  'agent', 'APP3_creador_promovido_a_agent'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000084002'),
  '00000000-0000-0000-0000-000000084101'::uuid, 'APP4_agency_id_denormalizado'
);
select is(
  (select approved_by_admin_id from public.agencies where id = '00000000-0000-0000-0000-000000084101'),
  '00000000-0000-0000-0000-000000084001'::uuid, 'APP5_approved_by_admin_id_es_el_actor_del_jwt'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'approve_agency'
      and entity_id   = '00000000-0000-0000-0000-000000084101'
      and admin_id    = '00000000-0000-0000-0000-000000084001'),
  1, 'APP6_auditoria_del_trigger'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000084101'),
  1, 'APP7_aprobar_no_escribe_fila_extra_de_auditoria'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000084002' and type = 'agency_approved'),
  1, 'APP8_espejo_al_solicitante_219_2'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000084001'); -- ADMIN, 2a vez
select throws_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084101', false, 'me arrepentí') $$,
  'P0001', 'ALREADY_RESOLVED', 'STATE2_segunda_resolucion_con_verbo_uniforme'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) RECHAZO: estado + auditoría del trigger + fila EXTRA con el motivo
--    (D-REASON), y la limitación conocida del espejo.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000084001'); -- ADMIN
select lives_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084102', false, 'Acta constitutiva ilegible') $$,
  'REJ0_admin_rechaza_con_motivo'
);
reset role;

select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000084102'),
  'rejected', 'REJ1_agencia_rechazada'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'reject_agency'
      and entity_id   = '00000000-0000-0000-0000-000000084102'),
  1, 'REJ2_auditoria_del_cambio_de_estado_la_del_trigger'
);
select is(
  (select reason from public.admin_actions
    where action_type = 'reject_agency_registration'
      and entity_id   = '00000000-0000-0000-0000-000000084102'),
  'Acta constitutiva ilegible', 'REJ3_el_motivo_queda_en_la_auditoria'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000084003' and type = 'agency_rejected'),
  1, 'REJ4_espejo_de_rechazo_al_solicitante'
);
-- [LIMITACIÓN CONOCIDA, anclada a propósito] el espejo NO lleva el motivo:
-- agencies no tiene columna para él y esta migración no cambia el esquema.
-- Si algún día se agrega agencies.rejection_reason, este assert DEBE cambiar.
select ok(
  (select data ->> 'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000084003' and type = 'agency_rejected') is null,
  'REJ5_limitacion_el_espejo_no_lleva_el_motivo_ver_D_REASON'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Guard SELF: un admin que resuelve SU PROPIO registro no se auto-notifica.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000084007'); -- ADMINCREATOR
select lives_ok(
  $$ select public.resolve_agency_registration('00000000-0000-0000-0000-000000084105', true) $$,
  'SELF0_el_admin_resuelve_su_propio_registro'
);
reset role;

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000084007' and type = 'agency_approved'),
  0, 'SELF1_el_actor_no_se_notifica_a_si_mismo'
);

select * from finish();
rollback;

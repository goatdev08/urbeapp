-- Tests pgTAP — CONTRATO ADMIN de public.agent_applications (subtarea #221.2,
-- tarea 221 "cola de solicitudes", exploración 041-M4).
-- Ejecutar con: supabase test db supabase/tests/83_agent_application_admin_contract_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- Este archivo tiene DOS mitades con naturalezas distintas:
--   secciones 1-4 = [ANCLA] del contrato que YA existía (pasan sin código nuevo).
--   sección 5     = [DELTA] la RPC public.resolve_agent_application, que SÍ es
--                   código nuevo (migración 20260902100002).
--
-- 🔴 POR QUÉ HAY UNA RPC SI EL CONTRATO YA FUNCIONABA (cambio de decisión,
-- orquestador 2026-09-01). La investigación original de 221.2 concluyó "no
-- dupliques": el UPDATE directo con JWT de admin ya dispara todo el ciclo. El
-- orquestador mantuvo el análisis pero pidió la RPC igual, por dos razones de
-- INTEGRACIÓN: (a) el agente de UI ya programó contra
-- client.rpc('resolve_agent_application', …) —contrato pinneado del carril
-- paralelo—, y (b) una puerta ÚNICA con códigos uniformes
-- (APPLICATION_NOT_FOUND / ALREADY_RESOLVED / REASON_REQUIRED, los mismos
-- verbos que resolve_advertising_request y resolve_agency_registration)
-- simplifica el cliente frente a tres formas distintas de fallar.
-- La RPC es un WRAPPER DELGADO: valida al admin y hace EL MISMO UPDATE que
-- valida la mitad ANCLA de este archivo. NO duplica ni una línea del grafo de
-- estados, la promoción de role, la auditoría ni el espejo — todo eso lo sigue
-- haciendo el trigger de 71.5/#219.2, que es la única autoridad.
--
-- El contrato admin de agent_applications YA EXISTÍA COMPLETO y funciona con el
-- JWT de un admin de plataforma — o sea, desde el panel móvil vía PostgREST, sin Edge Function ni
-- RPC nueva:
--   - policy `agent_app_update` (20260604000010:236): `using (private.is_admin())
--     with check (private.is_admin())` — el admin de plataforma SÍ puede
--     escribir la fila (a diferencia de agencies.status, que está fuera del
--     GRANT de columna a `authenticated` — ver HALLAZGO al final).
--   - trigger `handle_agent_application_status_change` (71.5, vigente en
--     20260826000001 tras #219.2): valida {pending->approved|rejected},
--     exige rejection_reason al rechazar, estampa reviewed_by_admin_id/
--     reviewed_at, promueve role SOLO si application_type='independent',
--     audita en admin_actions y escribe el espejo a notifications — TODO en la
--     misma transacción del UPDATE.
-- Ese contrato no estaba ANCLADO por ningún test: la UI de la cola (#221.4)
-- depende de él y la suite 25_admin_approvals_test.sql solo lo cubre por el
-- camino GUC/Studio, no por el JWT del admin. Los 14 asserts de las secciones
-- 1-4 son de REGRESIÓN pura (pasan sin implementación nueva): si alguien
-- endurece las policies, cambia el grafo de estados o toca el trigger, esta
-- suite lo caza antes de que la cola deje de funcionar en producción. Y como
-- la RPC de la sección 5 delega en ESE mismo camino, esas 14 anclas son
-- también la red de seguridad del wrapper.
--
-- Corre como superusuario en una transacción revertida; las aserciones del
-- camino admin impersonan con pg_temp.act_as (patrón 02/…/76/79_*).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(30);

-- Fixtures — prefijo '00000000-0000-0000-0000-000000080XXX'.
--   ADMIN(080001)      admin de plataforma (resuelve la cola).
--   INDEP(080002)      solicitante independiente -> aprobación.
--   REJECTED(080003)   solicitante independiente -> rechazo.
--   UNDERAG(080004)    solicitante bajo agencia -> aprobación SIN promoción.
--   AGCREATOR(080005)  creador de la agencia de UNDERAG.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000080001', 'admin_80@test.local'),
  ('00000000-0000-0000-0000-000000080002', 'indep_80@test.local'),
  ('00000000-0000-0000-0000-000000080003', 'rejected_80@test.local'),
  ('00000000-0000-0000-0000-000000080004', 'underag_80@test.local'),
  ('00000000-0000-0000-0000-000000080005', 'agcreator_80@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000080001';

insert into public.agencies (id, name, slug, status, created_by_user_id)
values ('00000000-0000-0000-0000-000000080201', 'Agencia 80', 'agencia-80', 'active',
        '00000000-0000-0000-0000-000000080005');

insert into public.agent_applications (id, user_id, application_type, agency_id, status) values
  ('00000000-0000-0000-0000-000000080101', '00000000-0000-0000-0000-000000080002', 'independent',  null,                                   'pending'),
  ('00000000-0000-0000-0000-000000080102', '00000000-0000-0000-0000-000000080003', 'independent',  null,                                   'pending'),
  ('00000000-0000-0000-0000-000000080103', '00000000-0000-0000-0000-000000080004', 'under_agency', '00000000-0000-0000-0000-000000080201', 'pending');

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) [ANCLA] El SOLICITANTE no resuelve lo suyo: la policy agent_app_update
--    solo deja escribir al admin, así que su UPDATE no toca NINGUNA fila
--    (sin excepción — RLS filtra, no lanza).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000080002'); -- INDEP
update public.agent_applications set status = 'approved'
 where id = '00000000-0000-0000-0000-000000080101';
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000080101'),
  'pending', 'SELF1_el_solicitante_no_se_aprueba_a_si_mismo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [ANCLA] APROBACIÓN por el admin con su propio JWT (el camino que usará la
--    cola de #221.4): estado + revisor + promoción + auditoría + aviso.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000080001'); -- ADMIN
select lives_ok(
  $$ update public.agent_applications set status = 'approved'
      where id = '00000000-0000-0000-0000-000000080101' $$,
  'APP0_el_admin_aprueba_por_update_directo_con_jwt'
);
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000080101'),
  'approved', 'APP1_status_approved'
);
select is(
  (select reviewed_by_admin_id from public.agent_applications where id = '00000000-0000-0000-0000-000000080101'),
  '00000000-0000-0000-0000-000000080001'::uuid, 'APP2_reviewed_by_es_el_admin_del_jwt'
);
select ok(
  (select reviewed_at from public.agent_applications where id = '00000000-0000-0000-0000-000000080101') is not null,
  'APP3_reviewed_at_estampado'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000080002'),
  'agent', 'APP4_independent_promueve_a_agent'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'approve_agent_application'
      and entity_id   = '00000000-0000-0000-0000-000000080101'
      and admin_id    = '00000000-0000-0000-0000-000000080001'),
  1, 'APP5_auditoria_en_admin_actions'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000080002'
      and type    = 'agent_application_approved'),
  1, 'APP6_espejo_al_solicitante_219_2'
);

-- [ANCLA] Los estados finales son inmutables (grafo del trigger, D7 de 71.5).
select pg_temp.act_as('00000000-0000-0000-0000-000000080001'); -- ADMIN
select throws_ok(
  $$ update public.agent_applications set status = 'rejected', rejection_reason = 'me arrepentí'
      where id = '00000000-0000-0000-0000-000000080101' $$,
  'P0001', 'INVALID_STATUS_TRANSITION', 'APP7_una_resuelta_no_se_re_resuelve'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [ANCLA] RECHAZO: motivo OBLIGATORIO, y con motivo escribe todo el ciclo.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000080001'); -- ADMIN
select throws_ok(
  $$ update public.agent_applications set status = 'rejected'
      where id = '00000000-0000-0000-0000-000000080102' $$,
  'P0001', 'REJECTION_REASON_REQUIRED', 'REJ1_rechazar_sin_motivo_rebota'
);
select lives_ok(
  $$ update public.agent_applications
        set status = 'rejected', rejection_reason = 'Documentación ilegible'
      where id = '00000000-0000-0000-0000-000000080102' $$,
  'REJ2_rechazo_con_motivo'
);
reset role;

select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'reject_agent_application'
      and entity_id   = '00000000-0000-0000-0000-000000080102'
      and reason      = 'Documentación ilegible'),
  1, 'REJ3_auditoria_del_rechazo_con_motivo'
);
select is(
  (select data ->> 'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000080003'
      and type    = 'agent_application_rejected'),
  'Documentación ilegible', 'REJ4_el_motivo_viaja_al_solicitante'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [ANCLA] under_agency: se aprueba igual, pero NO promueve el role (D8 de
--    71.5) — la membresía la otorga el flujo de invitación, no esta cola.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000080001'); -- ADMIN
update public.agent_applications set status = 'approved'
 where id = '00000000-0000-0000-0000-000000080103';
reset role;

select isnt(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000080004'),
  'agent', 'UNDER1_under_agency_no_promueve_el_role'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [DELTA] public.resolve_agent_application(p_application_id, p_approve,
--    p_reason) — la puerta ÚNICA que consume la UI (#221.4). Wrapper delgado:
--    valida al admin (private.resolve_admin_actor) y hace el MISMO UPDATE de
--    arriba; el trigger sigue siendo la única autoridad del resto.
--    Códigos P0001: STATUS_CHANGE_REQUIRES_ADMIN, APPLICATION_NOT_FOUND,
--    ALREADY_RESOLVED, REASON_REQUIRED (motivo real, `~ '\S'`).
--    🔴 ALREADY_RESOLVED, no INVALID_STATUS_TRANSITION: el guard propio de la
--    RPC corre ANTES del UPDATE, así que el cliente recibe siempre el mismo
--    verbo que en resolve_advertising_request / resolve_agency_registration.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000080006', 'rpc_indep_80@test.local'),
  ('00000000-0000-0000-0000-000000080007', 'rpc_rej_80@test.local');

insert into public.agent_applications (id, user_id, application_type, agency_id, status) values
  ('00000000-0000-0000-0000-000000080104', '00000000-0000-0000-0000-000000080006', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000080105', '00000000-0000-0000-0000-000000080007', 'independent', null, 'pending');

-- Autorización: el solicitante NO es admin -> el gate rebota ANTES de tocar la
-- fila (y sin revelar si existe).
select pg_temp.act_as('00000000-0000-0000-0000-000000080006'); -- solicitante
select throws_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-000000080104', true) $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN', 'RPC_ADM1_solo_admin_resuelve'
);
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000080104'),
  'pending', 'RPC_ADM2_el_intento_no_admin_no_movio_nada'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000080001'); -- ADMIN
select throws_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-0000000801ff', true) $$,
  'P0001', 'APPLICATION_NOT_FOUND', 'RPC_NF1_solicitud_inexistente'
);
select throws_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-000000080105', false) $$,
  'P0001', 'REASON_REQUIRED', 'RPC_REASON1_rechazo_sin_motivo'
);
select throws_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-000000080105', false, E' \t\n ') $$,
  'P0001', 'REASON_REQUIRED', 'RPC_REASON2_motivo_solo_whitespace'
);
select lives_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-000000080104', true) $$,
  'RPC_APP0_admin_aprueba_por_rpc'
);
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000080104'),
  'approved', 'RPC_APP1_status_approved'
);
select is(
  (select reviewed_by_admin_id from public.agent_applications where id = '00000000-0000-0000-0000-000000080104'),
  '00000000-0000-0000-0000-000000080001'::uuid, 'RPC_APP2_reviewed_by_es_el_admin'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000080006'),
  'agent', 'RPC_APP3_promocion_del_trigger_intacta'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'approve_agent_application'
      and entity_id   = '00000000-0000-0000-0000-000000080104'),
  1, 'RPC_APP4_una_sola_fila_de_auditoria_la_del_trigger'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000080006'
      and type    = 'agent_application_approved'),
  1, 'RPC_APP5_espejo_del_trigger_intacto'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000080001'); -- ADMIN, 2a resolución
select throws_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-000000080104', false, 'me arrepentí') $$,
  'P0001', 'ALREADY_RESOLVED', 'RPC_STATE1_segunda_resolucion_con_verbo_uniforme'
);
select lives_ok(
  $$ select public.resolve_agent_application('00000000-0000-0000-0000-000000080105', false, 'Cédula vencida') $$,
  'RPC_REJ0_admin_rechaza_por_rpc'
);
reset role;

select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000080105'),
  'rejected', 'RPC_REJ1_status_rejected'
);
select is(
  (select rejection_reason from public.agent_applications where id = '00000000-0000-0000-0000-000000080105'),
  'Cédula vencida', 'RPC_REJ2_motivo_persistido_en_la_fila'
);
select is(
  (select data ->> 'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000080007'
      and type    = 'agent_application_rejected'),
  'Cédula vencida', 'RPC_REJ3_el_motivo_viaja_al_solicitante'
);

select * from finish();
rollback;

-- ════════════════════════════════════════════════════════════════════════════
-- HALLAZGO (investigación 221.2, NO cubierto por esta suite ni por 221.1/221.2)
-- ════════════════════════════════════════════════════════════════════════════
-- El tercer carril de la cola unificada de M4 —los REGISTROS DE INMOBILIARIA
-- en `pending_approval`— NO tiene contrato admin utilizable desde el panel:
--   (a) UPDATE directo con JWT de admin -> 42501 "permission denied for table
--       agencies". Verificado empíricamente contra el stack local: el GRANT de
--       columna de 0008 (`grant update (name, slug, logo_url, contact_name,
--       contact_phone, contact_email, deleted_at) on public.agencies to
--       authenticated`) NO incluye `status` — es la decisión D3 de 71.5, que
--       dejaba la aprobación de agencias EXCLUSIVAMENTE en manos de Studio.
--   (b) La EF `suspend-agency` (#211.1) solo expone las acciones
--       suspend|reactivate, y su RPC `set_agency_status_atomic` rechaza
--       cualquier next_status que no sea active|suspended
--       (INVALID_NEXT_STATUS). O sea: APROBAR un registro se podría colar como
--       "reactivate" (pending_approval->active SÍ es una transición válida
--       para el trigger), pero con la semántica equivocada; y RECHAZARLO
--       (pending_approval->rejected) NO tiene NINGÚN camino publicado.
-- El trigger `handle_agency_status_change` ya implementa el grafo completo y
-- toda la resolución (membresía owner + role + agency_id + auditoría + espejo
-- a notifications de #219.2): lo que falta es SOLO la puerta de entrada para
-- el admin — una RPC/EF gemela de resolve_advertising_request, o ampliar el
-- catálogo de acciones de suspend-agency. Está FUERA del alcance pinneado de
-- 221.1/221.2 (que cubrían cuenta comercial y agent_applications): se reporta
-- al orquestador para que decida si entra en 221.4 o sale como tarea derivada.

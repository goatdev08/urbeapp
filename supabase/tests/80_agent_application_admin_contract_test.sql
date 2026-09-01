-- Tests pgTAP — CONTRATO ADMIN de public.agent_applications (subtarea #221.2,
-- tarea 221 "cola de solicitudes", exploración 041-M4).
-- Ejecutar con: supabase test db supabase/tests/80_agent_application_admin_contract_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 ESTE ARCHIVO NO ES UN RED. NO HAY CÓDIGO NUEVO DETRÁS.
--
-- La subtarea 221.2 pedía crear una RPC `resolve_agent_application` "si hoy
-- solo existe vía Studio". La investigación (bitácora 221.2) encontró que el
-- contrato admin YA EXISTE COMPLETO y funciona con el JWT de un admin de
-- plataforma — o sea, desde el panel móvil vía PostgREST, sin Edge Function ni
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
-- Añadir una RPC encima sería una SEGUNDA copia del mismo contrato (justo lo
-- que 20260823000001 y suspend-agency evitan a propósito): reusar > reescribir
-- (CLAUDE.md §0). Lo que SÍ faltaba era dejar ese contrato ANCLADO por un
-- test, porque la UI de la cola (#221.4) va a depender de él y hoy nada lo
-- protege de una regresión (la suite 25_admin_approvals_test.sql cubre el
-- trigger, pero por el camino GUC/Studio, no por el JWT del admin).
--
-- Por eso los 14 asserts de este archivo son TODOS [ANCLA]: pasan HOY, sin
-- implementación nueva. Su valor es de REGRESIÓN — si alguien endurece las
-- policies, cambia el grafo de estados o toca el trigger, esta suite lo caza
-- antes de que la cola del admin deje de funcionar en producción.
--
-- Corre como superusuario en una transacción revertida; las aserciones del
-- camino admin impersonan con pg_temp.act_as (patrón 02/…/76/79_*).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(14);

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

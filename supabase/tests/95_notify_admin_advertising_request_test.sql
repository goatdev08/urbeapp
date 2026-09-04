-- Tests pgTAP — la solicitud de cuenta comercial AVISA a los admins de
-- plataforma (tarea #246, derivada de la subtarea 221.1; detectada por el
-- usuario en el smoke de producción #222, 2026-09-03).
-- Ejecutar con: supabase test db supabase/tests/95_notify_admin_advertising_request_test.sql --local
-- Corre como superusuario dentro de una transacción revertida.
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO, VERIFICADO EN PRODUCCIÓN (smoke #222, bitácora paso 2)
-- ════════════════════════════════════════════════════════════════════════════
-- El owner mandó «Quiero anunciar» (create_advertising_request creó la
-- solicitud 2c901010) y NINGÚN admin se enteró: las únicas notificaciones
-- nuevas fueron para el propio owner. El catálogo de escritores admin de
-- #219.1 (20260825000001 + 20260827000002 + 20260902100004) cubre
-- admin_ad_pending, admin_agency_pending, admin_agent_application y
-- admin_revision_pending — advertising_requests nació en #221.1 SIN escritor.
--
-- ── SEAM bajo prueba ────────────────────────────────────────────────────────
-- El efecto OBSERVABLE sobre public.notifications de (a) una llamada real a
-- public.create_advertising_request (el ÚNICO camino de INSERT vivo) y (b) un
-- INSERT directo con status distinto de 'pending'. Nunca internals: no se
-- valida el nombre del trigger ni el cuerpo de la función.
--
-- ── D-KEY/D-TYPE/D-LINK (5º evento del catálogo admin) ──────────────────────
--   admin_advertising_request_pending
--     → deep_link '/admin/requests' (la cola unificada existe desde #221/
--       20260902100004 — este type nace ya apuntando a la ruta real, sin el
--       interino '/admin' que necesitaron los otros dos)
--     → related_entity_type 'advertising_request' · related_entity_id = la
--       solicitud · data->>'agency_name'
--     → destinatarios: TODOS los public.users.role='admin' VIVOS
--       (deleted_at is null, #223.2a). Admin de PLATAFORMA, sin relación con
--       agency_members.
--   Idempotencia por índice único parcial (user_id, related_entity_id, type)
--   + ON CONFLICT DO NOTHING, como admin_ad_pending / admin_agency_pending /
--   admin_agent_application: una solicitud solo nace UNA vez (el índice
--   parcial advertising_requests_one_pending_per_agency ya impide una segunda
--   fila abierta por agencia). NO es el caso de admin_revision_pending, que a
--   propósito re-avisa en cada re-envío.
--   Purga: la global public.purge_notifications() (30 días por created_at)
--   ya cubre este type — no hace falta nada nuevo.
--
-- ── Semántica BLOQUEANTE (DECISIÓN ABRAHAM 2026-08-25, heredada de #219.1) ──
-- El INSERT vive en la MISMA transacción del evento, SIN bloque EXCEPTION: si
-- el escritor truena, la solicitud tampoco se crea. El ON CONFLICT DO NOTHING
-- no es una excepción capturada, es un camino sin error.
--
-- ponytail: no se prueba "0 admins vivos → no revienta". Un `insert … select`
-- sobre cero filas es un no-op del motor, no una rama del SUT, y forzarlo
-- exigiría borrar los admins globales de la base dentro de la transacción.
-- Techo conocido: si algún día el escritor deja de ser un `insert … select`
-- (p.ej. un bucle o un RAISE cuando no hay destinatarios), ese caso vuelve.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(14);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — 2 admins vivos, 1 admin BORRADO, 2 owners, 1 agent.
-- agency_members_one_active_per_user: un usuario, una sola membresía activa.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0095-000000000001', 'admin_uno_95@urbea.mx'),
  ('00000000-0000-0000-0095-000000000002', 'admin_dos_95@urbea.mx'),
  ('00000000-0000-0000-0095-000000000003', 'admin_borrado_95@urbea.mx'),
  ('00000000-0000-0000-0095-000000000004', 'owner_solicitante_95@urbea.mx'),
  ('00000000-0000-0000-0095-000000000005', 'agent_de_la_agencia_95@urbea.mx'),
  ('00000000-0000-0000-0095-000000000006', 'owner_segundo_95@urbea.mx');

update public.users set role = 'admin' where id in (
  '00000000-0000-0000-0095-000000000001', '00000000-0000-0000-0095-000000000002',
  '00000000-0000-0000-0095-000000000003'
);
update public.users set deleted_at = now() where id = '00000000-0000-0000-0095-000000000003';
update public.users set role = 'agent' where id in (
  '00000000-0000-0000-0095-000000000004', '00000000-0000-0000-0095-000000000005',
  '00000000-0000-0000-0095-000000000006'
);

-- status 'active' a propósito: una agencia que naciera en 'pending_approval'
-- dispararía además el admin_agency_pending de #219.1 y metería ruido.
-- can_advertise false: es el requisito para poder SOLICITAR la cuenta.
insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise)
values
  ('00000000-0000-0000-0095-000000000101', 'Inmobiliaria Solicitante 95', 'inmobiliaria-solicitante-95',
   'active', '00000000-0000-0000-0095-000000000004', true, false),
  ('00000000-0000-0000-0095-000000000102', 'Inmobiliaria Segunda 95', 'inmobiliaria-segunda-95',
   'active', '00000000-0000-0000-0095-000000000006', true, false);

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0095-000000000101', '00000000-0000-0000-0095-000000000004', 'owner', 'active'),
  ('00000000-0000-0000-0095-000000000101', '00000000-0000-0000-0095-000000000005', 'agent', 'active'),
  ('00000000-0000-0000-0095-000000000102', '00000000-0000-0000-0095-000000000006', 'owner', 'active');

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Camino REAL — el owner manda «Quiero anunciar» y los admins se enteran.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0095-000000000004');
select set_config('t95.req1', public.create_advertising_request('seguros')::text, true);
reset role;

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = current_setting('t95.req1')::uuid
      and type = 'admin_advertising_request_pending'
      and user_id in ('00000000-0000-0000-0095-000000000001',
                      '00000000-0000-0000-0095-000000000002',
                      '00000000-0000-0000-0095-000000000003',
                      '00000000-0000-0000-0095-000000000004',
                      '00000000-0000-0000-0095-000000000005',
                      '00000000-0000-0000-0095-000000000006')),
  array[
    '00000000-0000-0000-0095-000000000001'::uuid,
    '00000000-0000-0000-0095-000000000002'::uuid
  ],
  'ADV1_los_dos_admins_VIVOS_reciben_el_aviso_y_solo_ellos'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0095-000000000003'
      and related_entity_id = current_setting('t95.req1')::uuid),
  0, 'ADV2_un_admin_BORRADO_deleted_at_no_recibe_fuente_viva'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0095-000000000004'
      and related_entity_id = current_setting('t95.req1')::uuid
      and type = 'admin_advertising_request_pending'),
  0, 'ADV3_el_owner_SOLICITANTE_no_recibe_el_aviso_de_admin_es_su_propia_solicitud'
);

-- Fan-out COMPLETO, no solo los dos del fixture: si la base local tuviera más
-- admins vivos, todos deben tener su fila (una por admin, ni más ni menos).
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = current_setting('t95.req1')::uuid
      and type = 'admin_advertising_request_pending'),
  (select count(*)::int from public.users where role = 'admin' and deleted_at is null),
  'ADV4_una_fila_por_CADA_admin_de_plataforma_vivo_ni_una_de_mas'
);

-- ── Contrato completo de la fila ────────────────────────────────────────────
create temp table result_adv_95 (n_title text, n_body text, n_deep_link text,
                                 n_rel_type text, n_agency_name text, n_read_at timestamptz);
insert into result_adv_95
  select title, body, deep_link, related_entity_type, data->>'agency_name', read_at
  from public.notifications
  where user_id = '00000000-0000-0000-0095-000000000001'
    and related_entity_id = current_setting('t95.req1')::uuid
    and type = 'admin_advertising_request_pending';

select is((select n_title from result_adv_95),
  'Nueva solicitud de cuenta comercial', 'ADV5_title');
select is((select n_body from result_adv_95),
  'La inmobiliaria "Inmobiliaria Solicitante 95" solicitó una cuenta comercial.',
  'ADV6_body_nombra_a_la_inmobiliaria_real');
select is((select n_deep_link from result_adv_95),
  '/admin/requests', 'ADV7_deep_link_a_la_cola_unificada_que_YA_existe');
select is((select n_rel_type from result_adv_95),
  'advertising_request', 'ADV8_related_entity_type_advertising_request');
select is((select n_agency_name from result_adv_95),
  'Inmobiliaria Solicitante 95', 'ADV9_data_agency_name');
-- `is(read_at, null)` pasaría en falso sobre una tabla VACÍA (null = null):
-- se afirma el booleano, que sobre cero filas da NULL y falla.
select is((select (n_read_at is null) from result_adv_95),
  true, 'ADV10_nace_SIN_leer_es_lo_que_enciende_la_campana');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Ancla de idempotencia — invariante de ESQUEMA (INSERT crudo directo),
--    mismo espíritu que la sección 6 de 71_notify_admin_events_test.sql.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  format($$ insert into public.notifications (user_id, type, title, related_entity_type, related_entity_id)
            values ('00000000-0000-0000-0095-000000000001', 'admin_advertising_request_pending',
                    'Nueva solicitud de cuenta comercial (duplicado)', 'advertising_request', %L) $$,
         current_setting('t95.req1')),
  '23505', null,
  'ADV11_un_segundo_INSERT_con_la_misma_llave_user_related_type_es_rechazado'
);

update public.notifications set deleted_at = now()
 where user_id = '00000000-0000-0000-0095-000000000001'
   and related_entity_id = current_setting('t95.req1')::uuid
   and type = 'admin_advertising_request_pending';

select throws_ok(
  format($$ insert into public.notifications (user_id, type, title, related_entity_type, related_entity_id)
            values ('00000000-0000-0000-0095-000000000001', 'admin_advertising_request_pending',
                    'Nueva solicitud de cuenta comercial (post-borrado)', 'advertising_request', %L) $$,
         current_setting('t95.req1')),
  '23505', null,
  'ADV12_un_aviso_BORRADO_sigue_anclando_el_indice_no_filtra_por_deleted_at'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Fronteras — solo el NACIMIENTO en 'pending' avisa.
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1) INSERT directo con status distinto de 'pending' NO dispara (WHEN
--      clause). Camino imposible por la RPC, pero alcanzable por Studio /
--      service_role / una migración de datos.
insert into public.advertising_requests (id, agency_id, requested_by_user_id, proposed_category, status)
values ('00000000-0000-0000-0095-000000000301', '00000000-0000-0000-0095-000000000102',
        '00000000-0000-0000-0095-000000000006', 'mudanzas', 'approved');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0095-000000000301'),
  0, 'ADV13_una_solicitud_que_NACE_approved_no_avisa_a_nadie_solo_pending_dispara'
);

-- 3.2) RESOLVER una solicitud no vuelve a avisar: el escritor es AFTER
--      INSERT, no AFTER UPDATE. El aviso de la resolución es del solicitante
--      (lo escribe resolve_advertising_request, #221.1), no de la cola admin.
select set_config('urbea.admin_actor_id', '00000000-0000-0000-0095-000000000001', true);
select public.resolve_advertising_request(current_setting('t95.req1')::uuid, false, 'No aplica');

-- El conjunto EXACTO de destinatarios tras resolver sigue siendo el de ADV1:
-- ni un admin nuevo, ni una fila extra para alguien que ya la tenía (por eso
-- se afirma el array de user_id, no un conteo — un conteo lo satisfacen dos
-- filas del MISMO admin).
select is(
  (select array_agg(distinct user_id) from public.notifications
    where related_entity_id = current_setting('t95.req1')::uuid
      and type = 'admin_advertising_request_pending'),
  array[
    '00000000-0000-0000-0095-000000000001'::uuid,
    '00000000-0000-0000-0095-000000000002'::uuid
  ],
  'ADV14_resolver_la_solicitud_NO_genera_un_segundo_aviso_de_cola_admin'
);

select * from finish();
rollback;

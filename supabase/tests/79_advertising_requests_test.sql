-- Tests pgTAP — solicitudes de CUENTA COMERCIAL (subtarea #221.1, tarea 221
-- "cola de solicitudes — agente, inmobiliaria y cuenta comercial",
-- exploración 041-M4). Cierra el hueco de 039:133: el canal «Quiero anunciar»
-- se prometió y nunca se construyó (#209 solo hizo el lado del admin).
-- Ejecutar con: supabase test db supabase/tests/79_advertising_requests_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste) — el superusuario bypassa RLS para
-- los fixtures; las aserciones de RLS impersonan con pg_temp.act_as(uid, role)
-- (mismo patrón que 02/08/18/21/25/27/28/30/73/76_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (contrato PÚBLICO, nada de internals):
--   (1) public.create_advertising_request(p_proposed_category text) -> uuid,
--       llamada por el OWNER con su propio JWT.
--   (2) public.resolve_advertising_request(p_request_id uuid, p_approve
--       boolean, p_reason text default null) -> void, llamada por el ADMIN de
--       plataforma con su propio JWT.
--   (3) El comportamiento observable de las policies RLS de
--       public.advertising_requests vía impersonación JWT.
--   (4) Los efectos observables de la resolución en OTRAS tablas ya vivas:
--       public.agencies (can_advertise/advertiser_category),
--       public.admin_actions (auditoría) y public.notifications (espejo al
--       solicitante).
--
-- SUT: migración supabase/migrations/20260902100001_advertising_requests.sql
-- (GREEN). El RED usó un STUB del mismo nombre con sufijo `_stub` (columnas/
-- tipos/FK/defaults + RLS ENABLED sin policies + 2 funciones no-op con la
-- firma final) SOLO para que estos CALL/INSERT/SELECT no abortaran por
-- catálogo (42P01/42883); ese archivo se consolida en el GREEN y se elimina
-- del árbol antes de integrar (criterio de 220.3/220.6: el stub es andamio de
-- test, no algo que deba viajar a producción).
--
-- ── DECISIONES DE CONTRATO que este archivo FIJA ────────────────────────────
-- D-JWT     La agencia NUNCA es un parámetro: sale de la membresía ACTIVA
--           `owner` del caller (precedente 20260820000005
--           create_ad_campaign_atomic — "no se blinda un dato que el cliente
--           controla, se deja de aceptar"). Un miembro `agent`, una membresía
--           `suspended`, un no-miembro o un caller sin JWT -> NOT_OWNER (el
--           MISMO código para las 4 causas: no se revela cuál).
-- D-CAT     La categoría propuesta se guarda como public.advertiser_category
--           (el enum del dominio, 20260815000001), no como text libre: es
--           EXACTAMENTE el valor que set_org_advertising_atomic escribirá en
--           agencies.advertiser_category al aprobar, así que una solicitud
--           inválida debe rebotar AL CREARSE y no al aprobarse. El parámetro
--           de la RPC sí es `text` (contrato con el cliente) y se valida
--           contra el enum -> P0001 INVALID_CATEGORY, nunca un 22P02 crudo.
-- D-ONE     Índice único PARCIAL `advertising_requests_one_pending_per_agency`
--           sobre (agency_id) where status='pending' — UNA solicitud abierta
--           por agencia (mismo patrón que agent_app_one_pending_per_user,
--           20260604000003). Tras un RECHAZO la agencia SÍ puede volver a
--           solicitar (el parcial libera la llave).
-- D-CREATE  La creación es EXCLUSIVA de la RPC: la tabla NO tiene policy ni
--           grant de INSERT (mismo criterio que public.ads, 20260816000005:
--           "sin policy de INSERT, a propósito"). Un INSERT directo del owner
--           saltaría ALREADY_ADVERTISER/ALREADY_PENDING/NOT_OWNER — las
--           validaciones dejarían de ser inevitables.
-- D-READ    RLS de lectura: el OWNER ve las de SU agencia (private.agency_role_of
--           (agency_id) = 'owner', helper YA existente de 20260805000003 —
--           reuso, no helper nuevo) y el admin de plataforma ve TODAS: a
--           diferencia de los leads (#226), esta SÍ es la cola del admin.
--           Un miembro `agent`/`admin` de la agencia NO la ve (es una
--           decisión comercial del owner).
-- D-ADMIN   El actor admin se resuelve con private.resolve_admin_actor()
--           (71.5/D4): JWT admin real o GUC urbea.admin_actor_id. Sin admin
--           -> P0001 STATUS_CHANGE_REQUIRES_ADMIN, ANTES de tocar (o de
--           revelar la existencia de) la solicitud.
-- D-REUSE   Aprobar delega el encendido en el overload de 4 argumentos de
--           public.set_org_advertising_atomic (20260823000001) — misma
--           semántica que la EF set-org-advertising: can_advertise=true +
--           advertiser_category + auditoría 'enable_org_advertising' sobre la
--           entidad `agency`, en la MISMA transacción. No se reescribe ese
--           UPDATE ni esa auditoría (reusar > reescribir, CLAUDE.md §0).
-- D-AUDIT   ADEMÁS, la RESOLUCIÓN de la solicitud audita su propia fila en
--           admin_actions: action_type 'approve_advertising_request' /
--           'reject_advertising_request', entity_type 'advertising_request',
--           entity_id = la solicitud, reason = el motivo en la rama rechazo.
--           Son entidades DISTINTAS (la capacidad de la agencia vs. la
--           resolución de la solicitud): aprobar deja 2 filas de auditoría, y
--           eso es el contrato, no un descuido.
-- D-REASON  Rechazar exige motivo con contenido real: `p_reason ~ '\S'`, nunca
--           trim() (trim() en Postgres solo recorta el espacio ASCII y deja
--           pasar tabuladores/saltos de línea — hallazgo 220.1) -> P0001
--           REASON_REQUIRED.
-- D-STATE   pending -> approved | rejected y nada más: una 2ª resolución sobre
--           una solicitud ya resuelta -> P0001 ALREADY_RESOLVED (no un no-op
--           silencioso: el admin necesita saber que otro admin ya la tomó).
-- D-NOTIF   Espejo al SOLICITANTE (requested_by_user_id) en ambas ramas, tipos
--           'advertising_request_approved' / 'advertising_request_rejected'
--           (convención <entidad>_<resolución> de #219.2), deep_link '/ads'
--           (ruta viva, mobile/app/(protected)/ads/index.tsx — mismo destino
--           que los espejos de anuncios), related_entity_type
--           'advertising_request'. NUNCA al admin actor (guard SELF, `is
--           distinct from`). El catálogo v1 de #219 admite tipos nuevos sin
--           tocar esquema: notifications.type es TEXT a propósito
--           ("catálogo crece -> text, no enum", 20260604000007:59).
-- D-ATOM    Todo o nada: si el encendido revienta (p.ej. agencia soft-deleted
--           -> AGENCY_NOT_FOUND de set_org_advertising_atomic), la solicitud
--           sigue 'pending' y no queda ninguna auditoría ni notificación.
--           Sin bloques EXCEPTION que traguen errores (semántica BLOQUEANTE
--           de Abraham 2026-08-25, #219.1).
--
-- ── Convención DELTA vs COINCIDE vs INVARIANTE (igual que 73/76_*.sql) ──────
-- DELTA      = falla HOY contra el STUB, debe pasar tras el GREEN por la razón
--              correcta. Es la inmensa mayoría de esta suite (SUT nuevo).
-- COINCIDE   = pasa HOY pero por la razón EQUIVOCADA (deny-total de "RLS
--              habilitado sin ninguna policy" / "sin grant"), no por la regla
--              real. El guardian DEBE revalidar que sigue en verde con las
--              policies ya puestas: RLS_OTHER_OWNER, RLS_AGENT_MEMBER,
--              RLS_NO_INSERT, RLS_NO_UPDATE, RLS_NO_DELETE, RLS_ANON.
-- INVARIANTE = pasa HOY y seguirá pasando (forma mecánica que el stub ya
--              resuelve): DEF2/DEF3/DEF4, UNIQ_OTHER_AGENCY.
--
-- Verificado en el RED contra el STUB (salida real de
-- `supabase test db supabase/tests/79_advertising_requests_test.sql --local`):
--   Failed 46/73 subtests
--   Failed tests:  5-6, 10-30, 32-36, 38-41, 44-46, 48, 51-52, 55-60, 65, 69
-- Los 27 que ya pasan son los INVARIANTE/COINCIDE de arriba más los lives_ok
-- que el no-op del stub satisface trivialmente (CREATE1/REJ0/REJ7/ATOM0/
-- NOTIF8/NOTIF9, etc.) — cada uno de ellos queda anclado por el assert de
-- EFECTO que lo sigue, que hoy SÍ falla.
--
-- 🔴 Los 4 `set_config('t79.req_*')` llevan coalesce a un uuid inexistente
-- (…0799aa/ab/ac/ad): bajo el STUB la RPC devuelve NULL y no crea fila, así
-- que sin ese coalesce el GUC quedaba en '' y el primer `::uuid` FUERA de un
-- throws_ok abortaba la transacción entera (22P02) — la suite moría en el
-- test 37 con "Bad plan". Tras el GREEN el coalesce es inerte (siempre hay
-- fila).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(73);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs con prefijo '00000000-0000-0000-0000-000000079XXX'.
--   Usuarios 079001..079013 · Agencias 0791NN.
--   ADMIN(079001)      admin de plataforma que resuelve la cola.
--   OWNER1(079002)     owner de AG1 -> camino feliz + APROBACIÓN.
--   OWNER2(079003)     owner de AG2 -> RECHAZO + re-solicitud tras rechazo.
--   AGENT1(079004)     miembro 'agent' ACTIVO de AG1 (no owner).
--   OUTSIDER(079005)   sin ninguna membresía.
--   OWNER3(079006)     owner de AG3, que YA es anunciante (can_advertise).
--   OWNER4(079007)     owner de AG4, agencia SOFT-DELETED.
--   OWNER5(079008)     owner de AG5 -> aislamiento RLS entre agencias.
--   SUSPOWNER(079009)  owner de AG6 con membresía 'suspended'.
--   OWNER7(079010)     owner de AG7 -> atomicidad (agencia borrada después).
--   ADMINOWNER(079011) admin de plataforma que ADEMÁS es owner de AG8 ->
--                      guard SELF de la notificación.
--   OWNER9(079012)     owner de AG9 -> defaults/estructura.
--   OWNER10(079013)    owner de AG10 -> índice único parcial.
-- OJO agency_members_one_active_per_user: cada usuario tiene UNA sola
-- membresía activa, por eso hay un owner distinto por agencia.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000079001', 'admin_79@test.local'),
  ('00000000-0000-0000-0000-000000079002', 'owner1_79@test.local'),
  ('00000000-0000-0000-0000-000000079003', 'owner2_79@test.local'),
  ('00000000-0000-0000-0000-000000079004', 'agent1_79@test.local'),
  ('00000000-0000-0000-0000-000000079005', 'outsider_79@test.local'),
  ('00000000-0000-0000-0000-000000079006', 'owner3_79@test.local'),
  ('00000000-0000-0000-0000-000000079007', 'owner4_79@test.local'),
  ('00000000-0000-0000-0000-000000079008', 'owner5_79@test.local'),
  ('00000000-0000-0000-0000-000000079009', 'suspowner_79@test.local'),
  ('00000000-0000-0000-0000-000000079010', 'owner7_79@test.local'),
  ('00000000-0000-0000-0000-000000079011', 'adminowner_79@test.local'),
  ('00000000-0000-0000-0000-000000079012', 'owner9_79@test.local'),
  ('00000000-0000-0000-0000-000000079013', 'owner10_79@test.local');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000079001',
              '00000000-0000-0000-0000-000000079011');

-- Agencias ya ACTIVAS (el trigger de 71.5 es BEFORE UPDATE: un INSERT directo
-- en 'active' no lo dispara — mismo atajo de fixture que 65/67_*.sql).
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000079101', 'Agencia 79 Uno',    'agencia-79-uno',    'active', '00000000-0000-0000-0000-000000079002', false, null),
  ('00000000-0000-0000-0000-000000079102', 'Agencia 79 Dos',    'agencia-79-dos',    'active', '00000000-0000-0000-0000-000000079003', false, null),
  ('00000000-0000-0000-0000-000000079103', 'Agencia 79 Tres',   'agencia-79-tres',   'active', '00000000-0000-0000-0000-000000079006', true,  'seguros'),
  ('00000000-0000-0000-0000-000000079104', 'Agencia 79 Cuatro', 'agencia-79-cuatro', 'active', '00000000-0000-0000-0000-000000079007', false, null),
  ('00000000-0000-0000-0000-000000079105', 'Agencia 79 Cinco',  'agencia-79-cinco',  'active', '00000000-0000-0000-0000-000000079008', false, null),
  ('00000000-0000-0000-0000-000000079106', 'Agencia 79 Seis',   'agencia-79-seis',   'active', '00000000-0000-0000-0000-000000079009', false, null),
  ('00000000-0000-0000-0000-000000079107', 'Agencia 79 Siete',  'agencia-79-siete',  'active', '00000000-0000-0000-0000-000000079010', false, null),
  ('00000000-0000-0000-0000-000000079108', 'Agencia 79 Ocho',   'agencia-79-ocho',   'active', '00000000-0000-0000-0000-000000079011', false, null),
  ('00000000-0000-0000-0000-000000079109', 'Agencia 79 Nueve',  'agencia-79-nueve',  'active', '00000000-0000-0000-0000-000000079012', false, null),
  ('00000000-0000-0000-0000-000000079110', 'Agencia 79 Diez',   'agencia-79-diez',   'active', '00000000-0000-0000-0000-000000079013', false, null);

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000079101', '00000000-0000-0000-0000-000000079002', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079102', '00000000-0000-0000-0000-000000079003', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079101', '00000000-0000-0000-0000-000000079004', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000079103', '00000000-0000-0000-0000-000000079006', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079104', '00000000-0000-0000-0000-000000079007', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079105', '00000000-0000-0000-0000-000000079008', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079106', '00000000-0000-0000-0000-000000079009', 'owner', 'suspended'),
  ('00000000-0000-0000-0000-000000079107', '00000000-0000-0000-0000-000000079010', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079108', '00000000-0000-0000-0000-000000079011', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079109', '00000000-0000-0000-0000-000000079012', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000079110', '00000000-0000-0000-0000-000000079013', 'owner', 'active');

-- AG4 soft-deleted (después de crear la membresía: el owner sigue existiendo,
-- lo que se apaga es la agencia).
update public.agencies set deleted_at = now()
 where id = '00000000-0000-0000-0000-000000079104';

-- Helper de impersonación inline (mismo patrón que 02/08/…/76_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Defaults y CHECK de status. Fila insertada por el SUPERUSUARIO (fixture),
--    no por el cliente: aquí se prueba la FORMA de la tabla, no el camino de
--    creación (ese es la sección 3).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category)
values ('00000000-0000-0000-0000-000000079109', '00000000-0000-0000-0000-000000079012', 'mudanzas');

select is(
  (select status from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079109'),
  'pending', 'DEF1_status_nace_pending'
);
select ok(
  (select rejection_reason from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079109') is null,
  'DEF2_rejection_reason_nace_null'
);
select ok(
  (select resolved_at from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079109') is null,
  'DEF3_resolved_at_nace_null'
);
select ok(
  (select resolved_by_user_id from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079109') is null,
  'DEF4_resolved_by_user_id_nace_null'
);

-- [DELTA] El CHECK de status es invariante de negocio: el stub NO lo trae.
select throws_ok(
  $$ insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category, status)
     values ('00000000-0000-0000-0000-000000079110', '00000000-0000-0000-0000-000000079013', 'seguros', 'archivada') $$,
  '23514', null, 'CHK1_status_fuera_del_catalogo_rebota'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [DELTA] Índice único parcial: UNA pending por agencia; los estados
--    finales NO ocupan la llave.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category)
     values ('00000000-0000-0000-0000-000000079109', '00000000-0000-0000-0000-000000079012', 'seguros') $$,
  '23505', null, 'UNIQ_SEGUNDA_PENDING_MISMA_AGENCIA_REBOTA'
);

-- [INVARIANTE] Otra agencia sí puede tener su propia pending al mismo tiempo.
insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category)
values ('00000000-0000-0000-0000-000000079105', '00000000-0000-0000-0000-000000079008', 'notaria');
select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079105' and status = 'pending'),
  1, 'UNIQ_OTHER_AGENCY_pending_paralela_permitida'
);

-- [DELTA] Una resuelta NO bloquea la llave: AG10 puede tener una 'rejected' y
-- una 'pending' a la vez.
insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category, status, rejection_reason, resolved_at, resolved_by_user_id)
values ('00000000-0000-0000-0000-000000079110', '00000000-0000-0000-0000-000000079013', 'limpieza', 'rejected', 'motivo viejo', now(), '00000000-0000-0000-0000-000000079001');
select lives_ok(
  $$ insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category)
     values ('00000000-0000-0000-0000-000000079110', '00000000-0000-0000-0000-000000079013', 'avaluos') $$,
  'UNIQ_RESUELTA_NO_OCUPA_LA_LLAVE'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [DELTA] create_advertising_request — la agencia sale del JWT (D-JWT).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000079002'); -- OWNER1
select lives_ok(
  $$ select public.create_advertising_request('credito_hipotecario') $$,
  'CREATE1_owner_crea_su_solicitud'
);
reset role;

select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  1, 'CREATE2_una_fila_para_la_agencia_del_caller'
);
select is(
  (select requested_by_user_id from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  '00000000-0000-0000-0000-000000079002'::uuid, 'CREATE3_requested_by_es_el_caller'
);
select is(
  (select proposed_category::text from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  'credito_hipotecario', 'CREATE4_categoria_propuesta_persistida'
);
select is(
  (select status from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  'pending', 'CREATE5_nace_pending'
);

-- NOT_OWNER: 4 causas, un solo código (no se revela cuál).
select pg_temp.act_as('00000000-0000-0000-0000-000000079005'); -- OUTSIDER
select throws_ok(
  $$ select public.create_advertising_request('seguros') $$,
  'P0001', 'NOT_OWNER', 'NOTOWNER1_sin_membresia'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079004'); -- AGENT1 (agent de AG1)
select throws_ok(
  $$ select public.create_advertising_request('seguros') $$,
  'P0001', 'NOT_OWNER', 'NOTOWNER2_miembro_agent_no_es_owner'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079009'); -- SUSPOWNER (membresía suspended)
select throws_ok(
  $$ select public.create_advertising_request('seguros') $$,
  'P0001', 'NOT_OWNER', 'NOTOWNER3_membresia_suspendida'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079007'); -- OWNER4 (AG4 soft-deleted)
select throws_ok(
  $$ select public.create_advertising_request('seguros') $$,
  'P0001', 'NOT_OWNER', 'NOTOWNER4_agencia_soft_deleted'
);
reset role;

-- Sin JWT: rol authenticated pero claims vacíos -> auth.uid() NULL.
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select public.create_advertising_request('seguros') $$,
  'P0001', 'NOT_OWNER', 'NOTOWNER5_sin_jwt'
);
reset role;

-- Orden de guards: primero QUIÉN eres, después QUÉ mandas.
select pg_temp.act_as('00000000-0000-0000-0000-000000079005'); -- OUTSIDER + categoría basura
select throws_ok(
  $$ select public.create_advertising_request('no_existe_esta_categoria') $$,
  'P0001', 'NOT_OWNER', 'ORDER1_not_owner_precede_a_invalid_category'
);
reset role;

-- INVALID_CATEGORY (D-CAT): typed, nunca un 22P02 crudo del cast.
select pg_temp.act_as('00000000-0000-0000-0000-000000079003'); -- OWNER2
select throws_ok(
  $$ select public.create_advertising_request('no_existe_esta_categoria') $$,
  'P0001', 'INVALID_CATEGORY', 'INVCAT1_categoria_fuera_del_enum'
);
select throws_ok(
  $$ select public.create_advertising_request(null) $$,
  'P0001', 'INVALID_CATEGORY', 'INVCAT2_categoria_null'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079006'); -- OWNER3 (AG3 ya anunciante)
select throws_ok(
  $$ select public.create_advertising_request('mudanzas') $$,
  'P0001', 'ALREADY_ADVERTISER', 'ALREADYADV1_agencia_que_ya_puede_anunciar'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079002'); -- OWNER1, 2ª vez
select throws_ok(
  $$ select public.create_advertising_request('limpieza') $$,
  'P0001', 'ALREADY_PENDING', 'PENDING1_segunda_solicitud_abierta'
);
reset role;

select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  1, 'PENDING2_el_intento_rechazado_no_dejo_fila'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [DELTA] resolve_advertising_request — autorización y guards de entrada.
-- ════════════════════════════════════════════════════════════════════════════

select set_config('t79.req_ag1',
  coalesce((select id::text from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101'),
           '00000000-0000-0000-0000-0000000799aa'), true);

select pg_temp.act_as('00000000-0000-0000-0000-000000079002'); -- OWNER1 (dueño, NO admin)
select throws_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag1')::uuid, true) $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN', 'ADM1_el_solicitante_no_resuelve_lo_suyo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079005'); -- OUTSIDER
select throws_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag1')::uuid, false, 'porque sí') $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN', 'ADM2_un_cualquiera_no_resuelve'
);
reset role;

select is(
  (select status from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101'),
  'pending', 'ADM3_los_intentos_no_admin_no_movieron_nada'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000079001'); -- ADMIN
select throws_ok(
  $$ select public.resolve_advertising_request('00000000-0000-0000-0000-0000000799ff'::uuid, true) $$,
  'P0001', 'REQUEST_NOT_FOUND', 'NOTFOUND1_solicitud_inexistente'
);
select throws_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag1')::uuid, false) $$,
  'P0001', 'REASON_REQUIRED', 'REASON1_rechazo_sin_motivo'
);
select throws_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag1')::uuid, false, E' \t\n ') $$,
  'P0001', 'REASON_REQUIRED', 'REASON2_motivo_solo_whitespace'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [DELTA] APROBACIÓN — efectos en la MISMA transacción (D-REUSE/D-AUDIT).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000079001'); -- ADMIN
select lives_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag1')::uuid, true) $$,
  'APP0_admin_aprueba'
);
reset role;

select ok(
  (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000079101'),
  'APP1_can_advertise_encendido'
);
select is(
  (select advertiser_category::text from public.agencies where id = '00000000-0000-0000-0000-000000079101'),
  'credito_hipotecario', 'APP2_categoria_propuesta_aplicada_a_la_agencia'
);
select is(
  (select status from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101'),
  'approved', 'APP3_solicitud_approved'
);
select ok(
  (select resolved_at from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101') is not null,
  'APP4_resolved_at_estampado'
);
select is(
  (select resolved_by_user_id from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101'),
  '00000000-0000-0000-0000-000000079001'::uuid, 'APP5_resolved_by_es_el_admin'
);
select ok(
  (select rejection_reason from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101') is null,
  'APP6_aprobar_no_inventa_motivo'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'approve_advertising_request'
      and entity_type = 'advertising_request'
      and entity_id   = current_setting('t79.req_ag1')::uuid
      and admin_id    = '00000000-0000-0000-0000-000000079001'),
  1, 'APP7_auditoria_de_la_resolucion'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'enable_org_advertising'
      and entity_type = 'agency'
      and entity_id   = '00000000-0000-0000-0000-000000079101'
      and admin_id    = '00000000-0000-0000-0000-000000079001'),
  1, 'APP8_auditoria_del_encendido_reusada_de_set_org_advertising_atomic'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000079001'); -- ADMIN, 2ª resolución
select throws_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag1')::uuid, false, 'me arrepentí') $$,
  'P0001', 'ALREADY_RESOLVED', 'STATE1_segunda_resolucion_rebota'
);
reset role;

select is(
  (select status from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079101'),
  'approved', 'STATE2_la_segunda_resolucion_no_cambio_nada'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [DELTA] RECHAZO — motivo obligatorio, sin encender nada, y la agencia
--    puede volver a solicitar después (D-ONE).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000079003'); -- OWNER2
select lives_ok(
  $$ select public.create_advertising_request('seguros') $$,
  'REJ0_owner2_solicita'
);
reset role;

select set_config('t79.req_ag2',
  coalesce((select id::text from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079102' and status = 'pending'),
           '00000000-0000-0000-0000-0000000799ab'), true);

select pg_temp.act_as('00000000-0000-0000-0000-000000079001'); -- ADMIN
select lives_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag2')::uuid, false, 'Faltan datos fiscales') $$,
  'REJ1_admin_rechaza_con_motivo'
);
reset role;

select is(
  (select status from public.advertising_requests where id = current_setting('t79.req_ag2')::uuid),
  'rejected', 'REJ2_solicitud_rejected'
);
select is(
  (select rejection_reason from public.advertising_requests where id = current_setting('t79.req_ag2')::uuid),
  'Faltan datos fiscales', 'REJ3_motivo_persistido'
);
select is(
  (select resolved_by_user_id from public.advertising_requests where id = current_setting('t79.req_ag2')::uuid),
  '00000000-0000-0000-0000-000000079001'::uuid, 'REJ4_resolved_by_en_el_rechazo'
);
select ok(
  not (select can_advertise from public.agencies where id = '00000000-0000-0000-0000-000000079102'),
  'REJ5_rechazar_no_enciende_can_advertise'
);
select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'reject_advertising_request'
      and entity_type = 'advertising_request'
      and entity_id   = current_setting('t79.req_ag2')::uuid
      and reason      = 'Faltan datos fiscales'),
  1, 'REJ6_auditoria_del_rechazo_con_motivo'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000079003'); -- OWNER2 vuelve a intentar
select lives_ok(
  $$ select public.create_advertising_request('mudanzas') $$,
  'REJ7_tras_el_rechazo_puede_volver_a_solicitar'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) [DELTA] ATOMICIDAD (D-ATOM): si el encendido revienta, NADA queda.
--    AG7 se borra (soft) DESPUÉS de que su owner solicitó -> el encendido
--    lanza AGENCY_NOT_FOUND desde set_org_advertising_atomic.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000079010'); -- OWNER7
select lives_ok(
  $$ select public.create_advertising_request('otro') $$,
  'ATOM0_owner7_solicita'
);
reset role;

update public.agencies set deleted_at = now() where id = '00000000-0000-0000-0000-000000079107';
select set_config('t79.req_ag7',
  coalesce((select id::text from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079107'),
           '00000000-0000-0000-0000-0000000799ac'), true);

select pg_temp.act_as('00000000-0000-0000-0000-000000079001'); -- ADMIN
select throws_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag7')::uuid, true) $$,
  'P0001', 'AGENCY_NOT_FOUND', 'ATOM1_aprobar_una_agencia_borrada_revienta'
);
reset role;

select is(
  (select status from public.advertising_requests where id = current_setting('t79.req_ag7')::uuid),
  'pending', 'ATOM2_la_solicitud_sigue_pending'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = current_setting('t79.req_ag7')::uuid),
  0, 'ATOM3_sin_auditoria_de_una_resolucion_que_no_ocurrio'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = current_setting('t79.req_ag7')::uuid),
  0, 'ATOM4_sin_notificacion_de_una_resolucion_que_no_ocurrio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) [DELTA] Espejo a notifications (D-NOTIF) — catálogo v1 de #219.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079002'
      and type    = 'advertising_request_approved'),
  1, 'NOTIF1_aviso_de_aprobacion_al_solicitante'
);
select is(
  (select deep_link from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079002'
      and type    = 'advertising_request_approved'),
  '/ads', 'NOTIF2_deep_link_a_una_ruta_viva'
);
select is(
  (select related_entity_type from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079002'
      and type    = 'advertising_request_approved'),
  'advertising_request', 'NOTIF3_related_entity_type'
);
select is(
  (select related_entity_id from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079002'
      and type    = 'advertising_request_approved'),
  current_setting('t79.req_ag1')::uuid, 'NOTIF4_related_entity_id_es_la_solicitud'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079003'
      and type    = 'advertising_request_rejected'),
  1, 'NOTIF5_aviso_de_rechazo_al_solicitante'
);
select is(
  (select data ->> 'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079003'
      and type    = 'advertising_request_rejected'),
  'Faltan datos fiscales', 'NOTIF6_el_motivo_viaja_en_data'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079001'
      and type in ('advertising_request_approved', 'advertising_request_rejected')),
  0, 'NOTIF7_el_admin_actor_nunca_se_avisa_a_si_mismo'
);

-- Guard SELF real: ADMINOWNER es admin Y owner de AG8 — se aprueba su propia
-- solicitud y NO debe recibir aviso.
select pg_temp.act_as('00000000-0000-0000-0000-000000079011'); -- ADMINOWNER
select lives_ok(
  $$ select public.create_advertising_request('avaluos') $$,
  'NOTIF8_adminowner_solicita'
);
reset role;

select set_config('t79.req_ag8',
  coalesce((select id::text from public.advertising_requests where agency_id = '00000000-0000-0000-0000-000000079108'),
           '00000000-0000-0000-0000-0000000799ad'), true);

select pg_temp.act_as('00000000-0000-0000-0000-000000079011'); -- ADMINOWNER se aprueba
select lives_ok(
  $$ select public.resolve_advertising_request(current_setting('t79.req_ag8')::uuid, true) $$,
  'NOTIF9_adminowner_se_aprueba'
);
reset role;

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000079011'
      and type    = 'advertising_request_approved'),
  0, 'NOTIF10_guard_self_el_actor_no_se_notifica'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) RLS (D-READ / D-CREATE). Marcados COINCIDE los que HOY pasan por
--    deny-total de "RLS sin policies" / "sin grant" — el guardian revalida la
--    RAZÓN tras el GREEN.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000079002'); -- OWNER1
select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  1, 'RLS_OWNER_VE_LO_SUYO'
);
select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079105'),
  0, 'RLS_OWNER_NO_VE_LO_AJENO'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079008'); -- OWNER5 (otra agencia)
select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  0, 'RLS_OTHER_OWNER_aislado'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079004'); -- AGENT1 (agent de AG1)
select is(
  (select count(*)::int from public.advertising_requests
    where agency_id = '00000000-0000-0000-0000-000000079101'),
  0, 'RLS_AGENT_MEMBER_no_ve_la_solicitud_comercial'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079001'); -- ADMIN: es SU cola
select is(
  (select count(*)::int from public.advertising_requests
    where agency_id in ('00000000-0000-0000-0000-000000079101',
                        '00000000-0000-0000-0000-000000079105',
                        '00000000-0000-0000-0000-000000079109')),
  3, 'RLS_ADMIN_VE_TODAS'
);
reset role;

-- D-CREATE: la creación es exclusiva de la RPC (sin grant ni policy de INSERT).
select pg_temp.act_as('00000000-0000-0000-0000-000000079008'); -- OWNER5
select throws_ok(
  $$ insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category)
     values ('00000000-0000-0000-0000-000000079105', '00000000-0000-0000-0000-000000079008', 'seguros') $$,
  '42501', null, 'RLS_NO_INSERT_directo_del_cliente'
);
select throws_ok(
  $$ update public.advertising_requests set status = 'approved'
      where agency_id = '00000000-0000-0000-0000-000000079105' $$,
  '42501', null, 'RLS_NO_UPDATE_directo_del_cliente'
);
select throws_ok(
  $$ delete from public.advertising_requests
      where agency_id = '00000000-0000-0000-0000-000000079105' $$,
  '42501', null, 'RLS_NO_DELETE_directo_del_cliente'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000079008', 'anon');
select throws_ok(
  $$ select count(*) from public.advertising_requests $$,
  '42501', null, 'RLS_ANON_sin_acceso'
);
reset role;

select * from finish();
rollback;

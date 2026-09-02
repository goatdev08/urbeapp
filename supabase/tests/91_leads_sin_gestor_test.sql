-- Tests pgTAP — Un agente suspendido sigue recibiendo leads nuevos y su
-- inventario queda sin gestor (tarea #203, subtarea 203.1).
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- ⚠️ GOTCHA operativo: `supabase test db` NO reaplica migraciones nuevas por sí
-- solo — la migración GREEN se aplica al stack local con
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/20260904200001_leads_sin_gestor.sql
-- (el lote 2 corre en paralelo: PROHIBIDO `supabase db reset`).
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Los fixtures se insertan directo (bypass RLS); las aserciones de visibilidad
-- impersonan con pg_temp.act_as(uid, role) — mismo patrón que 30/31/77/88_*.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — el hueco REAL (verificado sobre el código, contrato #203 pinneado
-- 2026-09-02).
--
-- private.set_lead_agency_id (20260807000006:84-100, BEFORE INSERT en leads)
-- resuelve la agencia del lead SOLO desde la membresía con status='active'. Si
-- el agente está SUSPENDIDO, ninguna fila matchea y leads.agency_id nace NULL.
-- Y leads_select (20260901000001) es
--     agent_id = auth.uid() OR private.agency_role_of(agency_id) in ('owner','admin')
-- → con agency_id NULL, `agency_role_of(NULL)` es NULL y el owner/admin de la
-- inmobiliaria NO VE el lead. El daño no es "el lead llega a una cuenta
-- congelada": es que el lead no le llega A NADIE MÁS. Una persona real escribió
-- pidiendo ver una casa y ese mensaje queda en un buzón que nadie abre.
--
-- 🔴 Regla 3 de la definición de suspensión (#202, Abraham 2026-08-21): «lo que
-- quedó vivo pasa al control de la agencia». La suspensión es del AGENTE, NO de
-- su inventario: las propiedades NO se pausan automáticamente (eso castigaría a
-- la inmobiliaria, que no hizo nada, y destruiría inventario vivo).
--
-- ── SEAM bajo prueba (comportamiento observable, NUNCA internals) ────────────
--   1) El valor de leads.agency_id tras un INSERT real (el trigger visto desde
--      afuera), y a quién deja ver ese lead leads_select bajo impersonación.
--   2) Las filas de public.notifications que aparecen tras ese INSERT
--      (destinatarios EXACTOS, type, body, deep_link, data).
--   3) El contrato público de la RPC reassign_member_properties_atomic:
--      valor de retorno, qué filas de properties movió (y cuáles NO), la fila
--      de auditoría, el aviso al destinatario, y los códigos de error por
--      impersonación.
-- NUNCA se lee el cuerpo de la función ni el texto de la policy.
--
-- ── SUT del GREEN (aún no existe en la fase RED) ─────────────────────────────
--   (a) private.set_lead_agency_id: fallback a la membresía SUSPENDIDA más
--       reciente (created_at desc) cuando no hay ninguna activa. `removed` y
--       "sin membresía" siguen dando NULL (el agente independiente y el que
--       SALIÓ de la inmobiliaria no le pertenecen a nadie).
--   (b) trigger AFTER INSERT leads_notify_unmanaged → public.notify_lead_unmanaged():
--       avisa type='lead_unmanaged' a cada owner/admin ACTIVO de la agencia del
--       lead cuando el agente está suspendido en ella. Nunca al propio agente.
--   (c) RPC public.reassign_member_properties_atomic(uuid, uuid, uuid) → integer.
--
-- ── 🔒 Invariantes que este archivo ancla ───────────────────────────────────
--   🔒 Los LEADS existentes NO cambian de dueño al reasignar el inventario: el
--      buscador no cambia de interlocutor en silencio (H8).
--   🔒 La reasignación queda AUDITADA con los ids exactos que movió (H6).
--   🔒 Una propiedad soft-deleted o de OTRA agencia jamás se toca (H3/H4).
--   🔒 NOT_AUTHORIZED es un solo código para 4 causas distintas: no revela si
--      la agencia existe (E3-E6, anti-enumeración, criterio de #213).
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30/31/77) ────
-- DELTA      = falla HOY por ASERCIÓN, pasa tras el GREEN (discrimina).
-- INVARIANTE = ya se cumple hoy; es la red de no-regresión (suites 08/30/31/35/77).
-- GUARD      = pasa hoy TRIVIALMENTE (la fila/función todavía no existe, así que
--              el conteo es 0 y el dueño no cambió) y solo cobra sentido tras el
--              GREEN: discrimina un GREEN *equivocado* -- un fan-out que avise a
--              todo el mundo, o un UPDATE que barra de más. Se marcan aparte a
--              propósito para no inflar la cuenta de DELTA con aserciones que hoy
--              no discriminan nada.
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- La RPC no existe todavía: cada llamada se hace por pg_temp.reassign(), que
-- captura la excepción y devuelve 'SQLSTATE|mensaje'. En RED devuelve
-- '42883|function ... does not exist' y el is() falla por ASERCIÓN, nunca por
-- aborto de transacción. Las metadatas se leen de pg_proc (catálogo puro: NULL
-- cuando la función no existe, jamás lanza).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(50);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Invoca la RPC bajo el rol actual y devuelve 'ok|<n>' o 'SQLSTATE|mensaje'.
-- SECURITY INVOKER (el default) a propósito: el chequeo de EXECUTE y el
-- auth.uid() deben verse desde el rol impersonado, no desde postgres.
create or replace function pg_temp.reassign(p_agency_id uuid, p_from uuid, p_to uuid)
returns text language plpgsql as $$
declare v_n integer;
begin
  v_n := public.reassign_member_properties_atomic(p_agency_id, p_from, p_to);
  return 'ok|' || v_n::text;
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;

create temp table res_91 (k text primary key, v text);
grant insert, select, update on res_91 to public;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000002031XX' (#203.1, sin colisión con 0755XX
-- de 30/31, 0226XX de 77 ni 8800XX de 88).
--   Inmobiliaria X ...020310 · Inmobiliaria Y ...020320
--   OX  owner  ACTIVO de X                                       : ...020301
--   MX  admin  ACTIVO de X                                       : ...020302
--   VX  viewer ACTIVO de X                                       : ...020303
--   SX  agente SUSPENDIDO de X, CON nombre (el caso del bug)      : ...020304
--   AX  agente ACTIVO de X (destino de la reasignación)           : ...020305
--   RX  agente REMOVED de X (salió: ya no le pertenece a nadie)   : ...020306
--   OS  owner SUSPENDIDO de X (NO debe recibir el aviso)          : ...020307
--   CX  agente ACTIVO de X, dueño de una propiedad ajena al caso  : ...020308
--   SN  agente SUSPENDIDO de X, SIN nombre (fallback del body)    : ...020309
--   DX  agente con DOS membresías suspendidas (X vieja, Y nueva)  : ...020311
--   OY  owner  ACTIVO de Y                                        : ...020321
--   AY  agente ACTIVO de Y                                        : ...020322
--   IND agente INDEPENDIENTE (nunca tuvo inmobiliaria)            : ...020331
--   B1..B6 buscadores                                             : ...02034X
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000020301', 'ox.203@test.local'),
  ('00000000-0000-0000-0000-000000020302', 'mx.203@test.local'),
  ('00000000-0000-0000-0000-000000020303', 'vx.203@test.local'),
  ('00000000-0000-0000-0000-000000020304', 'sx.203@test.local'),
  ('00000000-0000-0000-0000-000000020305', 'ax.203@test.local'),
  ('00000000-0000-0000-0000-000000020306', 'rx.203@test.local'),
  ('00000000-0000-0000-0000-000000020307', 'os.203@test.local'),
  ('00000000-0000-0000-0000-000000020308', 'cx.203@test.local'),
  ('00000000-0000-0000-0000-000000020309', 'sn.203@test.local'),
  ('00000000-0000-0000-0000-000000020311', 'dx.203@test.local'),
  ('00000000-0000-0000-0000-000000020321', 'oy.203@test.local'),
  ('00000000-0000-0000-0000-000000020322', 'ay.203@test.local'),
  ('00000000-0000-0000-0000-000000020331', 'ind.203@test.local'),
  ('00000000-0000-0000-0000-000000020341', 'b1.203@test.local'),
  ('00000000-0000-0000-0000-000000020342', 'b2.203@test.local'),
  ('00000000-0000-0000-0000-000000020343', 'b3.203@test.local'),
  ('00000000-0000-0000-0000-000000020344', 'b4.203@test.local'),
  ('00000000-0000-0000-0000-000000020345', 'b5.203@test.local'),
  ('00000000-0000-0000-0000-000000020346', 'b6.203@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000020304', -- SX
    '00000000-0000-0000-0000-000000020305', -- AX
    '00000000-0000-0000-0000-000000020306', -- RX
    '00000000-0000-0000-0000-000000020308', -- CX
    '00000000-0000-0000-0000-000000020309', -- SN
    '00000000-0000-0000-0000-000000020311', -- DX
    '00000000-0000-0000-0000-000000020322', -- AY
    '00000000-0000-0000-0000-000000020331'  -- IND
  );

-- SX tiene nombre completo: el aviso al owner debe DECIR de quién se trata.
update public.users set first_name = 'Sonia', last_name = 'Suspendida'
  where id = '00000000-0000-0000-0000-000000020304';
-- SN no lo tiene: el aviso NO puede quedar como 'contactó a , cuya cuenta...'.
update public.users set first_name = null, last_name = null
  where id = '00000000-0000-0000-0000-000000020309';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000020310', 'Inmobiliaria Sin Gestor 203', 'inmo-sin-gestor-203', 'active', '00000000-0000-0000-0000-000000020301'),
  ('00000000-0000-0000-0000-000000020320', 'Inmobiliaria Vecina 203',     'inmo-vecina-203',     'active', '00000000-0000-0000-0000-000000020321');

insert into public.agency_members (id, agency_id, user_id, member_role, status, created_at) values
  ('00000000-0000-0000-0000-000000020371', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020301', 'owner',  'active',    now()),
  ('00000000-0000-0000-0000-000000020372', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020302', 'admin',  'active',    now()),
  ('00000000-0000-0000-0000-000000020373', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020303', 'viewer', 'active',    now()),
  ('00000000-0000-0000-0000-000000020374', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020304', 'agent',  'suspended', now()),
  ('00000000-0000-0000-0000-000000020375', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020305', 'agent',  'active',    now()),
  ('00000000-0000-0000-0000-000000020376', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020306', 'agent',  'removed',   now()),
  ('00000000-0000-0000-0000-000000020377', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020307', 'owner',  'suspended', now()),
  ('00000000-0000-0000-0000-000000020378', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020308', 'agent',  'active',    now()),
  ('00000000-0000-0000-0000-000000020379', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020309', 'agent',  'suspended', now()),
  -- DX: dos membresías SUSPENDIDAS. La de X es VIEJA, la de Y es la RECIENTE.
  -- El índice agency_members_one_active_per_user solo restringe filas 'active',
  -- así que un histórico como éste es posible en producción.
  ('00000000-0000-0000-0000-00000002037a', '00000000-0000-0000-0000-000000020310', '00000000-0000-0000-0000-000000020311', 'agent',  'suspended', now() - interval '400 days'),
  ('00000000-0000-0000-0000-00000002037b', '00000000-0000-0000-0000-000000020320', '00000000-0000-0000-0000-000000020311', 'agent',  'suspended', now() - interval '10 days'),
  ('00000000-0000-0000-0000-00000002037c', '00000000-0000-0000-0000-000000020320', '00000000-0000-0000-0000-000000020321', 'owner',  'active',    now()),
  ('00000000-0000-0000-0000-00000002037d', '00000000-0000-0000-0000-000000020320', '00000000-0000-0000-0000-000000020322', 'agent',  'active',    now());

-- Inventario. P1/P2 son lo que quedó SIN GESTOR (SX suspendido). P3 está
-- soft-deleted, P4 quedó denormalizada bajo la agencia VECINA y P5 es de otro
-- agente: las tres son el control negativo de la reasignación.
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status, deleted_at) values
  ('00000000-0000-0000-0000-000000020351', '00000000-0000-0000-0000-000000020304', '00000000-0000-0000-0000-000000020310', 'casa', 'rent', 'Sin gestor 203 — P1 activa',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 15000, 'active', null),
  ('00000000-0000-0000-0000-000000020352', '00000000-0000-0000-0000-000000020304', '00000000-0000-0000-0000-000000020310', 'departamento', 'sale', 'Sin gestor 203 — P2 pausada',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'paused', null),
  ('00000000-0000-0000-0000-000000020353', '00000000-0000-0000-0000-000000020304', '00000000-0000-0000-0000-000000020310', 'casa', 'rent', 'Sin gestor 203 — P3 borrada',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 9000, 'active', now()),
  ('00000000-0000-0000-0000-000000020354', '00000000-0000-0000-0000-000000020304', '00000000-0000-0000-0000-000000020320', 'casa', 'rent', 'Sin gestor 203 — P4 de la agencia vecina',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 11000, 'active', null),
  ('00000000-0000-0000-0000-000000020355', '00000000-0000-0000-0000-000000020308', '00000000-0000-0000-0000-000000020310', 'casa', 'sale', 'Sin gestor 203 — P5 de otro agente',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.39, 20.71), 4326)::extensions.geography, 1800000, 'active', null),
  ('00000000-0000-0000-0000-000000020356', '00000000-0000-0000-0000-000000020322', '00000000-0000-0000-0000-000000020320', 'casa', 'rent', 'Sin gestor 203 — P6 de la vecina',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.40, 20.72), 4326)::extensions.geography, 13000, 'active', null);

-- ════════════════════════════════════════════════════════════════════════════
-- Los leads NACEN aquí: es el INSERT real el que dispara los dos triggers bajo
-- prueba (el BEFORE de ruteo y el AFTER de aviso). Ningún agency_id se escribe
-- a mano — si se escribiera, el test no probaría nada.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000020361', '00000000-0000-0000-0000-000000020304', '00000000-0000-0000-0000-000000020341', 'new'), -- L1 SX suspendido
  ('00000000-0000-0000-0000-000000020362', '00000000-0000-0000-0000-000000020305', '00000000-0000-0000-0000-000000020342', 'new'), -- L2 AX activo
  ('00000000-0000-0000-0000-000000020363', '00000000-0000-0000-0000-000000020306', '00000000-0000-0000-0000-000000020343', 'new'), -- L3 RX removed
  ('00000000-0000-0000-0000-000000020364', '00000000-0000-0000-0000-000000020331', '00000000-0000-0000-0000-000000020344', 'new'), -- L4 independiente
  ('00000000-0000-0000-0000-000000020365', '00000000-0000-0000-0000-000000020311', '00000000-0000-0000-0000-000000020345', 'new'), -- L5 DX 2 suspensiones
  ('00000000-0000-0000-0000-000000020366', '00000000-0000-0000-0000-000000020309', '00000000-0000-0000-0000-000000020346', 'new'); -- L6 SN sin nombre

-- ════════════════════════════════════════════════════════════════════════════
-- 1) RUTEO — leads.agency_id tras el INSERT.
-- ════════════════════════════════════════════════════════════════════════════

-- [DELTA] El corazón del bug: hoy esto es NULL y el lead se vuelve invisible.
select is(
  (select agency_id from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  '00000000-0000-0000-0000-000000020310'::uuid,
  'R1_DELTA_el_lead_de_un_agente_SUSPENDIDO_nace_bajo_la_agencia_donde_esta_suspendido'
);

-- [INVARIANTE] No-regresión de 75.5-bis (suite 31): el camino de siempre.
select is(
  (select agency_id from public.leads where id = '00000000-0000-0000-0000-000000020362'),
  '00000000-0000-0000-0000-000000020310'::uuid,
  'R2_INV_el_lead_de_un_agente_ACTIVO_sigue_naciendo_bajo_su_agencia'
);

-- [INVARIANTE] `removed` NO es `suspended`: el que SALIÓ de la inmobiliaria se
-- llevó su cartera. Darle el lead a la ex-agencia sería una fuga de PII.
select is(
  (select agency_id from public.leads where id = '00000000-0000-0000-0000-000000020363'),
  null::uuid,
  'R3_INV_el_lead_de_un_agente_REMOVED_sigue_naciendo_sin_agencia'
);

select is(
  (select agency_id from public.leads where id = '00000000-0000-0000-0000-000000020364'),
  null::uuid,
  'R4_INV_el_lead_de_un_agente_INDEPENDIENTE_sigue_naciendo_sin_agencia'
);

-- [DELTA] Con historial de varias suspensiones gana la MÁS RECIENTE, no la
-- primera que devuelva el índice: la agencia vigente es la última.
select is(
  (select agency_id from public.leads where id = '00000000-0000-0000-0000-000000020365'),
  '00000000-0000-0000-0000-000000020320'::uuid,
  'R5_DELTA_con_dos_membresias_suspendidas_gana_la_mas_reciente_por_created_at'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) VISIBILIDAD — leads_select bajo impersonación (nunca leyendo la policy).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000020301'); -- OX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  1,
  'V1_DELTA_el_owner_de_la_inmobiliaria_VE_el_lead_del_agente_suspendido'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000020302'); -- MX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  1,
  'V2_DELTA_el_admin_de_la_inmobiliaria_VE_el_lead_del_agente_suspendido'
);
reset role;

-- 🔒 El viewer NO entra al pipeline comercial (no-regresión de 30/77): el
-- arreglo abre la puerta al owner/admin, a NADIE más.
select pg_temp.act_as('00000000-0000-0000-0000-000000020303'); -- VX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  0,
  'V3_INV_el_viewer_sigue_SIN_ver_el_lead_ni_siquiera_el_del_suspendido'
);
reset role;

-- Suspender no le quita al agente su propio pipeline: la cuenta está congelada
-- para la app, no borrada. La rama agent_id = auth.uid() sigue viva.
select pg_temp.act_as('00000000-0000-0000-0000-000000020304'); -- SX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  1,
  'V4_INV_el_propio_agente_suspendido_sigue_viendo_su_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000020321'); -- OY
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  0,
  'V5_INV_el_owner_de_OTRA_inmobiliaria_no_ve_el_lead'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) AVISO lead_unmanaged — destinatarios EXACTOS. Se cuenta por
--    related_entity_id = el lead, para que un lead de otro fixture no
--    contamine el conteo.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id = '00000000-0000-0000-0000-000000020301'),
  1,
  'N1_DELTA_el_owner_ACTIVO_recibe_exactamente_un_aviso_lead_unmanaged'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id = '00000000-0000-0000-0000-000000020302'),
  1,
  'N2_DELTA_el_admin_ACTIVO_recibe_exactamente_un_aviso_lead_unmanaged'
);

-- Avisarle al suspendido sería el bug original con otro nombre: el punto es que
-- lo atienda ALGUIEN MÁS.
select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id = '00000000-0000-0000-0000-000000020304'),
  0,
  'N3_GUARD_el_propio_agente_suspendido_NO_recibe_el_aviso'
);

-- Un owner suspendido es una cuenta congelada: tampoco abre ese buzón.
select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id = '00000000-0000-0000-0000-000000020307'),
  0,
  'N4_GUARD_un_owner_SUSPENDIDO_de_la_misma_agencia_NO_recibe_el_aviso'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id in ('00000000-0000-0000-0000-000000020303',   -- VX viewer
                      '00000000-0000-0000-0000-000000020305',   -- AX agente raso
                      '00000000-0000-0000-0000-000000020321')), -- OY owner ajeno
  0,
  'N5_GUARD_ni_el_viewer_ni_un_agente_raso_ni_el_owner_de_otra_agencia_reciben_el_aviso'
);

-- El owner tiene que saber DE QUIÉN es el lead sin abrir la app: el nombre va
-- en el body, no solo en el data.
select is(
  (select body from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id = '00000000-0000-0000-0000-000000020301'),
  'Un buscador contactó a Sonia Suspendida, cuya cuenta está suspendida. Atiéndelo desde el CRM.',
  'N6_DELTA_el_body_nombra_al_agente_suspendido'
);

select is(
  (select title || '|' || deep_link || '|' || related_entity_type || '|' ||
          (data ->> 'agent_user_id') || '|' || (data ->> 'agent_name')
     from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020361'
      and user_id = '00000000-0000-0000-0000-000000020301'),
  'Nuevo lead sin gestor|/crm|lead|00000000-0000-0000-0000-000000020304|Sonia Suspendida',
  'N7_DELTA_title_deep_link_related_entity_type_y_data_del_aviso'
);

-- 🔒 No-regresión dura: el camino sano (agente activo) NO genera ruido. Si esto
-- fallara, cada lead normal de la plataforma spamearía a su owner.
select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020362'),
  0,
  'N8_INV_un_lead_de_agente_ACTIVO_no_genera_NINGUN_aviso_lead_unmanaged'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id in ('00000000-0000-0000-0000-000000020363',   -- L3 removed
                                '00000000-0000-0000-0000-000000020364')), -- L4 independiente
  0,
  'N9_INV_un_lead_sin_agencia_removed_o_independiente_no_genera_aviso'
);

-- Sin nombre en el perfil el aviso sigue siendo una frase en español, no
-- 'contactó a , cuya cuenta...'.
select is(
  (select body from public.notifications
    where type = 'lead_unmanaged'
      and related_entity_id = '00000000-0000-0000-0000-000000020366'
      and user_id = '00000000-0000-0000-0000-000000020301'),
  'Un buscador contactó a un agente suspendido, cuya cuenta está suspendida. Atiéndelo desde el CRM.',
  'N10_DELTA_sin_nombre_de_perfil_el_body_cae_al_texto_generico'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) ANCLAS de catálogo — firma, security definer, search_path y ACL de la RPC,
--    más el trigger de ruteo (que debe seguir siendo BEFORE INSERT: si pasara a
--    AFTER, `new.agency_id` ya no se persistiría y R1-R5 pasarían por accidente
--    en algún refactor futuro).
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'reassign_member_properties_atomic', array['uuid','uuid','uuid'],
  'META1_la_RPC_existe_y_recibe_agencia_origen_y_destino');

select is(
  (select pg_get_function_result(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reassign_member_properties_atomic' limit 1),
  'integer',
  'META2_devuelve_cuantas_publicaciones_movio'
);

-- 🔒 El ACTOR no viaja como parámetro: sale de auth.uid(). Si la firma creciera
-- con un p_caller_id, cualquiera reasignaría a nombre de otro (criterio #191/#213).
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reassign_member_properties_atomic' limit 1),
  'p_agency_id uuid, p_from_user_id uuid, p_to_user_id uuid',
  'META3_TRES_parametros_el_actor_NO_viaja_como_argumento'
);

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reassign_member_properties_atomic' limit 1),
  true,
  'META4_es_security_definer_escribe_en_admin_actions_que_exige_is_admin'
);

select is(
  (select exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
     where n.nspname = 'public' and p.proname = 'reassign_member_properties_atomic'
       and cfg.setting = 'search_path=public, pg_temp')),
  true,
  'META5_search_path_fijo_a_public_pg_temp'
);

select is(
  (select exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reassign_member_properties_atomic'
       and array_to_string(p.proacl, ',') like '%authenticated=X%')),
  true,
  'META6_authenticated_SI_puede_ejecutarla_es_el_punto_de_esta_RPC'
);

select is(
  (select exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reassign_member_properties_atomic'
       and array_to_string(p.proacl, ',') like '%anon=X%')),
  false,
  'META7_GUARD_anon_NO_aparece_en_el_ACL_ni_por_herencia_de_public'
);

select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
    where t.tgrelid = 'public.leads'::regclass and t.tgname = 'trg_set_lead_agency_id'),
  'CREATE TRIGGER trg_set_lead_agency_id BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION private.set_lead_agency_id()',
  'META8_INV_el_trigger_de_ruteo_sigue_siendo_BEFORE_INSERT_por_fila'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) RPC — camino feliz. OX (owner) pasa el inventario de SX a AX.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000020301'); -- OX
insert into res_91 values ('HAPPY', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020304',
  '00000000-0000-0000-0000-000000020305'));
reset role;

-- P1 (activa) + P2 (pausada) = 2. El inventario es de la AGENCIA: se mueve en
-- cualquier estado no borrado, no solo el publicado.
select is(
  (select v from res_91 where k = 'HAPPY'),
  'ok|2',
  'H1_DELTA_el_owner_reasigna_las_2_publicaciones_no_borradas_del_suspendido'
);

select is(
  (select string_agg(owner_user_id::text, ',' order by id)
     from public.properties
    where id in ('00000000-0000-0000-0000-000000020351', '00000000-0000-0000-0000-000000020352')),
  '00000000-0000-0000-0000-000000020305,00000000-0000-0000-0000-000000020305',
  'H2_DELTA_P1_activa_y_P2_pausada_quedaron_a_cargo_del_destino'
);

-- 🔒 Una publicación borrada no revive con dueño nuevo.
select is(
  (select owner_user_id from public.properties where id = '00000000-0000-0000-0000-000000020353'),
  '00000000-0000-0000-0000-000000020304'::uuid,
  'H3_GUARD_la_publicacion_soft_deleted_NO_se_toca'
);

-- 🔒 El owner de X no manda sobre el inventario que quedó bajo la agencia Y.
select is(
  (select owner_user_id from public.properties where id = '00000000-0000-0000-0000-000000020354'),
  '00000000-0000-0000-0000-000000020304'::uuid,
  'H4_GUARD_la_publicacion_denormalizada_bajo_OTRA_agencia_NO_se_toca'
);

select is(
  (select owner_user_id from public.properties where id = '00000000-0000-0000-0000-000000020355'),
  '00000000-0000-0000-0000-000000020308'::uuid,
  'H5_GUARD_la_publicacion_de_OTRO_agente_de_la_misma_agencia_NO_se_toca'
);

-- 🔒 Reasignar toca datos de personas reales (§0.5): queda auditado CON los ids
-- exactos que se movieron, no solo el conteo.
select is(
  (select aa.action_type || '|' || aa.entity_type || '|' || aa.admin_id::text || '|' ||
          (aa.old_values ->> 'from_user_id') || '|' ||
          (aa.new_values ->> 'to_user_id') || '|' ||
          (aa.new_values ->> 'count') || '|' ||
          (select string_agg(e, ',' order by e) from jsonb_array_elements_text(aa.old_values -> 'property_ids') e)
     from public.admin_actions aa
    where aa.action_type = 'reassign_member_properties'
      and aa.entity_id = '00000000-0000-0000-0000-000000020310'),
  'reassign_member_properties|agency|00000000-0000-0000-0000-000000020301|'
  || '00000000-0000-0000-0000-000000020304|00000000-0000-0000-0000-000000020305|2|'
  || '00000000-0000-0000-0000-000000020351,00000000-0000-0000-0000-000000020352',
  'H6_DELTA_la_reasignacion_queda_auditada_con_actor_origen_destino_conteo_e_ids'
);

select is(
  (select n.title || '|' || n.body || '|' || n.deep_link || '|' || n.related_entity_type || '|' ||
          n.related_entity_id::text || '|' || (n.data ->> 'count') || '|' || (n.data ->> 'from_user_id')
     from public.notifications n
    where n.type = 'properties_reassigned'
      and n.user_id = '00000000-0000-0000-0000-000000020305'),
  'Te asignaron publicaciones|2 publicación(es) de tu inmobiliaria ahora están a tu cargo.'
  || '|/profile/my-listings|agency|00000000-0000-0000-0000-000000020310|2|'
  || '00000000-0000-0000-0000-000000020304',
  'H7_DELTA_el_destino_recibe_el_aviso_properties_reassigned_con_el_conteo'
);

-- 🔒 EL INVARIANTE MÁS IMPORTANTE DE ESTA SUBTAREA: el buscador NO cambia de
-- interlocutor en silencio. Reasignar el INVENTARIO no toca los LEADS ya
-- creados — quien ya venía hablando con SX sigue hablando con SX (y ahora el
-- owner también lo ve). Reasignar leads es fase 2, con aviso al buscador.
select is(
  (select agent_id::text || '|' || coalesce(agency_id::text, 'null')
     from public.leads where id = '00000000-0000-0000-0000-000000020361'),
  '00000000-0000-0000-0000-000000020304|00000000-0000-0000-0000-000000020310',
  'H8_DELTA_los_LEADS_existentes_NO_cambian_de_agente_ni_de_agencia'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) N=0 no es un error — es el caso normal de un agente sin inventario (y de
--    darle doble tap al botón).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000020301'); -- OX otra vez
insert into res_91 values ('ZERO', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020304',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is(
  (select v from res_91 where k = 'ZERO'),
  'ok|0',
  'Z1_DELTA_reasignar_a_quien_ya_no_tiene_inventario_devuelve_0_sin_error'
);

select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'reassign_member_properties'
      and entity_id = '00000000-0000-0000-0000-000000020310'),
  1,
  'Z2_DELTA_la_pasada_de_0_filas_NO_agrega_una_segunda_fila_de_auditoria'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'properties_reassigned'
      and user_id = '00000000-0000-0000-0000-000000020305'),
  1,
  'Z3_DELTA_la_pasada_de_0_filas_NO_manda_un_segundo_aviso'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Errores y permisos.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000020301', 'anon');
insert into res_91 values ('E1', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020308',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is(
  (select split_part(v, '|', 1) from res_91 where k = 'E1'),
  '42501',
  'E1_DELTA_anon_no_puede_ejecutar_la_RPC_42501_no_es_solo_que_RLS_lo_filtre'
);

set local role authenticated;
select set_config('request.jwt.claims', null, true);
insert into res_91 values ('E2', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020308',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is(
  (select v from res_91 where k = 'E2'),
  'P0001|NOT_AUTHENTICATED',
  'E2_DELTA_authenticated_sin_JWT_recibe_NOT_AUTHENTICATED'
);

-- 🔒 Un solo código para las 4 causas de rechazo: la RPC no es un oráculo de
-- qué inmobiliarias existen ni de quién es miembro de cuál.
select pg_temp.act_as('00000000-0000-0000-0000-000000020308'); -- CX agente raso
insert into res_91 values ('E3', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020304',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is((select v from res_91 where k = 'E3'), 'P0001|NOT_AUTHORIZED',
  'E3_DELTA_un_agente_raso_de_la_agencia_no_puede_reasignar');

select pg_temp.act_as('00000000-0000-0000-0000-000000020303'); -- VX viewer
insert into res_91 values ('E4', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020304',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is((select v from res_91 where k = 'E4'), 'P0001|NOT_AUTHORIZED',
  'E4_DELTA_un_viewer_no_puede_reasignar_solo_mira');

select pg_temp.act_as('00000000-0000-0000-0000-000000020321'); -- OY owner de la vecina
insert into res_91 values ('E5', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020304',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is((select v from res_91 where k = 'E5'), 'P0001|NOT_AUTHORIZED',
  'E5_DELTA_el_owner_de_OTRA_inmobiliaria_no_puede_reasignar_aqui');

select pg_temp.act_as('00000000-0000-0000-0000-000000020331'); -- IND independiente
insert into res_91 values ('E6', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020304',
  '00000000-0000-0000-0000-000000020305'));
reset role;

select is((select v from res_91 where k = 'E6'), 'P0001|NOT_AUTHORIZED',
  'E6_DELTA_un_agente_independiente_no_puede_reasignar_en_una_agencia_ajena');

-- El destino tiene que poder ATENDER lo que recibe: mover el inventario a otra
-- cuenta congelada sería el mismo bug otra vez.
select pg_temp.act_as('00000000-0000-0000-0000-000000020301'); -- OX
insert into res_91 values ('E7', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020308',
  '00000000-0000-0000-0000-000000020309')); -- SN suspendido
insert into res_91 values ('E8', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020308',
  '00000000-0000-0000-0000-000000020306')); -- RX removed
insert into res_91 values ('E9', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020308',
  '00000000-0000-0000-0000-000000020322')); -- AY, activo pero en OTRA agencia
insert into res_91 values ('E10', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020310',
  '00000000-0000-0000-0000-000000020308',
  '00000000-0000-0000-0000-000000020308'));
reset role;

select is((select v from res_91 where k = 'E7'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'E7_DELTA_no_se_puede_reasignar_a_un_miembro_SUSPENDIDO');

select is((select v from res_91 where k = 'E8'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'E8_DELTA_no_se_puede_reasignar_a_un_miembro_REMOVED');

select is((select v from res_91 where k = 'E9'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'E9_DELTA_no_se_puede_reasignar_a_un_activo_de_OTRA_inmobiliaria');

select is((select v from res_91 where k = 'E10'), 'P0001|SAME_USER',
  'E10_DELTA_origen_y_destino_iguales_es_SAME_USER_no_un_no_op_silencioso');

-- El owner puede quedarse él mismo el inventario, y el ORIGEN no necesita estar
-- suspendido: es su inmobiliaria y la reasignación es una herramienta de
-- gestión, no un castigo atado a la suspensión.
select pg_temp.act_as('00000000-0000-0000-0000-000000020321'); -- OY
insert into res_91 values ('E11', pg_temp.reassign(
  '00000000-0000-0000-0000-000000020320',
  '00000000-0000-0000-0000-000000020322',  -- AY: ACTIVO, no suspendido
  '00000000-0000-0000-0000-000000020321')); -- destino: el propio owner
reset role;

select is(
  (select (select v from res_91 where k = 'E11') || '|' ||
          (select owner_user_id::text from public.properties where id = '00000000-0000-0000-0000-000000020356')),
  'ok|1|00000000-0000-0000-0000-000000020321',
  'E11_DELTA_el_owner_puede_quedarse_el_inventario_de_un_agente_ACTIVO_de_su_agencia'
);

select * from finish();
rollback;

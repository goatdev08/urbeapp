-- Tests pgTAP — Cierre de #31: el owner/admin ACTIVO de la agencia EDITA los leads del
-- equipo (subtarea 269.3, exploración 045 §6.6/D10-bis).
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
--     -tAq -f /dev/stdin < supabase/tests/109_leads_owner_write_test.sql
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los fixtures
-- se insertan directo (bypass RLS); las aserciones impersonan con pg_temp.act_as(uid,role)
-- (mismo patrón que 02/08/18/21/25/27/28/29/30/31/77/90/107/108).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — desde 20260604000010 (#28/#75.5) la visibilidad (SELECT) del owner/admin de
-- agencia sobre el pipeline del equipo se amplió varias veces (75.5, 75.5-bis/#31-parcial,
-- #226), pero la ESCRITURA se dejó a propósito solo para el agente dueño (private.can_edit_lead
-- y la policy leads_update: `agent_id = auth.uid() or private.is_admin()`), anclada por
-- I9/I10 (30_leads_admin_visibility_test.sql) e I5 (31_leads_agency_id_denorm_test.sql). Esa
-- línea era la #31, diferida. Decisión de Abraham (2026-09-07): el owner Y el admin ACTIVOS
-- de la agencia DEL LEAD (leads.agency_id, no la membresía "hoy" del agente) ya pueden
-- gestionar (editar) los leads de su equipo, no solo leerlos.
--
-- SEAM bajo prueba (comportamiento observable vía impersonación JWT, NUNCA internals):
--   1) private.can_edit_lead(uuid)     (20260604000010:96 — hoy `agent_id=auth.uid() or
--      is_admin()`; gatea también lead_origin_insert, 20260604000010:344)
--   2) policy leads_update (USING + WITH CHECK) (20260604000010:331-333 — hoy
--      `agent_id=auth.uid() or is_admin()`)
--   3) policy lead_origin_insert (20260604000010:344 — `with check
--      (private.can_edit_lead(lead_id))`) — efecto lateral de (1), no un SUT nuevo.
--
-- SUT AÚN NO EXISTE (RED, 2026-09-06): lo crea
--   supabase/migrations/20260906400003_leads_owner_write.sql (fuera de esta fase) —
--   `private.can_edit_lead` y `leads_update` (USING+WITH CHECK) pasan a:
--     agent_id = auth.uid()
--       OR private.agency_role_of(leads.agency_id) in ('owner','admin')
--       OR private.is_admin()
--   (private.agency_role_of, 20260805000003, ya filtra por status='active' — un
--   suspendido/removido resuelve NULL, nunca entra al IN).
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30/31/77/90) ──────────────
-- DELTA      = falla HOY, pasa tras el GREEN (discrimina la implementación real).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión: agente dueño, agente raso, viewer,
--   suspendido, otra agencia, admin de PLATAFORMA, agente independiente — NINGUNO de estos
--   casos cambia con este GREEN, y el guardian debe re-verificar que siguen en verde por la
--   razón correcta).
--
-- ── D-WITHCHECK (decisión del test-author, delegada explícitamente por la subtarea:
--    "decide y fija") ───────────────────────────────────────────────────────────────────
-- La propuesta del PLAN es reusar LA MISMA expresión de USING como WITH CHECK, evaluada
-- sobre la fila NUEVA — mismo patrón EXACTO que properties_update (#100/#202,
-- 20260904100001): USING mira la agencia VIEJA, WITH CHECK mira la agencia NUEVA. Igual que
-- en properties_update, esta expresión NO valida que el `agent_id` nuevo sea miembro de
-- `agency_id` cuando `agency_id` NO cambia — lo único que realmente defiende es que el owner
-- NO pueda RELOCALIZAR la fila hacia una agencia donde no es owner/admin (si cambia agency_id
-- Y agent_id a la vez hacia una agencia ajena, agency_role_of(NEW.agency_id) es NULL para él y
-- NEW.agent_id != él → WITH CHECK falla). Por eso WITHCHECK1/WITHCHECK2 abajo prueban
-- EXACTAMENTE ese par de escenarios (reasignar DENTRO de la misma agencia hacia otro miembro
-- ACTIVO -- sí; reasignar HACIA una agencia ajena -- no) — no se inventa una garantía más
-- fina ("el nuevo agent_id debe ser miembro activo de ESA MISMA agencia") porque esa validación
-- ya vive, con sus propios matices (excluye viewer, código SAME_USER, auditoría), en la RPC
-- dedicada `public.reassign_lead_atomic` (subtarea 269.2, 20260906400002) — la RPC es el canal
-- oficial de reasignación; este RLS es la red de seguridad genérica contra un PATCH crudo.
--
-- ── 🔴 BLOQUEANTE (hallazgo del test-author, verificado empíricamente, 2026-09-06) ───────
-- El PLAN de la subtarea pedía anclar "is_admin() de plataforma sigue editando (1 fila)".
-- Verificado por impersonación real contra el local: HOY un admin de PLATAFORMA sin
-- relación de agencia (`private.is_admin()=true`) NO puede hacer UPDATE de un lead ajeno vía
-- RLS — afecta 0 filas — aunque `leads_update.using` incluya `or private.is_admin()`.
-- CAUSA: Postgres exige que la fila sea VISIBLE por la policy de SELECT de la tabla ADEMÁS
-- de pasar el USING de UPDATE/DELETE (verificado por contraste: agregar `is_admin()` a
-- `leads_select` en la misma transacción hace que el UPDATE SÍ afecte 1 fila). Desde
-- `20260901000001` (#226) `leads_select` YA NO incluye `is_admin()` (fix de fuga de PII) —
-- así que la rama `is_admin()` de `leads_update`/`leads_delete` quedó INERTE para cualquier
-- admin de plataforma sin relación de agencia, sin que #226 lo notara (su propio archivo,
-- 77_leads_admin_plataforma_test.sql, solo prueba SELECT/lectura, nunca UPDATE).
-- Esta subtarea (269.3) NO toca `leads_select` (fuera de su footprint: SUT = can_edit_lead +
-- leads_update/lead_origin_insert) y no puede resucitar esa rama sin revertir la decisión de
-- privacidad de #226 — por eso el caso NO se ancla en este archivo (un test que jamás puede
-- pasar con el GREEN planeado de 269.3 no es RED válido, es una garantía inventada). Se
-- reporta aquí como HALLAZGO para que el orquestador abra la derivada
-- `hardening(226): private.is_admin() inerte en leads_update/leads_delete` (origen: RED de
-- 269.3, detectado por test-author) — decidir si se resuelve con una RPC SECURITY DEFINER
-- dedicada para el admin de plataforma (bypassa RLS, no reexpone leads_select) o se acepta
-- como alcance retirado de #226 con el comentario de esa migración corregido.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(15);

-- Helper de impersonación (mismo patrón que 02/.../90/107/108).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-0000001093XX' (subtarea 269.3,
-- archivo 109 — sin colisión con 0755XX/0758XX/0202XX/0226XX/269XXX de 30/31/90/77/107/108).
--   USERS:
--     01 OX   owner  ACTIVO agencia X                        (bajo prueba, DELTA)
--     02 AX   admin  ACTIVO agencia X                        (bajo prueba, DELTA)
--     03 VX   viewer ACTIVO agencia X                        (invariante: sigue en 0)
--     04 SOX  owner  SUSPENDIDO agencia X                    (invariante: sigue en 0)
--     05 SAX  admin  SUSPENDIDO agencia X                    (invariante: sigue en 0)
--     06 GX   agent  ACTIVO agencia X, DUEÑO real del lead   (invariante: sigue en 1)
--     07 RX   agent  ACTIVO agencia X, agente RASO (ajeno)   (invariante: sigue en 0)
--     08 MX   agent  ACTIVO agencia X, destino válido reasignación
--     09 OY   owner  ACTIVO agencia Y (OTRA agencia, ajena)  (invariante: sigue en 0)
--     10 HH   agente INDEPENDIENTE (nunca tuvo agencia)      (invariante: sigue en 1 sobre lo suyo)
--     11 BX   buscador del lead de GX
--     12 BH   buscador del lead de HH
--     13 PA   admin de PLATAFORMA (users.role='admin'), SIN relación con ninguna agencia
--     14 B2   buscador del lead 343 (WITHCHECK1) · 15 B3 buscador del lead 344 (WITHCHECK2)
--        — distintos de BX: leads_agent_user_unique_active exige un par (agent_id,user_id)
--        único, y GX es agent_id de 341/343/344 a la vez.
--   AGENCIES: 20=X, 21=Y
--   AGENCY_MEMBERS: 31=X/OX(owner,active) 32=X/AX(admin,active) 33=X/VX(viewer,active)
--     34=X/SOX(owner,suspended) 35=X/SAX(admin,suspended) 36=X/GX(agent,active)
--     37=X/RX(agent,active) 38=X/MX(agent,active) 39=Y/OY(owner,active)
--   LEADS: 41=lead de GX en X (happy path, múltiples actores) · 42=lead de HH (agency_id NULL)
--     43=lead de GX en X (WITH CHECK — reasignación DENTRO de la agencia) · 44=lead de GX en X
--     (WITH CHECK — intento de reasignación HACIA agencia ajena)
--   PROPERTIES: 51=propiedad de GX (efecto lateral lead_origin_insert sobre el lead 41)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000109301', 'ox.1093@test.local'),
  ('00000000-0000-0000-0000-000000109302', 'ax.1093@test.local'),
  ('00000000-0000-0000-0000-000000109303', 'vx.1093@test.local'),
  ('00000000-0000-0000-0000-000000109304', 'sox.1093@test.local'),
  ('00000000-0000-0000-0000-000000109305', 'sax.1093@test.local'),
  ('00000000-0000-0000-0000-000000109306', 'gx.1093@test.local'),
  ('00000000-0000-0000-0000-000000109307', 'rx.1093@test.local'),
  ('00000000-0000-0000-0000-000000109308', 'mx.1093@test.local'),
  ('00000000-0000-0000-0000-000000109309', 'oy.1093@test.local'),
  ('00000000-0000-0000-0000-000000109310', 'hh.1093@test.local'),
  ('00000000-0000-0000-0000-000000109311', 'bx.1093@test.local'),
  ('00000000-0000-0000-0000-000000109312', 'bh.1093@test.local'),
  ('00000000-0000-0000-0000-000000109313', 'pa.1093@test.local'),
  ('00000000-0000-0000-0000-000000109314', 'b2.1093@test.local'),
  ('00000000-0000-0000-0000-000000109315', 'b3.1093@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000109306', -- GX
    '00000000-0000-0000-0000-000000109307', -- RX
    '00000000-0000-0000-0000-000000109308', -- MX
    '00000000-0000-0000-0000-000000109310'  -- HH
  );
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000109313'; -- PA (admin de PLATAFORMA)

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000109320', 'Inmobiliaria Owner-Write X 1093', 'inmo-owner-write-x-1093', 'active', '00000000-0000-0000-0000-000000109301'),
  ('00000000-0000-0000-0000-000000109321', 'Inmobiliaria Owner-Write Y 1093', 'inmo-owner-write-y-1093', 'active', '00000000-0000-0000-0000-000000109309');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000109331', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109301', 'owner',  'active'),    -- OX
  ('00000000-0000-0000-0000-000000109332', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109302', 'admin',  'active'),    -- AX
  ('00000000-0000-0000-0000-000000109333', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109303', 'viewer', 'active'),    -- VX
  ('00000000-0000-0000-0000-000000109334', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109304', 'owner',  'suspended'), -- SOX
  ('00000000-0000-0000-0000-000000109335', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109305', 'admin',  'suspended'), -- SAX
  ('00000000-0000-0000-0000-000000109336', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109306', 'agent',  'active'),    -- GX
  ('00000000-0000-0000-0000-000000109337', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109307', 'agent',  'active'),    -- RX
  ('00000000-0000-0000-0000-000000109338', '00000000-0000-0000-0000-000000109320', '00000000-0000-0000-0000-000000109308', 'agent',  'active'),    -- MX
  ('00000000-0000-0000-0000-000000109339', '00000000-0000-0000-0000-000000109321', '00000000-0000-0000-0000-000000109309', 'owner',  'active');    -- OY (agencia Y)

-- Lead bajo prueba (happy path, múltiples actores — ninguno de los tests de esta sección
-- toca agent_id/agency_id, solo status/internal_notes, así que el orden entre actores no
-- contamina la autorización de los siguientes).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000109341', '00000000-0000-0000-0000-000000109306', '00000000-0000-0000-0000-000000109311', 'new'); -- GX↔BX, agencia X

-- Lead del agente INDEPENDIENTE (agency_id NULL — nunca perteneció a una agencia).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000109342', '00000000-0000-0000-0000-000000109310', '00000000-0000-0000-0000-000000109312', 'new'); -- HH↔BH, agencia NULL

-- Leads dedicados a WITH CHECK (aislados del happy path para que una reasignación de
-- agent_id/agency_id no contamine ninguna otra aserción).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000109343', '00000000-0000-0000-0000-000000109306', '00000000-0000-0000-0000-000000109314', 'new'), -- WITHCHECK1 (reasignar dentro de X)
  ('00000000-0000-0000-0000-000000109344', '00000000-0000-0000-0000-000000109306', '00000000-0000-0000-0000-000000109315', 'new'); -- WITHCHECK2 (intento hacia Y)

-- Propiedad de GX — efecto lateral lead_origin_insert sobre el lead 341.
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000109351', '00000000-0000-0000-0000-000000109306',
   '00000000-0000-0000-0000-000000109320', 'departamento', 'rent', 'Fixture 269.3 — propiedad de GX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 13500, 'active');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) [DELTA] OWNER activo de la agencia del lead escribe: UPDATE afecta 1 fila,
--    private.can_edit_lead pasa a true.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109301'); -- OX
with u as (
  update public.leads set status = 'contacted', internal_notes = 'nota del owner'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 1, 'D1_owner_activo_actualiza_status_y_nota_del_lead_de_su_agente') from u;
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000109341'),
  true,
  'D2_can_edit_lead_true_para_el_owner_activo_de_la_agencia'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [DELTA] ADMIN activo de la agencia del lead escribe: mismo par de aserciones.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109302'); -- AX
with u as (
  update public.leads set status = 'interested', internal_notes = 'nota del admin'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 1, 'D3_admin_activo_actualiza_status_y_nota_del_lead_del_equipo') from u;
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000109341'),
  true,
  'D4_can_edit_lead_true_para_el_admin_activo_de_la_agencia'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [INVARIANTE] viewer ACTIVO de la agencia — la matriz de roles (#71) no le da
--    escritura sobre el pipeline (solo owner/admin la ganan aquí).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109303'); -- VX
with u as (
  update public.leads set internal_notes = 'intento de escritura del viewer'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 0, 'I1_viewer_activo_no_puede_escribir_leads_del_equipo') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [INVARIANTE] owner SUSPENDIDO de la agencia — private.agency_role_of resuelve NULL
--    para membresía no-activa (mismo mecanismo que #202); nunca entra al IN(owner,admin).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109304'); -- SOX
with u as (
  update public.leads set internal_notes = 'intento de escritura del owner suspendido'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 0, 'I2_owner_suspendido_no_puede_escribir_leads_del_equipo') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [INVARIANTE] admin SUSPENDIDO de la agencia — mismo mecanismo.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109305'); -- SAX
with u as (
  update public.leads set internal_notes = 'intento de escritura del admin suspendido'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 0, 'I3_admin_suspendido_no_puede_escribir_leads_del_equipo') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [INVARIANTE crítica — mutante clásico #100] owner ACTIVO de OTRA agencia (Y) —
--    la comparación debe ser contra leads.agency_id REAL, nunca "cualquier owner activo".
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109309'); -- OY
with u as (
  update public.leads set internal_notes = 'intento de escritura del owner de otra agencia'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 0, 'I4_owner_de_otra_agencia_no_puede_escribir_leads_ajenos') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) [INVARIANTE] agente RASO de la MISMA agencia (sin ser dueño del lead) — la línea
--    que #31 amplía es owner/admin, NUNCA "cualquier miembro de mi agencia".
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109307'); -- RX
with u as (
  update public.leads set internal_notes = 'intento de escritura del agente raso'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 0, 'I5_agente_raso_de_la_agencia_no_puede_escribir_leads_ajenos') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) [INVARIANTE] el agente DUEÑO del lead sigue editando lo suyo (agent_id=auth.uid()
--    nunca se toca en este cambio).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109306'); -- GX
with u as (
  update public.leads set internal_notes = 'nota del propio agente'
   where id = '00000000-0000-0000-0000-000000109341'
   returning id
)
select is(count(*)::int, 1, 'I6_agente_dueno_sigue_escribiendo_su_propio_lead') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) [INVARIANTE] lead con agency_id NULL (agente INDEPENDIENTE) — solo su propio
--    agente lo edita; ningún owner/admin de una agencia real (aunque exista) lo alcanza,
--    porque private.agency_role_of(NULL) resuelve NULL (nunca entra al IN).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109310'); -- HH (independiente)
with u as (
  update public.leads set internal_notes = 'nota del agente independiente'
   where id = '00000000-0000-0000-0000-000000109342'
   returning id
)
select is(count(*)::int, 1, 'I7_agente_independiente_sigue_escribiendo_su_propio_lead') from u;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000109302'); -- AX (admin de X, sin relación con HH)
with u as (
  update public.leads set internal_notes = 'intento de escritura sobre lead independiente'
   where id = '00000000-0000-0000-0000-000000109342'
   returning id
)
select is(count(*)::int, 0, 'I8_ningun_admin_de_agencia_alcanza_el_lead_de_un_agente_independiente') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) [DELTA] WITH CHECK — el owner reasigna agent_id a OTRO MIEMBRO ACTIVO de la
--    MISMA agencia (agency_id sin cambiar): la fila nueva sigue satisfaciendo
--    agency_role_of(agency_id) para el owner → permitido.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109301'); -- OX
with u as (
  update public.leads set agent_id = '00000000-0000-0000-0000-000000109308' -- MX
   where id = '00000000-0000-0000-0000-000000109343'
   returning id
)
select is(count(*)::int, 1, 'D5_owner_reasigna_agent_id_a_otro_miembro_activo_de_la_misma_agencia') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) [DELTA] WITH CHECK — el owner NO puede mover el lead (agent_id + agency_id a la
--    vez) hacia una agencia AJENA (Y): la fila nueva ya no satisface agency_role_of
--    para el owner (NULL en Y) → la policy RECHAZA la fila nueva (42501), no "0 filas"
--    (ver D-WITHCHECK en la cabecera).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109301'); -- OX
select throws_ok(
  $$ update public.leads set agent_id = '00000000-0000-0000-0000-000000109309',
       agency_id = '00000000-0000-0000-0000-000000109321'
     where id = '00000000-0000-0000-0000-000000109344' $$,
  '42501', null,
  'D6_owner_no_puede_mover_el_lead_hacia_una_agencia_ajena'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12) [HALLAZGO — NO se ancla aquí, ver cabecera "BLOQUEANTE 226"] "admin de
--    PLATAFORMA sigue editando cualquier lead" NO se prueba en este archivo:
--    verificado empíricamente (docker exec, 2026-09-06) que HOY, con o sin el GREEN
--    de 269.3, un `UPDATE public.leads` real por RLS para PA (is_admin()=true, SIN
--    relación de agencia) afecta 0 filas — Postgres exige que la fila sea VISIBLE
--    por la policy de SELECT (leads_select) ADEMÁS de pasar el USING de UPDATE, y
--    leads_select dejó de incluir is_admin() en 20260901000001 (#226, fuga de PII).
--    private.is_admin() en leads_update/leads_delete quedó INERTE para un admin de
--    plataforma sin relación desde ese momento — 269.3 no toca leads_select (fuera
--    de su footprint) y no puede resucitarlo sin revertir el fix de privacidad de
--    #226. Es un bug LATENTE de #226, no algo que esta subtarea introduzca ni deba
--    arreglar calladamente. Ver BLOQUEANTE en la cabecera.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 13) [DELTA — efecto lateral] can_edit_lead también gatea lead_origin_insert
--    (20260604000010:344): el owner activo ahora puede insertar un origen para un
--    lead de su agente (hoy no puede, porque can_edit_lead hoy es agent_id/is_admin
--    puro). lead_origin_properties NO tiene policy de SELECT propia que combinar —
--    solo WITH CHECK en INSERT — y una violación de WITH CHECK en INSERT SIEMPRE
--    lanza una excepción (nunca "0 filas" silencioso, a diferencia de UPDATE con
--    USING): se envuelve en `lives_ok` + DO (mismo patrón que I9/I10 de
--    30_leads_admin_visibility_test.sql) para poder leer el row_count real y
--    convertir la excepción de hoy en un "not ok" legible en vez de abortar la
--    transacción completa.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000109301'); -- OX
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    insert into public.lead_origin_properties (lead_id, property_id)
    values ('00000000-0000-0000-0000-000000109341', '00000000-0000-0000-0000-000000109351');
    get diagnostics v_count = row_count;
    if v_count is distinct from 1 then
      raise exception 'el owner activo de la agencia debe poder insertar un lead_origin_properties para un lead de su agente; filas insertadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'D7_owner_activo_puede_insertar_lead_origin_properties_de_un_lead_de_su_agente'
);
reset role;

select * from finish();
rollback;

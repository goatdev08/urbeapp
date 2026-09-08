-- Tests pgTAP — hardening(226): retirar `private.is_admin()` de leads_update, leads_delete
-- y private.can_edit_lead para que la frontera de ESCRITURA sobre public.leads sea UNA SOLA
-- (subtarea 276.1, origen: hallazgo del guardian de 269.3).
-- Ejecutar con: supabase test db (CLI GLOBAL de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los fixtures
-- se insertan directo (bypass RLS); las aserciones impersonan con pg_temp.act_as(uid,role)
-- (mismo patrón que 02/08/18/21/25/27/28/29/30/31/77/90/107/108/109).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — el guardian de 269.3 encontró que, desde #226 (20260901000001), leads_select
-- ya NO incluye is_admin() (fix de fuga de PII), y Postgres exige que una fila sea VISIBLE
-- por la policy de SELECT de la tabla ADEMÁS de pasar el USING/WITH CHECK de UPDATE/DELETE.
-- Eso dejó la rama `is_admin()` de leads_update/leads_delete INERTE para un admin de
-- PLATAFORMA sin membresía de agencia (77_leads_admin_plataforma_test pasa igual con o sin
-- ella). En cambio, private.can_edit_lead es SECURITY DEFINER y BYPASSA leads_select por
-- completo, así que ahí la rama sigue VIVA: un admin de plataforma puede insertar
-- lead_origin_properties de cualquier lead sin poder verlo -- escribir a ciegas lo que no
-- puedes leer. Decisión de Abraham (2026-09-07), opción (a): retirar `is_admin()` de los
-- tres objetos, con un FRENO deliberado en leads_delete (ver bloque siguiente).
--
-- SEAM bajo prueba (comportamiento observable vía impersonación JWT, NUNCA internals):
--   1) private.can_edit_lead(uuid)         (20260906400003:33-40 -- hoy agrega is_admin();
--      queda `agent_id=auth.uid() OR agency_role_of(agency_id) in (owner,admin)`)
--   2) policy leads_update (USING=WITH CHECK) (20260906400003:62-73 -- hoy agrega is_admin();
--      queda `agent_id=auth.uid() OR agency_role_of(agency_id) in (owner,admin)`)
--   3) policy leads_delete (USING)          (20260901000001 -- hoy `agent_id=auth.uid() or
--      is_admin()`, SIN rama de agencia; queda SOLO `agent_id=auth.uid()` -- ver bloque
--      "RETIRO PURO, CERO AMPLIACIÓN" abajo)
--   4) policy lead_origin_insert (WITH CHECK private.can_edit_lead(lead_id)) -- efecto
--      lateral de (1), no un SUT nuevo.
--   5) Catálogo: pg_get_expr(polqual/polwithcheck, polrelid) y pg_get_functiondef -- único
--      canal para anclar la AUSENCIA/presencia de un token en la expresión viva (igual que
--      ENUMGUARD1 en 102_crm_leads_page_funnel_test.sql).
--
-- SUT AÚN NO EXISTE (RED, 2026-09-07): lo crea una migración nueva (fuera de esta fase).
--
-- ── 🔴 RETIRO PURO, CERO AMPLIACIÓN (decisión de Abraham, corrigiendo al test-author) ────
-- Verificación empírica (docker exec, 2026-09-07): el estado VIVO real de leads_delete es
-- `agent_id = auth.uid() OR private.is_admin()` -- SIN `agency_role_of` (269.3 explícitamente
-- NO tocó leads_delete, ver 20260906400003:9-11). El test-author, leyendo "la frontera de
-- escritura sea UNA SOLA", propuso que leads_delete GANARA la rama agency_role_of para
-- igualarse a leads_update/can_edit_lead -- lectura descartada. Evidencia que decide en
-- contra: NADIE borra leads en duro -- cero `.delete()` sobre `leads` en `mobile/src` ni en
-- `supabase/functions`; el producto usa borrado SUAVE (`deleted_at`, con el índice único
-- parcial `leads_agent_user_unique_active ... where deleted_at is null`). La policy
-- `leads_delete` está DORMIDA -- nadie la ejerce hoy y nadie la ejercerá tras el GREEN salvo
-- el agente dueño. Dar un poder de borrado DURO nuevo a owner/admin, sobre una ruta que nadie
-- usa, solo para lograr una simetría cosmética con leads_update/can_edit_lead, es exactamente
-- lo que el default conservador de CLAUDE.md §8 evita: no se amplía alcance sin que el
-- producto lo pida. leads_delete queda entonces en SOLO `agent_id = auth.uid()` -- pierde
-- is_admin() y NO gana agency_role_of; owner/admin ACTIVOS de la agencia NUNCA pudieron
-- borrar un lead del equipo y SIGUEN sin poder tras el GREEN (INVARIANTE, no DELTA -- ver
-- LD_I2/LD_I3 abajo). El desacoplamiento entre leads_update/can_edit_lead (comparten
-- fórmula) y leads_delete (frontera propia, más angosta) es intencional: edición se
-- comparte con el equipo, el borrado duro se queda con el dueño del registro porque el
-- producto borra en suave.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30/31/77/90/109) ──────────
-- DELTA      = falla HOY, pasa tras el GREEN (discrimina la implementación real).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión: agente dueño -- para leads_delete --,
--   agente dueño/owner/admin activos -- para can_edit_lead/leads_update --, viewer,
--   suspendido, retirado, otra agencia, agente raso, y -- deliberado -- owner/admin activos
--   de la agencia SIGUEN sin poder borrar en duro el lead de su equipo -- NINGUNO de estos
--   casos se degrada NI se amplía con este GREEN).
--
-- ── Trampa metodológica evitada (memoria pgtap_policy_dominada_por_select) ──────────────
-- Cuando la policy bajo prueba comparte expresión con `*_select` de la misma tabla, un
-- negativo puede pasar por la razón EQUIVOCADA (la fila no era visible, no porque la policy
-- de escritura la rechazara). Por eso: (a) los asserts sobre el admin de PLATAFORMA contra
-- `can_edit_lead` van DIRECTOS a la función (SECURITY DEFINER, bypassa leads_select); (b) para
-- discriminar leads_update/leads_delete DEL admin de plataforma, la sección final relaja
-- `leads_select` (`using(true)`) DENTRO de esta misma transacción, revertida por el
-- `rollback;` final -- exactamente el patrón fijado en 109_leads_owner_write_test.sql
-- sección 14.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(30);

-- Helper de impersonación (mismo patrón que 02/.../90/107/108/109).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-0000002761XX' (subtarea 276.1, archivo
-- 110 -- sin colisión con 0755XX/0758XX/0202XX/0226XX/269XXX/1093XX de 30/31/90/77/108/109).
--   USERS (actores, 01-09):
--     01 PA   admin de PLATAFORMA (users.role='admin'), SIN relación con ninguna agencia
--     02 OX   owner  ACTIVO agencia X
--     03 AX   admin  ACTIVO agencia X (member_role)
--     04 SOX  owner  SUSPENDIDO agencia X
--     05 RAX  admin  RETIRADO (status='removed') agencia X
--     06 GX   agent  ACTIVO agencia X, DUEÑO real de todos los leads de este archivo
--     07 RX   agent  ACTIVO agencia X, agente RASO (ajeno a los leads bajo prueba)
--     08 OY   owner  ACTIVO agencia Y (OTRA agencia, ajena)
--     09 VX   viewer ACTIVO agencia X
--   BUSCADORES (10-23, uno por lead -- GX es agent_id de TODOS, y
--     leads_agent_user_unique_active exige (agent_id,user_id) único entre filas vivas):
--     10 B_CE · 11 B_LOI_PA · 12 B_LOI_OWNER · 13 B_LU · 14 B_LD_OWNER · 15 B_LD_ADMIN ·
--     16 B_LD_AGENT · 17 B_LD_SUSP · 18 B_LD_REMOVED · 19 B_LD_VIEWER · 20 B_LD_OTHERAG ·
--     21 B_LD_RASO · 22 B_ISO_UPD · 23 B_ISO_DEL
--   AGENCIES: 30=X, 31=Y
--   AGENCY_MEMBERS (40-46): 40=X/OX(owner,active) 41=X/AX(admin,active)
--     42=X/SOX(owner,suspended) 43=X/RAX(admin,removed) 44=X/GX(agent,active)
--     45=X/RX(agent,active) 46=Y/OY(owner,active) -- VX (viewer) se agrega aparte, ver abajo
--   PROPERTIES (50-51): 50=para LOI_LEAD_PA · 51=para LOI_LEAD_OWNER (ambas de GX)
--   LEADS (60-73, TODOS agent_id=GX salvo donde se indique):
--     60 CE_LEAD (compartido, solo lecturas de can_edit_lead -- no muta nada)
--     61 LOI_LEAD_PA · 62 LOI_LEAD_OWNER (para lead_origin_insert)
--     63 LU_LEAD (compartido, UPDATE real -- no destructivo)
--     64 LD_LEAD_OWNER · 65 LD_LEAD_ADMIN · 66 LD_LEAD_AGENT · 67 LD_LEAD_SUSP ·
--     68 LD_LEAD_REMOVED · 69 LD_LEAD_VIEWER · 70 LD_LEAD_OTHERAG · 71 LD_LEAD_RASO
--       (DELETE real -- destructivo, un lead dedicado por assert)
--     72 ISO_LEAD_UPD_PA · 73 ISO_LEAD_DEL_PA (sección final, leads_select relajada)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000276101', 'pa.2761@test.local'),
  ('00000000-0000-0000-0000-000000276102', 'ox.2761@test.local'),
  ('00000000-0000-0000-0000-000000276103', 'ax.2761@test.local'),
  ('00000000-0000-0000-0000-000000276104', 'sox.2761@test.local'),
  ('00000000-0000-0000-0000-000000276105', 'rax.2761@test.local'),
  ('00000000-0000-0000-0000-000000276106', 'gx.2761@test.local'),
  ('00000000-0000-0000-0000-000000276107', 'rx.2761@test.local'),
  ('00000000-0000-0000-0000-000000276108', 'oy.2761@test.local'),
  ('00000000-0000-0000-0000-000000276109', 'vx.2761@test.local'),
  ('00000000-0000-0000-0000-000000276110', 'b_ce.2761@test.local'),
  ('00000000-0000-0000-0000-000000276111', 'b_loi_pa.2761@test.local'),
  ('00000000-0000-0000-0000-000000276112', 'b_loi_owner.2761@test.local'),
  ('00000000-0000-0000-0000-000000276113', 'b_lu.2761@test.local'),
  ('00000000-0000-0000-0000-000000276114', 'b_ld_owner.2761@test.local'),
  ('00000000-0000-0000-0000-000000276115', 'b_ld_admin.2761@test.local'),
  ('00000000-0000-0000-0000-000000276116', 'b_ld_agent.2761@test.local'),
  ('00000000-0000-0000-0000-000000276117', 'b_ld_susp.2761@test.local'),
  ('00000000-0000-0000-0000-000000276118', 'b_ld_removed.2761@test.local'),
  ('00000000-0000-0000-0000-000000276119', 'b_ld_viewer.2761@test.local'),
  ('00000000-0000-0000-0000-000000276120', 'b_ld_otherag.2761@test.local'),
  ('00000000-0000-0000-0000-000000276121', 'b_ld_raso.2761@test.local'),
  ('00000000-0000-0000-0000-000000276122', 'b_iso_upd.2761@test.local'),
  ('00000000-0000-0000-0000-000000276123', 'b_iso_del.2761@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id = '00000000-0000-0000-0000-000000276106'; -- GX
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000276101'; -- PA (admin de PLATAFORMA, sin agencia)

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000276130', 'Inmobiliaria Frontera X 2761', 'inmo-frontera-x-2761', 'active', '00000000-0000-0000-0000-000000276102'),
  ('00000000-0000-0000-0000-000000276131', 'Inmobiliaria Frontera Y 2761', 'inmo-frontera-y-2761', 'active', '00000000-0000-0000-0000-000000276108');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000276140', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276102', 'owner',  'active'),    -- OX
  ('00000000-0000-0000-0000-000000276141', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276103', 'admin',  'active'),    -- AX
  ('00000000-0000-0000-0000-000000276142', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276104', 'owner',  'suspended'), -- SOX
  ('00000000-0000-0000-0000-000000276143', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276105', 'admin',  'removed'),   -- RAX
  ('00000000-0000-0000-0000-000000276144', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276106', 'agent',  'active'),    -- GX
  ('00000000-0000-0000-0000-000000276145', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276107', 'agent',  'active'),    -- RX
  ('00000000-0000-0000-0000-000000276146', '00000000-0000-0000-0000-000000276131', '00000000-0000-0000-0000-000000276108', 'owner',  'active'),    -- OY (agencia Y)
  ('00000000-0000-0000-0000-000000276147', '00000000-0000-0000-0000-000000276130', '00000000-0000-0000-0000-000000276109', 'viewer', 'active');    -- VX

-- PA (admin de plataforma) NUNCA se inserta en agency_members -- es el punto del test:
-- "sin relación con ninguna agencia".

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000276150', '00000000-0000-0000-0000-000000276106',
   '00000000-0000-0000-0000-000000276130', 'departamento', 'rent', 'Fixture 276.1 — propiedad de GX (LOI PA)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000276151', '00000000-0000-0000-0000-000000276106',
   '00000000-0000-0000-0000-000000276130', 'departamento', 'rent', 'Fixture 276.1 — propiedad de GX (LOI owner)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 12500, 'active');

insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000276160', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276110', 'new'), -- CE_LEAD
  ('00000000-0000-0000-0000-000000276161', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276111', 'new'), -- LOI_LEAD_PA
  ('00000000-0000-0000-0000-000000276162', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276112', 'new'), -- LOI_LEAD_OWNER
  ('00000000-0000-0000-0000-000000276163', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276113', 'new'), -- LU_LEAD
  ('00000000-0000-0000-0000-000000276164', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276114', 'new'), -- LD_LEAD_OWNER
  ('00000000-0000-0000-0000-000000276165', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276115', 'new'), -- LD_LEAD_ADMIN
  ('00000000-0000-0000-0000-000000276166', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276116', 'new'), -- LD_LEAD_AGENT
  ('00000000-0000-0000-0000-000000276167', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276117', 'new'), -- LD_LEAD_SUSP
  ('00000000-0000-0000-0000-000000276168', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276118', 'new'), -- LD_LEAD_REMOVED
  ('00000000-0000-0000-0000-000000276169', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276119', 'new'), -- LD_LEAD_VIEWER
  ('00000000-0000-0000-0000-000000276170', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276120', 'new'), -- LD_LEAD_OTHERAG
  ('00000000-0000-0000-0000-000000276171', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276121', 'new'), -- LD_LEAD_RASO
  ('00000000-0000-0000-0000-000000276172', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276122', 'new'), -- ISO_LEAD_UPD_PA
  ('00000000-0000-0000-0000-000000276173', '00000000-0000-0000-0000-000000276106', '00000000-0000-0000-0000-000000276123', 'new'); -- ISO_LEAD_DEL_PA

-- ════════════════════════════════════════════════════════════════════════════
-- 1) private.can_edit_lead — asserts DIRECTOS contra la función (SECURITY DEFINER, bypassa
--    leads_select por completo; ver trampa metodológica en la cabecera).
-- ════════════════════════════════════════════════════════════════════════════

-- [DELTA] admin de PLATAFORMA sin relación de agencia: hoy true (rama is_admin() viva en la
-- función), debe ser false tras el GREEN -- es el hallazgo central del guardian de 269.3.
select pg_temp.act_as('00000000-0000-0000-0000-000000276101'); -- PA
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000276160'),
  false,
  'CE_D1_can_edit_lead_false_para_admin_de_plataforma_sin_relacion_de_agencia'
);
reset role;

-- [INVARIANTE] agente dueño del lead.
select pg_temp.act_as('00000000-0000-0000-0000-000000276106'); -- GX
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000276160'),
  true,
  'CE_I1_can_edit_lead_true_para_el_agente_dueno'
);
reset role;

-- [INVARIANTE] owner ACTIVO de la agencia del lead.
select pg_temp.act_as('00000000-0000-0000-0000-000000276102'); -- OX
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000276160'),
  true,
  'CE_I2_can_edit_lead_true_para_el_owner_activo_de_la_agencia'
);
reset role;

-- [INVARIANTE] admin (member_role) ACTIVO de la agencia del lead.
select pg_temp.act_as('00000000-0000-0000-0000-000000276103'); -- AX
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000276160'),
  true,
  'CE_I3_can_edit_lead_true_para_el_admin_activo_de_la_agencia'
);
reset role;

-- [INVARIANTE] owner SUSPENDIDO de la agencia -- agency_role_of ya filtra status='active'.
select pg_temp.act_as('00000000-0000-0000-0000-000000276104'); -- SOX
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000276160'),
  false,
  'CE_I4_can_edit_lead_false_para_owner_suspendido'
);
reset role;

-- [INVARIANTE] admin (member_role) RETIRADO (status='removed') de la agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000276105'); -- RAX
select is(
  private.can_edit_lead('00000000-0000-0000-0000-000000276160'),
  false,
  'CE_I5_can_edit_lead_false_para_admin_retirado'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) lead_origin_insert (efecto lateral de can_edit_lead) -- una violación de WITH CHECK
--    en INSERT SIEMPRE lanza excepción (nunca "0 filas" silencioso, a diferencia de UPDATE
--    con USING) -- mismo patrón que 109 D7/lives_ok.
-- ════════════════════════════════════════════════════════════════════════════

-- [DELTA] admin de plataforma inserta lead_origin_properties de un lead AJENO: hoy vive
-- (can_edit_lead=true por is_admin()), debe morir con 42501 tras el GREEN -- el efecto
-- observable exacto de "escribir a ciegas lo que no puedes leer".
select pg_temp.act_as('00000000-0000-0000-0000-000000276101'); -- PA
select throws_ok(
  $$ insert into public.lead_origin_properties (lead_id, property_id)
     values ('00000000-0000-0000-0000-000000276161', '00000000-0000-0000-0000-000000276150') $$,
  '42501', null,
  'LOI_D1_admin_de_plataforma_no_puede_insertar_lead_origin_properties_de_un_lead_ajeno'
);
reset role;

-- [INVARIANTE] owner activo de la agencia sigue insertando lead_origin_properties de un lead
-- de su agente (cierre de #31, 109 D7 -- no se degrada con el retiro de is_admin()).
select pg_temp.act_as('00000000-0000-0000-0000-000000276102'); -- OX
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    insert into public.lead_origin_properties (lead_id, property_id)
    values ('00000000-0000-0000-0000-000000276162', '00000000-0000-0000-0000-000000276151');
    get diagnostics v_count = row_count;
    if v_count is distinct from 1 then
      raise exception 'el owner activo de la agencia debe poder insertar un lead_origin_properties para un lead de su agente; filas insertadas: %', v_count;
    end if;
  end
  $do$;
  $$,
  'LOI_I1_owner_activo_sigue_insertando_lead_origin_properties_de_un_lead_de_su_agente'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) policy leads_update -- UPDATE real, leads_select intacta (no relajada aquí; el caso
--    del admin de plataforma va aislado en la sección 6, ver trampa metodológica).
-- ════════════════════════════════════════════════════════════════════════════

-- [INVARIANTE] owner activo -- ya editaba desde 269.3, no se degrada.
select pg_temp.act_as('00000000-0000-0000-0000-000000276102'); -- OX
with u as (
  update public.leads set internal_notes = 'nota del owner'
   where id = '00000000-0000-0000-0000-000000276163'
   returning id
)
select is(count(*)::int, 1, 'LU_I1_owner_activo_sigue_actualizando_el_lead_de_su_equipo') from u;
reset role;

-- [INVARIANTE] admin (member_role) activo.
select pg_temp.act_as('00000000-0000-0000-0000-000000276103'); -- AX
with u as (
  update public.leads set internal_notes = 'nota del admin'
   where id = '00000000-0000-0000-0000-000000276163'
   returning id
)
select is(count(*)::int, 1, 'LU_I2_admin_activo_sigue_actualizando_el_lead_del_equipo') from u;
reset role;

-- [INVARIANTE] agente dueño.
select pg_temp.act_as('00000000-0000-0000-0000-000000276106'); -- GX
with u as (
  update public.leads set internal_notes = 'nota del agente dueño'
   where id = '00000000-0000-0000-0000-000000276163'
   returning id
)
select is(count(*)::int, 1, 'LU_I3_agente_dueno_sigue_actualizando_su_propio_lead') from u;
reset role;

-- [INVARIANTE] owner SUSPENDIDO -- agency_role_of resuelve NULL, nunca entra al IN.
select pg_temp.act_as('00000000-0000-0000-0000-000000276104'); -- SOX
with u as (
  update public.leads set internal_notes = 'intento del owner suspendido'
   where id = '00000000-0000-0000-0000-000000276163'
   returning id
)
select is(count(*)::int, 0, 'LU_I4_owner_suspendido_sigue_sin_poder_actualizar') from u;
reset role;

-- [INVARIANTE] admin RETIRADO.
select pg_temp.act_as('00000000-0000-0000-0000-000000276105'); -- RAX
with u as (
  update public.leads set internal_notes = 'intento del admin retirado'
   where id = '00000000-0000-0000-0000-000000276163'
   returning id
)
select is(count(*)::int, 0, 'LU_I5_admin_retirado_sigue_sin_poder_actualizar') from u;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) policy leads_delete -- DELETE real, un lead DEDICADO por assert (destructivo, no se
--    puede reusar fila). leads_select intacta (el caso del admin de plataforma va aislado
--    en la sección 6).
-- ════════════════════════════════════════════════════════════════════════════

-- [INVARIANTE] agente dueño borra su propio lead -- nunca dependió de is_admin(), es la
-- ÚNICA rama que leads_delete conserva.
select pg_temp.act_as('00000000-0000-0000-0000-000000276106'); -- GX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276166' returning id
)
select is(count(*)::int, 1, 'LD_I1_agente_dueno_sigue_borrando_su_propio_lead') from d;
reset role;

-- [INVARIANTE, DELIBERADO -- ver "RETIRO PURO, CERO AMPLIACIÓN" en la cabecera] owner
-- ACTIVO de la agencia del lead: HOY 0 filas (leads_delete no tiene rama agency_role_of) y
-- SIGUE en 0 filas tras el GREEN (leads_delete pierde is_admin() pero NO gana
-- agency_role_of -- el borrado duro se queda con el dueño del registro, el producto borra
-- en suave).
select pg_temp.act_as('00000000-0000-0000-0000-000000276102'); -- OX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276164' returning id
)
select is(count(*)::int, 0, 'LD_I2_owner_activo_sigue_sin_poder_borrar_un_lead_de_su_equipo') from d;
reset role;

-- [INVARIANTE, DELIBERADO -- mismo motivo] admin (member_role) ACTIVO de la agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000276103'); -- AX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276165' returning id
)
select is(count(*)::int, 0, 'LD_I3_admin_activo_sigue_sin_poder_borrar_un_lead_del_equipo') from d;
reset role;

-- [INVARIANTE] owner SUSPENDIDO -- sigue sin poder (nunca pudo; ahora además ni siquiera
-- aplicaría agency_role_of, porque esa rama no existe en leads_delete).
select pg_temp.act_as('00000000-0000-0000-0000-000000276104'); -- SOX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276167' returning id
)
select is(count(*)::int, 0, 'LD_I4_owner_suspendido_sigue_sin_poder_borrar') from d;
reset role;

-- [INVARIANTE] admin RETIRADO.
select pg_temp.act_as('00000000-0000-0000-0000-000000276105'); -- RAX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276168' returning id
)
select is(count(*)::int, 0, 'LD_I5_admin_retirado_sigue_sin_poder_borrar') from d;
reset role;

-- [INVARIANTE] viewer ACTIVO -- la matriz de roles nunca amplía a viewer.
select pg_temp.act_as('00000000-0000-0000-0000-000000276109'); -- VX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276169' returning id
)
select is(count(*)::int, 0, 'LD_I6_viewer_activo_sigue_sin_poder_borrar') from d;
reset role;

-- [INVARIANTE crítica -- mutante clásico #100] owner ACTIVO de OTRA agencia (Y) -- la
-- comparación debe ser contra leads.agency_id REAL, nunca "cualquier owner activo".
select pg_temp.act_as('00000000-0000-0000-0000-000000276108'); -- OY
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276170' returning id
)
select is(count(*)::int, 0, 'LD_I7_owner_de_otra_agencia_sigue_sin_poder_borrar_leads_ajenos') from d;
reset role;

-- [INVARIANTE] agente RASO de la MISMA agencia (no dueño del lead) -- la línea es
-- owner/admin, nunca "cualquier miembro de mi agencia" -- y de todos modos leads_delete ya
-- no tiene rama de agencia alguna.
select pg_temp.act_as('00000000-0000-0000-0000-000000276107'); -- RX
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276171' returning id
)
select is(count(*)::int, 0, 'LD_I8_agente_raso_de_la_agencia_sigue_sin_poder_borrar') from d;
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Guarda de catálogo -- único canal para anclar la AUSENCIA/presencia de un token en la
--    expresión VIVA (misma técnica que ENUMGUARD1 en 102_crm_leads_page_funnel_test.sql).
--    No se sustituye por un assert de comportamiento: un mutante que reintroduzca
--    `is_admin()` en el texto de la policy sin cambiar ningún resultado observable HOY
--    (porque ya está inerte por el hallazgo de 269.3) pasaría todos los asserts de arriba.
-- ════════════════════════════════════════════════════════════════════════════

-- Igualdad EXACTA, no ausencia de la subcadena 'is_admin' (endurecido por el guardian de
-- 276.1, 2026-09-07). Un `!~ 'is_admin'` deja pasar un mutante REALISTA: reescribir la rama
-- de agencia como un `exists (select 1 from agency_members ...)` inline que olvida
-- `status = 'active'`. Ese mutante concede escritura a un owner SUSPENDIDO y a un admin
-- RETIRADO -- justo lo que LU_I4/LU_I5 dicen anclar y lo que protege
-- 90_suspension_congela_escritura -- y sobrevivía la suite entera, porque LU_I4/LU_I5 son
-- vacuos (esos actores tampoco ven la fila por leads_select) y CAT1/CAT2 solo miraban que no
-- apareciera la palabra. La igualdad exacta obliga a que la frontera pase por
-- private.agency_role_of, que es la única que filtra status='active'.
-- Literal leído del catálogo vivo (docker exec, 2026-09-07), no recompuesto a mano.
select is(
  (select pg_get_expr(polqual, polrelid)
     from pg_policy where polrelid = 'public.leads'::regclass and polname = 'leads_update'),
  $canon$((agent_id = ( SELECT auth.uid() AS uid)) OR (private.agency_role_of(agency_id) = ANY (ARRAY['owner'::agency_member_role, 'admin'::agency_member_role])))$canon$,
  'CAT1_leads_update_using_es_exactamente_agent_id_o_agency_role_of_sin_ramas_extra'
);

select is(
  (select pg_get_expr(polwithcheck, polrelid)
     from pg_policy where polrelid = 'public.leads'::regclass and polname = 'leads_update'),
  $canon$((agent_id = ( SELECT auth.uid() AS uid)) OR (private.agency_role_of(agency_id) = ANY (ARRAY['owner'::agency_member_role, 'admin'::agency_member_role])))$canon$,
  'CAT2_leads_update_with_check_es_exactamente_igual_al_using'
);

select ok(
  (select pg_get_expr(polqual, polrelid) !~ 'is_admin'
     from pg_policy where polrelid = 'public.leads'::regclass and polname = 'leads_delete'),
  'CAT3_leads_delete_using_ya_no_menciona_is_admin'
);

-- Ancla el FRENO deliberado -- ver "RETIRO PURO, CERO AMPLIACIÓN" en la cabecera: leads_delete
-- pierde is_admin() y NO gana agency_role_of. Igualdad EXACTA (no un `like`/regex de
-- ausencia): así ninguna de las dos ramas -- ni is_admin() reintroducida, ni agency_role_of
-- agregada de más -- puede reaparecer sin romper este assert. Literal derivado de forma
-- independiente (docker exec, transacción revertida, 2026-09-07): es el pg_get_expr
-- canónico de Postgres para `using (agent_id = (select auth.uid()))` sola.
select is(
  (select pg_get_expr(polqual, polrelid)
     from pg_policy where polrelid = 'public.leads'::regclass and polname = 'leads_delete'),
  '(agent_id = ( SELECT auth.uid() AS uid))',
  'CAT4_leads_delete_using_es_exactamente_agent_id_igual_auth_uid_sin_ramas_extra'
);

select ok(
  pg_get_functiondef('private.can_edit_lead(uuid)'::regprocedure) !~ 'is_admin',
  'CAT5_can_edit_lead_ya_no_menciona_is_admin'
);

-- [INVARIANTE, fuera de alcance] leads_insert CONSERVA is_admin() -- decisión #226, no se
-- toca en 276.1 (guarda contra sobre-alcance del GREEN).
select ok(
  (select pg_get_expr(polwithcheck, polrelid) ~ 'is_admin'
     from pg_policy where polrelid = 'public.leads'::regclass and polname = 'leads_insert'),
  'CAT6_leads_insert_sigue_conservando_is_admin_fuera_de_alcance'
);

-- [INVARIANTE, fuera de alcance] lead_origin_delete CONSERVA is_admin() -- no se toca aquí.
select ok(
  (select pg_get_expr(polqual, polrelid) ~ 'is_admin'
     from pg_policy where polrelid = 'public.lead_origin_properties'::regclass and polname = 'lead_origin_delete'),
  'CAT7_lead_origin_delete_sigue_conservando_is_admin_fuera_de_alcance'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) "Policy aislada" -- el admin de plataforma vía UPDATE/DELETE real, con leads_select
--    relajada (`using(true)`) DENTRO de esta misma transacción (revertida por el
--    `rollback;` final), para probar leads_update/leads_delete y NO la visibilidad --
--    mismo patrón que 109_leads_owner_write_test.sql sección 14. Va AL FINAL: una vez
--    relajada, leads_select ya no protege ninguna aserción posterior de una fuga real.
-- ════════════════════════════════════════════════════════════════════════════

alter policy leads_select on public.leads using (true);

-- [DELTA] con la visibilidad fuera de la ecuación, la rama is_admin() de leads_update
-- HOY sí se ejerce (1 fila) -- debe desaparecer tras el GREEN (0 filas).
select pg_temp.act_as('00000000-0000-0000-0000-000000276101'); -- PA
with u as (
  update public.leads set internal_notes = 'ISO admin de plataforma'
   where id = '00000000-0000-0000-0000-000000276172'
   returning id
)
select is(count(*)::int, 0, 'ISO_UPD_PA_leads_update_sola_rechaza_al_admin_de_plataforma_sin_relacion') from u;
reset role;

-- [DELTA] mismo patrón para leads_delete.
select pg_temp.act_as('00000000-0000-0000-0000-000000276101'); -- PA
with d as (
  delete from public.leads where id = '00000000-0000-0000-0000-000000276173' returning id
)
select is(count(*)::int, 0, 'ISO_DEL_PA_leads_delete_sola_rechaza_al_admin_de_plataforma_sin_relacion') from d;
reset role;

select * from finish();
rollback;

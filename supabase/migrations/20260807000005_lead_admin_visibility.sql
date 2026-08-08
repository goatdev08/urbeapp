-- Migración 20260807000005 — El admin de inmobiliaria ve el pipeline del equipo (subtarea 75.5)
--
-- CONTEXTO: hoy un ADMIN de inmobiliaria (rol nuevo de la Ola 1, #71) queda como agente raso
-- y NO ve los leads de su equipo, porque el único helper que amplía la visibilidad de
-- "gestor de agencia" es private.is_agency_owner_of (20260604000010:38-50), que SOLO
-- matchea member_role='owner'.
--
-- Contenido:
--   1) private.is_agency_admin_of(uuid) — calco EXACTO de private.is_agency_owner_of, pero
--      con member_role='admin' en vez de 'owner'. Mismas garantías: ambos (admin y agente
--      dueño del lead) deben estar `active` en la MISMA agencia (join por agency_id).
--   2) Se agrega como cláusula OR adicional en los 3 puntos que hoy solo miran al owner:
--        a) leads_select              (20260604000010:324-326)
--        b) private.can_view_lead     (20260604000010:85-94)
--        c) private.can_view_user_as_lead_searcher (20260702000001:30-38)
--
-- 🔴 Solo amplía SELECT. leads_update NO se toca — la escritura sigue restringida a
-- agent_id = caller (o admin de plataforma). Extender la edición a admin/owner de agencia
-- es la tarea #31, deliberadamente diferida. Ver los asserts I9/I10 de
-- supabase/tests/30_leads_admin_visibility_test.sql.
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS antes de CREATE POLICY.
-- Rollback: supabase/migrations/rollbacks/20260807000005_lead_admin_visibility.sql
-- RED: supabase/tests/30_leads_admin_visibility_test.sql (plan 15, 5 DELTA + 10 INVARIANTE).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Helper: private.is_agency_admin_of — calco de private.is_agency_owner_of
--    con member_role='admin'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.is_agency_admin_of(p_target_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.agency_members admin_m
    join public.agency_members agent_m on agent_m.agency_id = admin_m.agency_id
    where admin_m.user_id = (select auth.uid())
      and admin_m.member_role = 'admin'
      and admin_m.status = 'active'
      and agent_m.user_id = p_target_user_id
      and agent_m.status = 'active'
  );
$$;

comment on function private.is_agency_admin_of(uuid) is
  'RLS: true si el usuario autenticado es admin ACTIVO de la MISMA agencia donde '
  'p_target_user_id es un miembro ACTIVO (típicamente el agent_id dueño de un lead). '
  'Calco exacto de private.is_agency_owner_of con member_role=''admin'' (subtarea 75.5, '
  'Ola 1 #71 introdujo el rol admin). Solo amplía SELECT — nunca usado en leads_update.';

grant execute on function private.is_agency_admin_of(uuid) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2a) leads_select — se agrega la cláusula OR del helper nuevo.
--     Definición base copiada EXACTA de 20260604000010:324-326.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    agent_id = (select auth.uid())
    or private.is_agency_owner_of(agent_id)
    or private.is_agency_admin_of(agent_id)
    or private.is_admin()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2b) private.can_view_lead — se agrega la cláusula OR del helper nuevo.
--     Definición base copiada EXACTA de 20260604000010:85-94.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.is_agency_owner_of(l.agent_id)
           or private.is_agency_admin_of(l.agent_id)
           or private.is_admin())
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2c) private.can_view_user_as_lead_searcher — se agrega la cláusula OR del
--     helper nuevo. Definición base copiada EXACTA de 20260702000001:30-38.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.can_view_user_as_lead_searcher(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.user_id = p_user_id
      and l.deleted_at is null
      and (l.agent_id = (select auth.uid())
           or private.is_agency_owner_of(l.agent_id)
           or private.is_agency_admin_of(l.agent_id))
  );
$$;

comment on function private.can_view_user_as_lead_searcher(uuid) is
  'RLS: true si p_user_id es el buscador (leads.user_id) de un lead ACTIVO cuyo agente '
  'dueño (leads.agent_id) es el usuario autenticado, o el owner o admin de la agencia de '
  'ese agente (subtarea 75.5 amplía a admin). Usado por users_select para exponer la '
  'identidad de contacto del buscador (first_name, last_name, phone, avatar_url).';

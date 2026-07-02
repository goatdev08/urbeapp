-- Migración 20260702000001 — RLS: identidad del BUSCADOR de un lead se lee desde public.users
-- Bug: el CRM (agente/owner) mostraba "Usuario sin nombre" para el buscador de un lead
-- porque la política users_select (migración 0010) NO otorgaba acceso al agente dueño
-- del lead ni al owner de su agencia para leer la fila public.users del buscador
-- (first_name, last_name, phone, avatar_url). El único acceso existente era
-- id = auth.uid() (el propio usuario), private.is_admin(), private.is_agency_owner_of(id)
-- (para AGENTES gestionados, no buscadores) o el perfil público de agente verificado.
-- Un buscador normal (role='searcher') no cae en ninguna de esas cláusulas.
--
-- Fix: nuevo helper private.can_view_user_as_lead_searcher(p_user_id) que autoriza la
-- lectura de la fila public.users de p_user_id cuando existe un lead ACTIVO
-- (deleted_at is null) donde leads.user_id = p_user_id y quien pregunta es el agente
-- dueño del lead (leads.agent_id = auth.uid()) o el owner de la agencia de ese agente
-- (private.is_agency_owner_of(leads.agent_id)). Se añade como cláusula OR adicional en
-- users_select, sin tocar ninguna cláusula existente.
--
-- Decisión de diseño (tarea 30): la identidad del buscador se lee SIEMPRE desde
-- public.users, NUNCA desde user_preferences. Esta migración toca EXCLUSIVAMENTE la
-- política users_select. NO se toca user_prefs_select ni la tabla user_preferences
-- (fuera de alcance).
--
-- Subtarea 30.2 — FASE GREEN. RED: supabase/tests/08_rls_lead_searcher_test.sql (plan 12).
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS antes de CREATE POLICY.
-- Rollback: supabase/migrations/rollbacks/20260702000001_rls_lead_searcher_identity.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Helper: private.can_view_user_as_lead_searcher
--    Mismo patrón que private.can_view_lead / private.can_edit_lead (migración 0010).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.can_view_user_as_lead_searcher(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.user_id = p_user_id
      and l.deleted_at is null
      and (l.agent_id = (select auth.uid()) or private.is_agency_owner_of(l.agent_id))
  );
$$;

comment on function private.can_view_user_as_lead_searcher(uuid) is
  'RLS: true si p_user_id es el buscador (leads.user_id) de un lead ACTIVO cuyo agente '
  'dueño (leads.agent_id) es el usuario autenticado, o el owner de la agencia de ese '
  'agente. Usado por users_select para exponer la identidad de contacto del buscador '
  '(first_name, last_name, phone, avatar_url) al agente/owner que gestiona su lead.';

grant execute on function private.can_view_user_as_lead_searcher(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Política users_select: se añade la cláusula OR del helper nuevo.
--    Definición base copiada EXACTA de 20260604000010 líneas 111-118; se agrega
--    únicamente `or private.can_view_user_as_lead_searcher(id)` al final.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or private.is_agency_owner_of(id)
    or (role = 'agent' and deleted_at is null and is_verified_agent = true)
    or private.can_view_user_as_lead_searcher(id)
  );

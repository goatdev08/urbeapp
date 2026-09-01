-- Migración 20260901000001 — tarea #226: el admin de PLATAFORMA ya no lee el
-- pipeline comercial (leads) de organizaciones ajenas.
-- Rollback: supabase/migrations/rollbacks/20260901000001_leads_sin_admin_plataforma.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL BUG (evidencia 2026-08-31, impersonación JWT contra producción, revertida):
-- la cuenta admin de Abraham — 0 propiedades, organización sin publicaciones —
-- veía los 3 leads de "Tu Casa con Vlad", incluido el teléfono del buscador.
--
-- ARQUEOLOGÍA: `or private.is_admin()` está en leads_select desde la PRIMERA
-- policy (20260604000008:330), como parte del molde "el admin lo ve todo".
-- Las migraciones que después la reescribieron (20260807000005 = 75.5 y
-- 20260807000006 = 75.5-bis) resolvían la visibilidad del owner/admin de
-- INMOBILIARIA y arrastraron la cláusula sin decidirla. Nadie decidió nunca
-- que un admin de plataforma leyera pipeline comercial ajeno. El CONTRASTE
-- que lo confirma: private.can_view_user_as_lead_searcher (la capa de
-- IDENTIDAD del buscador) NUNCA tuvo is_admin(). Misma invariante en varias
-- capas, anclada en una sola — el patrón de #220 y #100.
--
-- QUÉ CAMBIA: se quita `or private.is_admin()` de
--   1) la policy leads_select, y
--   2) private.can_view_lead — usada por lead_status_history_select,
--      lead_origin_select y el RPC get_lead_stats: la fuga se propagaba ahí.
-- El admin de plataforma que ADEMÁS es owner/admin de una organización (caso
-- real de Abraham tras #225) CONSERVA la visibilidad de SU organización por la
-- rama agency_role_of(agency_id) — anclado por I4/I5 de
-- supabase/tests/77_leads_admin_plataforma_test.sql.
--
-- QUÉ NO CAMBIA (decisión anotada en #226): leads_update y leads_delete
-- conservan is_admin() — el borrado por petición del titular es un caso
-- legítimo de administración; moverlo a una Edge Function con service_role +
-- admin_actions es trabajo aparte (derivada futura), y recortarlo aquí sin
-- esa ruta dejaría a soporte sin herramienta.
--
-- COMPATIBILIDAD (§0.5): SOLO RESTRINGE lectura — ninguna fila cambia, ningún
-- contrato de shape cambia. El único caller de `leads` en toda la app es
-- useAgentLeads (verificado por grep), y el panel admin NO lee leads
-- (useAdminReports lee property_reports). Orden de release cliente-primero
-- cumplido: el OTA con el filtro explícito del cliente sale antes de aplicar
-- esta migración al remoto. Idempotente: drop policy if exists + create or
-- replace function.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) leads_select sin is_admin() — misma forma que 20260807000006:129-134.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
  );

comment on policy leads_select on public.leads is
  'Fix #226: se elimina el `or private.is_admin()` que arrastraban 0008/75.5/'
  '75.5-bis — un admin de PLATAFORMA sin relación con la agencia no lee '
  'pipeline comercial ajeno. El agente dueño (agent_id) y el owner/admin de la '
  'agencia donde NACIÓ el lead (agency_role_of sobre leads.agency_id) quedan '
  'igual que en 75.5-bis.';

-- 2) private.can_view_lead sin is_admin() — misma forma que 20260807000006:142-151.
create or replace function private.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin'))
  );
$$;

comment on function private.can_view_lead(uuid) is
  'RLS/RPC: true si el caller es el agente dueño del lead o owner/admin de la '
  'agencia donde nació (agency_role_of sobre leads.agency_id). Fix #226: ya '
  'SIN is_admin() — el admin de plataforma no hereda visibilidad del pipeline '
  'comercial; la fuga se propagaba vía lead_status_history_select, '
  'lead_origin_select y get_lead_stats, que reusan este helper.';

-- Migración 20260809000001 — PRIVACIDAD DEL LEAD (§19.2): las interacciones se
-- REGISTRAN siempre, pero se EXPONEN al agente solo si existe un lead ACTIVO.
-- Subtarea 75.3 — FASE GREEN. RED: supabase/tests/35_lead_privacy_test.sql (plan 15).
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA (fuga VIVA, medida en producción el 2026-08-08 con un JWT real)
--   La policy vigente (20260808000001, #112) era:
--       events_raw_select using (user_id = auth.uid()
--                                OR private.can_manage_property(property_id))
--   No menciona al lead. Bastaba con ser dueño de la propiedad para leer el
--   comportamiento de CUALQUIER usuario sobre ella. Comprobado: el agente Ramos
--   leyó filas `video_view` de otro usuario que nunca lo contactó.
--
--   Eso contradice al PRD de frente:
--     §19.1 "Las interacciones de un usuario que nunca contactó al agente NO
--            generan registro accesible al agente."
--     §19.2 "Solo después de que el usuario toca Contactar agente… el agente
--            obtiene acceso retroactivo al historial completo de interacciones
--            de ese usuario con TODAS las publicaciones del agente."
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA REGLA, EN UNA SOLA EXPRESIÓN
--   private.can_view_user_events(user_id, property_id) traduce esa frase del PRD
--   literalmente: existe un lead ACTIVO de ese usuario, la propiedad del evento
--   pertenece al AGENTE DE ESE LEAD (de ahí "todas las publicaciones del
--   agente", no solo la que originó el contacto), y quien pregunta es ese agente
--   o el owner/admin de la agencia del lead.
--
--   Se ata al LEAD y no a la propiedad, que es lo que hacía la versión anterior.
--   Por eso el permiso CADUCA solo: borrar el lead (deleted_at) revoca el acceso
--   retroactivo sin tocar ninguna otra cosa.
--
-- ── Efecto lateral deseado: se cierra un hueco de 75.5 ──────────────────────
--   El admin de inmobiliaria NO veía NINGÚN evento del equipo (RED test 8,
--   'esperaba 2, obtuve 0'): private.can_manage_property compone dueño + owner
--   de agencia + admin de plataforma, pero NO al admin de inmobiliaria. Como el
--   helper nuevo deriva el permiso del lead — y private.agency_role_of ya
--   resuelve owner Y admin (20260807000005/000006) —, el admin queda alineado
--   con leads_select, can_view_lead y can_view_user_as_lead_searcher, que ya lo
--   contemplaban. Deja de ser el único punto del CRM donde el admin era ciego.
--
-- ── Lo que NO cambia (deliberado) ───────────────────────────────────────────
--   · La rama `user_id = auth.uid()`: el dueño de sus datos siempre los lee.
--   · La policy INSERT de #112: la captura sigue viva, no se toca una coma.
--   · `private.is_admin()` se conserva EXPLÍCITO. Hoy el admin de plataforma ya
--     lee todo (vía can_manage_property) y §19.2 legisla sobre AGENTES, no sobre
--     moderación; quitárselo sería un cambio de alcance que nadie pidió.
--   · users_select (identidad del buscador) queda igual — esa mitad de §19.2 ya
--     la resolvió 20260702000001 y la cubre 08_rls_lead_searcher_test.sql.
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS.
-- Rollback: supabase/migrations/rollbacks/20260809000001_events_raw_lead_gate.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Helper: private.can_view_user_events(user_id, property_id)
--    security definer + search_path = '' (todo calificado): la policy consulta
--    leads y properties, y sin definer la RLS de ESAS tablas se aplicaría dentro
--    de la evaluación — dependencia circular y denegaciones fantasma.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.can_view_user_events(p_user_id uuid, p_property_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.leads l
    join public.properties pr on pr.id = p_property_id
    where l.user_id = p_user_id
      and l.deleted_at is null
      -- La publicación es DEL AGENTE DEL LEAD (§19.2: "todas las publicaciones
      -- del agente"), no de cualquiera que comparta agencia.
      and pr.owner_user_id = l.agent_id
      -- …y quien pregunta es ese agente, o quien gestiona su agencia.
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin'))
  );
$$;

comment on function private.can_view_user_events(uuid, uuid) is
  'RLS/§19.2: true si p_user_id tiene un lead ACTIVO cuyo agente es dueño de '
  'p_property_id, y el usuario autenticado es ese agente o el owner/admin de la '
  'agencia del lead. Traduce la regla del PRD "el agente ve el historial '
  'retroactivo del usuario con TODAS sus publicaciones, pero SOLO tras el '
  'contacto". Al derivarse del lead, borrar el lead revoca el acceso.';

grant execute on function private.can_view_user_events(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) events_raw_select — se sustituye la condición de propiedad por la del lead.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists events_raw_select on public.events_raw;
create policy events_raw_select on public.events_raw for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_admin()
    or private.can_view_user_events(user_id, property_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Índice de apoyo: el helper filtra leads por (user_id, deleted_at is null).
--    leads_agency_idx (20260807000006) cubre agency_id; falta la entrada por
--    usuario, que es por donde entra esta policy en CADA fila leída.
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists leads_user_active_idx
  on public.leads (user_id, agent_id) where deleted_at is null;

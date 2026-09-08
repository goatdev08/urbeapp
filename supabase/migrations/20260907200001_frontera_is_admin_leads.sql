-- Migración 20260907200001 — subtarea 276.1 (derivada hardening(226), origen:
-- hallazgo del guardian de 269.3): retiro puro de `private.is_admin()` de TRES
-- objetos de escritura sobre public.leads, para que la frontera de ESCRITURA
-- tenga UNA sola vía: la relación real con el lead (agente dueño, o
-- owner/admin ACTIVO de la agencia DEL LEAD vía private.agency_role_of).
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ (coherencia con #226) — desde 20260901000001 (#226, fix de fuga de
-- PII) `leads_select` ya NO incluye `is_admin()`: un admin de PLATAFORMA sin
-- membresía de agencia no lee pipeline comercial ajeno. Postgres exige que una
-- fila sea VISIBLE por la policy de SELECT de la tabla ADEMÁS de pasar el
-- USING/WITH CHECK de UPDATE/DELETE — así que la rama `is_admin()` de
-- leads_update/leads_delete quedó INERTE para ese mismo admin desde #226
-- (verificado: 77_leads_admin_plataforma_test.sql solo prueba SELECT, nunca
-- detectó el arrastre). private.can_edit_lead, en cambio, es SECURITY DEFINER
-- y BYPASSA leads_select por completo — ahí la rama SEGUÍA VIVA: un admin de
-- plataforma podía insertar `lead_origin_properties` (policy lead_origin_insert,
-- gateada por can_edit_lead) para un lead que no puede ver — escribir a
-- ciegas lo que no se puede leer. Ese es el hallazgo real del guardian de
-- 269.3 y lo que este retiro cierra: quien no puede LEER un lead no debe
-- poder ESCRIBIRLO (ni directo, ni por el efecto lateral de lead_origin_insert).
--
-- QUÉ CAMBIA (retiro puro, sin ampliar ningún permiso — decisión de Abraham
-- 2026-09-07, verificada contra producción: los leads reales pertenecen a un
-- owner ACTIVO que conserva la escritura por agency_role_of; existe UN admin
-- de plataforma sin ninguna membresía, `10000000-0000-0000-0000-00000000000c`,
-- que es justo el perfil cuyo camino a ciegas se cierra):
--   1) private.can_edit_lead(uuid) — pierde `or private.is_admin()`.
--      Queda: agent_id=auth.uid() or agency_role_of(agency_id) in (owner,admin).
--   2) policy leads_update (USING = WITH CHECK) — pierde `or private.is_admin()`.
--      Queda: la misma fórmula que (1) (mismo patrón que properties_update).
--   3) policy leads_delete (USING) — pierde `or private.is_admin()` y NO gana
--      agency_role_of (no es "igualar a leads_update", es RETIRO PURO — ver
--      freno deliberado abajo). Queda SOLO: agent_id=auth.uid().
--
-- 🔴 FRENO DELIBERADO en leads_delete (NO se amplía a owner/admin) — el
-- borrado real sobre `leads` está DORMIDO: cero `.delete()` en `mobile/src` ni
-- en `supabase/functions`; el producto borra en SUAVE (`deleted_at`, índice
-- único parcial `leads_agent_user_unique_active ... where deleted_at is
-- null`). Darle a owner/admin un poder de borrado DURO nuevo, sobre una ruta
-- que nadie ejerce, solo por simetría cosmética con leads_update/can_edit_lead,
-- es justo lo que el default conservador de CLAUDE.md §8 evita: no se amplía
-- alcance sin que el producto lo pida. leads_delete sigue siendo, tras esta
-- migración, la frontera MÁS ANGOSTA de las tres: edición se comparte con el
-- equipo (owner/admin activos de la agencia), el borrado duro se queda con el
-- dueño del registro.
--
-- QUÉ NO CAMBIA (guardas contra sobre-alcance, ver CAT6/CAT7 en
-- 110_frontera_is_admin_leads_test.sql) — leads_insert y lead_origin_delete
-- CONSERVAN `private.is_admin()` a propósito: son decisión #226 vigente (el
-- admin de plataforma sigue pudiendo crear leads/limpiar orígenes por
-- petición del titular), fuera del footprint de 276.1. No se tocan aquí.
--
-- IMPACTO-PROD (§0.5) — es un CONTRACT (se revoca una rama de policy/función
-- ya publicada), pero SIN ventana de incompatibilidad ni orden OTA-primero:
--   - La rama en leads_update/leads_delete ya estaba INERTE (razonamiento
--     arriba) — retirarla no cambia ningún resultado observable hoy.
--   - La rama en can_edit_lead SÍ estaba viva, pero nada en producción la
--     ejerce como `authenticated`: la única escritura de lead_origin_properties
--     en producción la hace la Edge Function `contact-agent` con
--     `service_role`, que BYPASSA RLS por completo (no pasa por can_edit_lead).
--   - Ningún cliente instalado (APK/TestFlight) llama a este contrato desde
--     el móvil: no hace falta OTA antes de aplicar al remoto.
--
-- Idempotente: create or replace function + drop policy if exists/create policy.
-- Rollback: supabase/migrations/rollbacks/20260907200001_frontera_is_admin_leads.sql
-- (restaura las 3 definiciones EXACTAS de hoy: can_edit_lead/leads_update de
-- 20260906400003, leads_delete de 20260604000010:334-336).
-- Tests: supabase/tests/110_frontera_is_admin_leads_test.sql (nuevo, plan(30)).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function private.can_edit_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin'))
  );
$$;

comment on function private.can_edit_lead(uuid) is
  'RLS: true si el usuario autenticado puede EDITAR el lead p_lead_id -- es su '
  'agente dueño (agent_id), o tiene membresía ACTIVA owner/admin en la agencia '
  'DEL LEAD (leads.agency_id vía private.agency_role_of, que ya filtra por '
  'status=active). Gatea también la policy lead_origin_insert (efecto lateral, '
  'sin cambio de código). Subtarea 276.1 (derivada hardening(226), decisión '
  'Abraham 2026-09-07): se RETIRA `private.is_admin()` -- un admin de '
  'PLATAFORMA sin relación de agencia ya no puede escribir a ciegas (INSERT en '
  'lead_origin_properties, vía lead_origin_insert) un lead que tampoco puede '
  'LEER (leads_select no incluye is_admin() desde #226). Coherencia con #226: '
  'quien no puede LEER un lead no debe poder ESCRIBIRLO. leads_insert y '
  'lead_origin_delete CONSERVAN is_admin() a propósito -- decisión #226 '
  'vigente, fuera del footprint de 276.1, no se tocan aquí.';

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
  )
  with check (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
  );

comment on policy leads_update on public.leads is
  'Subtarea 276.1 (derivada hardening(226), decisión Abraham 2026-09-07): se '
  'RETIRA `private.is_admin()` de la expresión de 269.3 (20260906400003) -- '
  'la rama ya estaba INERTE (Postgres exige que la fila sea visible por '
  'leads_select, que no incluye is_admin() desde #226) así que el retiro no '
  'cambia ningún resultado observable. Queda agent_id=auth.uid() or '
  'agency_role_of(agency_id) in (owner,admin), USING=WITH CHECK -- mismo '
  'patrón que properties_update (#100/#202). leads_insert y lead_origin_delete '
  'CONSERVAN is_admin() a propósito -- fuera del footprint de 276.1.';

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (agent_id = (select auth.uid()));

comment on policy leads_delete on public.leads is
  'Subtarea 276.1 (derivada hardening(226), decisión Abraham 2026-09-07): se '
  'RETIRA `private.is_admin()` de la expresión de 20260604000010:334-336 -- '
  'igual que en leads_update, la rama ya estaba INERTE por #226. A DIFERENCIA '
  'de leads_update/can_edit_lead, esta policy NO gana `private.agency_role_of` '
  '(RETIRO PURO, no unificación): el borrado DURO sobre leads está DORMIDO en '
  'producción (el producto borra en SUAVE vía deleted_at); dar a owner/admin '
  'un poder de borrado nuevo, sobre una ruta que nadie ejerce, solo por '
  'simetría con leads_update, es la ampliación de alcance que CLAUDE.md §8 '
  'evita por default. Queda SOLO agent_id=auth.uid() -- el borrado duro se '
  'queda con el dueño del registro. leads_insert y lead_origin_delete '
  'CONSERVAN is_admin() a propósito -- fuera del footprint de 276.1.';

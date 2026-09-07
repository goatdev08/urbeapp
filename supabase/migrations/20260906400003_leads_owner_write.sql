-- Migración 20260906400003 — cierre de #31 (subtarea 269.3): el owner/admin
-- ACTIVO de la agencia DEL LEAD (leads.agency_id, no la membresía "hoy" del
-- agente) ya puede EDITAR (no solo leer) los leads del equipo. Decisión de
-- Abraham 2026-09-07. Impacto-prod: AMPLIACIÓN pura de un contrato publicado
-- (nadie pierde acceso: el agente dueño sigue escribiendo su propio lead,
-- is_admin() se conserva) — sin expand→contract.
--
-- Redefine EXACTAMENTE 2 objetos, mismo patrón que properties_update (#100/#202,
-- 20260904100001): private.can_edit_lead (20260604000010:96) y la policy
-- leads_update (20260604000010:330-333, USING = WITH CHECK, no toca
-- leads_select/leads_insert/leads_delete). private.agency_role_of
-- (20260805000003) ya filtra por status='active' -- un suspendido/removido
-- resuelve NULL, nunca entra al IN('owner','admin'); reusado tal cual, sin
-- helper nuevo (rung 2 de la escalera: ya existe, no se reescribe).
--
-- Efecto lateral (sin cambio de código, heredado): private.can_edit_lead
-- también gatea la policy lead_origin_insert (20260604000010:343-344) -- el
-- owner/admin activo ahora también puede insertar un lead_origin_properties
-- para un lead de su agente.
--
-- 🔴 NO incluido a propósito (hallazgo del test-author, ver cabecera de
-- supabase/tests/109_leads_owner_write_test.sql): la rama `is_admin()` de
-- leads_update/leads_delete quedó INERTE desde 20260901000001 (#226, fuga de
-- PII) porque Postgres exige que la fila sea visible por leads_select ADEMÁS
-- de pasar el USING de UPDATE, y leads_select ya no incluye is_admin(). Esta
-- migración CONSERVA la rama tal cual estaba (no la resucita, no la retira) --
-- resolverlo es la derivada hardening(226) que decide Abraham.
--
-- Idempotente: create or replace function + drop policy if exists/create policy.
-- Rollback: supabase/migrations/rollbacks/20260906400003_leads_owner_write.sql
-- (restaura la definición EXACTA de 20260604000010:96/331-333).
-- Tests: supabase/tests/109_leads_owner_write_test.sql (nuevo, 15 asserts) +
-- inversión de 30_leads_admin_visibility_test.sql (I9/I10) y
-- 31_leads_agency_id_denorm_test.sql (I5).

create or replace function private.can_edit_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin')
           or private.is_admin())
  );
$$;

comment on function private.can_edit_lead(uuid) is
  'RLS: true si el usuario autenticado puede EDITAR el lead p_lead_id -- es su '
  'agente dueño (agent_id), o tiene membresía ACTIVA owner/admin en la agencia '
  'DEL LEAD (leads.agency_id vía private.agency_role_of, que ya filtra por '
  'status=active), o es admin de plataforma (private.is_admin()). Cierre de #31 '
  '(subtarea 269.3, decisión Abraham 2026-09-07): hasta acá can_edit_lead solo '
  'daba agent_id=self/is_admin(); la visibilidad (private.can_view_lead) ya '
  'incluía owner/admin de agencia desde 75.5/75.5-bis/#226, pero la ESCRITURA se '
  'había dejado a propósito solo para el agente dueño. Gatea también la policy '
  'lead_origin_insert (20260604000010:343-344) -- efecto lateral heredado, sin '
  'cambio de código. is_admin() se conserva por #226 (77_leads_admin_plataforma_test) '
  'aunque hoy esté INERTE para escritura sin relación de agencia (ver hallazgo del '
  'test-author en 109_leads_owner_write_test.sql, sección 12/cabecera BLOQUEANTE) -- '
  'no se resuelve aquí (fuera del footprint de 269.3, es la derivada hardening(226)).';

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  )
  with check (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  );

comment on policy leads_update on public.leads is
  'Cierre de #31 (subtarea 269.3, decisión Abraham 2026-09-07): agrega '
  'private.agency_role_of(agency_id) in (owner,admin) a la expresión vieja '
  '(agent_id=auth.uid() or is_admin(), 20260604000010:331-333) -- mismo patrón '
  'EXACTO que properties_update (#100/#202, 20260904100001): USING mira la '
  'agencia VIEJA de la fila, WITH CHECK mira la fila NUEVA -- el owner/admin '
  'puede reasignar agent_id DENTRO de su agencia (agency_id sin cambiar) pero no '
  'puede RELOCALIZAR el lead (agent_id+agency_id) hacia una agencia donde no es '
  'owner/admin (WITH CHECK lo rechaza, D-WITHCHECK en 109_leads_owner_write_test.sql). '
  'NO valida que el agent_id nuevo sea miembro activo de esa agencia cuando '
  'agency_id no cambia -- esa validación más fina vive en la RPC dedicada '
  'reassign_lead_atomic (269.2, 20260906400002), que es el canal oficial de '
  'reasignación; esta policy es la red de seguridad genérica contra un PATCH crudo.';

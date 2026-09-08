-- Rollback de 20260907200001 (subtarea 276.1) — restaura las 3 definiciones
-- EXACTAS de ANTES de este retiro:
--   - private.can_edit_lead y policy leads_update: tal cual quedaron en
--     20260906400003_leads_owner_write.sql (agrega de vuelta `or
--     private.is_admin()` a ambas expresiones, USING=WITH CHECK).
--   - policy leads_delete: tal cual quedó en
--     20260604000010_security_perf_hardening.sql:334-336 (agrega de vuelta
--     `or private.is_admin()`, sin rama de agencia).
--
-- ⚠️ Al revertir, un admin de PLATAFORMA sin membresía de agencia vuelve a
-- poder INSERTAR lead_origin_properties (vía can_edit_lead/lead_origin_insert)
-- para un lead ajeno que no puede leer -- reabre el hallazgo del guardian de
-- 269.3 que esta migración cierra. La rama is_admin() de leads_update/
-- leads_delete sigue INERTE en la práctica (Postgres exige visibilidad vía
-- leads_select, que no incluye is_admin() desde #226) así que su reaparición
-- ahí no cambia comportamiento observable -- solo el catálogo (CAT1-CAT4 de
-- 110_frontera_is_admin_leads_test.sql vuelven a fallar, como se espera de un
-- rollback correcto). Idempotente y no destructivo (create or replace + drop
-- policy if exists).

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

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (agent_id = (select auth.uid()) or private.is_admin());

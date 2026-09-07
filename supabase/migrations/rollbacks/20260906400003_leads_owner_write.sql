-- Rollback de 20260906400003 (cierre de #31, subtarea 269.3) — restaura las
-- definiciones EXACTAS previas de private.can_edit_lead y la policy
-- leads_update, tal cual quedaron en 20260604000010:96 y :330-333 (sin la
-- rama private.agency_role_of(agency_id) in ('owner','admin')).
--
-- ⚠️ Al revertir, el owner/admin ACTIVO de la agencia del lead vuelve a NO
-- poder editar (UPDATE) los leads del equipo -- solo el agente dueño (o
-- is_admin(), aunque esa rama ya esté inerte para escritura sin relación de
-- agencia, ver comentario del hallazgo en la migración que se revierte) puede
-- escribir. Efecto lateral: lead_origin_insert (gateada por can_edit_lead)
-- vuelve a rechazar el INSERT del owner/admin sobre leads que no son suyos.
-- Idempotente y no destructivo (create or replace + drop policy if exists).

create or replace function private.can_edit_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id and (l.agent_id = (select auth.uid()) or private.is_admin())
  );
$$;

comment on function private.can_edit_lead(uuid) is null;

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (agent_id = (select auth.uid()) or private.is_admin())
  with check (agent_id = (select auth.uid()) or private.is_admin());

comment on policy leads_update on public.leads is null;

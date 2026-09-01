-- Rollback de 20260901000001 — restaura las definiciones EXACTAS de
-- 20260807000006 (75.5-bis): leads_select y private.can_view_lead CON
-- `or private.is_admin()`. Solo para revertir el fix #226 si algo truena.

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    agent_id = (select auth.uid())
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  );

comment on policy leads_select on public.leads is
  'Fix 75.5-bis: reemplaza is_agency_owner_of(agent_id) OR is_agency_admin_of(agent_id) '
  '(membresía compartida HOY entre caller y agente, ignoraba la agencia REAL del lead) por '
  'agency_role_of(agency_id) in (owner,admin), siempre escapada a la agencia donde nació '
  'el lead.';

create or replace function private.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.agency_role_of(l.agency_id) in ('owner', 'admin')
           or private.is_admin())
  );
$$;

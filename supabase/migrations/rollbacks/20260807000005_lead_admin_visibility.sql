-- Rollback: 20260807000005_lead_admin_visibility.sql
-- Restaura leads_select, private.can_view_lead y private.can_view_user_as_lead_searcher a
-- sus definiciones previas (sin la cláusula private.is_agency_admin_of), y elimina el
-- helper nuevo.

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (agent_id = (select auth.uid()) or private.is_agency_owner_of(agent_id) or private.is_admin());

create or replace function private.can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and (l.agent_id = (select auth.uid())
           or private.is_agency_owner_of(l.agent_id)
           or private.is_admin())
  );
$$;

create or replace function private.can_view_user_as_lead_searcher(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.user_id = p_user_id
      and l.deleted_at is null
      and (l.agent_id = (select auth.uid()) or private.is_agency_owner_of(l.agent_id))
  );
$$;

drop function if exists private.is_agency_admin_of(uuid);

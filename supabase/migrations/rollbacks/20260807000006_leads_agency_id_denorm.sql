-- Rollback: 20260807000006_leads_agency_id_denorm.sql
-- Restaura leads_select, private.can_view_lead y private.can_view_user_as_lead_searcher a
-- sus definiciones de 20260807000005 (con is_agency_owner_of OR is_agency_admin_of),
-- recrea private.is_agency_admin_of, y quita el trigger/columna nuevos.
-- Nota: no se revierte el backfill de agency_id ni se resetea a NULL -- bajo el código
-- viejo (membresía compartida HOY) un agency_id ya poblado es inofensivo (mismo criterio
-- que el rollback de #100, 20260805000011).

drop trigger if exists trg_set_lead_agency_id on public.leads;
drop function if exists private.set_lead_agency_id();

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

grant execute on function private.is_agency_admin_of(uuid) to anon, authenticated, service_role;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    agent_id = (select auth.uid())
    or private.is_agency_owner_of(agent_id)
    or private.is_agency_admin_of(agent_id)
    or private.is_admin()
  );

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

alter table public.leads
  drop column if exists agency_id;

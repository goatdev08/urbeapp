-- Rollback: 20260809000001_events_raw_lead_gate.sql
-- Restaura events_raw_select a la versión de 20260808000001 (#112), es decir
-- REABRE la fuga de §19.2 que esta migración cerró: el agente vuelve a leer las
-- interacciones de cualquier usuario sobre sus propiedades, haya contactado o no.
-- Úsalo solo si el cierre rompe el CRM en producción; no es un rollback benigno.
-- Nota: no hay datos que revertir — esta migración solo cambió permisos.

drop policy if exists events_raw_select on public.events_raw;
create policy events_raw_select on public.events_raw for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_manage_property(property_id)
  );

drop index if exists public.leads_user_active_idx;

drop function if exists private.can_view_user_events(uuid, uuid);

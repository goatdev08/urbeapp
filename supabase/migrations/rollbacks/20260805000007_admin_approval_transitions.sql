-- Rollback de 20260805000007_admin_approval_transitions.sql (subtarea 71.5)
--
-- Re-ejecutable: `drop ... if exists` y los grants son idempotentes por naturaleza.

drop trigger if exists agencies_status_change on public.agencies;
drop trigger if exists agent_applications_status_change on public.agent_applications;

drop function if exists public.handle_agency_status_change();
drop function if exists public.handle_agent_application_status_change();
drop function if exists private.resolve_admin_actor();

-- Restaura los grants que 0008 le había dado a `authenticated` sobre admin_actions.
-- Ojo: restaurarlos NO reabre INSERT (nunca se tocó) -- solo permite de nuevo
-- UPDATE/DELETE con éxito silencioso filtrado por RLS (comportamiento previo a esta
-- migración: 0 filas, no excepción, porque no hay política RLS de UPDATE/DELETE).
grant update, delete on public.admin_actions to authenticated;

-- ⚠️ Esto RESTAURA UN AGUJERO CONOCIDO, a propósito (mismo patrón que el rollback de
-- 20260727000003_legal_gate.sql): el estado previo a esta migración era el default de
-- fábrica de Supabase (anon y authenticated con TRUNCATE sobre toda tabla de public).
-- La tarea #92 lo cierra de forma sistémica para todas las tablas append-only.
grant truncate on public.admin_actions to anon, authenticated;

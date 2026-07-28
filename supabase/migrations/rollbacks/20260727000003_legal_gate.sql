-- Rollback de 20260727000003_legal_gate.sql (#72.6)
--
-- Re-ejecutable: `drop ... if exists` y los grants son idempotentes por naturaleza.

drop function if exists public.pending_legal_consents();

-- Restaura los grants de tabla que 0008 le había dado a `authenticated` sobre
-- user_consents. Ojo: restaurarlos NO vuelve la tabla mutable — sigue sin haber
-- políticas RLS de UPDATE/DELETE, que es el candado original de 0004.
grant update, delete on public.user_consents to authenticated;

-- ⚠️ Esto RESTAURA UN AGUJERO CONOCIDO, a propósito: un rollback debe devolver el
-- estado previo, y el previo era el default de fábrica de Supabase (anon y
-- authenticated con TRUNCATE sobre toda tabla de public). Si lo que quieres es revertir
-- la RPC pero NO reabrir el agujero, comenta esta línea — la tarea #92 lo va a cerrar
-- de forma sistémica para las 21+ tablas de public de todos modos.
grant truncate on public.user_consents to anon, authenticated;

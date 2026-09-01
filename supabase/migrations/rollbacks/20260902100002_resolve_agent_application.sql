-- Rollback de 20260902100002_resolve_agent_application.sql (subtarea #221.2).
--
-- DROPEA la función nueva y nada más: esa migración es aditiva pura (no tocó
-- policies, trigger, columnas ni grants preexistentes), así que revertirla es
-- exactamente esto.
--
-- ⚠️ Tras este rollback, el panel admin pierde la RPC pero NO pierde la
-- capacidad de resolver solicitudes: el camino vivo desde 71.5 (UPDATE directo
-- con JWT de admin, policy agent_app_update + trigger) sigue intacto porque
-- esta migración nunca lo tocó. El cliente móvil que llame a la RPC recibirá
-- 404 de PostgREST — si ya salió por OTA, hacer el rollback del cliente
-- PRIMERO (orden OTA-primero, §0.5).

drop function if exists public.resolve_agent_application(uuid, boolean, text);

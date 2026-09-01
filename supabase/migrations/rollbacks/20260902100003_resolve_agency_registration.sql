-- Rollback de 20260902100003_resolve_agency_registration.sql (subtarea #221.2).
--
-- DROPEA la función nueva y nada más: la migración es aditiva pura (no tocó el
-- trigger, ni set_agency_status_atomic, ni grants, ni columnas).
--
-- ⚠️ Tras este rollback, el carril de registros de inmobiliaria vuelve a
-- quedarse SIN puerta admin desde el panel (ese era justo el hueco que la
-- migración cerró): aprobar solo vía Studio/GUC, rechazar sin camino. Si el
-- cliente ya salió por OTA llamando a esta RPC, revertir el cliente PRIMERO
-- (orden OTA-primero, §0.5) — si no, la cola responderá 404 de PostgREST.
--
-- Las filas 'reject_agency_registration' ya escritas en admin_actions se
-- QUEDAN: son auditoría append-only (historia), no esquema.

drop function if exists public.resolve_agency_registration(uuid, boolean, text);

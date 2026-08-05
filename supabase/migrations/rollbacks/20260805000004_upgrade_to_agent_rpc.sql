-- Rollback — elimina la RPC atómica de upgrade a agente.
-- No hay cambios de esquema (solo una función), así que el rollback es el drop de la función.
drop function if exists public.upgrade_to_agent_atomic(uuid, text);

-- Rollback — elimina la RPC atómica de registro (register_user_atomic).
-- No hay cambios de esquema (solo una función), así que el rollback es el drop de la función.
drop function if exists public.register_user_atomic(uuid, inet);

-- Rollback 0013 — elimina la RPC atómica de canje de invitación.
-- No hay cambios de esquema (solo una función), así que el rollback es el drop de la función.
drop function if exists public.redeem_invitation_atomic(uuid, uuid, inet);

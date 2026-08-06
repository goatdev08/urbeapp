-- Rollback — elimina la RPC atómica de autoregistro de inmobiliaria.
-- No hay cambios de esquema (solo una función), así que el rollback es el drop de la función.
drop function if exists public.register_agency_atomic(text, text, text, text, text, uuid, text);

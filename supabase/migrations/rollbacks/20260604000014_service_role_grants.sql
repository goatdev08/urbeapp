-- Rollback 0014 — Revierte los privilegios de service_role sobre public
--
-- ADVERTENCIA: ejecutar este rollback vuelve a romper la capa de servicio de las
-- Edge Functions (supabase-js con service_role recibirá 403 en consultas directas).
-- Solo usar si se quiere restaurar el estado defectuoso previo a 0014.

-- Revertir default privileges (debe coincidir con el rol que ejecutó la migración)
alter default privileges in schema public
  revoke select, insert, update, delete on tables from service_role;

alter default privileges in schema public
  revoke usage, select on sequences from service_role;

alter default privileges in schema public
  revoke execute on routines from service_role;

-- Revocar los grants explícitos sobre objetos existentes
revoke execute on all routines in schema public from service_role;
revoke usage, select on all sequences in schema public from service_role;
revoke select, insert, update, delete on all tables in schema public from service_role;
-- Nota: NO se revoca `usage on schema public` (anon/authenticated también lo usan;
-- service_role lo tenía por defecto). Revocarlo afectaría el acceso base del rol.

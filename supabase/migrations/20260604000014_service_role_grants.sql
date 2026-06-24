-- Migración 0014 — Restablece los privilegios de `service_role` sobre el esquema public
--
-- Contexto / bug que corrige:
--   La migración 0008 otorga DML al rol `authenticated` (y SELECT acotado a `anon`),
--   pero NUNCA otorga privilegios a `service_role`. En una instalación estándar de
--   Supabase `service_role` recibe `GRANT ALL ON ALL TABLES ... TO service_role` vía
--   los default privileges del rol propietario; al aplicar estas migraciones por fuera
--   de ese flujo, `service_role` quedó sin SELECT/INSERT/UPDATE/DELETE en NINGUNA tabla
--   de public. Resultado: el cliente supabase-js con `service_role` (la capa de servicio
--   de las Edge Functions) recibía 403 de PostgREST en cualquier consulta directa.
--   `service_role` SÍ tiene rolbypassrls=true (RLS no era el problema); lo que faltaba
--   eran los grants de tabla.
--
--   La RPC `redeem_invitation_atomic` (0013) seguía funcionando porque es SECURITY DEFINER
--   y corre como su dueño (postgres), de modo que el bug pasó desapercibido hasta probar
--   las Edge Functions que leen tablas directamente (p. ej. validate-invitation).
--
-- Arquitectura (lineamientos §): `service_role` es la capa de servicio confiable de las
--   Edge Functions; debe tener DML completo en public. Las protecciones anti-escalación
--   (revokes/column-grants de 0008) aplican SOLO a anon/authenticated — el backend confiable
--   no se restringe a nivel de columna.
--
-- Idempotente: los GRANT son idempotentes por naturaleza. Incluye ALTER DEFAULT PRIVILEGES
--   para que las tablas/secuencias/funciones creadas a futuro por el rol que aplica las
--   migraciones también otorguen a service_role.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Uso del esquema y DML completo sobre todas las tablas existentes
-- ════════════════════════════════════════════════════════════════════════════
grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;

-- Secuencias (para defaults serial/identity al insertar desde el backend)
grant usage, select on all sequences in schema public to service_role;

-- Rutinas/funciones de negocio expuestas en public (p. ej. RPC del backend)
grant execute on all routines in schema public to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Default privileges — tablas/secuencias/funciones futuras
-- ════════════════════════════════════════════════════════════════════════════
-- Aplica a los objetos creados por el rol que ejecuta esta sentencia (el rol de migración).
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

alter default privileges in schema public
  grant execute on routines to service_role;

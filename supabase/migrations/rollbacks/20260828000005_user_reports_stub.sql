-- Rollback: 20260828000005_user_reports_stub.sql (subtarea #220.6)
-- Quita la tabla user_reports (STUB o GREEN, misma tabla base). Tabla nueva y
-- aditiva (§0.5) — sin datos en producción hasta que 220.6 despliegue.

drop table if exists public.user_reports;

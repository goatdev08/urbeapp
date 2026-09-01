-- Rollback de 20260902200002_properties_within_municipality.sql (tarea #160)
--
-- La migración es puramente aditiva (crea una función nueva; no toca tablas,
-- columnas, filas ni contratos existentes), así que revertir es eliminarla.
--
-- ⚠️ ORDEN OTA-PRIMERO (§0.5): esta función la estrena el cliente del mapa. Si
-- ya salió un build/OTA que la llama, dropearla lo deja sin la rama de
-- municipio — revertir el cliente PRIMERO y esta migración después.
--
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/rollbacks/20260902200002_properties_within_municipality.sql

drop function if exists public.properties_within_municipality(text);

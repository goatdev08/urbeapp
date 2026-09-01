-- Rollback de 20260902200003_place_at_point.sql (subtarea 232.1)
--
-- La migración es puramente aditiva (crea una función nueva; no toca tablas,
-- columnas, filas ni contratos existentes), así que revertir es eliminarla.
--
-- ⚠️ ORDEN OTA-PRIMERO (§0.5): la estrena el buscador unificado de #232
-- (232.2/232.3). Si ya salió un build/OTA que la llama, revertir el cliente
-- PRIMERO y esta migración después, o el buscador se queda sin la rama de
-- direcciones.
--
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/rollbacks/20260902200003_place_at_point.sql

drop function if exists public.place_at_point(double precision, double precision);

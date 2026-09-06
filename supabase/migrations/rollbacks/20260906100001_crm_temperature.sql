-- Rollback de 20260906100001_crm_temperature.sql (subtarea 266.2).
-- Aditiva pura (2 funciones nuevas en `private`, ninguna tabla/columna tocada): el rollback
-- es simplemente eliminarlas. Nada más depende de ellas hasta 266.4–266.6 (aún no existen
-- en esta subtarea), así que no hay CASCADE que temer.

drop function if exists private.crm_temperature(uuid, uuid, timestamptz);
drop function if exists private.crm_band(boolean, int, int, int, timestamptz, timestamptz, timestamptz);

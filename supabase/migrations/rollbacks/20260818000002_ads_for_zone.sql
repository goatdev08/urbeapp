-- Rollback de 20260818000002_ads_for_zone.sql (subtarea #170.2)
--
-- public.ads_for_zone es una función 100% nueva (sin versión previa que
-- restaurar, a diferencia del rollback de 20260818000001) -- drop function
-- basta. Re-ejecutable (if exists).

drop function if exists public.ads_for_zone(double precision, double precision, bigint, text);

-- Rollback: 20260824000001_ad_stats_per_ad.sql
-- Elimina las 3 funciones NUEVAS. No hay datos que revertir -- ninguna tabla
-- ni columna se tocó, solo 3 funciones RPC de lectura aditivas (cero
-- llamadores instalados). Idempotente (if exists).

drop function if exists public.ad_stats_totals(uuid, timestamptz, timestamptz);
drop function if exists public.ad_stats_daily(uuid, timestamptz, timestamptz);
drop function if exists public.ad_stats_zones(uuid, timestamptz, timestamptz);

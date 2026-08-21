-- Rollback: 20260821000001_ad_metrics_for_agency.sql
-- Elimina la función public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) por
-- completo. No hay datos que revertir -- esta migración solo agregó una función RPC de
-- solo lectura (agregados sobre ad_impressions), ninguna tabla ni columna nueva.

drop function if exists public.ad_metrics_for_agency(uuid, timestamptz, timestamptz);

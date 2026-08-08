-- Rollback: 20260808000002_get_lead_stats_rpc.sql
-- Elimina la función public.get_lead_stats(uuid[]) por completo. No hay datos que
-- revertir -- esta migración solo agregó una función RPC de solo lectura, ningún dato ni
-- columna nueva.

drop function if exists public.get_lead_stats(uuid[]);
